/**
 * Minimal typed client for the VYBZ API. No dependencies; works in Node 20+.
 * Shared by the local MCP server (stdio) and the hosted MCP endpoint.
 */
import { createHash } from "node:crypto";

export const DEFAULT_BASE = "https://vybz.cloud/v1";

export interface ClientOptions {
  apiKey: string;
  base?: string;
  userAgent?: string;
}

export class VybzApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  /**
   * Extra fields the API attached to the error: `required_scope`, `missing`
   * (blobs), `head` / `expected` (branch), `plan` / `used` / `included` /
   * `upgrade`, `supported` (formats), `retry_after_seconds`, `computed` (hash).
   * Surfaced to agents so they can act on the cause, not only the message.
   */
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, requestId?: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

/** Reserved keys of the API error envelope; everything else is a detail. */
const ENVELOPE_KEYS = new Set(["code", "message", "request_id", "docs"]);

export type UploadSession = { object: "vault.upload"; id: string; sha256: string; size: number; part_size: number; parts: number; received_bytes: number; next_part: number; status: string; expires_at: string };

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type NamedFile = { name: string; bytes: Uint8Array };
export type VerifyOptions = { attribute?: boolean; asset?: string; name?: string };

function verifyQuery(opts: VerifyOptions): string {
  const q = new URLSearchParams();
  if (opts.attribute) q.set("attribute", "true");
  if (opts.asset) q.set("asset", opts.asset);
  const s = q.toString();
  return s ? `?${s}` : "";
}

function toForm(files: NamedFile[]): FormData {
  const form = new FormData();
  for (const f of files) form.append("files", new Blob([f.bytes as unknown as ArrayBuffer]), f.name);
  return form;
}

export class VybzClient {
  private readonly key: string;
  readonly base: string;
  private readonly ua: string;

