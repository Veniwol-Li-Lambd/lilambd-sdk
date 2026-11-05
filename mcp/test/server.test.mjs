import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLilambdServer } from "../dist/server.js";
import { loadCatalog } from "../dist/catalog.js";
import { toolName, routeSlug, TOOL_NAME_RE } from "../dist/tools.js";
import { buildUrl } from "../dist/client.js";

const catalog = loadCatalog();
const ROUTES = catalog.products.reduce((n, p) => n + p.routes.length, 0);

function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return handler(String(url), init, calls.length);
  };
  f.calls = calls;
  return f;
}
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const REQ = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x000000000000000000000000000000000000dEaD",
    },
  ],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

async function connect(opts) {
  const { server } = createLilambdServer({ toolset: "", ...opts });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const cfg = (fetch, extra = {}) => ({ baseUrl: "https://api.test", fetch, ...extra });

test("catalog has 170 routes over 27 products", () => {
  assert.equal(catalog.products.length, 27);
  assert.equal(ROUTES, 170);
});

test("tool count == 170 routes + 2 meta, names valid and unique", async () => {
  const client = await connect({ config: cfg(mockFetch(() => json(200, {}))) });
  const { tools } = await client.listTools();
  assert.equal(tools.length, ROUTES + 2);
  const names = tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, TOOL_NAME_RE);
  assert.ok(names.includes("list_products"));
  assert.ok(names.includes("call"));
  assert.ok(names.includes("airports_search"));
  assert.ok(names.includes("airports_by_code"));
});

test("slugging", () => {
  assert.equal(routeSlug("/prefectures/{pref}/facts"), "prefectures_by_pref_facts");
  assert.equal(toolName("jp-health", "/prefectures/{pref}/facts"), "jp_health_prefectures_by_pref_facts");
  assert.equal(toolName("airports", "/{code}"), "airports_by_code");
  assert.equal(toolName("hazard", "/joint-exposure"), "hazard_joint_exposure");
});

test("every tool has a valid input schema matching catalog params", async () => {
  const { routeTools } = createLilambdServer({ toolset: "", config: cfg(mockFetch(() => json(200, {}))) });
  for (const t of routeTools) {
    const s = t.inputSchema;
    assert.equal(s.type, "object");
    assert.equal(s.properties.sample.type, "boolean");
    assert.ok(s.properties.limit && s.properties.offset);
    for (const p of t.route.params ?? []) {
      assert.ok(s.properties[p.name], `${t.name} missing ${p.name}`);
      if (p.in === "path") assert.ok(s.required?.includes(p.name), `${t.name} path param ${p.name} not required`);
    }
    for (const m of t.route.path.matchAll(/\{([^}]+)\}/g)) {
      assert.ok(s.required?.includes(m[1]), `${t.name} placeholder ${m[1]} not required`);
    }
    assert.match(t.description, t.free ? /Free/ : /\$[\d.]+ USDC per call/);
    if (!t.free) assert.match(t.description, /sample=true/);
  }
});

test("successful call builds the right URL", async () => {
  const f = mockFetch(() => json(200, { rows: [{ iata: "HND" }] }));
  const client = await connect({ config: cfg(f) });
  const r = await client.callTool({ name: "airports_by_code", arguments: { code: "HND" } });
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /HND/);
  assert.equal(f.calls[0].url, "https://api.test/airports/HND");
});

test("402 without signer returns isError with price, payTo, network, hint", async () => {
  const f = mockFetch(() => json(402, { error: "payment required" }, { "PAYMENT-REQUIRED": b64(REQ) }));
  const client = await connect({ config: cfg(f) });
  const r = await client.callTool({ name: "airports_search", arguments: { q: "tokyo" } });
  assert.equal(r.isError, true);
  const t = r.content[0].text;
  assert.match(t, /402/);
  assert.match(t, /\$0\.005 USDC/);
  assert.match(t, /payTo: 0x000000000000000000000000000000000000dEaD/);
  assert.match(t, /eip155:8453/);
  assert.match(t, /sample=true/);
  assert.match(t, /LILAMBD_PAYMENT_SIGNATURE_CMD/);
  assert.equal(f.calls.length, 1);
});

