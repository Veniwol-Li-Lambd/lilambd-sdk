#!/usr/bin/env node
import { createServer as createHttpServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { VERSION, createLilambdServer } from "./server.js";

const HELP = `lilambd-mcp ${VERSION} - MCP server for Lilambd Data for Agents

Usage:
  lilambd-mcp                 Run over stdio (default; for Claude Desktop / Claude Code / Cursor)
  lilambd-mcp --http [PORT]   Run streamable HTTP on http://127.0.0.1:PORT/mcp (default 3000)
  lilambd-mcp --list-tools    Print tool names and exit
  lilambd-mcp --version | --help

Environment:
  LILAMBD_BASE_URL               Upstream base URL (default https://api.lilambd.com)
  LILAMBD_PAYMENT_SIGNATURE_CMD  Shell command: reads x402 requirements JSON on stdin, prints PAYMENT-SIGNATURE value
  LILAMBD_RAPIDAPI_KEY/_HOST     Use RapidAPI auth instead of x402
  LILAMBD_TOOLSET                Comma list of product ids to expose (e.g. airports,colors)
  LILAMBD_DEFAULT_SAMPLE=1       Default every call to sample=1 (free 3-row previews)
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes("--list-tools")) {
    for (const t of createLilambdServer().tools) process.stdout.write(`${t.name}\n`);
    return;
  }
  const hi = argv.indexOf("--http");
  if (hi >= 0) {
    const port = Number(argv[hi + 1] && !argv[hi + 1].startsWith("-") ? argv[hi + 1] : process.env.PORT ?? 3000);
    const host = process.env.HOST ?? "127.0.0.1";
    const http = createHttpServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/mcp") {
        res.writeHead(url.pathname === "/" ? 200 : 404, { "content-type": "text/plain" });
        res.end(url.pathname === "/" ? `lilambd-mcp ${VERSION}: POST /mcp\n` : "not found\n");
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { allow: "POST", "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
        return;
      }
      // Stateless: one server + transport per request.
      const { server } = createLilambdServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(e) }, id: null }));
        }
      }
    });
    http.listen(port, host, () => process.stderr.write(`lilambd-mcp listening on http://${host}:${port}/mcp\n`));
    return;
  }
  const { server } = createLilambdServer();
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  process.stderr.write(`lilambd-mcp: ${e?.stack ?? e}\n`);
  process.exit(1);
});
