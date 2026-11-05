import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  Lilambd,
  LilambdError,
  PaymentRequiredError,
  PRODUCTS,
  ROUTES,
  buildUrl,
  encodeBase64,
  type FetchLike,
} from "../src/index.js";

const catalog = JSON.parse(readFileSync(new URL("../../spec/catalog.json", import.meta.url), "utf8")) as {
  products: { id: string; price_atomic: string; free_routes: string[]; routes: { path: string }[] }[];
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function mockFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
    const make = responses[Math.min(i++, responses.length - 1)];
    return make();
  });
  return { fetch: fn, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const challenge = {
  x402Version: 2,
  error: "payment required",
  resource: { url: "https://api.lilambd.com/airports/search" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 60,
    },
  ],
};
const paymentRequired = (amount = "5000") => {
  const c = { ...challenge, accepts: [{ ...challenge.accepts[0], amount }] };
  return json({ error: "payment required" }, 402, { "PAYMENT-REQUIRED": encodeBase64(JSON.stringify(c)) });
};

describe("URL building", () => {
  it("builds {base}/{product}{route}?query and skips undefined", () => {
    expect(buildUrl("https://api.lilambd.com/", "airports", "/search", { q: "tokyo", limit: 5, x: undefined })).toBe(
      "https://api.lilambd.com/airports/search?q=tokyo&limit=5",
    );
  });
  it("repeats array values and stringifies booleans", () => {
    expect(buildUrl("https://h", "p", "/r", { a: [1, 2], b: true })).toBe("https://h/p/r?a=1&a=2&b=true");
  });
  it("substitutes and encodes placeholders, removing them from the query", () => {
    expect(buildUrl("https://h", "jp-health", "/hospitals/{hospital_id}/mdc", { hospital_id: "a b/c", y: 1 })).toBe(
      "https://h/jp-health/hospitals/a%20b%2Fc/mdc?y=1",
    );
  });
  it("throws on a missing placeholder", () => {
    expect(() => buildUrl("https://h", "airports", "/{code}", {})).toThrow(LilambdError);
  });
  it("uses the generic get()", async () => {
    const m = mockFetch([json({ ok: 1 })]);
    const c = new Lilambd({ fetch: m.fetch });
    await expect(c.get("airports", "/{code}", { code: "HND" })).resolves.toEqual({ ok: 1 });
    expect(m.calls[0].url).toBe("https://api.lilambd.com/airports/HND");
  });
  it("discovery endpoints hit the root", async () => {
    const m = mockFetch([json({ ok: 1 })]);
    const c = new Lilambd({ fetch: m.fetch, baseUrl: "https://x.test" });
    await c.index();
    await c.openapi();
    await c.wellKnownX402();
    await c.health();
    await c.meta();
    expect(m.calls.map((x) => x.url)).toEqual([
      "https://x.test/",
      "https://x.test/openapi.json",
      "https://x.test/.well-known/x402",
      "https://x.test/health",
      "https://x.test/meta",
    ]);
  });
});

describe("generated namespaces", () => {
  it("airports.getByCode / airports.search", async () => {
    const m = mockFetch([json({})]);
    const c = new Lilambd({ fetch: m.fetch });
    await c.airports.getByCode({ code: "HND" });
    await c.airports.search({ q: "tokyo" });
    await c.jpHealth.hospitalsMdcByHospitalId({ hospital_id: "123" });
    expect(m.calls.map((x) => x.url)).toEqual([
      "https://api.lilambd.com/airports/HND",
      "https://api.lilambd.com/airports/search?q=tokyo",
      "https://api.lilambd.com/jp-health/hospitals/123/mdc",
    ]);
  });

  it("every generated method maps to exactly one catalog route", async () => {
    const expected = catalog.products.flatMap((p) => p.routes.map((r) => `${p.id} ${r.path}`)).sort();
    expect(ROUTES.map((r) => `${r.product} ${r.path}`).sort()).toEqual(expected);
    expect(ROUTES.length).toBe(170);

    const m = mockFetch([json({})]);
    const c = new Lilambd({ fetch: m.fetch, baseUrl: "https://t" }) as unknown as Record<
      string,
      Record<string, (p: object) => Promise<unknown>>
    >;
    for (const r of ROUTES) {
      const fn = c[r.namespace]?.[r.method];
      expect(typeof fn, `${r.namespace}.${r.method}`).toBe("function");
      const params: Record<string, string> = {};
      for (const ph of r.path.matchAll(/\{([^}]+)\}/g)) params[ph[1]] = "X";
      await fn(params);
      const want = "https://t/" + r.product + r.path.replace(/\{[^}]+\}/g, "X");
      expect(m.calls[m.calls.length - 1].url).toBe(want);
    }
    expect(m.calls.length).toBe(170);
  });

  it("PRODUCTS mirrors catalog prices", () => {
    expect(PRODUCTS.length).toBe(catalog.products.length);
    for (const p of catalog.products) {
      const meta = PRODUCTS.find((x) => x.id === p.id)!;
      expect(meta.priceAtomic).toBe(p.price_atomic);
      expect(meta.priceUsd).toBe(Number(p.price_atomic) / 1e6);
      expect([...meta.freeRoutes]).toEqual(p.free_routes);
    }
  });
});

