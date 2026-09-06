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
  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

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
    this.ua = opts.userAgent ?? "vybz-mcp/1.0";
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
      if (ct.includes("application/json")) {
        const j = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        code = j?.error?.code ?? code;
        message = j?.error?.message ?? message;
      }
      throw new VybzApiError(res.status, code, message, rid);
    }
    if (ct.includes("application/json")) return (await res.json()) as T;
    return (await res.arrayBuffer()) as unknown as T;
  }

  // Platform
  me() { return this.call<Record<string, unknown>>("GET", "/me"); }

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
