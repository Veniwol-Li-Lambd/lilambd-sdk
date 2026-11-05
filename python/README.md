# lilambd

Python client for the [Lilambd data API](https://api.lilambd.com): 27 curated datasets
(airports, hazards, holidays, units, security advisories, Japanese municipal and health
statistics and more) behind 170 plain `GET` routes.

* **Pay per call** with [x402](https://x402.org) (USDC on Base, `eip155:8453`), no account or API key.
* **Free previews**: add `sample=True` to any paid route for up to 3 rows.
* **RapidAPI mode** if you prefer a subscription key.
* **Zero dependencies**: standard library only, Python 3.9+, fully typed.

## Install

```bash
pip install lilambd
```

## Quickstart

```python
import lilambd

client = lilambd.Client()

client.health()                                   # discovery endpoints are free
client.koyomi.helplines()                         # free route
client.airports.search(q="tokyo", sample=True)    # free 3-row preview
client.airports.get_by_code(code="HND")           # paid: raises PaymentRequired without a signer
```

Every product is a namespace on the client (`client.airports`, `client.jp_health`, ...)
and every route is a method with typed keyword arguments and a docstring taken from the
catalog. Method names come from the route path:

| Route | Method |
|---|---|
| `/airports/search` | `client.airports.search(q=...)` |
| `/airports/{code}` | `client.airports.get_by_code(code="HND")` |
| `/hazard/countries/{iso2}` | `client.hazard.countries_by_iso2(iso2="JP")` |
| `/jp-health/hospitals/{hospital_id}/mdc` | `client.jp_health.hospitals_mdc_by_hospital_id(hospital_id=...)` |

Python keywords take a trailing underscore: `client.units.convert(from_="mi", to="km", value=3)`.
Methods also accept extra `**params` that are passed through as query parameters.

The generic form works for any route, including ones newer than this SDK:

```python
client.get("airports", "/{code}", code="HND")       # {placeholders} filled from params
client.sample("pulse", "/search", q="earthquake")    # same as sample=1
client.request("airports", "/search", q="x")         # raw Response (status, headers, .json())
```

Discovery: `client.index()`, `client.openapi()`, `client.llms_txt()`,
`client.x402_manifest()`, `client.health()`, `client.meta()`.

## Free access

* `sample=True` (or `sample=1`) on any route returns a free preview of at most 3 rows.
* Some routes are always free (see the table below), as are the discovery endpoints.

## Paying with x402

An unpaid call returns HTTP 402 with a base64 `PAYMENT-REQUIRED` challenge. The SDK decodes it
into a `PaymentRequired` exception:

```python
try:
    client.airports.get_by_code(code="HND")
except lilambd.PaymentRequired as err:
    err.price_usd      # 0.005
    err.amount         # "5000"  (USDC atomic units, 6 decimals)
    err.pay_to         # receiving address (also err.payTo)
    err.asset          # USDC contract on Base
    err.network        # "eip155:8453"
    err.resource       # URL being paid for
    err.requirements   # full decoded challenge (x402 v2)
```

To pay automatically, pass a `payment_signer`: any callable that takes the decoded
requirements dict and returns the base64 payment payload. The client calls it once on a 402
and retries the request with the `PAYMENT-SIGNATURE` header (use `payment_header="X-PAYMENT"`
for the legacy header). The SDK never touches your keys; signing is entirely up to you.

Example with the official [`x402`](https://pypi.org/project/x402/) package (not a dependency
of this SDK; adapt to the version you install):

```python
import os
from eth_account import Account
from x402.clients.base import x402Client
import lilambd

x402 = x402Client(Account.from_key(os.environ["PRIVATE_KEY"]))

def signer(requirements: dict) -> str:
    chosen = x402.select_payment_requirements(requirements["accepts"])
    return x402.create_payment_header(chosen, requirements.get("x402Version", 2))

client = lilambd.Client(payment_signer=signer)
resp = client.request("airports", "/{code}", code="HND")
resp.json()
resp.payment_response   # decoded PAYMENT-RESPONSE settlement receipt, if any
```

`lilambd.encode_payment_header(dict)` and `lilambd.decode_payment_header(str)` help when
building payloads by hand.

## RapidAPI mode

```python
client = lilambd.Client(
    rapidapi_key="YOUR_KEY",
    rapidapi_host="<host from the RapidAPI listing>",
    base_url="https://<host from the RapidAPI listing>",   # optional, defaults to https://{host}
)
client.airports.search(q="tokyo")
```

The client then sends `x-rapidapi-key` / `x-rapidapi-host` and never attempts x402 payment.

## Errors

| Exception | When |
|---|---|
| `lilambd.LilambdError` | base class; network errors and other HTTP errors (`.status`, `.body`, `.url`) |
| `lilambd.PaymentRequired` | HTTP 402 |
| `lilambd.BadRequest` | HTTP 400 / 422, or a missing path parameter |
| `lilambd.NotFound` | HTTP 404 |

## Products

Prices are per paid call in USDC. `sample=True` is always free.

<!-- PRODUCTS:START -->
| Product | Namespace | Routes | Price / call | Free routes |
|---|---|---:|---:|---|
| AI Agent Economy Census (`/agents`) | `client.agents` | 14 | $0.005 | - |
| Airports of the World (`/airports`) | `client.airports` | 3 | $0.005 | - |
| Color Names: 30,000+ Named Colors (`/colors`) | `client.colors` | 4 | $0.005 | - |
| Armed Conflict Events by Country and Region (`/conflict`) | `client.conflict` | 3 | $0.005 | - |
| Stock Exchanges and Trading Venues (MIC) (`/exchanges`) | `client.exchanges` | 2 | $0.005 | - |
| Exposure brief: one finished security answer per company domain or tech stack (`/exposure`) | `client.exposure` | 1 | $0.500 | - |
| World Natural Hazards and Warming (`/hazard`) | `client.hazard` | 16 | $0.005 | - |
| Japan Municipality Statistics (`/japan`) | `client.japan` | 4 | $0.005 | - |
| Japan Hospitals and Prefecture Health Facts (`/jp-health`) | `client.jp_health` | 17 | $0.005 | - |
| Kinds: linked ledgers of kinds of things (instruments, woods, alloys, elements) (`/kinds`) | `client.kinds` | 4 | $0.050 | - |
| Koyomi: Calendars, Holidays and Helplines for AI Answers (`/koyomi`) | `client.koyomi` | 10 | $0.050 | `/helplines` |
| World Languages (Glottolog) (`/languages`) | `client.languages` | 2 | $0.005 | - |
| Open Source Licenses (SPDX) (`/licenses`) | `client.licenses` | 2 | $0.005 | - |
| Local Markets: markets away from big cities (`/local-markets`) | `client.local_markets` | 5 | $0.050 | - |
| World Markets: Farmers, Flea, Night and Fish Markets (`/markets`) | `client.markets` | 5 | $0.005 | - |
| World Organizations: Research Bodies Societies Funders and Publishers (`/orgs`) | `client.orgs` | 11 | $0.005 | - |
| Pet entry: can my dog or cat cross this border in time? (`/pet-entry`) | `client.pet_entry` | 3 | $0.500 | `/countries` |
| Online Platforms Directory (`/platforms`) | `client.platforms` | 3 | $0.005 | - |
| Power Plants of the World (`/power`) | `client.power` | 5 | $0.005 | - |
| World Pulse Daily Tech and Money Briefing (`/pulse`) | `client.pulse` | 9 | $0.005 | - |
| States and Provinces of the World + Land Stats (`/regions`) | `client.regions` | 2 | $0.005 | - |
| What Is Rising in the World Today (`/rising`) | `client.rising` | 4 | $0.050 | - |
| World Science Output by Country and Field (`/science`) | `client.science` | 7 | $0.005 | - |
| Security ledgers: exploited CVEs (CISA KEV + EPSS + NVD), breach disclosures, change feed (`/security`) | `client.security` | 10 | $0.010 | `/stats`, `/gaps` |
| World Music Instruments and Singing Styles (`/sound`) | `client.sound` | 14 | $0.005 | - |
| Travel meds: can I bring this medicine into this country? (`/travel-meds`) | `client.travel_meds` | 3 | $0.500 | - |
| Unit Converter and Physical Constants (`/units`) | `client.units` | 7 | $0.005 | - |
<!-- PRODUCTS:END -->

`lilambd.PRODUCTS` holds the same metadata at runtime.

## Development

```bash
python scripts/generate.py      # regenerate lilambd/_generated.py and the table above from ../spec/catalog.json
pip install -e ".[dev]"
pytest
python -m build
```

## License

MIT, Copyright (c) 2026 Lilambd Crossing
