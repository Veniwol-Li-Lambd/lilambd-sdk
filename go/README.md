# lilambd-go

Go client for **Lilambd Data for Agents** (`https://api.lilambd.com`): 27 data products and 170 GET routes,
paid per call in USDC on Base via [x402](https://x402.org), with free 3-row samples and an optional RapidAPI mode.

- Standard library only, Go 1.21+
- One typed method per catalog route (generated from `spec/catalog.json`)
- x402 v2 payment hook: plug in any signer, the client retries with `PAYMENT-SIGNATURE`
- Embedded catalog: list products, prices and routes offline

## Install

```sh
go get github.com/Veniwol-Li-Lambd/lilambd-sdk/go
```

```go
import lilambd "github.com/Veniwol-Li-Lambd/lilambd-sdk/go"
```

## Quickstart

```go
ctx := context.Background()
c := lilambd.New()

// Typed, generated methods. Path placeholders are positional arguments.
raw, err := c.Airports().GetByCode(ctx, "HND", nil)
raw, err = c.Airports().Search(ctx, lilambd.Params{"q": "tokyo", "limit": "5"})

// Generic call: any product, any route, {placeholders} filled from params.
raw, err = c.Get(ctx, "hazard", "/regions/{id}/events", map[string]string{"id": "R1", "days": "30"})

// Decode into your own type.
var out map[string]any
err = c.GetInto(ctx, "units", "/convert", lilambd.Params{"from": "mi", "to": "km", "value": "1"}, &out)
```

Every method returns `json.RawMessage`. Method names are derived from the route path:
`/search` -> `Search`, `/{code}` -> `GetByCode`, `/mcp/daily` -> `MCPDaily`,
`/regions/{id}/events` -> `RegionsByIDEvents`.

## Free samples

Any route accepts `sample=1` and returns up to 3 rows without payment.

```go
raw, err := c.Sample(ctx, "airports", "/search", lilambd.Params{"q": "tokyo"})
raw, err = c.Airports().Sample(ctx, "/{code}", lilambd.Params{"code": "HND"})
raw, err = c.Airports().Search(ctx, lilambd.Params{"q": "tokyo", "sample": "1"})
```

Some routes are always free (see the table below), as are the discovery endpoints:
`c.Index`, `c.OpenAPI`, `c.LLMsTxt`, `c.WellKnownX402`, `c.Health`, `c.Meta`.

## Payments (x402)

Without a signer, a paid route returns `*lilambd.PaymentRequiredError` holding the decoded
`PAYMENT-REQUIRED` challenge (x402 v2, network `eip155:8453`, USDC with 6 decimals):

```go
_, err := c.Airports().GetByCode(ctx, "HND", nil)
var perr *lilambd.PaymentRequiredError
if errors.As(err, &perr) {
    fmt.Printf("costs $%.4f\n", perr.PriceUSD())
    opt := perr.Requirements.Accepts[0] // Scheme, Network, AmountAtomic(), Asset, PayTo
    _ = opt
}
```

Install a signer and the client pays automatically: on HTTP 402 it calls your function and
retries once with the returned payload in `PAYMENT-SIGNATURE`.

```go
c := lilambd.New(lilambd.WithPaymentSigner(
    func(ctx context.Context, req *lilambd.PaymentRequirements) (string, error) {
        if req.PriceUSD() > 0.10 {
            return "", errors.New("over budget")
        }
        // Sign an EIP-3009 transferWithAuthorization for req.Accepts[0] with your
        // wallet and return the base64-encoded x402 PaymentPayload.
        return mySigner.Sign(ctx, req)
    },
))
// Use lilambd.WithPaymentHeader(lilambd.HeaderXPayment) to send X-PAYMENT instead.
```

If the payment is rejected, the error is a `*PaymentRequiredError` with `Retried == true`.
Other non-2xx responses return `*lilambd.APIError` (status code and body).

## RapidAPI mode

```go
c := lilambd.New(lilambd.WithRapidAPI(os.Getenv("RAPIDAPI_KEY"), "your-host.p.rapidapi.com"))
// Sends x-rapidapi-key / x-rapidapi-host; base URL defaults to https://{host}.
// Override with lilambd.WithBaseURL(...) if your gateway URL differs.
```

## Options

| Option | Purpose |
|---|---|
| `WithBaseURL(url)` | Change the API base URL |
| `WithHTTPClient(*http.Client)` | Custom transport, timeouts, proxies |
| `WithPaymentSigner(fn)` | x402 signer for automatic payment |
| `WithPaymentHeader(name)` | `PAYMENT-SIGNATURE` (default) or `X-PAYMENT` |
| `WithRapidAPI(key, host)` | RapidAPI headers |
| `WithUserAgent(ua)`, `WithHeader(k, v)` | Extra request headers |

## Catalog

```go
for _, p := range lilambd.Products() {
    fmt.Println(p.ID, p.PriceUSD(), len(p.Routes))
}
p, _ := lilambd.FindProduct("koyomi")
p.IsFree("/helplines") // true
```

## Products

Prices are per paid call in USDC (catalog as of 2026-11-03).

| Product | Accessor | Title | Price | Routes | Free routes |
|---|---|---|---|---|---|
| `agents` | `c.Agents()` | AI Agent Economy Census | $0.005 | 14 | - |
| `airports` | `c.Airports()` | Airports of the World | $0.005 | 3 | - |
| `colors` | `c.Colors()` | Color Names: 30,000+ Named Colors | $0.005 | 4 | - |
| `conflict` | `c.Conflict()` | Armed Conflict Events by Country and Region | $0.005 | 3 | - |
| `exchanges` | `c.Exchanges()` | Stock Exchanges and Trading Venues (MIC) | $0.005 | 2 | - |
| `exposure` | `c.Exposure()` | Exposure brief: one finished security answer per company domain or tech stack | $0.5 | 1 | - |
| `hazard` | `c.Hazard()` | World Natural Hazards and Warming | $0.005 | 16 | - |
| `japan` | `c.Japan()` | Japan Municipality Statistics | $0.005 | 4 | - |
| `jp-health` | `c.JPHealth()` | Japan Hospitals and Prefecture Health Facts | $0.005 | 17 | - |
| `kinds` | `c.Kinds()` | Kinds: linked ledgers of kinds of things (instruments, woods, alloys, elements) | $0.05 | 4 | - |
| `koyomi` | `c.Koyomi()` | Koyomi: Calendars, Holidays and Helplines for AI Answers | $0.05 | 10 | `/helplines` |
| `languages` | `c.Languages()` | World Languages (Glottolog) | $0.005 | 2 | - |
| `licenses` | `c.Licenses()` | Open Source Licenses (SPDX) | $0.005 | 2 | - |
| `local-markets` | `c.LocalMarkets()` | Local Markets: markets away from big cities | $0.05 | 5 | - |
| `markets` | `c.Markets()` | World Markets: Farmers, Flea, Night and Fish Markets | $0.005 | 5 | - |
| `orgs` | `c.Orgs()` | World Organizations: Research Bodies Societies Funders and Publishers | $0.005 | 11 | - |
| `pet-entry` | `c.PetEntry()` | Pet entry: can my dog or cat cross this border in time? | $0.5 | 3 | `/countries` |
| `platforms` | `c.Platforms()` | Online Platforms Directory | $0.005 | 3 | - |
| `power` | `c.Power()` | Power Plants of the World | $0.005 | 5 | - |
| `pulse` | `c.Pulse()` | World Pulse Daily Tech and Money Briefing | $0.005 | 9 | - |
| `regions` | `c.Regions()` | States and Provinces of the World + Land Stats | $0.005 | 2 | - |
| `rising` | `c.Rising()` | What Is Rising in the World Today | $0.05 | 4 | - |
| `science` | `c.Science()` | World Science Output by Country and Field | $0.005 | 7 | - |
| `security` | `c.Security()` | Security ledgers: exploited CVEs (CISA KEV + EPSS + NVD), breach disclosures, change feed | $0.01 | 10 | `/stats`, `/gaps` |
| `sound` | `c.Sound()` | World Music Instruments and Singing Styles | $0.005 | 14 | - |
| `travel-meds` | `c.TravelMeds()` | Travel meds: can I bring this medicine into this country? | $0.5 | 3 | - |
| `units` | `c.Units()` | Unit Converter and Physical Constants | $0.005 | 7 | - |

## Development

```sh
go generate ./...   # regenerates products_gen.go and catalog.json from ../spec/catalog.json
go vet ./... && go test ./...
```

Examples: `go run ./examples/quickstart` (free samples) and `go run ./examples/payment` (signer / RapidAPI).

## License

MIT, Copyright (c) 2026 Lilambd Crossing. See [LICENSE](LICENSE).
