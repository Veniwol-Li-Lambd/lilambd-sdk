import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Catalog, formatPrice, loadCatalog } from "./catalog.js";
import { CallResult, ClientConfig, LilambdClient, configFromEnv } from "./client.js";
import { RouteTool, buildRouteTools, parseToolset } from "./tools.js";

export const VERSION = "0.1.0";
const MAX_TEXT = 100_000;

export interface ServerOptions {
  catalog?: Catalog;
  config?: ClientConfig;
  toolset?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [k: string]: unknown;
}

function text(s: string, isError = false): ToolResult {
  if (s.length > MAX_TEXT) s = s.slice(0, MAX_TEXT) + `\n... [truncated ${s.length - MAX_TEXT} chars; use limit/offset]`;
  return isError ? { content: [{ type: "text", text: s }], isError: true } : { content: [{ type: "text", text: s }] };
}

export function formatResult(r: CallResult, priceAtomic?: string): ToolResult {
  if (r.ok) {
    const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
    const note = r.sample ? "[sample=1 free preview: max 3 rows; call without sample for full data]\n" : "";
    return text(note + body);
  }
  if (r.status === 402) {
    const accepts = (r.payment?.accepts ?? []) as Array<Record<string, unknown>>;
    const a = accepts[0] ?? {};
    const amount = String(a.amount ?? a.maxAmountRequired ?? priceAtomic ?? "");
    const lines = [
      `Payment required (HTTP 402, x402 v${r.payment?.x402Version ?? 2}).`,
      amount ? `Price: ${formatPrice(amount)} (${amount} atomic USDC units)` : "",
      a.payTo ? `payTo: ${a.payTo}` : "",
      `network: ${a.network ?? "eip155:8453"}`,
      a.asset ? `asset: ${a.asset}` : "",
      `url: ${r.url}`,
      "",
      "Hint: retry with sample=true for a free 3-row preview, or configure a payment signer via the",
      "LILAMBD_PAYMENT_SIGNATURE_CMD environment variable (see README).",
      r.error !== "payment required" ? `Detail: ${r.error}` : "",
      "",
      "Payment requirements:",
      JSON.stringify(r.payment ?? r.body ?? {}, null, 2),
    ].filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""));
    return text(lines.join("\n"), true);
  }
  const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2);
  return text(`Upstream error ${r.status} for ${r.url}\n${body ?? ""}`, true);
}

export function createLilambdServer(opts: ServerOptions = {}) {
  const catalog = opts.catalog ?? loadCatalog();
  const config = opts.config ?? configFromEnv();
  const toolsetRaw = opts.toolset ?? process.env.LILAMBD_TOOLSET;
  const toolset = parseToolset(toolsetRaw);
  const routeTools = buildRouteTools(catalog, toolset);
  const byName = new Map<string, RouteTool>(routeTools.map((t) => [t.name, t]));
  const client = new LilambdClient(config);
  const productIds = catalog.products.map((p) => p.id);

  const metaTools = [
    {
      name: "list_products",
      description: `List every ${catalog.service} product with its routes, parameters and price per call. Free; no network call.`,
      inputSchema: {
        type: "object" as const,
        properties: {
          product: { type: "string", description: "Optional product id to show in detail", enum: productIds },
        },
      },
    },
    {
      name: "call",
      description:
        "Generic caller for any Lilambd Data for Agents route: GET /{product}{route}. Paid routes cost the product's per-call price via x402 (Base USDC); set sample=true for a free 3-row preview. Use list_products to discover routes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          product: { type: "string", description: "Product id, e.g. airports", enum: productIds },
          route: { type: "string", description: "Route path with path params filled in or as {name} placeholders, e.g. /search or /{code}" },
          params: {
            type: "object",
            description: "Path and query parameters, e.g. {\"q\":\"tokyo\",\"limit\":5}",
            additionalProperties: true,
          },
          sample: { type: "boolean", description: "true = free 3-row preview" },
        },
        required: ["product", "route"],
      },
    },
  ];

  const allTools = [
    ...metaTools,
    ...routeTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  ];

  const server = new Server({ name: "lilambd-mcp", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "list_products") {
        const sel = args.product ? catalog.products.filter((p) => p.id === args.product) : catalog.products;
        if (!sel.length) return text(`Unknown product: ${args.product}`, true);
        const out = sel.map((p) => ({
          id: p.id,
          title: p.title,
          price_per_call: formatPrice(p.price_atomic),
          price_atomic: p.price_atomic,
          free_routes: p.free_routes ?? [],
          routes: p.routes.map((r) => ({
            path: r.path,
            summary: r.summary,
            ...(args.product ? { params: r.params ?? [] } : {}),
          })),
        }));
        return text(JSON.stringify({ service: catalog.service, base_url: config.baseUrl, products: out }, null, 2));
      }
      if (name === "call") {
        const pid = String(args.product ?? "");
        const product = catalog.products.find((p) => p.id === pid);
        if (!product) return text(`Unknown product: ${pid}. Use list_products.`, true);
        let route = String(args.route ?? "/");
        if (!route.startsWith("/")) route = `/${route}`;
        const params = { ...((args.params as Record<string, unknown>) ?? {}) };
        if (args.sample !== undefined) params.sample = args.sample;
        const r = await client.get(product.id, route, params);
        return formatResult(r, product.price_atomic);
      }
      const tool = byName.get(name);
      if (!tool) return text(`Unknown tool: ${name}`, true);
      const pathNames = (tool.route.params ?? []).filter((p) => p.in === "path").map((p) => p.name);
      const r = await client.get(tool.product.id, tool.route.path, args, pathNames);
      return formatResult(r, tool.product.price_atomic);
    } catch (e) {
      return text(`Error: ${(e as Error).message}`, true);
    }
  });

  return { server, tools: allTools, routeTools, client };
}
