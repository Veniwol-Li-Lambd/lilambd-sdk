# lilambd

Zero-dependency TypeScript client for the [Lilambd](https://api.lilambd.com) open-data API: 27 curated datasets
(airports, hazards, markets, science, security, units and more), 170 typed `GET` routes, paid per call in USDC
over [x402](https://x402.org) or through RapidAPI.

- **No runtime dependencies.** Uses the global `fetch` (Node 18+, browsers, Deno, Bun, edge workers); inject your own if needed.
- **Typed namespaces** generated from the live catalog: `client.airports.getByCode({ code: "HND" })`.
- **x402 built in.** A `402 Payment Required` is decoded into a `PaymentRequiredError` (requirements + `priceUsd`), or handed to your signer and retried automatically.
- **Free previews.** `{ sample: true }` returns up to 3 rows of any paid route at no cost.
- **ESM + CommonJS**, with type declarations for both.

## Install

```sh
npm install lilambd
```

## Quickstart

```ts
import { Lilambd } from "lilambd";            // or: const { Lilambd } = require("lilambd");

const client = new Lilambd();                 // baseUrl defaults to https://api.lilambd.com

// Free 3-row preview of a paid route
const preview = await client.airports.search({ q: "tokyo" }, { sample: true });

// Path placeholders are filled from params: GET /airports/HND
const hnd = await client.airports.getByCode({ code: "HND" }, { sample: true });

// Generic form: GET {base}/{product}{route}?query
const km = await client.get("units", "/convert", { value: 1, from: "mi", to: "km" }, { sample: true });
```

Free discovery endpoints: `client.index()`, `client.openapi()`, `client.llmsTxt()`, `client.wellKnownX402()`,
`client.health()`, `client.meta()`.

### Method names

Methods are derived deterministically from the route path:

| Route | Method |
|---|---|
| `/search` | `search` |
| `/x402/price-check` | `x402PriceCheck` |
| `/{code}` | `getByCode` |
| `/countries/{iso2}` | `getCountriesByIso2` |
| `/regions/{id}/events` | `regionsEventsById` |

Product ids with dashes become camelCase namespaces (`jp-health` → `client.jpHealth`). Each method has a typed
params interface (e.g. `AirportsSearchParams`); extra query keys are passed through. `ROUTES` and `PRODUCTS` are
exported for introspection.

## Sample mode

```ts
await client.hazard.summary({}, { sample: true });     // per call
const preview = new Lilambd({ sample: true });         // every call
```

`sample=1` returns at most 3 rows and never requires payment.

## x402 payments

Without payment, a paid route answers `HTTP 402` with a base64 `PAYMENT-REQUIRED` header (x402 v2, network
`eip155:8453`, USDC on Base). With no signer configured the SDK throws:

```ts
import { PaymentRequiredError } from "lilambd";

try {
  await client.airports.search({ q: "tokyo" });
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    err.priceUsd;          // 0.005
    err.requirement;       // { scheme, network: "eip155:8453", amount: "5000", asset, payTo, ... }
    err.requirements;      // full `accepts` list
    err.paymentRequired;   // decoded challenge
  }
}
```

Pass a `paymentSigner` to pay automatically. It receives the decoded challenge and returns the base64 payment
payload; the SDK resends the request with it in the `PAYMENT-SIGNATURE` header (set
`paymentHeader: "X-PAYMENT"` for the legacy header). `maxPriceUsd` caps what the SDK lets the signer pay.

The SDK does not bundle any wallet code. Any x402 implementation works; for example with the x402 reference
packages (`@x402/fetch`, `@x402/evm`, `viem`, installed by you; see their docs for the current API):

```ts
import { Lilambd } from "lilambd";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const x402 = new x402Client();
registerExactEvmScheme(x402, { signer: privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`) });
const http = new x402HTTPClient(x402);

const client = new Lilambd({
  maxPriceUsd: 0.05,
  paymentSigner: async ({ paymentRequired }) => {
    const payload = await x402.createPaymentPayload(paymentRequired as never);
    return Object.values(http.encodePaymentSignatureHeader(payload))[0];
  },
});

