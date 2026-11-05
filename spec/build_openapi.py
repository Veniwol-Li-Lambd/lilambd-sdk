"""Build openapi.yaml/json (OpenAPI 3.1) for api.lilambd.com from catalog.json."""
import json, re, os
here = os.path.dirname(os.path.abspath(__file__))
cat = json.load(open(os.path.join(here, "catalog.json")))
def slug(path):
    parts = []
    for seg in path.strip("/").split("/"):
        m = re.fullmatch(r"\{(\w+)\}", seg)
        parts.append(("by_" + m.group(1)) if m else seg.replace("-", "_"))
    return "_".join(parts) or "root"
spec = {
  "openapi": "3.1.0",
  "info": {"title": "Lilambd Data for Agents", "version": "2026.11.03",
    "summary": "Open-data ledgers and finished answers, paid per call with x402 (USDC on Base) or via RapidAPI plans.",
    "description": "Every route accepts `sample=1` for a free preview (max 3 rows). Without payment a paid route returns HTTP 402 with a base64 `PAYMENT-REQUIRED` header (x402 v2). Resend with `PAYMENT-SIGNATURE`. Every response carries data_as_of, sources and licence metadata.",
    "license": {"name": "Data licences vary per product; see attribution in each response", "url": "https://api.lilambd.com/llms.txt"},
    "contact": {"name": "Lilambd Crossing", "email": "hello@lilambd.com", "url": "https://api.lilambd.com"}},
  "servers": [{"url": "https://api.lilambd.com"}],
  "externalDocs": {"url": "https://api.lilambd.com/llms.txt"},
  "tags": [], "paths": {},
  "components": {
    "securitySchemes": {
      "x402": {"type": "apiKey", "in": "header", "name": "PAYMENT-SIGNATURE", "description": "x402 v2 payment payload (base64). Obtain requirements from the 402 response PAYMENT-REQUIRED header."},
      "rapidapi": {"type": "apiKey", "in": "header", "name": "X-RapidAPI-Key"}},
    "parameters": {
      "sample": {"name": "sample", "in": "query", "required": False, "schema": {"type": "string", "enum": ["1", "true"]}, "description": "Free preview, max 3 rows."},
      "limit": {"name": "limit", "in": "query", "required": False, "schema": {"type": "integer", "default": 50, "maximum": 200}},
      "offset": {"name": "offset", "in": "query", "required": False, "schema": {"type": "integer", "default": 0}}},
    "schemas": {
      "Envelope": {"type": "object", "properties": {"data": {}, "attribution": {"type": "string"}, "meta": {"type": "object", "properties": {"data_as_of": {"type": ["string", "null"]}, "sources": {}, "license": {"type": "string"}, "refresh": {"type": "string"}, "known_limits": {"type": "string"}}}, "sample": {}}},
      "Error": {"type": "object", "properties": {"error": {"type": "string"}, "status": {"type": "integer"}}},
      "PaymentRequired": {"type": "object", "properties": {"x402Version": {"type": "integer"}, "error": {"type": "string"}, "accepts": {"type": "array", "items": {"type": "object", "properties": {"scheme": {"type": "string"}, "network": {"type": "string"}, "amount": {"type": "string"}, "asset": {"type": "string"}, "payTo": {"type": "string"}}}}, "hint": {"type": "string"}}}},
    "responses": {
      "402": {"description": "Payment required (x402)", "headers": {"PAYMENT-REQUIRED": {"schema": {"type": "string"}, "description": "base64 JSON payment requirements"}}, "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PaymentRequired"}}}},
      "400": {"description": "Bad input", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
      "404": {"description": "Unknown route or id", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}}}},
}
for name, d in [("/", "Service index: products, payment terms"), ("/health", "Health"), ("/openapi.json", "Live OpenAPI"), ("/llms.txt", "LLM-readable docs"), ("/.well-known/x402", "x402 discovery"), ("/meta", "Per-product data_as_of, sources, licence")]:
    spec["paths"][name] = {"get": {"tags": ["discovery"], "summary": d, "operationId": "discovery_" + (slug(name.replace(".", "_")) if name != "/" else "index"), "security": [], "responses": {"200": {"description": "OK"}}}}
spec["tags"].append({"name": "discovery", "description": "Free discovery endpoints"})
seen = set()
for p in cat["products"]:
    k = p["id"]
    spec["tags"].append({"name": k, "description": f'{p["title"]}. ${p["price_usd"]:g} USDC per call.'})
    for r in p["routes"]:
        free = r["path"] in p["free_routes"]
        params = []
        for q in r["params"]:
            sch = {"type": q["type"] if q["type"] in ("string", "integer", "number", "boolean") else "string"}
            if q.get("example") is not None: sch["examples"] = [q["example"]]
            pp = {"name": q["name"], "in": q["in"], "required": True if q["in"] == "path" else q["required"], "schema": sch}
            if q.get("description"): pp["description"] = q["description"]
            params.append(pp)
        names = {q["name"] for q in r["params"]}
        params.append({"$ref": "#/components/parameters/sample"})
        if "{" not in r["path"].split("/")[-1]:
            for x in ("limit", "offset"):
                if x not in names: params.append({"$ref": f"#/components/parameters/{x}"})
        opid = (k.replace("-", "_") + "_" + slug(r["path"]))
        assert opid not in seen; seen.add(opid)
        op = {"tags": [k], "operationId": opid, "summary": r["summary"] or f'{p["title"]}: {r["path"]}',
              "parameters": params,
              "x-payment-info": {"protocol": "x402", "version": 2, "price_atomic": p["price_atomic"], "price_usd": p["price_usd"], "currency": "USDC", "network": cat["payment"]["network"], "free": free},
              "security": [] if free else [{"x402": []}, {"rapidapi": []}],
              "responses": {"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Envelope"}}}}, "400": {"$ref": "#/components/responses/400"}, "404": {"$ref": "#/components/responses/404"}}}
        if not free: op["responses"]["402"] = {"$ref": "#/components/responses/402"}
        spec["paths"][f"/{k}{r['path']}"] = {"get": op}
json.dump(spec, open(os.path.join(here, "openapi.json"), "w"), indent=1, ensure_ascii=False)
try:
    import yaml
    yaml.safe_dump(spec, open(os.path.join(here, "openapi.yaml"), "w"), sort_keys=False, allow_unicode=True)
except ImportError: pass
print(len(spec["paths"]), "paths")