test("402 with signer command retries with PAYMENT-SIGNATURE", async () => {
  const f = mockFetch((url, init, n) =>
    n === 1 ? json(402, {}, { "PAYMENT-REQUIRED": b64(REQ) }) : json(200, { ok: true, sig: init.headers["payment-signature"] }),
  );
  // signer echoes a value derived from stdin (proves requirements JSON is piped in)
  const cmd = `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write('sig-'+JSON.parse(s).accepts[0].amount))"`;
  const client = await connect({ config: cfg(f, { signerCmd: cmd }) });
  const r = await client.callTool({ name: "airports_search", arguments: { q: "x" } });
  assert.ok(!r.isError, r.content[0].text);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].headers["payment-signature"], "sig-5000");
  assert.match(r.content[0].text, /sig-5000/);
});

test("sample param maps to sample=1; LILAMBD_DEFAULT_SAMPLE applies", async () => {
  const f = mockFetch(() => json(200, { rows: [] }));
  const client = await connect({ config: cfg(f) });
  const r = await client.callTool({ name: "airports_search", arguments: { q: "osaka", sample: true, limit: 2 } });
  assert.match(f.calls[0].url, /sample=1/);
  assert.match(f.calls[0].url, /q=osaka/);
  assert.match(f.calls[0].url, /limit=2/);
  assert.match(r.content[0].text, /free preview/);
  await client.callTool({ name: "airports_search", arguments: { q: "osaka", sample: false } });
  assert.doesNotMatch(f.calls[1].url, /sample/);

  const f2 = mockFetch(() => json(200, {}));
  const c2 = await connect({ config: cfg(f2, { defaultSample: true }) });
  await c2.callTool({ name: "colors_search", arguments: { q: "red" } });
  assert.match(f2.calls[0].url, /sample=1/);
  await c2.callTool({ name: "colors_search", arguments: { q: "red", sample: false } });
  assert.doesNotMatch(f2.calls[1].url, /sample/);
});

test("toolset filter limits tools", async () => {
  const client = await connect({ toolset: "airports, colors", config: cfg(mockFetch(() => json(200, {}))) });
  const { tools } = await client.listTools();
  const n = catalog.products.filter((p) => ["airports", "colors"].includes(p.id)).reduce((a, p) => a + p.routes.length, 0);
  assert.equal(tools.length, n + 2);
  assert.ok(tools.every((t) => ["list_products", "call"].includes(t.name) || /^(airports|colors)_/.test(t.name)));
});

test("list_products is free (no fetch) and call meta tool works", async () => {
  const f = mockFetch(() => json(200, { hello: 1 }));
  const client = await connect({ config: cfg(f) });
  const lp = await client.callTool({ name: "list_products", arguments: {} });
  const body = JSON.parse(lp.content[0].text);
  assert.equal(body.products.length, 27);
  assert.equal(f.calls.length, 0);
  const r = await client.callTool({ name: "call", arguments: { product: "units", route: "/{unit}", params: { unit: "m/s" }, sample: true } });
  assert.ok(!r.isError);
  assert.equal(f.calls[0].url, "https://api.test/units/m%2Fs?sample=1");
});

test("free routes are described as free; missing path param errors; upstream errors surface", async () => {
  const { routeTools } = createLilambdServer({ toolset: "", config: cfg(mockFetch(() => json(200, {}))) });
  assert.match(routeTools.find((t) => t.name === "security_stats").description, /Free/);
  const f = mockFetch(() => json(404, { error: "not found" }));
  const client = await connect({ config: cfg(f) });
  const r = await client.callTool({ name: "call", arguments: { product: "airports", route: "/{code}" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /missing required path parameter/);
  const r2 = await client.callTool({ name: "airports_by_code", arguments: { code: "ZZZ" } });
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /404/);
});

test("rapidapi headers", async () => {
  const f = mockFetch(() => json(200, {}));
  const client = await connect({ config: cfg(f, { rapidApiKey: "k", rapidApiHost: "h.example" }) });
  await client.callTool({ name: "colors_random", arguments: {} });
  assert.equal(f.calls[0].headers["x-rapidapi-key"], "k");
  assert.equal(f.calls[0].headers["x-rapidapi-host"], "h.example");
});

test("buildUrl encodes query", () => {
  assert.equal(buildUrl("https://b", "x", "/s", { q: "a b", n: 1, empty: "" }, []), "https://b/x/s?q=a+b&n=1");
});
