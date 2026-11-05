# lilambd-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **every endpoint of Lilambd Data for Agents** (27 products, 170 GET routes) as MCP tools: airports, colors, conflict and hazard data, exchanges, Japanese municipal and health statistics, calendars, languages, licenses, markets, organizations, power plants, news pulse, science, security (CVEs, KEV, breaches), sound, travel medicine, units and more.

- One tool per route (`{product}_{route}`, e.g. `airports_search`, `airports_by_code`), plus `list_products` and a generic `call` tool.
- Paid routes are pay-per-call over [x402](https://x402.org) (USDC on Base, `eip155:8453`). No account or API key.
- **Every paid tool accepts `sample: true`** for a free 3-row preview, so agents can explore at no cost.
- Runs over stdio (default) or streamable HTTP (`--http PORT`).

## Quick start

```bash
npx -y lilambd-mcp --help
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lilambd": {
      "command": "npx",
      "args": ["-y", "lilambd-mcp"],
      "env": { "LILAMBD_TOOLSET": "airports,colors,units", "LILAMBD_DEFAULT_SAMPLE": "1" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add lilambd -e LILAMBD_DEFAULT_SAMPLE=1 -- npx -y lilambd-mcp
```

Or use the hosted remote server without installing anything:

```bash
claude mcp add --transport http lilambd https://api.lilambd.com/mcp
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "lilambd": {
      "command": "npx",
      "args": ["-y", "lilambd-mcp"],
      "env": { "LILAMBD_TOOLSET": "security,hazard" }
    }
  }
}
```

> Tip: 172 tools is a lot for some clients. Use `LILAMBD_TOOLSET` to expose only the products you need; `list_products` and `call` are always available and can reach every route.

### Streamable HTTP

```bash
npx -y lilambd-mcp --http 3000   # serves http://127.0.0.1:3000/mcp (set HOST to change the bind address)
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `LILAMBD_BASE_URL` | `https://api.lilambd.com` | Upstream API base URL. |
| `LILAMBD_TOOLSET` | all products | Comma-separated product ids to expose as tools, e.g. `airports,colors`. |
| `LILAMBD_DEFAULT_SAMPLE` | off | `1` makes every call a free 3-row preview unless the tool call passes `sample: false`. |
| `LILAMBD_PAYMENT_SIGNATURE_CMD` | unset | Shell command used to pay for a call (see below). |
| `LILAMBD_RAPIDAPI_KEY` | unset | RapidAPI key; sent as `X-RapidAPI-Key`. |
| `LILAMBD_RAPIDAPI_HOST` | unset | RapidAPI host; sent as `X-RapidAPI-Host`. When both RapidAPI variables are set and `LILAMBD_BASE_URL` is not, requests go to `https://$LILAMBD_RAPIDAPI_HOST`. |

## Payments (x402)

An unpaid request to a paid route returns HTTP 402 with a base64 `PAYMENT-REQUIRED` header (x402 v2). The server handles it like this:

- **No signer configured:** the tool returns an error result with the price, `payTo`, network, asset and the full requirements, plus a hint to retry with `sample: true` or configure a signer. Nothing is paid.
- **Signer configured:** the server runs `LILAMBD_PAYMENT_SIGNATURE_CMD` through the shell, writes the decoded payment requirements JSON (`{"x402Version":2,"accepts":[{"scheme","network","amount","asset","payTo",...}],...}`) to its **stdin**, and reads the header value from its **stdout** (trimmed). A non-zero exit or empty output aborts the call. The request is then retried once with `PAYMENT-SIGNATURE: <value>`.

The signer is any program you trust with your wallet, for example a small script built on an x402 client library:

```bash
export LILAMBD_PAYMENT_SIGNATURE_CMD="node /path/to/sign-x402.mjs"
```

```js
// sign-x402.mjs (sketch): read requirements, sign with your wallet, print the header value
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", async () => {
  const requirements = JSON.parse(input);
  const header = await createPaymentHeader(requirements); // your x402 signing code
  process.stdout.write(header);
});
```

Keep the key out of the MCP config: the command runs with the server's environment, so load secrets inside the script. Every paid call spends real USDC; combine with `LILAMBD_TOOLSET` and `LILAMBD_DEFAULT_SAMPLE=1` while exploring.

## Meta tools

| Tool | Description |
| --- | --- |
| `list_products` | Free, offline. Lists products, routes, prices; pass `product` for parameter details. |
| `call` | Generic caller: `{ "product": "airports", "route": "/{code}", "params": { "code": "HND" }, "sample": true }`. |

All route tools also accept optional `limit`, `offset` and `sample`.

## Development

```bash
npm install
npm run build
npm test          # unit tests with mocked fetch + stdio smoke test
npm run sync-catalog && npm run gen-readme   # after the catalog changes
```

