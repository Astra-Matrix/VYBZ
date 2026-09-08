/**
 * MCP tool surface for VYBZ. One registration function serves both transports:
 *   • local (stdio) — has filesystem access: register files, commit folders, restore trees.
 *   • hosted (HTTP) — no filesystem: works with URLs and base64 payloads.
 *
 * Every tool returns compact JSON text so an agent can reason over it, and
 * never echoes the API key. Every tool carries MCP annotations so a host can
 * tell read-only tools from metered, mutating, or destructive ones before it
 * decides whether to ask the person for approval.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFile, readdir, stat, mkdir, writeFile, open as openFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, dirname, resolve, sep, basename } from "node:path";
import { sha256, VybzApiError, type NamedFile, type VybzClient } from "./client.js";

export interface ToolOptions {
  /** Allow tools that read and write the local filesystem. */
  filesystem: boolean;
  /** Restrict filesystem tools to paths under these roots (local mode). Empty = no restriction. */
  roots?: string[];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/** Error envelope every tool returns with `isError: true`. */
export type ToolError = {
  error: string;
  message: string;
  status?: number;
  request_id?: string;
  /** The API's extra fields (`required_scope`, `missing`, `head`, `plan`, `upgrade`, `supported`, …). */
  details?: Record<string, unknown>;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** A per-item failure from a batch route, surfaced as the tool's error when the batch had one item. */
class ItemError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function fail(e: unknown): ToolResult {
  let body: ToolError;
  if (e instanceof VybzApiError) {
    body = { error: e.code, message: e.message, status: e.status, request_id: e.requestId, ...(e.details ? { details: e.details } : {}) };
  } else if (e instanceof ItemError) {
    body = { error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
  } else {
    body = { error: "tool_error", message: e instanceof Error ? e.message : String(e) };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * A single URL is sent through the batch route (the only route that fetches).
 * Return the one result in the same shape a single file gets, so the tool's
 * output does not depend on how the file was supplied.
 */
function unwrapSingle(r: { data: Record<string, unknown>[] }): Record<string, unknown> {
  const item = r.data?.[0];
  if (!item) throw new ItemError("no_result", "The API returned no result for the URL.");
  if (item.status === "error") {
    const { code, message, ...rest } = (item.error ?? {}) as { code?: string; message?: string } & Record<string, unknown>;
    throw new ItemError(code ?? "item_error", message ?? "The URL could not be processed.", Object.keys(rest).length ? rest : undefined);
  }
  const { status: _status, ...rest } = item;
  return rest;
}

// ── Annotations ───────────────────────────────────────────────────────────────
// readOnlyHint: the tool changes nothing the organization owns.
// destructiveHint: the tool can delete or overwrite something.
// idempotentHint: repeating the same call has no additional effect (or cost).
// openWorldHint: the tool reaches beyond VYBZ (fetches URLs, calls customer endpoints).

/** Reads. Safe to repeat, free, touches nothing outside VYBZ. */
const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Creates or changes a record; repeating it creates another one. */
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** Creates or changes a record but repeating it converges on the same state. */
const WRITE_IDEMPOTENT: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
/** Removes or overwrites. */
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
/** Metered: each call is billed as a detection and appends to the ledger. */
const METERED: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const open = (a: ToolAnnotations): ToolAnnotations => ({ ...a, openWorldHint: true });

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const IGNORED_DIRS = new Set([".git", "node_modules", "Backup", "Ableton Project Info", ".vybz", "__MACOSX"]);
const IGNORED_FILES = /(\.asd|\.DS_Store|Thumbs\.db|\.tmp|\.bak|~)$/i;

async function walk(root: string): Promise<Array<{ path: string; abs: string; size: number }>> {
  const out: Array<{ path: string; abs: string; size: number }> = [];
  async function visit(dir: string) {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        await visit(abs);
      } else if (ent.isFile()) {
        if (IGNORED_FILES.test(ent.name)) continue;
        const s = await stat(abs);
        out.push({ path: relative(root, abs).split(sep).join("/"), abs, size: s.size });
      }
    }
  }
  await visit(root);
  out.sort((a, b) => (a.path < b.path ? -1 : 1));
  return out;
}

/** Windows paths compare case-insensitively; a root of `D:/projects` must admit `D:/Projects/x`. */
const fold = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/** Resolve a path and refuse it unless it lies under one of the allowed roots. Exported for tests. */
export function guard(roots: string[] | undefined, p: string): string {
  const abs = resolve(p);
  if (!roots || roots.length === 0) return abs;
  const inside = roots.some((r) => {
    const base = resolve(r);
    return fold(abs) === fold(base) || fold(abs).startsWith(fold(base + sep));
  });
  if (!inside) throw new Error(`Path is outside the allowed roots: ${abs}`);
  return abs;
}

/** Hosts a shared (hosted) server must never fetch on an agent's behalf. Mirrors the API gateway. */
export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return true;
  if (h.includes(":")) return true; // IPv6 literals are not accepted
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Fetch a URL into memory. `allowPrivate` is true only on a local server, where
 * the agent already has the person's network; the hosted server refuses
 * private and link-local hosts, before and after redirects.
 */
async function fetchBytes(url: string, max = 200 * 1_048_576, allowPrivate = false): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https URLs are fetched.");
  if (!allowPrivate && privateHost(u.hostname)) throw new Error("URLs pointing at private or local hosts are not fetched by the hosted server. Use base64 or run the MCP server locally.");
  const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!allowPrivate && privateHost(new URL(r.url || u.href).hostname)) throw new Error("The URL redirected to a private host.");
  if (!r.ok) throw new Error(`Could not fetch ${url}: ${r.status}`);
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error(`Fetched file exceeds the size limit (${Math.round(max / 1_048_576)} MB).`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > max) throw new Error(`Fetched file exceeds the size limit (${Math.round(max / 1_048_576)} MB).`);
  if (!buf.byteLength) throw new Error("The URL returned an empty file.");
  return buf;
}

