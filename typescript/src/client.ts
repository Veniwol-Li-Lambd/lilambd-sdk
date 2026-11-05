import { LilambdError, PaymentRequiredError } from "./errors.js";
import { createNamespaces, type GeneratedNamespaces } from "./generated.js";
import type {
  CallOptions,
  FetchLike,
  LilambdOptions,
  LilambdTransport,
  PaymentContext,
  PaymentRequired,
  PaymentRequirement,
  PaymentSigner,
  QueryValue,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.lilambd.com";
/** Base mainnet, where Lilambd settles USDC payments. */
export const DEFAULT_NETWORK = "eip155:8453";
const USDC_DECIMALS = 6;

/** Decode base64 (standard or URL-safe) to a UTF-8 string, in any runtime. */
export function decodeBase64(b64: string): string {
  const norm = b64.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const B = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer;
  if (B) return B.from(padded, "base64").toString("utf8");
  throw new Error("No base64 decoder available");
}

/** Encode a UTF-8 string as standard base64, in any runtime. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Convert an atomic USDC amount (6 decimals) to USD. */
export function atomicToUsd(atomic: string | number | bigint | undefined): number | undefined {
  if (atomic === undefined || atomic === null || atomic === "") return undefined;
  const n = Number(atomic);
  return Number.isFinite(n) ? n / 10 ** USDC_DECIMALS : undefined;
}

/** Pick the Base USDC requirement if offered, else the first one. */
export function selectRequirement(pr: PaymentRequired): PaymentRequirement | undefined {
  const list = Array.isArray(pr.accepts) ? pr.accepts : [];
  return list.find((a) => a && a.network === DEFAULT_NETWORK) ?? list[0];
}

/** Parse an x402 challenge from the `PAYMENT-REQUIRED` header (preferred) or the JSON body. */
export function parsePaymentRequired(header: string | null, body: unknown): PaymentRequired {
  let parsed: unknown;
  if (header) {
    try {
      parsed = JSON.parse(decodeBase64(header));
    } catch {
      parsed = undefined;
    }
  }
  if (!parsed && body && typeof body === "object") parsed = body;
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const accepts = Array.isArray(obj.accepts) ? (obj.accepts as PaymentRequirement[]) : [];
  return { ...obj, accepts } as PaymentRequired;
}

function appendQuery(sp: URLSearchParams, key: string, value: QueryValue): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const v of value) sp.append(key, String(v));
    return;
  }
  sp.append(key, String(value));
}

/**
 * Build `{base}/{product}{route}?query`, substituting `{placeholders}` in `route`
 * from `params` (those keys are removed from the query string).
 */
export function buildUrl(
  baseUrl: string,
  product: string,
  route: string,
  params: object = {},
  sample = false,
): string {
  const rest: Record<string, QueryValue> = { ...(params as Record<string, QueryValue>) };
  const path = route.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const v = rest[name];
    if (v === undefined || v === null || v === "") {
      throw new LilambdError(`Missing path parameter "${name}" for /${product}${route}`);
    }
    delete rest[name];
    return encodeURIComponent(String(v));
  });
  const prefix = product ? "/" + product.replace(/^\/+|\/+$/g, "") : "";
  const suffix = path ? (path.startsWith("/") ? path : "/" + path) : "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) appendQuery(sp, k, v);
  if (sample) sp.set("sample", "1");
  const qs = sp.toString();
  return baseUrl.replace(/\/+$/, "") + prefix + suffix + (qs ? "?" + qs : "");
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json") || /^[\s]*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      /* fall through */
    }
  }
  return text;
}

class Transport implements LilambdTransport {
  readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly signer: PaymentSigner | undefined;
  private readonly paymentHeader: string;
  private readonly maxPriceUsd: number | undefined;
  private readonly rapidapiKey: string | undefined;
  private readonly rapidapiHost: string | undefined;
  private readonly headers: Record<string, string>;
  private readonly sample: boolean;

