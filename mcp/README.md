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

## Tools (170 route tools + 2 meta tools)

| Product | Price / call | Tools |
| --- | --- | --- |
| `agents` AI Agent Economy Census | $0.005 USDC | 14 |
| `airports` Airports of the World | $0.005 USDC | 3 |
| `colors` Color Names: 30,000+ Named Colors | $0.005 USDC | 4 |
| `conflict` Armed Conflict Events by Country and Region | $0.005 USDC | 3 |
| `exchanges` Stock Exchanges and Trading Venues (MIC) | $0.005 USDC | 2 |
| `exposure` Exposure brief: one finished security answer per company domain or tech stack | $0.5 USDC | 1 |
| `hazard` World Natural Hazards and Warming | $0.005 USDC | 16 |
| `japan` Japan Municipality Statistics | $0.005 USDC | 4 |
| `jp-health` Japan Hospitals and Prefecture Health Facts | $0.005 USDC | 17 |
| `kinds` Kinds: linked ledgers of kinds of things (instruments, woods, alloys, elements) | $0.05 USDC | 4 |
| `koyomi` Koyomi: Calendars, Holidays and Helplines for AI Answers | $0.05 USDC | 10 |
| `languages` World Languages (Glottolog) | $0.005 USDC | 2 |
| `licenses` Open Source Licenses (SPDX) | $0.005 USDC | 2 |
| `local-markets` Local Markets: markets away from big cities | $0.05 USDC | 5 |
| `markets` World Markets: Farmers, Flea, Night and Fish Markets | $0.005 USDC | 5 |
| `orgs` World Organizations: Research Bodies Societies Funders and Publishers | $0.005 USDC | 11 |
| `pet-entry` Pet entry: can my dog or cat cross this border in time? | $0.5 USDC | 3 |
| `platforms` Online Platforms Directory | $0.005 USDC | 3 |
| `power` Power Plants of the World | $0.005 USDC | 5 |
| `pulse` World Pulse Daily Tech and Money Briefing | $0.005 USDC | 9 |
| `regions` States and Provinces of the World + Land Stats | $0.005 USDC | 2 |
| `rising` What Is Rising in the World Today | $0.05 USDC | 4 |
| `science` World Science Output by Country and Field | $0.005 USDC | 7 |
| `security` Security ledgers: exploited CVEs (CISA KEV + EPSS + NVD), breach disclosures, change feed | $0.01 USDC | 10 |
| `sound` World Music Instruments and Singing Styles | $0.005 USDC | 14 |
| `travel-meds` Travel meds: can I bring this medicine into this country? | $0.5 USDC | 3 |
| `units` Unit Converter and Physical Constants | $0.005 USDC | 7 |

