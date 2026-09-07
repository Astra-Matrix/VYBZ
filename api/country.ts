// Vercel function: the visitor's country from the edge header, for localized
// price previews. Returns { country: "US" } or { country: null } when Vercel
// did not set the header (local development, some proxies). The client passes
// the code to Paddle only when present; Paddle otherwise detects the location
// from the visitor's own IP address.
import type { IncomingMessage, ServerResponse } from "node:http";

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const raw = String(req.headers["x-vercel-ip-country"] ?? "").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : null;
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify({ country }));
}
