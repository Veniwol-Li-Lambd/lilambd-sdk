# Lilambd SDKs and MCP server

Client libraries and a local MCP server for **Lilambd Data for Agents** (`https://api.lilambd.com`):
27 open-data ledgers and finished answers (airports, units, languages, regions, power plants, markets,
hazards, science output, security/KEV, world pulse, pet entry, travel meds and more), 170 GET routes,
paid per call with **x402** (USDC on Base) or through RapidAPI plans. Every route has a free `sample=1` preview.

| Folder | Package | Language |
|---|---|---|
| [`python/`](python/) | `lilambd` (PyPI) | Python 3.9+ |
| [`typescript/`](typescript/) | `lilambd` (npm) | TypeScript / JavaScript (Node 18+, browsers, Deno, Bun) |
| [`go/`](go/) | `github.com/Veniwol-Li-Lambd/lilambd-sdk/go` | Go |
| [`mcp/`](mcp/) | `lilambd-mcp` (npm) | MCP server, stdio |
| [`spec/`](spec/) | `openapi.json` / `openapi.yaml` | OpenAPI 3.1, 176 paths |

`spec/catalog.json` is the single source every SDK generator reads. Regenerate after the catalog changes:

```sh
python3 spec/build_openapi.py
python3 python/scripts/generate.py
node typescript/scripts/generate.mjs
(cd go && go generate ./...)
```

## Payment in one paragraph
Call a route. Free routes and `sample=1` answer 200. Otherwise the API answers **402** with a base64
`PAYMENT-REQUIRED` header (x402 v2, network `eip155:8453`, USDC). Each SDK raises a typed
payment-required error carrying the price, or, if you pass a payment signer (for example one built
with the official x402 libraries), signs and retries with `PAYMENT-SIGNATURE` automatically.

There is also a hosted remote MCP endpoint: `https://api.lilambd.com/mcp` (streamable HTTP).

## Licence
Code: MIT. Data: licence per product, stated in every response (`attribution` / `meta.license`).