describe("x402 payments", () => {
  it("parses a 402 into PaymentRequiredError with decoded requirements", async () => {
    const m = mockFetch([paymentRequired("5000")]);
    const c = new Lilambd({ fetch: m.fetch });
    const err: any = await c.airports.search({ q: "x" }).catch((e: any) => e);
    expect(err).toBeInstanceOf(PaymentRequiredError);
    expect(err.status).toBe(402);
    expect(err.priceUsd).toBe(0.005);
    expect(err.requirement.network).toBe("eip155:8453");
    expect(err.requirements).toHaveLength(1);
    expect(err.paymentRequired.x402Version).toBe(2);
  });

  it("falls back to the JSON body when the header is missing", async () => {
    const m = mockFetch([json(challenge, 402)]);
    const err: any = await new Lilambd({ fetch: m.fetch }).colors.random().catch((e: any) => e);
    expect(err).toBeInstanceOf(PaymentRequiredError);
    expect(err.priceUsd).toBe(0.005);
  });

  it("calls the signer and retries with PAYMENT-SIGNATURE", async () => {
    const m = mockFetch([paymentRequired("50000"), json({ rows: [1] })]);
    const signer = vi.fn(async () => "c2lnbmVk");
    const c = new Lilambd({ fetch: m.fetch, paymentSigner: signer });
    await expect(c.koyomi.holidays({ country: "JP" })).resolves.toEqual({ rows: [1] });
    expect(signer).toHaveBeenCalledOnce();
    const ctx = signer.mock.calls[0][0 as never] as unknown as { priceUsd: number; product: string; route: string };
    expect(ctx.priceUsd).toBe(0.05);
    expect(ctx.product).toBe("koyomi");
    expect(ctx.route).toBe("/holidays");
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0].headers["PAYMENT-SIGNATURE"]).toBeUndefined();
    expect(m.calls[1].headers["PAYMENT-SIGNATURE"]).toBe("c2lnbmVk");
  });

  it("supports the X-PAYMENT header alias", async () => {
    const m = mockFetch([paymentRequired(), json({})]);
    const c = new Lilambd({ fetch: m.fetch, paymentSigner: async () => "p", paymentHeader: "X-PAYMENT" });
    await c.units.constants();
    expect(m.calls[1].headers["X-PAYMENT"]).toBe("p");
  });

  it("refuses to pay above maxPriceUsd", async () => {
    const m = mockFetch([paymentRequired("500000")]);
    const signer = vi.fn(async () => "p");
    const c = new Lilambd({ fetch: m.fetch, paymentSigner: signer, maxPriceUsd: 0.1 });
    await expect(c.exposure.brief()).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(signer).not.toHaveBeenCalled();
  });

  it("throws when the paid retry is still 402", async () => {
    const m = mockFetch([paymentRequired(), paymentRequired()]);
    const c = new Lilambd({ fetch: m.fetch, paymentSigner: async () => "bad" });
    await expect(c.airports.search()).rejects.toThrow(/rejected/);
  });

  it("raises LilambdError for other HTTP errors", async () => {
    const m = mockFetch([json({ error: "not found" }, 404)]);
    const err: any = await new Lilambd({ fetch: m.fetch }).airports.getByCode({ code: "ZZZ" }).catch((e: any) => e);
    expect(err).toBeInstanceOf(LilambdError);
    expect(err.status).toBe(404);
    expect(err.message).toContain("not found");
  });
});

describe("sample mode", () => {
  it("adds sample=1 per call", async () => {
    const m = mockFetch([json({ rows: [] })]);
    await new Lilambd({ fetch: m.fetch }).airports.search({ q: "a" }, { sample: true });
    expect(m.calls[0].url).toBe("https://api.lilambd.com/airports/search?q=a&sample=1");
  });
  it("adds sample=1 globally", async () => {
    const m = mockFetch([json({ rows: [] })]);
    await new Lilambd({ fetch: m.fetch, sample: true }).hazard.summary();
    expect(m.calls[0].url).toBe("https://api.lilambd.com/hazard/summary?sample=1");
  });
});

describe("RapidAPI mode", () => {
  it("sends x-rapidapi headers and uses the given baseUrl", async () => {
    const m = mockFetch([json({})]);
    const c = new Lilambd({
      fetch: m.fetch,
      rapidapiKey: "KEY",
      rapidapiHost: "lilambd.p.rapidapi.com",
      baseUrl: "https://lilambd.p.rapidapi.com",
    });
    await c.airports.search({ q: "a" });
    expect(m.calls[0].url).toBe("https://lilambd.p.rapidapi.com/airports/search?q=a");
    expect(m.calls[0].headers["x-rapidapi-key"]).toBe("KEY");
    expect(m.calls[0].headers["x-rapidapi-host"]).toBe("lilambd.p.rapidapi.com");
  });
  it("derives baseUrl from rapidapiHost and never signs", async () => {
    const m = mockFetch([paymentRequired()]);
    const signer = vi.fn(async () => "p");
    const c = new Lilambd({ fetch: m.fetch, rapidapiKey: "K", rapidapiHost: "h.example", paymentSigner: signer });
    expect(c.baseUrl).toBe("https://h.example");
    await expect(c.colors.random()).rejects.toBeInstanceOf(PaymentRequiredError);
    expect(signer).not.toHaveBeenCalled();
  });
});
