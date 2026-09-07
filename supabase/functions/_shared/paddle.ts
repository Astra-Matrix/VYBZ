// Paddle Billing client for VYBZ edge functions (Deno). Paddle is the merchant
// of record: it sells the subscription, collects tax, and bills overages we
// post as one-time charges. Secrets: PADDLE_API_KEY (env), PADDLE_ENV
// ("sandbox" | "live", env), PADDLE_WEBHOOK_SECRET (Vault, env fallback).
import { secret } from "./secrets.ts";

const ENV = (Deno.env.get("PADDLE_ENV") ?? "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
export const PADDLE_ENV = ENV;
const BASE = ENV === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

export class PaddleError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function paddle<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const key = Deno.env.get("PADDLE_API_KEY") ?? "";
  if (!key) throw new PaddleError(503, "not_configured", "PADDLE_API_KEY is not set.");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Paddle-Version": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: { data?: T; error?: { code?: string; detail?: string } } = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* non-JSON */ }
  if (!res.ok) throw new PaddleError(res.status, parsed.error?.code ?? "paddle_error", parsed.error?.detail ?? `Paddle answered ${res.status}.`);
  return parsed.data as T;
}

export type PaddleSubscription = {
  id: string;
  status: "active" | "canceled" | "past_due" | "paused" | "trialing";
  customer_id: string;
  custom_data?: Record<string, unknown> | null;
  current_billing_period?: { starts_at: string; ends_at: string } | null;
  items?: Array<{ price?: { id?: string; custom_data?: Record<string, unknown> | null } }>;
};

/** Map Paddle's subscription status onto the org_billing status vocabulary. */
export function mapStatus(s: string): string {
  return ["active", "trialing", "past_due", "paused", "canceled"].includes(s) ? s : "none";
}

/**
 * Verify a Paddle webhook. Header `Paddle-Signature: ts=<unix>;h1=<hex>` where
 * h1 = HMAC-SHA256(secret, `${ts}:${rawBody}`). Rejects signatures older than
 * five minutes.
 */
export async function verifyPaddleSignature(header: string | null, raw: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(";").map((kv) => kv.trim().split("=") as [string, string]));
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1 || !/^\d+$/.test(ts)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const whsec = await secret("PADDLE_WEBHOOK_SECRET");
  if (!whsec) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(whsec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}:${raw}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== h1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ h1.charCodeAt(i);
  return diff === 0;
}
