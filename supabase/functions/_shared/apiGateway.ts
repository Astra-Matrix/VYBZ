// Shared plumbing for the VYBZ public API (`api-v1`).
//
// Authentication is an organization API key, never a user session. The key
// arrives as `Authorization: Bearer vybz_live_…` (or `X-API-Key`). Only its
// SHA-256 is ever compared against the database.
import { admin } from "./edge.ts";

export const API_VERSION = "2026-09-05";
export const DOCS_URL = "https://vybz.cloud/docs";

export type Scope =
  | "org:read"
  | "provenance:read"
  | "provenance:write"
  | "provenance:detect"
  | "vault:read"
  | "vault:write";

export interface Principal {
  keyId: string;
  orgId: string;
  scopes: Scope[];
  plan: string;
  remaining: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-api-key, content-type, accept, idempotency-key, x-vybz-title, x-vybz-external-ref, x-vybz-content-sha256, x-vybz-mime",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers":
    "x-request-id, x-ratelimit-remaining, x-vybz-watermark-id, x-vybz-issuance-id, x-vybz-c2pa, x-vybz-sha256, content-disposition",
};

export function baseHeaders(requestId: string, principal?: Principal | null): Record<string, string> {
  const h: Record<string, string> = {
    ...CORS,
    "X-Request-Id": requestId,
    "X-VYBZ-Api-Version": API_VERSION,
    "Cache-Control": "no-store",
  };
  if (principal) h["X-RateLimit-Remaining"] = String(principal.remaining);
  return h;
}

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function errorBody(err: ApiError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      request_id: requestId,
      docs: `${DOCS_URL}/api#errors`,
      ...(err.extra ?? {}),
    },
  };
}

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const h = await crypto.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extractKey(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(vybz_(?:live|test)_[a-f0-9]{48})$/i.exec(auth.trim());
  if (m) return m[1];
  const x = req.headers.get("X-API-Key")?.trim() ?? "";
  if (/^vybz_(?:live|test)_[a-f0-9]{48}$/i.test(x)) return x;
  return null;
}

export async function authenticate(req: Request): Promise<Principal> {
  const key = extractKey(req);
  if (!key) {
    throw new ApiError(401, "unauthenticated", "Provide an organization API key as `Authorization: Bearer vybz_live_…`.");
  }
  const hash = await sha256Hex(key);
  const { data, error } = await admin.rpc("api_key_authenticate", { p_hash: hash });
  if (error) throw new ApiError(500, "auth_unavailable", "Key verification is temporarily unavailable.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.key_id) throw new ApiError(401, "invalid_key", "This API key is unknown, revoked, or expired.");
  if (row.limited) {
    throw new ApiError(429, "rate_limited", "Per-minute rate limit reached for this key.", { retry_after_seconds: 60 });
  }
  return {
    keyId: row.key_id,
    orgId: row.org_id,
    scopes: (row.scopes ?? []) as Scope[],
    plan: row.plan ?? "developer",
    remaining: Number(row.remaining ?? 0),
  };
}

export function requireScope(p: Principal, scope: Scope): void {
  if (!p.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `This key lacks the \`${scope}\` scope.`, { required_scope: scope });
  }
}

export function recordCall(input: {
  principal: Principal | null;
  method: string;
  path: string;
  status: number;
  startedAt: number;
  bytesIn: number;
  bytesOut: number;
  agent: string;
  requestId: string;
  product: "provenance" | "vault" | "platform";
  detail?: Record<string, unknown>;
}): void {
  if (!input.principal) return;
  // PostgREST builders are lazy: they only execute once awaited or `.then`-ed.
  const p = admin.rpc("api_record_call", {
    p_org: input.principal.orgId,
    p_key: input.principal.keyId,
    p_method: input.method,
    p_path: input.path,
    p_status: input.status,
    p_duration_ms: Math.round(performance.now() - input.startedAt),
    p_bytes_in: input.bytesIn,
    p_bytes_out: input.bytesOut,
    p_agent: input.agent,
    p_request_id: input.requestId,
    p_product: input.product,
    p_detail: input.detail ?? {},
  }).then(({ error }: { error: { message: string } | null }) => {
    if (error) console.error("audit", input.requestId, error.message);
  });
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "repo";
}

/** Canonical JSON: sorted keys, no whitespace — stable across runtimes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send a JSON body with `Content-Type: application/json`.");
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export async function readBinary(req: Request, maxBytes: number): Promise<Uint8Array> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) {
    throw new ApiError(413, "payload_too_large", `Body exceeds ${Math.round(maxBytes / 1_048_576)} MB.`);
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0) throw new ApiError(400, "empty_body", "Send the file bytes as the raw request body.");
  if (buf.byteLength > maxBytes) {
    throw new ApiError(413, "payload_too_large", `Body exceeds ${Math.round(maxBytes / 1_048_576)} MB.`);
  }
  return buf;
}
