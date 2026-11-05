import type { PaymentRequired, PaymentRequirement } from "./types.js";

/** Base error for any non-2xx answer or client-side misuse. */
export class LilambdError extends Error {
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly body: unknown;
  constructor(message: string, opts: { status?: number; url?: string; body?: unknown } = {}) {
    super(message);
    this.name = "LilambdError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
  }
}

/** Thrown on HTTP 402 when no signer is configured (or the paid retry was refused). */
export class PaymentRequiredError extends LilambdError {
  /** Decoded x402 challenge. */
  readonly paymentRequired: PaymentRequired;
  /** Shortcut for `paymentRequired.accepts`. */
  readonly requirements: PaymentRequirement[];
  /** Requirement the SDK would pay (Base USDC when offered). */
  readonly requirement: PaymentRequirement | undefined;
  /** Price in USD of `requirement`. */
  readonly priceUsd: number | undefined;
  /** Raw base64 `PAYMENT-REQUIRED` header. */
  readonly paymentRequiredHeader: string | null;
  constructor(opts: {
    url: string;
    body: unknown;
    paymentRequired: PaymentRequired;
    requirement: PaymentRequirement | undefined;
    priceUsd: number | undefined;
    paymentRequiredHeader: string | null;
    message?: string;
  }) {
    const price = opts.priceUsd !== undefined ? ` (${opts.priceUsd} USD)` : "";
    super(opts.message ?? `Payment required${price}: ${opts.url}`, { status: 402, url: opts.url, body: opts.body });
    this.name = "PaymentRequiredError";
    this.paymentRequired = opts.paymentRequired;
    this.requirements = opts.paymentRequired.accepts;
    this.requirement = opts.requirement;
    this.priceUsd = opts.priceUsd;
    this.paymentRequiredHeader = opts.paymentRequiredHeader;
  }
}