const risk = await client.hazard.placeRisk({ lat: 35.68, lon: 139.76 });
```

Alternatively, wrap `fetch` itself with `wrapFetchWithPayment` from `x402-fetch` / `@x402/fetch` and pass it as
`new Lilambd({ fetch: paidFetch })`; the wrapped fetch then settles the 402 before the SDK sees it.

## RapidAPI mode

```ts
const client = new Lilambd({
  rapidapiKey: process.env.RAPIDAPI_KEY,
  rapidapiHost: "lilambd.p.rapidapi.com",
  baseUrl: "https://lilambd.p.rapidapi.com",   // optional, defaults to https://{rapidapiHost}
});
```

Requests carry `x-rapidapi-key` / `x-rapidapi-host` instead of x402 headers; the signer is never called.

## Options

| Option | Default | Description |
|---|---|---|
| `baseUrl` | `https://api.lilambd.com` | API origin |
| `paymentSigner` | – | `(ctx) => Promise<string>` returning a base64 x402 payload |
| `paymentHeader` | `PAYMENT-SIGNATURE` | or `X-PAYMENT` |
| `maxPriceUsd` | – | refuse to pay above this per call |
| `rapidapiKey`, `rapidapiHost` | – | enable RapidAPI mode |
| `fetch` | `globalThis.fetch` | custom fetch |
| `headers` | – | extra headers on every call |
| `sample` | `false` | preview mode for every call |

Per call: `{ sample, signal, headers }`. Non-2xx answers throw `LilambdError` (`status`, `url`, `body`).

## Products

Prices are per paid call in USDC (6 decimals). Free routes never require payment.

| Product | Namespace | Routes | Price / call (USD) | Free routes |
|---|---|---:|---:|---|
| AI Agent Economy Census (`/agents`) | `client.agents` | 14 | $0.005 | — |
| Airports of the World (`/airports`) | `client.airports` | 3 | $0.005 | — |
| Color Names: 30,000+ Named Colors (`/colors`) | `client.colors` | 4 | $0.005 | — |
| Armed Conflict Events by Country and Region (`/conflict`) | `client.conflict` | 3 | $0.005 | — |
| Stock Exchanges and Trading Venues (MIC) (`/exchanges`) | `client.exchanges` | 2 | $0.005 | — |
| Exposure brief: one finished security answer per company domain or tech stack (`/exposure`) | `client.exposure` | 1 | $0.5 | — |
| World Natural Hazards and Warming (`/hazard`) | `client.hazard` | 16 | $0.005 | — |
| Japan Municipality Statistics (`/japan`) | `client.japan` | 4 | $0.005 | — |
| Japan Hospitals and Prefecture Health Facts (`/jp-health`) | `client.jpHealth` | 17 | $0.005 | — |
| Kinds: linked ledgers of kinds of things (instruments, woods, alloys, elements) (`/kinds`) | `client.kinds` | 4 | $0.05 | — |
| Koyomi: Calendars, Holidays and Helplines for AI Answers (`/koyomi`) | `client.koyomi` | 10 | $0.05 | `/helplines` |
| World Languages (Glottolog) (`/languages`) | `client.languages` | 2 | $0.005 | — |
| Open Source Licenses (SPDX) (`/licenses`) | `client.licenses` | 2 | $0.005 | — |
| Local Markets: markets away from big cities (`/local-markets`) | `client.localMarkets` | 5 | $0.05 | — |
| World Markets: Farmers, Flea, Night and Fish Markets (`/markets`) | `client.markets` | 5 | $0.005 | — |
| World Organizations: Research Bodies Societies Funders and Publishers (`/orgs`) | `client.orgs` | 11 | $0.005 | — |
| Pet entry: can my dog or cat cross this border in time? (`/pet-entry`) | `client.petEntry` | 3 | $0.5 | `/countries` |
| Online Platforms Directory (`/platforms`) | `client.platforms` | 3 | $0.005 | — |
| Power Plants of the World (`/power`) | `client.power` | 5 | $0.005 | — |
| World Pulse Daily Tech and Money Briefing (`/pulse`) | `client.pulse` | 9 | $0.005 | — |
| States and Provinces of the World + Land Stats (`/regions`) | `client.regions` | 2 | $0.005 | — |
| What Is Rising in the World Today (`/rising`) | `client.rising` | 4 | $0.05 | — |
| World Science Output by Country and Field (`/science`) | `client.science` | 7 | $0.005 | — |
| Security ledgers: exploited CVEs (CISA KEV + EPSS + NVD), breach disclosures, change feed (`/security`) | `client.security` | 10 | $0.01 | `/stats`, `/gaps` |
| World Music Instruments and Singing Styles (`/sound`) | `client.sound` | 14 | $0.005 | — |
| Travel meds: can I bring this medicine into this country? (`/travel-meds`) | `client.travelMeds` | 3 | $0.5 | — |
| Unit Converter and Physical Constants (`/units`) | `client.units` | 7 | $0.005 | — |

## Development

```sh
npm install
npm run generate   # regenerate src/generated.ts from ../spec/catalog.json
npm run build      # ESM + CJS + .d.ts into dist/
npm test
```

## License

MIT © Lilambd Crossing
