/** A value accepted as a query/path parameter. Arrays are sent as repeated keys. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/** Generic parameter bag. */
export type Params = Record<string, QueryValue>;

/** Minimal fetch signature so any WHATWG-compatible implementation can be injected. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One entry of the x402 `accepts` list. Unknown fields are preserved. */
export interface PaymentRequirement {
  scheme?: string;
  network?: string;
  /** Atomic amount (x402 v2). */
  amount?: string;
  /** Atomic amount (x402 v1 naming). */
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Decoded x402 challenge (from the `PAYMENT-REQUIRED` header or the 402 JSON body). */
export interface PaymentRequired {
  x402Version?: number;
  error?: string;
  resource?: unknown;
  accepts: PaymentRequirement[];
  [key: string]: unknown;
}

/** What a payment signer receives when the API answers 402. */
export interface PaymentContext {
  /** Fully-built request URL. */
  url: string;
  /** HTTP method (always GET for this API). */
  method: string;
  product: string;
  route: string;
  /** Decoded challenge. */
  paymentRequired: PaymentRequired;
  /** The requirement the SDK picked (Base USDC when offered, else the first). */
  requirement: PaymentRequirement | undefined;
  /** Price of the selected requirement in USD (USDC has 6 decimals). */
  priceUsd: number | undefined;
  /** Raw base64 `PAYMENT-REQUIRED` header, if present. */
  paymentRequiredHeader: string | null;
}

/**
 * Turns a 402 challenge into a base64 x402 payment payload, which the SDK sends
 * back in the `PAYMENT-SIGNATURE` (or `X-PAYMENT`) header.
 */
export type PaymentSigner = (ctx: PaymentContext) => Promise<string>;

export interface LilambdOptions {
  /** API origin. Default `https://api.lilambd.com`. */
  baseUrl?: string;
  /** x402 signer; when omitted, paid calls throw `PaymentRequiredError`. */
  paymentSigner?: PaymentSigner;
  /** Header used to carry the payment payload. Default `PAYMENT-SIGNATURE`. */
  paymentHeader?: "PAYMENT-SIGNATURE" | "X-PAYMENT";
  /** Upper bound in USD the SDK will let the signer pay per call. */
  maxPriceUsd?: number;
  /** RapidAPI key: switches to RapidAPI mode (no x402). */
  rapidapiKey?: string;
  /** RapidAPI host, e.g. `lilambd.p.rapidapi.com`. */
  rapidapiHost?: string;
  /** Custom fetch implementation (defaults to `globalThis.fetch`). */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Request every call as a free 3-row preview (`sample=1`). */
  sample?: boolean;
}

export interface CallOptions {
  /** Free 3-row preview (`sample=1`). */
  sample?: boolean;
  /** Abort signal for this call. */
  signal?: AbortSignal;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

/** Internal transport the generated namespaces call into. */
export interface LilambdTransport {
  get<T = unknown>(product: string, route: string, params?: object, options?: CallOptions): Promise<T>;
}