| Tool | Route | Description | Price |
| --- | --- | --- | --- |
| `agents_counters` | `GET /agents/counters` | Ecosystem counters | $0.005 USDC |
| `agents_mcp` | `GET /agents/mcp` | Search MCP servers | $0.005 USDC |
| `agents_mcp_daily` | `GET /agents/mcp/daily` | MCP servers per day | $0.005 USDC |
| `agents_mcp_namespaces` | `GET /agents/mcp/namespaces` | MCP namespaces | $0.005 USDC |
| `agents_mcp_new` | `GET /agents/mcp/new` | Newly published MCP servers | $0.005 USDC |
| `agents_mcp_by_name` | `GET /agents/mcp/{name}` | Get an MCP server | $0.005 USDC |
| `agents_summary` | `GET /agents/summary` | Today's census | $0.005 USDC |
| `agents_trending_by_kind` | `GET /agents/trending/{kind}` | Trending lists | $0.005 USDC |
| `agents_x402` | `GET /agents/x402` | Search paid endpoints | $0.005 USDC |
| `agents_x402_categories` | `GET /agents/x402/categories` | Prices by category | $0.005 USDC |
| `agents_x402_daily` | `GET /agents/x402/daily` | Daily new endpoints | $0.005 USDC |
| `agents_x402_hosts` | `GET /agents/x402/hosts` | Hosts | $0.005 USDC |
| `agents_x402_new` | `GET /agents/x402/new` | New endpoints | $0.005 USDC |
| `agents_x402_price_check` | `GET /agents/x402/price-check` | Check a price | $0.005 USDC |
| `airports_nearby` | `GET /airports/nearby` | Nearby airports | $0.005 USDC |
| `airports_search` | `GET /airports/search` | Search airports | $0.005 USDC |
| `airports_by_code` | `GET /airports/{code}` | Get an airport | $0.005 USDC |
| `colors_nearest` | `GET /colors/nearest` | Nearest color name | $0.005 USDC |
| `colors_random` | `GET /colors/random` | Random palette | $0.005 USDC |
| `colors_search` | `GET /colors/search` | Search names | $0.005 USDC |
| `colors_by_name_or_hex` | `GET /colors/{name_or_hex}` | Get a color | $0.005 USDC |
| `conflict_countries_by_iso2` | `GET /conflict/countries/{iso2}` | Country history | $0.005 USDC |
| `conflict_regions` | `GET /conflict/regions` | Regions | $0.005 USDC |
| `conflict_top` | `GET /conflict/top` | Top list | $0.005 USDC |
| `exchanges_search` | `GET /exchanges/search` | Search venues | $0.005 USDC |
| `exchanges_by_mic` | `GET /exchanges/{mic}` | Get a venue | $0.005 USDC |
| `exposure_brief` | `GET /exposure/brief` |  | $0.5 USDC |
| `hazard_countries` | `GET /hazard/countries` | Rank countries | $0.005 USDC |
| `hazard_countries_by_iso2` | `GET /hazard/countries/{iso2}` | Country profile | $0.005 USDC |
| `hazard_events` | `GET /hazard/events` | Search disasters | $0.005 USDC |
| `hazard_events_by_id` | `GET /hazard/events/{id}` | Get an event | $0.005 USDC |
| `hazard_features_by_id` | `GET /hazard/features/{id}` | Indicators | $0.005 USDC |
| `hazard_gaps` | `GET /hazard/gaps` | Gaps | $0.005 USDC |
| `hazard_joint_exposure` | `GET /hazard/joint-exposure` | Joint exposure | $0.005 USDC |
| `hazard_place_risk` | `GET /hazard/place-risk` | Risk for a point (finished answer) | $0.005 USDC |
| `hazard_regions` | `GET /hazard/regions` | Search or rank regions | $0.005 USDC |
| `hazard_regions_by_id` | `GET /hazard/regions/{id}` | Region profile (finished answer) | $0.005 USDC |
| `hazard_regions_by_id_events` | `GET /hazard/regions/{id}/events` | Events in a region | $0.005 USDC |
| `hazard_regions_by_id_stations` | `GET /hazard/regions/{id}/stations` | Stations in a region | $0.005 USDC |
| `hazard_stations` | `GET /hazard/stations` | Weather stations | $0.005 USDC |
| `hazard_stations_by_id` | `GET /hazard/stations/{id}` | Get a station | $0.005 USDC |
| `hazard_summary` | `GET /hazard/summary` | Totals | $0.005 USDC |
| `hazard_trends` | `GET /hazard/trends` | Trends | $0.005 USDC |
| `japan_indicators` | `GET /japan/indicators` | List indicators | $0.005 USDC |
| `japan_municipalities` | `GET /japan/municipalities` | List municipalities | $0.005 USDC |
| `japan_municipalities_by_code` | `GET /japan/municipalities/{code}` | Municipality profile | $0.005 USDC |
| `japan_rank` | `GET /japan/rank` | Rank municipalities | $0.005 USDC |
| `jp_health_cities_by_city_code` | `GET /jp-health/cities/{city_code}` | Hospitals in a municipality | $0.005 USDC |
| `jp_health_facts` | `GET /jp-health/facts` | Prefecture facts | $0.005 USDC |
| `jp_health_facts_topics` | `GET /jp-health/facts/topics` | Fact topics | $0.005 USDC |
| `jp_health_gaps` | `GET /jp-health/gaps` | Gaps | $0.005 USDC |
| `jp_health_hospitals` | `GET /jp-health/hospitals` | Search hospitals | $0.005 USDC |
| `jp_health_hospitals_by_hospital_id` | `GET /jp-health/hospitals/{hospital_id}` | Get a hospital | $0.005 USDC |
| `jp_health_hospitals_by_hospital_id_mdc` | `GET /jp-health/hospitals/{hospital_id}/mdc` | Hospital case mix | $0.005 USDC |
| `jp_health_hospitals_by_hospital_id_profile` | `GET /jp-health/hospitals/{hospital_id}/profile` | Hospital profile | $0.005 USDC |
| `jp_health_mdc` | `GET /jp-health/mdc` | Diagnostic categories | $0.005 USDC |
| `jp_health_mdc_by_mdc` | `GET /jp-health/mdc/{mdc}` | Top hospitals per category | $0.005 USDC |
| `jp_health_prefectures` | `GET /jp-health/prefectures` | Prefectures | $0.005 USDC |
| `jp_health_prefectures_by_pref` | `GET /jp-health/prefectures/{pref}` | Get a prefecture | $0.005 USDC |
| `jp_health_prefectures_by_pref_facts` | `GET /jp-health/prefectures/{pref}/facts` | Prefecture facts | $0.005 USDC |
| `jp_health_prefectures_by_pref_health_profile` | `GET /jp-health/prefectures/{pref}/health-profile` | Prefecture health profile | $0.005 USDC |
| `jp_health_prefectures_by_pref_hospitals` | `GET /jp-health/prefectures/{pref}/hospitals` | Hospitals in a prefecture | $0.005 USDC |
| `jp_health_rank` | `GET /jp-health/rank` | Rank prefectures | $0.005 USDC |
| `jp_health_summary` | `GET /jp-health/summary` | Dataset summary | $0.005 USDC |
| `kinds_chain` | `GET /kinds/chain` |  | $0.05 USDC |
| `kinds_facets` | `GET /kinds/facets` |  | $0.05 USDC |
| `kinds_search` | `GET /kinds/search` |  | $0.05 USDC |
| `kinds_by_id` | `GET /kinds/{id}` |  | $0.05 USDC |
| `koyomi_countries` | `GET /koyomi/countries` |  | $0.05 USDC |
| `koyomi_day` | `GET /koyomi/day` |  | $0.05 USDC |
| `koyomi_helplines` | `GET /koyomi/helplines` |  | free |
| `koyomi_holidays` | `GET /koyomi/holidays` |  | $0.05 USDC |
| `koyomi_moon_phases` | `GET /koyomi/moon-phases` |  | $0.05 USDC |
| `koyomi_range` | `GET /koyomi/range` |  | $0.05 USDC |
| `koyomi_rules` | `GET /koyomi/rules` |  | $0.05 USDC |
| `koyomi_solar_terms` | `GET /koyomi/solar-terms` |  | $0.05 USDC |
| `koyomi_sun` | `GET /koyomi/sun` |  | $0.05 USDC |
| `koyomi_topics` | `GET /koyomi/topics` |  | $0.05 USDC |
| `languages_search` | `GET /languages/search` | Search languages | $0.005 USDC |
| `languages_by_code` | `GET /languages/{code}` | Get a language | $0.005 USDC |
| `licenses_search` | `GET /licenses/search` | Search licenses | $0.005 USDC |
| `licenses_by_id` | `GET /licenses/{id}` | Get a license | $0.005 USDC |
| `local_markets_countries` | `GET /local-markets/countries` |  | $0.05 USDC |
| `local_markets_country` | `GET /local-markets/country` |  | $0.05 USDC |
| `local_markets_near` | `GET /local-markets/near` |  | $0.05 USDC |
| `local_markets_search` | `GET /local-markets/search` |  | $0.05 USDC |
| `local_markets_by_id` | `GET /local-markets/{id}` |  | $0.05 USDC |
| `markets_countries` | `GET /markets/countries` | Markets by country | $0.005 USDC |
| `markets_kinds` | `GET /markets/kinds` | Market kinds | $0.005 USDC |
| `markets_nearby` | `GET /markets/nearby` | Nearby markets | $0.005 USDC |
| `markets_search` | `GET /markets/search` | Search markets | $0.005 USDC |
| `markets_by_id` | `GET /markets/{id}` | Get a market | $0.005 USDC |
| `orgs_countries` | `GET /orgs/countries` | Organizations by country | $0.005 USDC |
| `orgs_forms` | `GET /orgs/forms` | Forms | $0.005 USDC |
| `orgs_gaps` | `GET /orgs/gaps` | Thinly recorded countries | $0.005 USDC |
| `orgs_kinds` | `GET /orgs/kinds` | Kinds | $0.005 USDC |
| `orgs_nearby` | `GET /orgs/nearby` | Nearby organizations | $0.005 USDC |
| `orgs_nonprofits_causes` | `GET /orgs/nonprofits/causes` | US nonprofits by cause | $0.005 USDC |
| `orgs_nonprofits_search` | `GET /orgs/nonprofits/search` | Search US nonprofits | $0.005 USDC |
| `orgs_nonprofits_states` | `GET /orgs/nonprofits/states` | US nonprofits by state | $0.005 USDC |
| `orgs_nonprofits_by_ein` | `GET /orgs/nonprofits/{ein}` | Get a US nonprofit | $0.005 USDC |
| `orgs_search` | `GET /orgs/search` | Search organizations | $0.005 USDC |
| `orgs_by_id` | `GET /orgs/{id}` | Get an organization | $0.005 USDC |
| `pet_entry_answer` | `GET /pet-entry/answer` |  | $0.5 USDC |
| `pet_entry_countries` | `GET /pet-entry/countries` |  | free |
| `pet_entry_country` | `GET /pet-entry/country` |  | $0.5 USDC |
| `platforms_categories` | `GET /platforms/categories` | List categories | $0.005 USDC |
| `platforms_search` | `GET /platforms/search` | Search platforms | $0.005 USDC |
| `platforms_by_wikidata` | `GET /platforms/{wikidata}` | Get a platform | $0.005 USDC |
| `power_countries` | `GET /power/countries` | Country fuel mix | $0.005 USDC |
| `power_fuels` | `GET /power/fuels` | Fuels | $0.005 USDC |
| `power_nearby` | `GET /power/nearby` | Nearby power plants | $0.005 USDC |
| `power_search` | `GET /power/search` | Search plants | $0.005 USDC |
| `power_by_id` | `GET /power/{id}` | Get a plant | $0.005 USDC |
| `pulse_briefing` | `GET /pulse/briefing` | Daily briefing | $0.005 USDC |
| `pulse_changes` | `GET /pulse/changes` | Changes since a day | $0.005 USDC |
| `pulse_days` | `GET /pulse/days` | Days loaded | $0.005 USDC |
| `pulse_feeds` | `GET /pulse/feeds` | List feeds | $0.005 USDC |
| `pulse_feeds_by_feed` | `GET /pulse/feeds/{feed}` | One feed on one day | $0.005 USDC |
| `pulse_feeds_by_feed_history` | `GET /pulse/feeds/{feed}/history` | History of one item | $0.005 USDC |
| `pulse_fx` | `GET /pulse/fx` | Exchange rates | $0.005 USDC |
| `pulse_search` | `GET /pulse/search` | Search all feeds | $0.005 USDC |
| `pulse_today` | `GET /pulse/today` | Today across feeds | $0.005 USDC |
| `regions_search` | `GET /regions/search` | Search regions | $0.005 USDC |
| `regions_by_iso3166_2` | `GET /regions/{iso3166_2}` | Get a region | $0.005 USDC |
| `rising_days` | `GET /rising/days` |  | $0.05 USDC |
| `rising_history` | `GET /rising/history` |  | $0.05 USDC |
| `rising_today` | `GET /rising/today` |  | $0.05 USDC |
| `rising_by_date` | `GET /rising/{date}` |  | $0.05 USDC |
| `science_countries_by_iso2` | `GET /science/countries/{iso2}` | Country history | $0.005 USDC |
| `science_fields` | `GET /science/fields` | Fields in a year | $0.005 USDC |
| `science_fields_by_field_id` | `GET /science/fields/{field_id}` | Field history | $0.005 USDC |
| `science_gaps` | `GET /science/gaps` | Gaps | $0.005 USDC |
| `science_rank` | `GET /science/rank` | Rank countries | $0.005 USDC |
| `science_rising` | `GET /science/rising` | Rising subfields | $0.005 USDC |
| `science_subfields` | `GET /science/subfields` | Subfields | $0.005 USDC |
| `security_breaches` | `GET /security/breaches` |  | $0.01 USDC |
| `security_changes` | `GET /security/changes` |  | $0.01 USDC |
| `security_cve_by_id` | `GET /security/cve/{id}` |  | $0.01 USDC |
| `security_gaps` | `GET /security/gaps` |  | free |
| `security_hot` | `GET /security/hot` |  | $0.01 USDC |
| `security_incidents` | `GET /security/incidents` |  | $0.01 USDC |
| `security_incidents_trends` | `GET /security/incidents/trends` |  | $0.01 USDC |
| `security_kev` | `GET /security/kev` |  | $0.01 USDC |
| `security_stats` | `GET /security/stats` |  | free |
| `security_vendors` | `GET /security/vendors` |  | $0.01 USDC |
| `sound_classes` | `GET /sound/classes` | Hornbostel-Sachs classes | $0.005 USDC |
| `sound_classes_by_hs_code` | `GET /sound/classes/{hs_code}` | Get a class | $0.005 USDC |
| `sound_ensembles` | `GET /sound/ensembles` | Ensembles | $0.005 USDC |
| `sound_functions` | `GET /sound/functions` | Song functions | $0.005 USDC |
| `sound_genres` | `GET /sound/genres` | Genres | $0.005 USDC |
| `sound_instruments` | `GET /sound/instruments` | Instruments | $0.005 USDC |
| `sound_instruments_by_id` | `GET /sound/instruments/{id}` | Get an instrument | $0.005 USDC |
| `sound_names` | `GET /sound/names` | Instrument names in 12 languages | $0.005 USDC |
| `sound_societies` | `GET /sound/societies` | Societies | $0.005 USDC |
| `sound_societies_by_society_id` | `GET /sound/societies/{society_id}` | Society profile | $0.005 USDC |
| `sound_songs` | `GET /sound/songs` | Songs | $0.005 USDC |
| `sound_sound_sources` | `GET /sound/sound-sources` | Sound sources | $0.005 USDC |
| `sound_styles` | `GET /sound/styles` | Singing style values | $0.005 USDC |
| `sound_styles_axes` | `GET /sound/styles/axes` | Singing style axes | $0.005 USDC |
| `travel_meds_answer` | `GET /travel-meds/answer` |  | $0.5 USDC |
| `travel_meds_countries` | `GET /travel-meds/countries` |  | $0.5 USDC |
| `travel_meds_country` | `GET /travel-meds/country` |  | $0.5 USDC |
| `units_constants` | `GET /units/constants` | Search physical constants | $0.005 USDC |
| `units_constants_by_id` | `GET /units/constants/{id}` | Get a constant | $0.005 USDC |
| `units_convert` | `GET /units/convert` | Convert a value | $0.005 USDC |
| `units_isotopes` | `GET /units/isotopes` | List isotopes | $0.005 USDC |
| `units_quantity_kinds` | `GET /units/quantity-kinds` | List quantity kinds | $0.005 USDC |
| `units_search` | `GET /units/search` | Search units | $0.005 USDC |
| `units_by_unit` | `GET /units/{unit}` | Get a unit | $0.005 USDC |

## License

MIT (c) Lilambd Crossing