  constructor(opts: ClientOptions) {
    if (!/^vybz_(live|test)_[a-f0-9]{48}$/i.test(opts.apiKey ?? "")) {
      throw new Error("A VYBZ organization API key (vybz_live_…) is required.");
    }
    this.key = opts.apiKey;
    this.base = (opts.base ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.ua = opts.userAgent ?? "vybz-mcp/1.1";
  }

  private async call<T>(method: string, path: string, init: { json?: unknown; body?: Uint8Array; form?: FormData; headers?: Record<string, string>; accept?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      "User-Agent": this.ua,
      Accept: init.accept ?? "application/json",
      ...(init.headers ?? {}),
    };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) {
      body = init.form; // fetch sets the multipart boundary
    } else if (init.body) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/octet-stream";
      body = init.body as unknown as BodyInit;
    }
    const res = await fetch(`${this.base}${path}`, { method, headers, body });
    const rid = res.headers.get("x-request-id") ?? undefined;
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      let code = "http_error";
      let message = `${res.status} ${res.statusText}`;
      let details: Record<string, unknown> | undefined;
      let requestId = rid;
      if (ct.includes("application/json")) {
        const j = (await res.json().catch(() => null)) as { error?: Record<string, unknown> } | null;
        const e = j?.error;
        if (e && typeof e === "object") {
          if (typeof e.code === "string") code = e.code;
          if (typeof e.message === "string") message = e.message;
          if (typeof e.request_id === "string") requestId = requestId ?? e.request_id;
          const rest = Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE_KEYS.has(k)));
          if (Object.keys(rest).length) details = rest;
        }
      }
      throw new VybzApiError(res.status, code, message, requestId, details);
    }
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.arrayBuffer()) as unknown as T;
  }

  // Platform
  me() { return this.call<Record<string, unknown>>("GET", "/me"); }
  billingUsage(months?: number) { return this.call<Record<string, unknown>>("GET", months ? `/billing/usage?months=${months}` : "/billing/usage"); }

  // Provenance
  registerAsset(wav: Uint8Array, opts: { title?: string; externalRef?: string } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream", "X-VYBZ-Content-SHA256": sha256(wav) };
    if (opts.title) headers["X-VYBZ-Title"] = opts.title;
    if (opts.externalRef) headers["X-VYBZ-External-Ref"] = opts.externalRef;
    return this.call<Record<string, unknown>>("POST", "/provenance/assets", { body: wav, headers });
  }
  listAssets(limit = 50) { return this.call<{ data: Record<string, unknown>[] }>("GET", `/provenance/assets?limit=${limit}`); }
  getAsset(id: string) { return this.call<Record<string, unknown>>("GET", `/provenance/assets/${encodeURIComponent(id)}`); }
  issueBytes(id: string, req: { recipient: string; license?: string; c2pa?: boolean }) {
    return this.call<ArrayBuffer>("POST", `/provenance/assets/${encodeURIComponent(id)}/issue`, { json: req, accept: "audio/wav" });
  }
  issueLink(id: string, req: { recipient: string; license?: string; c2pa?: boolean }) {
    return this.call<Record<string, unknown>>("POST", `/provenance/assets/${encodeURIComponent(id)}/issue`, { json: { ...req, store: true }, accept: "application/json" });
  }
  issueBatch(id: string, req: { recipients: Array<string | { recipient: string; license?: string }>; license?: string; c2pa?: boolean }) {
    return this.call<{ data: Record<string, unknown>[]; summary: Record<string, number>; manifest: { url: string | null; expires_in: number } | null }>("POST", `/provenance/assets/${encodeURIComponent(id)}/issue/batch`, { json: req });
  }
  listIssuances(id: string) { return this.call<{ data: Record<string, unknown>[] }>("GET", `/provenance/assets/${encodeURIComponent(id)}/issuances`); }
  ledger(id: string) { return this.call<{ data: Record<string, unknown>[] }>("GET", `/provenance/assets/${encodeURIComponent(id)}/ledger`); }
  detect(id: string, bytes: Uint8Array, name = "suspect") {
    return this.call<Record<string, unknown>>("POST", `/provenance/assets/${encodeURIComponent(id)}/detect`, { body: bytes, headers: { "X-VYBZ-Name": name } });
  }
  detectBatch(id: string, files: NamedFile[]) {
    return this.call<{ data: Record<string, unknown>[]; summary: Record<string, number> }>("POST", `/provenance/assets/${encodeURIComponent(id)}/detect/batch`, { form: toForm(files) });
  }
  verify(bytes: Uint8Array, opts: VerifyOptions = {}) {
    const q = verifyQuery(opts);
    return this.call<Record<string, unknown>>("POST", `/provenance/verify${q}`, { body: bytes, headers: { "X-VYBZ-Name": opts.name ?? "file" } });
  }
  verifyBatch(files: NamedFile[], opts: VerifyOptions = {}) {
    return this.call<{ data: Record<string, unknown>[]; summary: Record<string, number> }>("POST", `/provenance/verify/batch${verifyQuery(opts)}`, { form: toForm(files) });
  }
  verifyUrls(items: { url: string; name?: string }[], opts: VerifyOptions = {}) {
    return this.call<{ data: Record<string, unknown>[]; summary: Record<string, number> }>("POST", `/provenance/verify/batch${verifyQuery(opts)}`, { json: { items } });
  }
  detectUrls(id: string, items: { url: string; name?: string }[]) {
    return this.call<{ data: Record<string, unknown>[]; summary: Record<string, number> }>("POST", `/provenance/assets/${encodeURIComponent(id)}/detect/batch`, { json: { items } });
  }
  formats() { return this.call<Record<string, unknown>>("GET", "/provenance/formats"); }

  // Leak reports: a stored verification with attribution, as JSON and PDF.
  createReport(bytes: Uint8Array, opts: VerifyOptions & { note?: string } = {}) {
    const q = verifyQuery(opts);
    const headers: Record<string, string> = { "X-VYBZ-Name": opts.name ?? "file" };
    if (opts.note) headers["X-VYBZ-Note"] = opts.note.slice(0, 2000);
    return this.call<Record<string, unknown>>("POST", `/provenance/reports${q}`, { body: bytes, headers });
  }
  listReports(opts: { asset?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.asset) q.set("asset", opts.asset);
    if (opts.limit) q.set("limit", String(opts.limit));
    const s = q.toString();
    return this.call<{ data: Record<string, unknown>[] }>("GET", `/provenance/reports${s ? `?${s}` : ""}`);
  }
  getReport(id: string) { return this.call<Record<string, unknown>>("GET", `/provenance/reports/${encodeURIComponent(id)}`); }
  async getReportPdf(id: string): Promise<Uint8Array> {
    const res = await fetch(`${this.base}/provenance/reports/${encodeURIComponent(id)}.pdf`, { headers: { Authorization: `Bearer ${this.key}`, Accept: "application/pdf" } });
    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* not json */ }
      const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new VybzApiError(res.status, e?.code ?? "http_error", e?.message ?? `${res.status} ${res.statusText}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // Webhooks
  listWebhooks() { return this.call<{ events: string[]; data: Record<string, unknown>[] }>("GET", "/webhooks"); }
  createWebhook(req: { url: string; events?: string[]; description?: string }) { return this.call<Record<string, unknown>>("POST", "/webhooks", { json: req }); }
  updateWebhook(id: string, req: { url?: string; events?: string[]; description?: string; active?: boolean; rotate_secret?: boolean }) { return this.call<Record<string, unknown>>("PATCH", `/webhooks/${encodeURIComponent(id)}`, { json: req }); }
  deleteWebhook(id: string) { return this.call<Record<string, unknown>>("DELETE", `/webhooks/${encodeURIComponent(id)}`); }
  testWebhook(id: string) { return this.call<Record<string, unknown>>("POST", `/webhooks/${encodeURIComponent(id)}/test`); }
  webhookDeliveries(id: string, status?: string, limit = 50) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (status) q.set("status", status);
    return this.call<{ data: Record<string, unknown>[] }>("GET", `/webhooks/${encodeURIComponent(id)}/deliveries?${q}`);
  }
  retryDelivery(id: string, delivery: string) { return this.call<Record<string, unknown>>("POST", `/webhooks/${encodeURIComponent(id)}/deliveries/${encodeURIComponent(delivery)}/retry`); }
  chain() { return this.call<Record<string, unknown>>("GET", "/provenance/chain"); }

  // Vault
  createRepo(req: { name: string; slug?: string; description?: string; daw?: string }) { return this.call<Record<string, unknown>>("POST", "/vault/repos", { json: req }); }
  listRepos() { return this.call<{ data: Record<string, unknown>[] }>("GET", "/vault/repos"); }
  getRepo(repo: string) { return this.call<Record<string, unknown>>("GET", `/vault/repos/${encodeURIComponent(repo)}`); }
  blobsExist(repo: string, hashes: string[]) { return this.call<{ present: string[]; missing: string[] }>("POST", `/vault/repos/${encodeURIComponent(repo)}/blobs/exists`, { json: { hashes } }); }
  uploadBlob(repo: string, bytes: Uint8Array, mime?: string) {
    const headers: Record<string, string> = { "X-VYBZ-Content-SHA256": sha256(bytes) };
    if (mime) headers["X-VYBZ-Mime"] = mime;
    return this.call<{ hash: string; size: number; existed: boolean }>("POST", `/vault/repos/${encodeURIComponent(repo)}/blobs`, { body: bytes, headers });
  }
  createUpload(repo: string, req: { sha256: string; size: number; mime?: string }) {
    return this.call<UploadSession | { object: "vault.blob"; hash: string; size: number; existed: boolean }>("POST", `/vault/repos/${encodeURIComponent(repo)}/uploads`, { json: req });
  }
  uploadPart(repo: string, id: string, n: number, bytes: Uint8Array) {
    return this.call<UploadSession>("PUT", `/vault/repos/${encodeURIComponent(repo)}/uploads/${id}/parts/${n}`, { body: bytes });
  }
  completeUpload(repo: string, id: string) {
    return this.call<{ hash: string; size: number; existed: boolean }>("POST", `/vault/repos/${encodeURIComponent(repo)}/uploads/${id}/complete`);
  }
  abortUpload(repo: string, id: string) { return this.call<{ id: string; aborted: boolean }>("DELETE", `/vault/repos/${encodeURIComponent(repo)}/uploads/${id}`); }
  /**
   * Upload a large file as resumable parts. `read` returns exactly `length`
   * bytes from `offset`. Transient (5xx) part failures are retried; an
   * out-of-order answer re-reads the session and continues from `next_part`.
   */
  async uploadBlobChunked(repo: string, src: { size: number; sha256: string; mime?: string; read: (offset: number, length: number) => Promise<Uint8Array> }, onProgress?: (sent: number, total: number) => void) {
    const opened = await this.createUpload(repo, { sha256: src.sha256, size: src.size, mime: src.mime });
    if (opened.object === "vault.blob") return opened;
    let s: UploadSession = opened;
    while (s.next_part < s.parts) {
      const n = s.next_part;
      const offset = n * s.part_size;
      const length = Math.min(s.part_size, src.size - offset);
      const bytes = await src.read(offset, length);
      try {
        s = await this.uploadPart(repo, s.id, n, bytes);
      } catch (e) {
        if (e instanceof VybzApiError && e.code === "part_out_of_order") {
          s = await this.call<UploadSession>("GET", `/vault/repos/${encodeURIComponent(repo)}/uploads/${s.id}`);
          continue;
        }
        if (e instanceof VybzApiError && e.status >= 500) {
          s = await this.uploadPart(repo, s.id, n, bytes); // one retry for a transient storage error
        } else throw e;
      }
      onProgress?.(s.received_bytes, src.size);
    }
    return this.completeUpload(repo, s.id);
  }
  blobLink(repo: string, hash: string) { return this.call<{ download: { url: string } ; size: number }>("GET", `/vault/repos/${encodeURIComponent(repo)}/blobs/${hash}`); }
  commit(repo: string, req: { branch?: string; message?: string; entries: { path: string; hash: string; size: number }[]; parent?: string | null; meta?: Record<string, unknown> }) {
    return this.call<Record<string, unknown>>("POST", `/vault/repos/${encodeURIComponent(repo)}/commits`, { json: req });
  }
  history(repo: string, ref?: string, limit = 50) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (ref) q.set("ref", ref);
    return this.call<{ data: Record<string, unknown>[] }>("GET", `/vault/repos/${encodeURIComponent(repo)}/commits?${q}`);
  }
  commitDetail(repo: string, sha: string) { return this.call<Record<string, unknown>>("GET", `/vault/repos/${encodeURIComponent(repo)}/commits/${sha}`); }
  tree(repo: string, ref?: string) {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    return this.call<{ commit: Record<string, unknown> | null; entries: { path: string; hash: string; size: number }[] }>("GET", `/vault/repos/${encodeURIComponent(repo)}/tree${q}`);
  }
  diff(repo: string, from: string, to: string) {
    return this.call<Record<string, unknown>>("GET", `/vault/repos/${encodeURIComponent(repo)}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }
  branches(repo: string) { return this.call<Record<string, unknown>>("GET", `/vault/repos/${encodeURIComponent(repo)}/branches`); }
  createBranch(repo: string, name: string, from?: string) { return this.call<Record<string, unknown>>("POST", `/vault/repos/${encodeURIComponent(repo)}/branches`, { json: { name, from } }); }
}
