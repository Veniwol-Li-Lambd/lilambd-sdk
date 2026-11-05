import { spawn } from "node:child_process";

export interface ClientConfig {
  baseUrl: string;
  signerCmd?: string;
  rapidApiKey?: string;
  rapidApiHost?: string;
  defaultSample?: boolean;
  fetch?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClientConfig {
  const rapidApiKey = env.LILAMBD_RAPIDAPI_KEY || undefined;
  const rapidApiHost = env.LILAMBD_RAPIDAPI_HOST || undefined;
  let baseUrl = env.LILAMBD_BASE_URL || "";
  if (!baseUrl) baseUrl = rapidApiKey && rapidApiHost ? `https://${rapidApiHost}` : "https://api.lilambd.com";
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    signerCmd: env.LILAMBD_PAYMENT_SIGNATURE_CMD || undefined,
    rapidApiKey,
    rapidApiHost,
    defaultSample: /^(1|true|yes)$/i.test(env.LILAMBD_DEFAULT_SAMPLE ?? ""),
  };
}

export interface PaymentRequirements {
  x402Version?: number;
  accepts?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export type CallResult =
  | { ok: true; status: number; data: unknown; paid: boolean; sample: boolean; url: string }
  | {
      ok: false;
      status: number;
      error: string;
      url: string;
      payment?: PaymentRequirements;
      body?: unknown;
    };

export function decodePaymentHeader(v: string | null): PaymentRequirements | undefined {
  if (!v) return undefined;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  }
}

/** Run the user-configured signer: requirements JSON on stdin, header value on stdout. */
export function runSigner(cmd: string, requirements: unknown, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("payment signer timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const v = out.trim();
      if (code !== 0 || !v) reject(new Error(`payment signer failed (exit ${code}): ${err.trim().slice(0, 500)}`));
      else resolve(v);
    });
    child.stdin.end(JSON.stringify(requirements));
  });
}

export function buildUrl(
  baseUrl: string,
  product: string,
  routePath: string,
  args: Record<string, unknown>,
  pathParamNames: string[],
): string {
  const used = new Set<string>();
  const path = routePath.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    used.add(name);
    const v = args[name];
    if (v === undefined || v === null || v === "") throw new Error(`missing required path parameter: ${name}`);
    return encodeURIComponent(String(v));
  });
  for (const n of pathParamNames) used.add(n);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (used.has(k) || v === undefined || v === null || v === "") continue;
    if (k === "sample") {
      if (v === true || v === "true" || v === 1 || v === "1") qs.set("sample", "1");
      continue;
    }
    qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const q = qs.toString();
  return `${baseUrl}/${product.replace(/^\/+/, "")}${path.startsWith("/") ? path : `/${path}`}${q ? `?${q}` : ""}`;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class LilambdClient {
  constructor(public cfg: ClientConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.cfg.userAgent ?? "lilambd-mcp/0.1.0",
      ...extra,
    };
    if (this.cfg.rapidApiKey) {
      h["x-rapidapi-key"] = this.cfg.rapidApiKey;
      if (this.cfg.rapidApiHost) h["x-rapidapi-host"] = this.cfg.rapidApiHost;
    }
    return h;
  }

  private async doFetch(url: string, headers: Record<string, string>): Promise<Response> {
    const f = this.cfg.fetch ?? fetch;
    return f(url, { method: "GET", headers, signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 60_000) });
  }

  async get(
    product: string,
    routePath: string,
    args: Record<string, unknown> = {},
    pathParamNames: string[] = [],
  ): Promise<CallResult> {
    const a = { ...args };
    if (a.sample === undefined && this.cfg.defaultSample) a.sample = true;
    const sample = a.sample === true || a.sample === "true" || a.sample === 1 || a.sample === "1";
    const url = buildUrl(this.cfg.baseUrl, product, routePath, a, pathParamNames);
    let res = await this.doFetch(url, this.headers());
    let paid = false;
    if (res.status === 402) {
      const body = await readBody(res);
      const payment =
        decodePaymentHeader(res.headers.get("payment-required")) ??
        (body && typeof body === "object" ? (body as PaymentRequirements) : undefined);
      if (!this.cfg.signerCmd) {
        return { ok: false, status: 402, error: "payment required", url, payment, body };
      }
      const sig = await runSigner(this.cfg.signerCmd, payment ?? body);
      res = await this.doFetch(url, this.headers({ "payment-signature": sig }));
      paid = true;
      if (res.status === 402) {
        const b2 = await readBody(res);
        return {
          ok: false,
          status: 402,
          error: "payment rejected by upstream after signing",
          url,
          payment: decodePaymentHeader(res.headers.get("payment-required")) ?? payment,
          body: b2,
        };
      }
    }
    const data = await readBody(res);
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, url, body: data };
    return { ok: true, status: res.status, data, paid, sample, url };
  }
}
