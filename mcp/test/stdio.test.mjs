import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url));

async function spawnClient(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    env: { ...process.env, LILAMBD_BASE_URL: "http://127.0.0.1:9", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(transport);
  return client;
}

test("stdio smoke: initialize + tools/list", async () => {
  const client = await spawnClient({ LILAMBD_TOOLSET: "" });
  try {
    assert.equal(client.getServerVersion()?.name, "lilambd-mcp");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 172);
    const lp = await client.callTool({ name: "list_products", arguments: { product: "airports" } });
    assert.match(lp.content[0].text, /airports/);
  } finally {
    await client.close();
  }
});

test("stdio smoke: LILAMBD_TOOLSET env", async () => {
  const client = await spawnClient({ LILAMBD_TOOLSET: "airports" });
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3 + 2);
  } finally {
    await client.close();
  }
});
