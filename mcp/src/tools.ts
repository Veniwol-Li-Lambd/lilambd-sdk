import { Catalog, Product, Route, formatPrice, isFreeRoute } from "./catalog.js";

export const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface RouteTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  product: Product;
  route: Route;
  free: boolean;
}

/** "/prefectures/{pref}/facts" -> "prefectures_by_pref_facts"; "/{code}" -> "by_code". */
export function routeSlug(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      const m = /^\{(.+)\}$/.exec(seg);
      return m ? `by_${m[1]}` : seg;
    })
    .join("_");
}

export function sanitize(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function toolName(productId: string, path: string): string {
  let name = sanitize(`${productId}_${routeSlug(path) || "root"}`);
  if (name.length > 64) name = name.slice(0, 64).replace(/_$/, "");
  return name;
}

function jsonType(t?: string): string {
  switch (t) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

export function buildInputSchema(route: Route): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  const required: string[] = [];
  for (const p of route.params ?? []) {
    const prop: Record<string, unknown> = { type: jsonType(p.type) };
    let desc = p.description ?? "";
    if (p.example !== undefined && p.example !== "" && p.example !== null) {
      desc += `${desc ? " " : ""}(e.g. ${JSON.stringify(p.example)})`;
    }
    if (p.in === "path") desc = `Path parameter. ${desc}`.trim();
    if (desc) prop.description = desc;
    properties[p.name] = prop;
    if (p.in === "path" || p.required) required.push(p.name);
  }
  if (!properties.limit) properties.limit = { type: "integer", description: "Max rows to return" };
  if (!properties.offset) properties.offset = { type: "integer", description: "Rows to skip" };
  properties.sample = {
    type: "boolean",
    description: "true = free 3-row preview (no payment needed)",
  };
  const schema: JsonSchema = { type: "object", properties };
  if (required.length) schema.required = [...new Set(required)];
  return schema;
}

export function buildDescription(product: Product, route: Route, free: boolean): string {
  const price = free ? "Free (no payment)." : `Price: ${formatPrice(product.price_atomic)} per call via x402 (Base USDC).`;
  const summary = route.summary ? `${route.summary}.` : "";
  return `${product.title}: ${summary} GET /${product.id}${route.path}. ${price}${
    free ? "" : " Set sample=true for a free 3-row preview."
  }`.replace(/\.\./g, ".");
}

/** Parse LILAMBD_TOOLSET ("airports,colors") into a set; empty/undefined/"all" = everything. */
export function parseToolset(v?: string): Set<string> | undefined {
  if (!v) return undefined;
  const ids = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.includes("all") || ids.includes("*")) return undefined;
  return new Set(ids);
}

export function buildRouteTools(catalog: Catalog, toolset?: Set<string>): RouteTool[] {
  const out: RouteTool[] = [];
  const seen = new Set<string>();
  for (const product of catalog.products) {
    if (toolset && !toolset.has(product.id)) continue;
    for (const route of product.routes) {
      let name = toolName(product.id, route.path);
      let i = 2;
      while (seen.has(name)) name = `${toolName(product.id, route.path).slice(0, 60)}_${i++}`;
      seen.add(name);
      const free = isFreeRoute(product, route.path);
      out.push({
        name,
        description: buildDescription(product, route, free),
        inputSchema: buildInputSchema(route),
        product,
        route,
        free,
      });
    }
  }
  return out;
}