  constructor(opts: LilambdOptions) {
    const f = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) throw new LilambdError("No fetch implementation found: pass `fetch` in options (Node 18+ has one built in).");
    this.fetchImpl = opts.fetch ? f : (input, init) => (globalThis.fetch as FetchLike)(input, init);
    this.rapidapiKey = opts.rapidapiKey;
    this.rapidapiHost = opts.rapidapiHost;
    this.baseUrl =
      opts.baseUrl ?? (opts.rapidapiKey && opts.rapidapiHost ? `https://${opts.rapidapiHost}` : DEFAULT_BASE_URL);
    this.signer = opts.paymentSigner;
    this.paymentHeader = opts.paymentHeader ?? "PAYMENT-SIGNATURE";
    this.maxPriceUsd = opts.maxPriceUsd;
    this.headers = { ...(opts.headers ?? {}) };
    this.sample = opts.sample ?? false;
  }

  get rapidapi(): boolean {
    return Boolean(this.rapidapiKey);
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json", ...this.headers, ...(extra ?? {}) };
    if (this.rapidapiKey) {
      h["x-rapidapi-key"] = this.rapidapiKey;
      if (this.rapidapiHost) h["x-rapidapi-host"] = this.rapidapiHost;
    }
    return h;
  }

  async getUrl<T>(url: string, product: string, route: string, options: CallOptions = {}): Promise<T> {
    const headers = this.baseHeaders(options.headers);
    let res = await this.fetchImpl(url, { method: "GET", headers, signal: options.signal });
    if (res.status === 402) {
      const body = await readBody(res);
      const header = res.headers.get("payment-required");
      const paymentRequired = parsePaymentRequired(header, body);
      const requirement = selectRequirement(paymentRequired);
      const priceUsd = atomicToUsd(requirement?.amount ?? requirement?.maxAmountRequired);
      const errInfo = { url, body, paymentRequired, requirement, priceUsd, paymentRequiredHeader: header };
      if (!this.signer || this.rapidapi) throw new PaymentRequiredError(errInfo);
      if (this.maxPriceUsd !== undefined && priceUsd !== undefined && priceUsd > this.maxPriceUsd) {
        throw new PaymentRequiredError({
          ...errInfo,
          message: `Price ${priceUsd} USD exceeds maxPriceUsd ${this.maxPriceUsd}: ${url}`,
        });
      }
      const ctx: PaymentContext = {
        url,
        method: "GET",
        product,
        route,
        paymentRequired,
        requirement,
        priceUsd,
        paymentRequiredHeader: header,
      };
      const payload = await this.signer(ctx);
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: { ...headers, [this.paymentHeader]: payload },
        signal: options.signal,
      });
      if (res.status === 402) {
        const body2 = await readBody(res);
        const header2 = res.headers.get("payment-required");
        const pr2 = parsePaymentRequired(header2, body2);
        const req2 = selectRequirement(pr2);
        throw new PaymentRequiredError({
          url,
          body: body2,
          paymentRequired: pr2,
          requirement: req2,
          priceUsd: atomicToUsd(req2?.amount ?? req2?.maxAmountRequired),
          paymentRequiredHeader: header2,
          message: `Payment rejected by server: ${url}`,
        });
      }
    }
    const data = await readBody(res);
    if (!res.ok) {
      const detail =
        data && typeof data === "object" && "error" in data ? `: ${String((data as { error: unknown }).error)}` : "";
      throw new LilambdError(`HTTP ${res.status}${detail} (${url})`, { status: res.status, url, body: data });
    }
    return data as T;
  }

  get<T = unknown>(product: string, route: string, params?: object, options: CallOptions = {}): Promise<T> {
    let url: string;
    try {
      url = buildUrl(this.baseUrl, product, route, params ?? {}, options.sample ?? this.sample);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.getUrl<T>(url, product, route, options);
  }
}

// Declaration merging: the class gets one typed property per product namespace.
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-unsafe-declaration-merging
export interface Lilambd extends GeneratedNamespaces {}

/**
 * Lilambd API client.
 *
 * ```ts
 * const client = new Lilambd();
 * const preview = await client.airports.search({ q: "tokyo" }, { sample: true });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Lilambd {
  /** Resolved API origin. */
  readonly baseUrl: string;
  private readonly transport: Transport;

  constructor(options: LilambdOptions = {}) {
    this.transport = new Transport(options);
    this.baseUrl = this.transport.baseUrl;
    Object.assign(this, createNamespaces(this.transport));
  }

  /**
   * Generic call: `GET {base}/{product}{route}?query`. `{placeholders}` in `route`
   * are filled from `params`.
   */
  get<T = unknown>(product: string, route: string, params?: object, options?: CallOptions): Promise<T> {
    return this.transport.get<T>(product, route, params, options);
  }

  /** Build the URL a call would hit, without sending it. */
  url(product: string, route: string, params?: object, options: CallOptions = {}): string {
    return buildUrl(this.baseUrl, product, route, params ?? {}, options.sample ?? false);
  }

  /** `GET /` — service index (free). */
  index<T = unknown>(options?: CallOptions): Promise<T> {
    return this.transport.get<T>("", "/", {}, options);
  }
  /** `GET /openapi.json` — OpenAPI document (free). */
  openapi<T = unknown>(options?: CallOptions): Promise<T> {
    return this.transport.get<T>("", "/openapi.json", {}, options);
  }
  /** `GET /llms.txt` — LLM-oriented description (free). */
  llmsTxt(options?: CallOptions): Promise<string> {
    return this.transport.get<string>("", "/llms.txt", {}, options);
  }
  /** `GET /.well-known/x402` — x402 discovery document (free). */
  wellKnownX402<T = unknown>(options?: CallOptions): Promise<T> {
    return this.transport.get<T>("", "/.well-known/x402", {}, options);
  }
  /** `GET /health` — liveness (free). */
  health<T = unknown>(options?: CallOptions): Promise<T> {
    return this.transport.get<T>("", "/health", {}, options);
  }
  /** `GET /meta` — catalog metadata (free). */
  meta<T = unknown>(options?: CallOptions): Promise<T> {
    return this.transport.get<T>("", "/meta", {}, options);
  }
}
