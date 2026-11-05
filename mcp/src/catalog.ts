import { readFileSync } from "node:fs";

export interface Param {
  name: string;
  in: "path" | "query" | string;
  required?: boolean;
  type?: string;
  description?: string;
  example?: unknown;
}
export interface Route {
  path: string;
  summary?: string;
  operationId?: string;
  params?: Param[];
}
export interface Product {
  id: string;
  title: string;
  price_atomic: string;
  price_usd?: number;
  free_routes?: string[];
  routes: Route[];
}
export interface Catalog {
  service: string;
  base_url: string;
  mcp_url?: string;
  payment?: Record<string, unknown>;
  products: Product[];
}

let cached: Catalog | undefined;

/** Load the bundled catalog.json (shipped next to dist/). */
export function loadCatalog(): Catalog {
  if (!cached) {
    const url = new URL("../catalog.json", import.meta.url);
    cached = JSON.parse(readFileSync(url, "utf8")) as Catalog;
  }
  return cached;
}

/** USDC has 6 decimals. */
export function formatPrice(priceAtomic: string): string {
  const n = Number(priceAtomic) / 1e6;
  return `$${n.toFixed(n < 0.01 ? 4 : 3).replace(/0+$/, "").replace(/\.$/, ".00")} USDC`;
}

export function isFreeRoute(p: Product, path: string): boolean {
  return (p.free_routes ?? []).includes(path);
}