function decodeInput(input: { url?: string; base64?: string }, allowPrivate: boolean): Promise<Uint8Array> {
  if (input.base64) {
    const bytes = new Uint8Array(Buffer.from(input.base64, "base64"));
    if (!bytes.byteLength) return Promise.reject(new Error("`base64` decoded to zero bytes."));
    return Promise.resolve(bytes);
  }
  if (input.url) return fetchBytes(input.url, undefined, allowPrivate);
  throw new Error("Provide `url` or `base64`.");
}

/** Files at or above this size are hashed as a stream and sent as resumable parts. */
const LARGE_FILE_BYTES = 200 * 1_048_576;

async function hashFile(abs: string, size: number): Promise<string> {
  if (size < LARGE_FILE_BYTES) return sha256(new Uint8Array(await readFile(abs)));
  const h = createHash("sha256");
  for await (const chunk of createReadStream(abs)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function uploadFile(client: VybzClient, repo: string, abs: string, size: number, hash: string, mime?: string) {
  if (size < LARGE_FILE_BYTES) return client.uploadBlob(repo, new Uint8Array(await readFile(abs)), mime);
  const fh = await openFile(abs, "r");
  try {
    return await client.uploadBlobChunked(repo, {
      size,
      sha256: hash,
      mime,
      read: async (offset, length) => {
        const buf = new Uint8Array(length);
        let got = 0;
        while (got < length) {
          const r = await fh.read(buf, got, length - got, offset + got);
          if (r.bytesRead === 0) throw new Error(`${abs} changed while uploading.`);
          got += r.bytesRead;
        }
        return buf;
      },
    });
  } finally {
    await fh.close();
  }
}

export function registerTools(server: McpServer, client: VybzClient, opts: ToolOptions): void {
  const fs = opts.filesystem;

  // ── Platform ──────────────────────────────────────────────────────────────
  server.registerTool(
    "vybz_whoami",
    { title: "Who am I", description: "Show the organization, plan, key name, and scopes behind the configured API key. Call this first when a later tool answers `insufficient_scope`.", annotations: READ },
    async () => run(() => client.me()),
  );
  server.registerTool(
    "vybz_billing_usage",
    {
      title: "Billing usage",
      description: "Metered usage for the organization: the running month against the plan's included issuances, detections, and storage, then one report per closed month with overage and the amount invoiced. Use it before a large batch to see how much of the plan remains.",
      inputSchema: { months: z.number().int().min(1).max(36).optional().describe("Closed months to return, newest first. Default 12.") },
      annotations: READ,
    },
    async (a) => run(() => client.billingUsage(a.months)),
  );

  // ── Provenance ────────────────────────────────────────────────────────────
  server.registerTool(
    "provenance_register",
    {
      title: "Register an original",
      description:
        "Register a lossless original (WAV, AIFF, or FLAC) as a provenance asset. It is hashed, PCM-hashed, and fingerprinted. Returns the asset id and SHA-256. Idempotent for identical bytes. " +
        (fs ? "Provide `file` (local path), `url`, or `base64`." : "Provide `url` or `base64`."),
      inputSchema: {
        file: z.string().optional().describe(fs ? "Local path to a .wav, .aiff, or .flac" : "Unavailable in hosted mode"),
        url: z.string().url().optional().describe("HTTPS URL of a lossless file"),
        base64: z.string().optional().describe("Base64 file bytes (small files only)"),
        title: z.string().max(200).optional(),
        external_ref: z.string().max(200).optional().describe("Your own id for this recording"),
      },
      annotations: open(WRITE_IDEMPOTENT),
    },
    async (a) =>
      run(async () => {
        if (!fs && a.file) throw new Error("The hosted server has no filesystem. Pass `url` or `base64`, or run `npx @vybz/mcp-server` locally.");
        const bytes = fs && a.file ? new Uint8Array(await readFile(guard(opts.roots, a.file))) : await decodeInput(a, fs);
        return client.registerAsset(bytes, { title: a.title, externalRef: a.external_ref });
      }),
  );

  server.registerTool(
    "provenance_list_assets",
    { title: "List assets", description: "List registered provenance assets, newest first.", inputSchema: { limit: z.number().int().min(1).max(200).optional() }, annotations: READ },
    async (a) => run(() => client.listAssets(a.limit ?? 50)),
  );

  server.registerTool(
    "provenance_get_asset",
    { title: "Get asset", description: "Fetch one asset with its issuance count.", inputSchema: { asset_id: z.string().uuid() }, annotations: READ },
    async (a) => run(() => client.getAsset(a.asset_id)),
  );

  server.registerTool(
    "provenance_issue",
    {
      title: "Issue a watermarked copy",
      description:
        "Create a uniquely watermarked copy of an asset for a recipient. Every call creates a new issuance with a new watermark, even for the same recipient, and counts against the plan's issuances. Returns the issuance record and a one-hour download link" +
        (fs ? ", or writes the WAV to `output_file` when given." : "."),
      inputSchema: {
        asset_id: z.string().uuid(),
        recipient: z.string().min(1).max(200).describe("Stable identifier for the receiving party (email, account id, partner)"),
        license: z.string().max(200).optional(),
        c2pa: z.boolean().optional().describe("Attach Content Credentials when the deployment supports it (default true)"),
        output_file: z.string().optional().describe(fs ? "Local path to write the delivered WAV" : "Unavailable in hosted mode"),
      },
      annotations: WRITE,
    },
    async (a) =>
      run(async () => {
        if (!fs && a.output_file) throw new Error("The hosted server cannot write files. Omit `output_file` to receive a download link.");
        if (fs && a.output_file) {
          const out = guard(opts.roots, a.output_file);
          const buf = await client.issueBytes(a.asset_id, { recipient: a.recipient, license: a.license, c2pa: a.c2pa });
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, new Uint8Array(buf));
          return { written: out, bytes: buf.byteLength, sha256: sha256(new Uint8Array(buf)) };
        }
        return client.issueLink(a.asset_id, { recipient: a.recipient, license: a.license, c2pa: a.c2pa });
      }),
  );

  server.registerTool(
    "provenance_issue_batch",
    {
      title: "Issue copies to many recipients",
      description:
        "One call, up to 50 recipients. The original is decoded once and every recipient gets a distinct watermark, a stored copy, and a one-hour download link. Returns each item in order with `status: ok` or an error, a summary, and a `manifest` link to a stored JSON copy of the list. Every successful item counts as one issuance; when the plan runs out mid-batch the rest are reported as `plan_limit_reached`.",
      inputSchema: {
        asset_id: z.string().uuid(),
        recipients: z.array(z.union([z.string().min(1).max(200), z.object({ recipient: z.string().min(1).max(200), license: z.string().max(200).optional() })])).min(1).max(50)
          .describe("Recipient identifiers, or objects with a per-recipient license"),
        license: z.string().max(200).optional().describe("Default license for recipients without their own"),
        c2pa: z.boolean().optional().describe("Attach Content Credentials when the deployment supports it (default true)"),
      },
      annotations: METERED,
    },
    async (a) => run(() => client.issueBatch(a.asset_id, { recipients: a.recipients, license: a.license, c2pa: a.c2pa })),
  );

  server.registerTool(
    "provenance_list_issuances",
    { title: "List issuances", description: "Every copy issued for an asset, with recipients and watermark ids.", inputSchema: { asset_id: z.string().uuid() }, annotations: READ },
    async (a) => run(() => client.listIssuances(a.asset_id)),
  );

  server.registerTool(
    "provenance_ledger",
    { title: "Asset ledger", description: "Hash-chained event history for an asset (register, issue, c2pa, verify, detect).", inputSchema: { asset_id: z.string().uuid() }, annotations: READ },
    async (a) => run(() => client.ledger(a.asset_id)),
  );

  const FORMATS = "Any format: WAV, AIFF, FLAC, MP3, Ogg Vorbis, Opus, and (when the deployment has a decode worker) AAC/M4A, ALAC, MP4, MOV, WebM.";
  const inputSchema = {
    file: z.string().optional().describe(fs ? "Local file path" : "Not available on the hosted server"),
    files: z.array(z.string()).max(25).optional().describe(fs ? "Local file paths for a batch (up to 25)" : "Not available on the hosted server"),
    url: z.string().url().optional().describe("Public URL to fetch. Returns one result, the same shape as a single file."),
    urls: z.array(z.string().url()).max(25).optional().describe("Public URLs to fetch as a batch (up to 25). Returns { data[], summary } even for one URL."),
    base64: z.string().optional().describe("Raw file bytes, base64"),
  };

  /** Resolve every way a tool can receive files into named byte arrays, or a URL list. */
  async function gather(a: { file?: string; files?: string[]; url?: string; urls?: string[]; base64?: string }): Promise<{ files: NamedFile[]; urls: { url: string; name: string }[] }> {
    const files: NamedFile[] = [];
    const urls: { url: string; name: string }[] = [];
    if (fs && a.file) files.push({ name: basename(a.file), bytes: new Uint8Array(await readFile(guard(opts.roots, a.file))) });
    if (fs && a.files?.length) for (const f of a.files) files.push({ name: basename(f), bytes: new Uint8Array(await readFile(guard(opts.roots, f))) });
    if (!fs && (a.file || a.files?.length)) throw new Error("The hosted server has no filesystem. Pass `url`, `urls`, or `base64`.");
    if (a.base64) files.push({ name: "base64", bytes: Buffer.from(a.base64, "base64") });
    if (a.url) urls.push({ url: a.url, name: a.url });
    if (a.urls?.length) for (const u of a.urls) urls.push({ url: u, name: u });
    if (!files.length && !urls.length) throw new Error("Provide `file`, `files`, `url`, `urls`, or `base64`.");
    if (files.length && urls.length) throw new Error("Pass either local files or URLs in one call, not both.");
    return { files, urls };
  }

  server.registerTool(
    "provenance_verify",
    {
      title: "Verify files",
      description:
        "Establish what a file is, with evidence from every method: exact hash, canonical PCM hash (same audio in any lossless container), perceptual fingerprint (which original it derives from and at what offset, no asset id needed), Content Credentials, and optionally watermark attribution. " +
        FORMATS + " Verification is free; `attribute: true` runs watermark attribution on the identified asset and is metered as one detection per file. Batches of up to 25 return one result per file.",
      inputSchema: {
        ...inputSchema,
        attribute: z.boolean().optional().describe("Run watermark attribution when an original is identified (metered as one detection per file; requires the provenance:detect scope)."),
        asset_id: z.string().uuid().optional().describe("Test the watermark against this asset when the file cannot be identified by fingerprint."),
      },
      // Free and non-mutating without `attribute`; with it, each file is metered like provenance_detect.
      annotations: open(READ),
    },
    async (a) =>
      run(async () => {
        const { files, urls } = await gather(a);
        const vo = { attribute: a.attribute, asset: a.asset_id };
        if (urls.length === 1 && !a.urls?.length) return unwrapSingle(await client.verifyUrls(urls, vo));
        if (urls.length) return client.verifyUrls(urls, vo);
        if (files.length === 1) return client.verify(files[0].bytes, { ...vo, name: files[0].name });
        return client.verifyBatch(files, vo);
      }),
  );

  server.registerTool(
    "provenance_detect",
    {
      title: "Attribute a leak",
      description:
        "Blind watermark correlation of suspect audio against every copy issued for an asset. Returns ranked candidates and the attributed recipient when decisive. " +
        FORMATS + " The suspect is decoded and resampled automatically. Metered as one detection per file; batches of up to 25 return one result per file. If you do not know the asset, call provenance_verify first: its fingerprint step identifies it.",
      inputSchema: { asset_id: z.string().uuid(), ...inputSchema },
      annotations: open(METERED),
    },
    async (a) =>
      run(async () => {
        const { files, urls } = await gather(a);
        if (urls.length === 1 && !a.urls?.length) return unwrapSingle(await client.detectUrls(a.asset_id, urls));
        if (urls.length) return client.detectUrls(a.asset_id, urls);
        if (files.length === 1) return client.detect(a.asset_id, files[0].bytes, files[0].name);
        return client.detectBatch(a.asset_id, files);
      }),
  );

  server.registerTool(
    "provenance_formats",
    { title: "Supported formats", description: "Which input formats this deployment decodes, which need the decode worker, and the size and batch limits.", annotations: READ },
    async () => run(() => client.formats()),
  );

  // ── Webhooks ──────────────────────────────────────────────────────────────
  const EVENTS = ["asset.registered", "issuance.created", "detection.completed", "detection.attributed", "commit.created", "ping", "*"] as const;
  server.registerTool(
    "webhooks_list",
    { title: "List webhooks", description: "Endpoints the organization has registered for events, and the event names available.", annotations: READ },
    async () => run(() => client.listWebhooks()),
  );
  server.registerTool(
    "webhooks_create",
    {
      title: "Create a webhook",
      description: "Register an https endpoint for events. Returns the signing secret once; the agent should hand it to whoever runs the receiver. Deliveries carry X-VYBZ-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + '.' + body)>. Up to 20 endpoints per organization.",
      inputSchema: { url: z.string().url(), events: z.array(z.enum(EVENTS)).optional().describe("Defaults to all events"), description: z.string().max(200).optional() },
      annotations: open(WRITE),
    },
    async (a) => run(() => client.createWebhook({ url: a.url, events: a.events, description: a.description })),
  );
  server.registerTool(
    "webhooks_update",
    {
      title: "Update a webhook",
      description: "Change url, events, description, or active; `rotate_secret` issues a new secret and invalidates the old one.",
      inputSchema: { id: z.string().uuid(), url: z.string().url().optional(), events: z.array(z.enum(EVENTS)).optional(), description: z.string().max(200).optional(), active: z.boolean().optional(), rotate_secret: z.boolean().optional() },
      annotations: open(WRITE_IDEMPOTENT),
    },
    async (a) => run(() => client.updateWebhook(a.id, { url: a.url, events: a.events, description: a.description, active: a.active, rotate_secret: a.rotate_secret })),
  );
  server.registerTool(
    "webhooks_delete",
    { title: "Delete a webhook", description: "Remove an endpoint and its delivery log. Deliveries stop immediately; this cannot be undone.", inputSchema: { id: z.string().uuid() }, annotations: DESTRUCTIVE },
    async (a) => run(() => client.deleteWebhook(a.id)),
  );
  server.registerTool(
    "webhooks_test",
    { title: "Send a test event", description: "Queues a `ping` delivery to the endpoint and dispatches it. Read the result with webhook_deliveries.", inputSchema: { id: z.string().uuid() }, annotations: open(WRITE) },
    async (a) => run(() => client.testWebhook(a.id)),
  );
  server.registerTool(
    "webhook_deliveries",
    {
      title: "Webhook deliveries",
      description: "Recent deliveries for an endpoint with status, attempts, and the last error. Retry one with `retry_delivery_id` (that re-sends to the customer's endpoint).",
      inputSchema: { id: z.string().uuid(), status: z.enum(["pending", "sending", "delivered", "failed"]).optional(), limit: z.number().int().min(1).max(200).optional(), retry_delivery_id: z.string().uuid().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (a) => run(() => (a.retry_delivery_id ? client.retryDelivery(a.id, a.retry_delivery_id) : client.webhookDeliveries(a.id, a.status, a.limit ?? 50))),
  );

  // ── Leak reports ──────────────────────────────────────────────────────────
  server.registerTool(
    "provenance_leak_report",
    {
      title: "Create a leak report",
      description:
        "The document to forward when a copy leaks. Verifies one suspect file with attribution on, stores the finding, and returns the report: verdict, confidence, the recipient of the matching copy, every method that ran, and an integrity hash. `links.pdf` is the printable version. " +
        FORMATS + " Metered as one detection when attribution runs. One file per call: `file`, `url`, or `base64`. If you know a recipient was named, quote the recipient, the confidence, and the report id back to the user.",
      inputSchema: {
        file: inputSchema.file,
        url: inputSchema.url,
        base64: inputSchema.base64,
        note: z.string().max(2000).optional().describe("Where the file was found and when; printed on the report."),
        asset_id: z.string().uuid().optional().describe("Test the watermark against this asset when the file cannot be identified by fingerprint."),
        pdf_output_file: z.string().optional().describe(fs ? "Also save the PDF to this local path." : "Not available on the hosted server"),
      },
      annotations: open(METERED),
    },
    async (a) =>
      run(async () => {
        const { files, urls } = await gather({ file: a.file, url: a.url, base64: a.base64 });
        let bytes: Uint8Array; let name: string;
        if (files.length) { bytes = files[0].bytes; name = files[0].name; }
        else if (urls.length) {
          const res = await fetch(urls[0].url);
          if (!res.ok) throw new ItemError("fetch_failed", `The URL returned ${res.status}.`);
          bytes = new Uint8Array(await res.arrayBuffer());
          name = basename(new URL(urls[0].url).pathname) || "url";
        } else throw new ItemError("no_input", "Pass `file`, `url`, or `base64`.");
        const report = await client.createReport(bytes, { name, note: a.note, asset: a.asset_id, attribute: true });
        if (fs && a.pdf_output_file) {
          const pdf = await client.getReportPdf(String(report.id));
          const out = guard(opts.roots, a.pdf_output_file);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, pdf);
          return { ...report, pdf_file: out };
        }
        return report;
      }),
  );

  server.registerTool(
    "provenance_list_reports",
    {
      title: "List leak reports",
      description: "Stored leak reports, newest first. Optional `asset_id` filters to one original.",
      inputSchema: { asset_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).optional() },
      annotations: READ,
    },
    async (a) => run(() => client.listReports({ asset: a.asset_id, limit: a.limit })),
  );

  server.registerTool(
    "provenance_get_report",
    {
      title: "Get a leak report",
      description: "One stored report as JSON, with `links.pdf` for the printable version. Optionally save the PDF locally with `pdf_output_file`.",
      inputSchema: { report_id: z.string().uuid(), pdf_output_file: z.string().optional().describe(fs ? "Save the PDF to this local path." : "Not available on the hosted server") },
      annotations: READ,
    },
    async (a) =>
      run(async () => {
        const report = await client.getReport(a.report_id);
        if (fs && a.pdf_output_file) {
          const pdf = await client.getReportPdf(a.report_id);
          const out = guard(opts.roots, a.pdf_output_file);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, pdf);
          return { ...report, pdf_file: out };
        }
        return report;
      }),
  );

  server.registerTool(
    "provenance_chain_verify",
    { title: "Verify ledger chain", description: "Recompute the organization's entire hash chain and report the first broken link, if any.", annotations: READ },
    async () => run(() => client.chain()),
  );

  // ── Vault ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "vault_create_repo",
    {
      title: "Create repository",
      description: "Create a content-addressed repository for a DAW project or sample library.",
      inputSchema: { name: z.string().min(1).max(120), slug: z.string().optional(), description: z.string().optional(), daw: z.string().optional().describe("ableton, fl-studio, logic, pro-tools, cubase, reaper, bitwig, other") },
      annotations: WRITE,
    },
    async (a) => run(() => client.createRepo({ name: a.name, slug: a.slug, description: a.description, daw: a.daw })),
  );

  server.registerTool("vault_list_repos", { title: "List repositories", description: "All repositories in the organization.", annotations: READ }, async () => run(() => client.listRepos()));

  server.registerTool(
    "vault_get_repo",
    { title: "Get repository", description: "Repository with branches and commit count.", inputSchema: { repo: z.string().describe("Repo id or slug") }, annotations: READ },
    async (a) => run(() => client.getRepo(a.repo)),
  );

  server.registerTool(
    "vault_history",
    { title: "Commit history", description: "Commits reachable from a ref, newest first.", inputSchema: { repo: z.string(), ref: z.string().optional().describe("Branch or sha"), limit: z.number().int().min(1).max(500).optional() }, annotations: READ },
    async (a) => run(() => client.history(a.repo, a.ref, a.limit ?? 50)),
  );

  server.registerTool(
    "vault_get_commit",
    { title: "Get commit", description: "One commit with its complete tree (path, hash, size for every file).", inputSchema: { repo: z.string(), sha: z.string().regex(/^[a-f0-9]{64}$/i).describe("Commit sha") }, annotations: READ },
    async (a) => run(() => client.commitDetail(a.repo, a.sha.toLowerCase())),
  );

  server.registerTool(
    "vault_tree",
    { title: "Tree at ref", description: "Full file list (path, hash, size) at a branch or commit.", inputSchema: { repo: z.string(), ref: z.string().optional() }, annotations: READ },
    async (a) => run(() => client.tree(a.repo, a.ref)),
  );

  server.registerTool(
    "vault_diff",
    { title: "Diff refs", description: "Added, removed, and modified paths between two refs.", inputSchema: { repo: z.string(), from: z.string(), to: z.string() }, annotations: READ },
    async (a) => run(() => client.diff(a.repo, a.from, a.to)),
  );

  server.registerTool(
    "vault_branches",
    { title: "Branches", description: "List branches and their heads.", inputSchema: { repo: z.string() }, annotations: READ },
    async (a) => run(() => client.branches(a.repo)),
  );

  server.registerTool(
    "vault_create_branch",
    { title: "Create branch", description: "Create a branch from another branch or a commit.", inputSchema: { repo: z.string(), name: z.string(), from: z.string().optional() }, annotations: WRITE },
    async (a) => run(() => client.createBranch(a.repo, a.name, a.from)),
  );

  server.registerTool(
    "vault_commit_entries",
    {
      title: "Commit a tree (entries)",
      description: "Commit an explicit tree. Every hash must already be uploaded (use vault_blob_exists / vault_upload_blob). Pass `parent` to require a specific head; a `head_moved` error carries the current `head` in details. An identical tree returns the head with `unchanged: true`.",
      inputSchema: {
        repo: z.string(),
        branch: z.string().optional(),
        message: z.string().optional(),
        entries: z.array(z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0) })),
        parent: z.string().nullable().optional(),
        meta: z.record(z.unknown()).optional(),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    async (a) => run(() => client.commit(a.repo, { branch: a.branch, message: a.message, entries: a.entries, parent: a.parent, meta: a.meta })),
  );

  server.registerTool(
    "vault_blob_exists",
    { title: "Check blobs", description: "Which of these SHA-256 hashes are already stored for the organization.", inputSchema: { repo: z.string(), hashes: z.array(z.string()).max(5000) }, annotations: READ },
    async (a) => run(() => client.blobsExist(a.repo, a.hashes)),
  );

  server.registerTool(
    "vault_upload_blob",
    {
      title: "Upload blob",
      description: "Upload one file's bytes as a content-addressed blob. Identical bytes are deduplicated across the organization. " + (fs ? "Provide `file`, `url`, or `base64`. Files above 200 MB are sent as resumable parts." : "Provide `url` or `base64`."),
      inputSchema: { repo: z.string(), file: z.string().optional(), url: z.string().url().optional(), base64: z.string().optional(), mime: z.string().optional() },
      annotations: open(WRITE_IDEMPOTENT),
    },
    async (a) =>
      run(async () => {
        if (!fs && a.file) throw new Error("The hosted server has no filesystem. Pass `url` or `base64`, or run `npx @vybz/mcp-server` locally.");
        if (fs && a.file) {
          const abs = guard(opts.roots, a.file);
          const size = (await stat(abs)).size;
          return uploadFile(client, a.repo, abs, size, await hashFile(abs, size), a.mime);
        }
        return client.uploadBlob(a.repo, await decodeInput(a, fs), a.mime);
      }),
  );

  server.registerTool(
    "vault_blob_link",
    { title: "Blob download link", description: "Mint a 15-minute download link for a blob by hash.", inputSchema: { repo: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }, annotations: READ },
    async (a) => run(() => client.blobLink(a.repo, a.hash)),
  );

  if (!fs) return;

  // ── Local-only: whole-folder workflows ────────────────────────────────────
  server.registerTool(
    "vault_commit_folder",
    {
      title: "Commit a folder",
      description:
        "Snapshot a local DAW project folder into a repository: hashes every file, uploads only what the organization does not already have, and commits the tree. Skips caches and backups. Returns the commit and upload stats.",
      inputSchema: {
        repo: z.string().describe("Repo id or slug"),
        folder: z.string().describe("Local project folder"),
        branch: z.string().optional(),
        message: z.string().optional(),
        meta: z.record(z.unknown()).optional().describe("daw, version, tempo, key, plugins…"),
        dry_run: z.boolean().optional().describe("Only report what would be uploaded"),
      },
      annotations: WRITE_IDEMPOTENT,
    },
    async (a) =>
      run(async () => {
        const root = guard(opts.roots, a.folder);
        const files = await walk(root);
        const entries: Array<{ path: string; hash: string; size: number; abs: string }> = [];
        for (const f of files) entries.push({ path: f.path, hash: await hashFile(f.abs, f.size), size: f.size, abs: f.abs });
        const hashes = [...new Set(entries.map((e) => e.hash))];
        const missing = new Set<string>();
        for (let i = 0; i < hashes.length; i += 2000) {
          const r = await client.blobsExist(a.repo, hashes.slice(i, i + 2000));
          for (const h of r.missing) missing.add(h);
        }
        const toUpload = entries.filter((e, i, arr) => missing.has(e.hash) && arr.findIndex((x) => x.hash === e.hash) === i);
        const uploadBytes = toUpload.reduce((s, e) => s + e.size, 0);
        if (a.dry_run) {
          return { dry_run: true, files: entries.length, total_bytes: entries.reduce((s, e) => s + e.size, 0), to_upload: toUpload.length, upload_bytes: uploadBytes, sample: toUpload.slice(0, 20).map((e) => e.path) };
        }
        let uploaded = 0;
        for (const e of toUpload) {
          await uploadFile(client, a.repo, e.abs, e.size, e.hash);
          uploaded++;
        }
        const commit = await client.commit(a.repo, {
          branch: a.branch,
          message: a.message ?? `Snapshot ${new Date().toISOString()}`,
          entries: entries.map(({ path, hash, size }) => ({ path, hash, size })),
          meta: a.meta,
        });
        return { commit, files: entries.length, uploaded, upload_bytes: uploadBytes, deduplicated: entries.length - toUpload.length };
      }),
  );

  server.registerTool(
    "vault_restore",
    {
      title: "Restore a tree to a folder",
      description: "Download every file of a ref into a local folder, recreating the project layout. Existing files with the same hash are left untouched; files whose content differs are overwritten.",
      inputSchema: { repo: z.string(), ref: z.string().optional(), folder: z.string().describe("Destination folder") },
      annotations: DESTRUCTIVE,
    },
    async (a) =>
      run(async () => {
        const dest = guard(opts.roots, a.folder);
        const t = await client.tree(a.repo, a.ref);
        let written = 0, skipped = 0;
        for (const e of t.entries) {
          const out = join(dest, ...e.path.split("/"));
          try {
            const cur = new Uint8Array(await readFile(out));
            if (sha256(cur) === e.hash) { skipped++; continue; }
          } catch { /* missing */ }
          const link = await client.blobLink(a.repo, e.hash);
          const bytes = await fetchBytes(link.download.url, 2 * 1024 * 1_048_576, true);
          await mkdir(dirname(out), { recursive: true });
          await writeFile(out, bytes);
          written++;
        }
        return { folder: dest, commit: t.commit, written, skipped, files: t.entries.length };
      }),
  );

  server.registerTool(
    "vault_status",
    {
      title: "Local folder status",
      description: "Compare a local folder with a ref without uploading anything: which files are new, changed, or deleted relative to the repository.",
      inputSchema: { repo: z.string(), folder: z.string(), ref: z.string().optional() },
      annotations: READ,
    },
    async (a) =>
      run(async () => {
        const root = guard(opts.roots, a.folder);
        const files = await walk(root);
        const local = new Map<string, { hash: string; size: number }>();
        for (const f of files) local.set(f.path, { hash: sha256(new Uint8Array(await readFile(f.abs))), size: f.size });
        const t = await client.tree(a.repo, a.ref);
        const remote = new Map(t.entries.map((e) => [e.path, e]));
        const added: string[] = [], modified: string[] = [], deleted: string[] = [];
        for (const [p, l] of local) {
          const r = remote.get(p);
          if (!r) added.push(p);
          else if (r.hash !== l.hash) modified.push(p);
        }
        for (const p of remote.keys()) if (!local.has(p)) deleted.push(p);
        return { ref: a.ref ?? "default", head: t.commit, clean: !added.length && !modified.length && !deleted.length, added, modified, deleted };
      }),
  );
}
