// VYBZ public API — one gateway for Provenance and Vault.
//
//   Base URL (production):  https://vybz.cloud/v1     (Vercel rewrite → this function)
//   Direct:                 https://<ref>.supabase.co/functions/v1/api-v1/v1
//   Auth:                   Authorization: Bearer vybz_live_<48 hex>
//   Deploy:                 supabase functions deploy api-v1 --no-verify-jwt
//   Secrets:                WM_SECRET (required), C2PA_WORKER_URL + C2PA_WORKER_TOKEN (optional),
//                           DECODE_WORKER_URL + DECODE_WORKER_TOKEN (optional, AAC/MP4/ALAC input)
//
// Every response carries X-Request-Id. Every call is written to the
// organization's audit log. Errors are JSON `{ error: { code, message } }`.
// deno-lint-ignore-file no-explicit-any
import { admin } from "../_shared/edge.ts";
import {
  API_VERSION,
  ApiError,
  authenticate,
  baseHeaders,
  canonical,
  errorBody,
  isUuid,
  json,
  readBinary,
  readJson,
  recordCall,
  requireScope,
  sha256Hex,
  slugify,
  type Principal,
} from "../_shared/apiGateway.ts";
import { openapiDocument } from "../_shared/openapi.ts";
import { deriveKey, detectFolded, embedChannel, encodeWav, foldChannel, parseWav } from "../_shared/watermark.mjs";
import { DecodeError, NATIVE_FORMATS, WORKER_FORMATS, decodeAudio, pcmHash, resample, sniff, supportedFormats } from "../_shared/decode.mjs";
import { FP_FPS, FP_HOP, FP_MATCH_BER, FP_MIN_OVERLAP_FRAMES, FP_RATE, FP_WINDOW, bestAlignment, fingerprint, fromBytes, toBytes, toInt4 } from "../_shared/fingerprint.mjs";

const WM_SECRET = Deno.env.get("WM_SECRET") ?? "";
const C2PA_WORKER_URL = Deno.env.get("C2PA_WORKER_URL") ?? "";
const C2PA_WORKER_TOKEN = Deno.env.get("C2PA_WORKER_TOKEN") ?? "";
const DECODE_WORKER_URL = Deno.env.get("DECODE_WORKER_URL") ?? "";
const DECODE_WORKER_TOKEN = Deno.env.get("DECODE_WORKER_TOKEN") ?? "";
const PUBLIC_BASE = Deno.env.get("API_PUBLIC_BASE") ?? "https://vybz.cloud/v1";

const MAX_AUDIO_BYTES = 200 * 1_048_576;
const MAX_BLOB_BYTES = 500 * 1_048_576;
const MAX_BATCH_BYTES = 200 * 1_048_576;
const MAX_BATCH_ITEMS = 25;
/** Decoded frames per channel kept for analysis (about 6 min at 44.1 kHz). Bounds memory on the edge. */
const MAX_ANALYSIS_FRAMES = 16_000_000;
/** Seconds of each original that enter the fingerprint index. */
const FP_MAX_SECONDS = 600;
/** Seconds of a suspect used for fingerprint lookup. */
const FP_QUERY_SECONDS = 120;
const FP_MIN_VOTES = 3;
const ORIGINALS = "provenance-originals";
const BLOBS = "vault-blobs";

type Ctx = {
  req: Request;
  requestId: string;
  principal: Principal;
  url: URL;
  parts: string[]; // path segments after /v1
  headers: Record<string, string>;
  bytesIn: number;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function b64utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

function wantsJson(req: Request): boolean {
  const a = req.headers.get("accept") ?? "";
  return a.includes("application/json") && !a.includes("audio/");
}

async function orgName(orgId: string): Promise<string> {
  const { data } = await admin.from("orgs").select("name").eq("id", orgId).single();
  return data?.name ?? "VYBZ customer";
}

async function getAsset(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw new ApiError(404, "not_found", "No such asset.");
  const { data } = await admin
    .from("provenance_assets")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.principal.orgId)
    .maybeSingle();
  if (!data) throw new ApiError(404, "not_found", "No such asset.");
  return data;
}

async function getRepo(ctx: Ctx, idOrSlug: string) {
  const q = admin.from("vault_repos").select("*").eq("org_id", ctx.principal.orgId);
  const { data } = isUuid(idOrSlug) ? await q.eq("id", idOrSlug).maybeSingle() : await q.eq("slug", idOrSlug).maybeSingle();
  if (!data) throw new ApiError(404, "not_found", "No such repository.");
  return data;
}

function assetView(a: any) {
  return {
    id: a.id,
    object: "provenance.asset",
    title: a.title,
    external_ref: a.external_ref,
    sha256: a.sha256,
    bytes: Number(a.bytes),
    mime: a.mime,
    sample_rate: a.sample_rate,
    channels: a.channels,
    duration_sec: a.duration_sec === null ? null : Number(a.duration_sec),
    pcm_sha256: a.pcm_sha256 ?? null,
    source_format: a.source_format ?? null,
    fingerprint_frames: a.fingerprint_frames ?? null,
    created_at: a.created_at,
    links: {
      self: `${PUBLIC_BASE}/provenance/assets/${a.id}`,
      issue: `${PUBLIC_BASE}/provenance/assets/${a.id}/issue`,
      detect: `${PUBLIC_BASE}/provenance/assets/${a.id}/detect`,
      ledger: `${PUBLIC_BASE}/provenance/assets/${a.id}/ledger`,
    },
  };
}

function issuanceView(i: any) {
  return {
    id: i.id,
    object: "provenance.issuance",
    asset_id: i.asset_id,
    recipient: i.recipient,
    license: i.license,
    watermark_id: i.watermark_id,
    delivered_sha256: i.delivered_sha256,
    pcm_sha256: i.pcm_sha256 ?? null,
    c2pa_signed: i.c2pa_signed,
    created_at: i.created_at,
  };
}

function repoView(r: any) {
  return {
    id: r.id,
    object: "vault.repo",
    name: r.name,
    slug: r.slug,
    description: r.description,
    daw: r.daw,
    default_branch: r.default_branch,
    created_at: r.created_at,
    updated_at: r.updated_at,
    links: {
      self: `${PUBLIC_BASE}/vault/repos/${r.id}`,
      commits: `${PUBLIC_BASE}/vault/repos/${r.id}/commits`,
      branches: `${PUBLIC_BASE}/vault/repos/${r.id}/branches`,
      tree: `${PUBLIC_BASE}/vault/repos/${r.id}/tree`,
    },
  };
}

function commitView(c: any, full = false) {
  const base = {
    id: c.id,
    object: "vault.commit",
    sha: c.sha,
    parent_sha: c.parent_sha,
    tree_sha: c.tree_sha,
    message: c.message,
    file_count: c.file_count,
    total_bytes: Number(c.total_bytes),
    meta: c.meta,
    created_at: c.created_at,
  };
  return full ? { ...base, entries: c.entries } : base;
}

async function chain(ctx: Ctx, assetId: string | null, event: string, payload: Record<string, unknown>) {
  const { data } = await admin.rpc("provenance_chain_append", {
    p_org: ctx.principal.orgId,
    p_asset: assetId,
    p_event: event,
    p_payload: payload,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

// ── Platform ────────────────────────────────────────────────────────────────

/** Plan enforcement. Developer is hard-capped; paid plans are metered beyond their included quantities. */
async function planCheck(ctx: Ctx, kind: "issue" | "detect" | "storage"): Promise<void> {
  const { data, error } = await admin.rpc("api_plan_check", { p_org: ctx.principal.orgId, p_kind: kind });
  if (error) return; // never block on a billing lookup failure
  const row = Array.isArray(data) ? data[0] : data;
  if (row && row.allowed === false) {
    const what = kind === "storage" ? "bytes of storage" : kind === "issue" ? "issuances per month" : "detections per month";
    throw new ApiError(402, "plan_limit_reached", `The ${row.plan} plan includes ${row.included} ${what}; ${row.used} used. Upgrade in the console.`, {
      plan: row.plan, used: Number(row.used), included: Number(row.included), upgrade: "https://vybz.cloud/console/billing",
    });
  }
}

function descriptor() {
  return {
    object: "vybz.api",
    version: API_VERSION,
    products: {
      provenance: {
        summary: "Forensic watermarking, Content Credentials, verification, and leak attribution for audio.",
        base: `${PUBLIC_BASE}/provenance`,
      },
      vault: {
        summary: "Content-addressed version control for DAW projects and sample libraries.",
        base: `${PUBLIC_BASE}/vault`,
      },
    },
    formats: `${PUBLIC_BASE}/provenance/formats`,
    agents: {
      mcp_remote: "https://vybz.cloud/api/mcp",
      mcp_local: "npx @vybz/mcp-server",
      llms_txt: "https://vybz.cloud/llms.txt",
      openapi: `${PUBLIC_BASE}/openapi.json`,
    },
    docs: "https://vybz.cloud/docs",
  };
}

async function me(ctx: Ctx) {
  requireScope(ctx.principal, "org:read");
  const { data: org } = await admin.from("orgs").select("id,name,slug,plan,created_at").eq("id", ctx.principal.orgId).single();
  const key = ctx.principal.keyId
    ? (await admin.from("api_keys").select("id,name,prefix,scopes,rate_limit_per_min,created_at,expires_at").eq("id", ctx.principal.keyId).single()).data
    : null;
  return json({ object: "org", org, key, via: ctx.principal.via }, 200, ctx.headers);
}

// ── Provenance ──────────────────────────────────────────────────────────────

async function registerAsset(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:write");
  await planCheck(ctx, "storage");
  const { bytes } = await readOneFile(ctx);
  ctx.bytesIn = bytes.byteLength;
  const d = await decodeOrThrow(bytes, { lossless: true });
  const sha = await sha256Hex(bytes);
  const declared = ctx.req.headers.get("x-vybz-content-sha256")?.toLowerCase();
  if (declared && declared !== sha) {
    throw new ApiError(409, "checksum_mismatch", "The bytes received do not match X-VYBZ-Content-SHA256.", { computed: sha });
  }
  const title = (ctx.req.headers.get("x-vybz-title") ?? ctx.url.searchParams.get("title") ?? "Untitled").slice(0, 200);
  const externalRef = (ctx.req.headers.get("x-vybz-external-ref") ?? ctx.url.searchParams.get("external_ref") ?? null)?.slice(0, 200) ?? null;

  const { data: existing } = await admin
    .from("provenance_assets")
    .select("*")
    .eq("org_id", ctx.principal.orgId)
    .eq("sha256", sha)
    .maybeSingle();
  if (existing) return json({ ...assetView(existing), existed: true }, 200, ctx.headers);

  const path = `${ctx.principal.orgId}/${sha.slice(0, 2)}/${sha}.${d.format}`;
  const up = await admin.storage.from(ORIGINALS).upload(path, bytes, { contentType: d.mime, upsert: true });
  if (up.error) throw new ApiError(500, "storage_error", "The original could not be stored.");

  const pcm = d.truncated ? null : await pcmHash(d.channels, d.sampleRate);
  const totalFrames = d.totalFrames ?? (d.truncated ? null : d.frames);
  const { data: row, error } = await admin
    .from("provenance_assets")
    .insert({
      org_id: ctx.principal.orgId,
      title,
      external_ref: externalRef,
      sha256: sha,
      pcm_sha256: pcm,
      source_format: d.format,
      storage_path: path,
      bytes: bytes.byteLength,
      mime: d.mime,
      sample_rate: d.sampleRate,
      channels: d.channels.length,
      duration_sec: totalFrames ? Number((totalFrames / d.sampleRate).toFixed(3)) : null,
      created_by_key: ctx.principal.keyId,
    })
    .select("*")
    .single();
  if (error || !row) throw new ApiError(500, "db_error", "The asset record could not be created.");
  const fpFrames = await storeFingerprint(ctx.principal.orgId, row.id, d);
  await chain(ctx, row.id, "register", { sha256: sha, pcm_sha256: pcm, bytes: bytes.byteLength, title, format: d.format, fingerprint_frames: fpFrames });
  ctx.headers["X-VYBZ-SHA256"] = sha;
  return json({ ...assetView({ ...row, fingerprint_frames: fpFrames }), existed: false }, 201, ctx.headers);
}

async function listAssets(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:read");
  const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit") ?? 50), 1), 200);
  const { data } = await admin
    .from("provenance_assets")
    .select("*")
    .eq("org_id", ctx.principal.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return json({ object: "list", data: (data ?? []).map(assetView) }, 200, ctx.headers);
}

async function showAsset(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:read");
  const a = await getAsset(ctx, id);
  const { count } = await admin
    .from("provenance_issuances")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", a.id);
  return json({ ...assetView(a), issuance_count: count ?? 0 }, 200, ctx.headers);
}

async function listIssuances(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:read");
  const a = await getAsset(ctx, id);
  const { data } = await admin
    .from("provenance_issuances")
    .select("*")
    .eq("asset_id", a.id)
    .order("created_at", { ascending: false })
    .limit(500);
  return json({ object: "list", data: (data ?? []).map(issuanceView) }, 200, ctx.headers);
}

async function ledger(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:read");
  const a = await getAsset(ctx, id);
  const { data } = await admin
    .from("provenance_chain")
    .select("seq,event,payload,prev_hash,row_hash,created_at")
    .eq("asset_id", a.id)
    .order("seq", { ascending: true })
    .limit(1000);
  return json({ object: "list", asset_id: a.id, data: data ?? [] }, 200, ctx.headers);
}

async function chainVerify(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:read");
  const { data, error } = await admin.rpc("provenance_chain_verify_service", { p_org: ctx.principal.orgId });
  if (error) throw new ApiError(500, "db_error", "Chain verification failed.");
  const row = Array.isArray(data) ? data[0] : data;
  return json({ object: "provenance.chain", org_id: ctx.principal.orgId, ...row }, 200, ctx.headers);
}

async function issue(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:write");
  if (!WM_SECRET) throw new ApiError(503, "not_configured", "Watermarking is not configured on this deployment.");
  await planCheck(ctx, "issue");
  const a = await getAsset(ctx, id);
  const body = await readJson<{ recipient?: string; license?: string; store?: boolean; c2pa?: boolean }>(ctx.req);
  const recipient = String(body.recipient ?? "").trim();
  if (!recipient || recipient.length > 200) {
    throw new ApiError(422, "invalid_recipient", "`recipient` is required (1–200 characters). Use your own stable identifier for the receiving party.");
  }
  const license = body.license ? String(body.license).slice(0, 200) : null;

  const dl = await admin.storage.from(ORIGINALS).download(a.storage_path);
  if (dl.error || !dl.data) throw new ApiError(500, "storage_error", "The original could not be read.");
  let wav: { channels: Float32Array[]; sampleRate: number };
  try {
    wav = await decodeAudio(new Uint8Array(await dl.data.arrayBuffer()), { lossless: true, maxFrames: Infinity });
  } catch {
    throw new ApiError(500, "corrupt_original", "The stored original could not be decoded.");
  }

  const watermarkId = crypto.randomUUID();
  const key = await deriveKey(WM_SECRET, `${ctx.principal.orgId}|${a.id}|${recipient}|${watermarkId}`);
  for (const ch of wav.channels) embedChannel(ch, key);
  let delivered = encodeWav({ channels: wav.channels, sampleRate: wav.sampleRate });

  let c2pa = false;
  if (body.c2pa !== false && C2PA_WORKER_URL && C2PA_WORKER_TOKEN) {
    try {
      const meta = {
        assetId: a.id,
        recipient,
        watermarkId,
        license,
        title: a.title,
        author: await orgName(ctx.principal.orgId),
      };
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20_000);
      const r = await fetch(`${C2PA_WORKER_URL.replace(/\/+$/, "")}/sign`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${C2PA_WORKER_TOKEN}`,
          "x-vybz-meta": b64utf8(JSON.stringify(meta)),
          "Content-Type": "audio/wav",
        },
        body: new Blob([delivered as unknown as ArrayBuffer], { type: "audio/wav" }),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (r.ok && (r.headers.get("content-type") ?? "").includes("audio")) {
        delivered = new Uint8Array(await r.arrayBuffer());
        c2pa = true;
      }
    } catch {
      // Content Credentials are best-effort; the watermark alone is a complete artifact.
    }
  }

  const deliveredSha = await sha256Hex(delivered);
  const deliveredWav = parseWav(delivered);
  const deliveredPcm = deliveredWav && !deliveredWav.truncated ? await pcmHash(deliveredWav.channels, deliveredWav.sampleRate) : null;
  const { data: iss, error } = await admin
    .from("provenance_issuances")
    .insert({
      org_id: ctx.principal.orgId,
      asset_id: a.id,
      recipient,
      license,
      watermark_id: watermarkId,
      delivered_sha256: deliveredSha,
      pcm_sha256: deliveredPcm,
      c2pa_signed: c2pa,
      issued_by_key: ctx.principal.keyId,
    })
    .select("*")
    .single();
  if (error || !iss) throw new ApiError(500, "db_error", "The issuance could not be recorded.");
  await chain(ctx, a.id, "issue", { issuance_id: iss.id, recipient, watermark_id: watermarkId, delivered_sha256: deliveredSha, c2pa });
  if (c2pa) await chain(ctx, a.id, "c2pa", { issuance_id: iss.id, delivered_sha256: deliveredSha });

  const h = {
    ...ctx.headers,
    "X-VYBZ-Watermark-Id": watermarkId,
    "X-VYBZ-Issuance-Id": iss.id,
    "X-VYBZ-C2PA": c2pa ? "1" : "0",
    "X-VYBZ-SHA256": deliveredSha,
  };

  const store = body.store === true || wantsJson(ctx.req);
  if (store) {
    const path = `${ctx.principal.orgId}/deliveries/${iss.id}.wav`;
    const up = await admin.storage.from(ORIGINALS).upload(path, delivered, { contentType: "audio/wav", upsert: true });
    if (up.error) throw new ApiError(500, "storage_error", "The delivered copy could not be stored.");
    const signed = await admin.storage.from(ORIGINALS).createSignedUrl(path, 3600, { download: `${slugify(a.title)}-${recipient.slice(0, 24)}.wav` });
    return json(
      {
        ...issuanceView(iss),
        bytes: delivered.byteLength,
        download: { url: signed.data?.signedUrl ?? null, expires_in: 3600 },
      },
      201,
      h,
    );
  }
  return new Response(new Blob([delivered as unknown as ArrayBuffer], { type: "audio/wav" }), {
    status: 201,
    headers: {
      ...h,
      "Content-Type": "audio/wav",
      "Content-Length": String(delivered.byteLength),
      "Content-Disposition": `attachment; filename="${slugify(a.title)}-${watermarkId.slice(0, 8)}.wav"`,
    },
  });
}

// ── Provenance: input, decoding, evidence ───────────────────────────────────

type Decoded = Awaited<ReturnType<typeof decodeAudio>>;
type FileInput = { name: string; bytes: Uint8Array; source: "body" | "multipart" | "url" };
type Evidence = Record<string, unknown> & { method: string; result: string };

function workerOpts() {
  return DECODE_WORKER_URL && DECODE_WORKER_TOKEN ? { url: DECODE_WORKER_URL, token: DECODE_WORKER_TOKEN } : undefined;
}

async function decodeOrThrow(bytes: Uint8Array, extra: Record<string, unknown> = {}): Promise<Decoded> {
  try {
    return await decodeAudio(bytes, { maxFrames: MAX_ANALYSIS_FRAMES, worker: workerOpts(), ...extra });
  } catch (e) {
    if (e instanceof DecodeError) throw new ApiError(422, e.code, e.message, e.extra as Record<string, unknown>);
    throw e;
  }
}

function truthy(v: string | null | undefined): boolean {
  return v !== null && v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "\\x";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function inputView(bytes: Uint8Array, sha: string, sniffed: ReturnType<typeof sniff>, d: Decoded | null, decodeError: { code: string; message: string } | null) {
  return {
    sha256: sha,
    bytes: bytes.byteLength,
    format: sniffed.format,
    codec: sniffed.codec,
    container: sniffed.container,
    mime: sniffed.mime,
    decoded: Boolean(d),
    decoder: d?.source ?? null,
    decode_error: decodeError,
    sample_rate: d?.sampleRate ?? null,
    channels: d?.channels.length ?? null,
    analyzed_sec: d ? Number(d.durationSec.toFixed(3)) : null,
    duration_sec: d?.totalFrames ? Number((d.totalFrames / d.sampleRate).toFixed(3)) : d && !d.truncated ? Number(d.durationSec.toFixed(3)) : null,
    truncated: d?.truncated ?? false,
  };
}

/** One file from a raw body or the first part of a multipart form. */
async function readOneFile(ctx: Ctx): Promise<FileInput> {
  const ct = ctx.req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const { items } = await readMultipart(ctx, 1);
    if (!items.length) throw new ApiError(400, "empty_body", "Attach the file as a multipart part.");
    return items[0];
  }
  const bytes = await readBinary(ctx.req, MAX_AUDIO_BYTES);
  return { name: ctx.req.headers.get("x-vybz-name") ?? "body", bytes, source: "body" };
}

async function readMultipart(ctx: Ctx, limit: number): Promise<{ items: FileInput[]; fields: Record<string, string> }> {
  const len = Number(ctx.req.headers.get("content-length") ?? "0");
  if (len > MAX_BATCH_BYTES) throw new ApiError(413, "payload_too_large", `Batch bodies are limited to ${Math.round(MAX_BATCH_BYTES / 1_048_576)} MB.`);
  let form: FormData;
  try {
    form = await ctx.req.formData();
  } catch {
    throw new ApiError(400, "invalid_multipart", "The multipart body could not be parsed.");
  }
  const items: FileInput[] = [];
  const fields: Record<string, string> = {};
  let total = 0;
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields[name] = value;
      continue;
    }
    if (items.length >= limit) throw new ApiError(422, "too_many_items", `At most ${limit} files per request.`);
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (!bytes.byteLength) continue;
    if (bytes.byteLength > MAX_AUDIO_BYTES) throw new ApiError(413, "payload_too_large", `"${value.name}" exceeds ${Math.round(MAX_AUDIO_BYTES / 1_048_576)} MB.`);
    total += bytes.byteLength;
    if (total > MAX_BATCH_BYTES) throw new ApiError(413, "payload_too_large", `Batch bodies are limited to ${Math.round(MAX_BATCH_BYTES / 1_048_576)} MB.`);
    items.push({ name: value.name || name, bytes, source: "multipart" });
  }
  return { items, fields };
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal") return true;
  if (h.includes(":")) return true; // IPv6 literals are not accepted
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Fetch a remote file with the guards a public API needs: https, no private hosts, bounded size and time. */
async function fetchRemote(raw: string): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(422, "invalid_url", `"${raw}" is not a valid URL.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ApiError(422, "invalid_url", "Only http and https URLs are fetched.");
  if (privateHost(u.hostname)) throw new ApiError(422, "url_not_allowed", "URLs pointing at private or local hosts are not fetched.");
  let res: Response;
  try {
    res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "vybz-api/1 (+https://vybz.cloud)" } });
  } catch (e) {
    throw new ApiError(422, "fetch_failed", `The URL could not be fetched: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (privateHost(new URL(res.url || u.href).hostname)) throw new ApiError(422, "url_not_allowed", "The URL redirected to a private host.");
  if (!res.ok) throw new ApiError(422, "fetch_failed", `The URL answered ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) throw new ApiError(413, "payload_too_large", `The URL's file exceeds ${Math.round(MAX_AUDIO_BYTES / 1_048_576)} MB.`);
  const reader = res.body?.getReader();
  if (!reader) throw new ApiError(422, "fetch_failed", "The URL returned no body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "payload_too_large", `The URL's file exceeds ${Math.round(MAX_AUDIO_BYTES / 1_048_576)} MB.`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  if (!size) throw new ApiError(422, "fetch_failed", "The URL returned an empty file.");
  return out;
}

/**
 * Batch input: multipart with any number of file parts, or JSON
 * `{ items: [{ url, name? }] }`. Options come from form fields, JSON fields,
 * or query parameters. Files are fetched one at a time to bound memory.
 */
async function readBatch(ctx: Ctx): Promise<{ items: Array<FileInput | { name: string; error: ApiError }>; options: Record<string, string> }> {
  const ct = ctx.req.headers.get("content-type") ?? "";
  const options: Record<string, string> = {};
  for (const [k, v] of ctx.url.searchParams.entries()) options[k] = v;
  if (ct.includes("multipart/form-data")) {
    const { items, fields } = await readMultipart(ctx, MAX_BATCH_ITEMS);
    Object.assign(options, fields);
    if (!items.length) throw new ApiError(400, "empty_body", "Attach at least one file part.");
    return { items, options };
  }
  if (ct.includes("application/json")) {
    const body = await readJson<{ items?: Array<{ url?: string; name?: string }>; attribute?: unknown; asset?: unknown }>(ctx.req);
    if (body.attribute !== undefined) options.attribute = String(body.attribute);
    if (body.asset !== undefined) options.asset = String(body.asset);
    const list = Array.isArray(body.items) ? body.items : [];
    if (!list.length) throw new ApiError(422, "validation", "`items` must be a non-empty array of { url, name? }.");
    if (list.length > MAX_BATCH_ITEMS) throw new ApiError(422, "too_many_items", `At most ${MAX_BATCH_ITEMS} items per request.`);
    const items: Array<FileInput | { name: string; error: ApiError }> = [];
    for (const it of list) {
      const name = String(it?.name ?? it?.url ?? "item").slice(0, 200);
      try {
        items.push({ name, bytes: await fetchRemote(String(it?.url ?? "")), source: "url" });
      } catch (e) {
        items.push({ name, error: e instanceof ApiError ? e : new ApiError(422, "fetch_failed", String(e)) });
      }
    }
    return { items, options };
  }
  throw new ApiError(415, "unsupported_media_type", "Send multipart/form-data with file parts, or application/json with `items: [{ url }]`.");
}

function itemError(name: string, e: unknown, requestId: string) {
  const err = e instanceof ApiError ? e : new ApiError(500, "internal_error", "This item failed on our side.");
  if (!(e instanceof ApiError)) console.error(requestId, name, e);
  return { name, status: "error", error: { code: err.code, message: err.message, ...(err.extra ?? {}) } };
}

// ── Fingerprint index ───────────────────────────────────────────────────────

async function storeFingerprint(orgId: string, assetId: string, d: Decoded): Promise<number> {
  try {
    const fp = fingerprint(d.channels, d.sampleRate, { maxSeconds: FP_MAX_SECONDS });
    if (!fp.length) return 0;
    const { error } = await admin.rpc("provenance_fingerprint_store", {
      p_asset: assetId,
      p_org: orgId,
      p_sample_hz: FP_RATE,
      p_window: FP_WINDOW,
      p_hop: FP_HOP,
      p_bits: bytesToHex(toBytes(fp)),
      p_hashes: Array.from(fp, toInt4),
    });
    if (error) {
      console.error("fingerprint", assetId, error.message);
      return 0;
    }
    return fp.length;
  } catch (e) {
    console.error("fingerprint", assetId, e);
    return 0;
  }
}

type FingerprintEvidence = Evidence & { asset_id?: string; similarity?: number; offset_sec?: number; overlap_sec?: number; votes?: number };

/** Which registered original does this audio derive from, and where in it? */
async function identifyByFingerprint(ctx: Ctx, d: Decoded): Promise<FingerprintEvidence> {
  const fp = fingerprint(d.channels, d.sampleRate, { maxSeconds: FP_QUERY_SECONDS });
  if (fp.length < FP_MIN_OVERLAP_FRAMES) return { method: "fingerprint", result: "skipped", reason: "too_short" };
  const { data, error } = await admin.rpc("provenance_fingerprint_lookup", { p_org: ctx.principal.orgId, p_hashes: Array.from(fp, toInt4), p_limit: 40 });
  if (error) return { method: "fingerprint", result: "skipped", reason: "index_unavailable" };
  const rows = (data ?? []) as Array<{ asset_id: string; offset_frames: number; votes: number }>;
  const byAsset = new Map<string, { votes: number; offsets: number[] }>();
  for (const r of rows) {
    const cur = byAsset.get(r.asset_id) ?? { votes: 0, offsets: [] };
    cur.votes += Number(r.votes);
    if (cur.offsets.length < 4) cur.offsets.push(Number(r.offset_frames));
    byAsset.set(r.asset_id, cur);
  }
  const candidates = [...byAsset.entries()].sort((a, b) => b[1].votes - a[1].votes).slice(0, 3);
  let best: (FingerprintEvidence & { ber: number }) | null = null;
  for (const [assetId, c] of candidates) {
    if (c.votes < FP_MIN_VOTES) continue;
    const { data: ref } = await admin.from("provenance_fingerprints").select("bits").eq("asset_id", assetId).maybeSingle();
    if (!ref?.bits) continue;
    const refFp = fromBytes(hexToBytes(String(ref.bits)));
    const al = bestAlignment(fp, refFp, c.offsets);
    if (!al.overlap) continue;
    const cand = {
      method: "fingerprint",
      result: al.ber <= FP_MATCH_BER ? "match" : "no_match",
      asset_id: assetId,
      similarity: Number((1 - al.ber).toFixed(4)),
      offset_sec: Number((al.offset / FP_FPS).toFixed(2)),
      overlap_sec: Number((al.overlap / FP_FPS).toFixed(2)),
      votes: c.votes,
      ber: al.ber,
    };
    if (!best || cand.ber < best.ber) best = cand;
  }
  if (!best) return { method: "fingerprint", result: "no_match", candidates: candidates.length };
  const { ber: _ber, ...rest } = best;
  return rest;
}

// ── Content Credentials (presence + our assertion) ──────────────────────────

function indexOfBytes(hay: Uint8Array, needle: string, from = 0, to = hay.length): number {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = from; i <= to - n; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < n; j++) if (hay[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function uuidAfter(bytes: Uint8Array, key: string, from: number, to: number): string | null {
  const k = indexOfBytes(bytes, key, from, to);
  if (k < 0) return null;
  const window = new TextDecoder("latin1").decode(bytes.subarray(k, Math.min(to, k + 128)));
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(window)?.[0]?.toLowerCase() ?? null;
}

async function contentCredentials(ctx: Ctx, bytes: Uint8Array): Promise<Evidence> {
  const SCAN = 8 * 1_048_576;
  const regions: Array<[number, number]> = bytes.length <= 2 * SCAN ? [[0, bytes.length]] : [[0, SCAN], [bytes.length - SCAN, bytes.length]];
  let present = false, labelAt = -1, region: [number, number] = [0, 0];
  for (const [a, b] of regions) {
    if (!present && indexOfBytes(bytes, "c2pa", a, b) >= 0 && indexOfBytes(bytes, "jumb", a, b) >= 0) present = true;
    if (labelAt < 0) {
      labelAt = indexOfBytes(bytes, "com.vybz.provenance", a, b);
      if (labelAt >= 0) region = [a, b];
    }
  }
  if (!present && labelAt < 0) return { method: "content_credentials", result: "absent" };
  if (labelAt < 0) return { method: "content_credentials", result: "present", issuer: "other", note: "A C2PA manifest is present but it is not a VYBZ manifest. Validate it with a public C2PA validator." };
  const end = Math.min(region[1], labelAt + 4096);
  const assetId = uuidAfter(bytes, "asset_id", labelAt, end);
  const watermarkId = uuidAfter(bytes, "watermark_id", labelAt, end);
  let consistent: boolean | null = null, issuanceId: string | null = null;
  if (watermarkId) {
    const { data } = await admin.from("provenance_issuances").select("id,asset_id").eq("org_id", ctx.principal.orgId).eq("watermark_id", watermarkId).maybeSingle();
    issuanceId = data?.id ?? null;
    consistent = Boolean(data) && (!assetId || data?.asset_id === assetId);
  }
  return {
    method: "content_credentials",
    result: "present",
    issuer: "vybz",
    asset_id: assetId,
    watermark_id: watermarkId,
    issuance_id: issuanceId,
    consistent,
    note: "Presence and record consistency only. Signature validity is checked by a C2PA validator, not here.",
  };
}

// ── Detection ───────────────────────────────────────────────────────────────

type Match = { issuance_id: string; recipient: string; watermark_id: string; score: number; exact: boolean };

/**
 * Attribution decision. Two independent tests, either suffices:
 *  • absolute: top score above the empirical floor and well clear of the runner-up;
 *  • relative: top score is a statistical outlier against every other candidate
 *    (z-score over the rest plus never-issued decoy keys), which is what a true
 *    recipient looks like when the material is tonal or short and absolute scores
 *    run low. Decoys make the test valid even with a single real candidate.
 */
function decide(
  matches: Match[],
  exact: boolean,
  decoys: number[] = [],
): { attributed: Match | null; confidence: "exact" | "high" | "medium" | "none"; statistics: Record<string, number | null> } {
  const top = matches[0];
  if (!top) return { attributed: null, confidence: "none", statistics: { z: null, ratio: null } };
  const rest = [...matches.slice(1).map((m) => m.score), ...decoys];
  const second = matches[1]?.score ?? Math.max(0, ...decoys);
  const ratio = second > 0 ? top.score / second : null;
  let z: number | null = null;
  if (rest.length >= 3) {
    const mean = rest.reduce((s, v) => s + v, 0) / rest.length;
    const sd = Math.sqrt(rest.reduce((s, v) => s + (v - mean) ** 2, 0) / rest.length) || 1e-9;
    z = (top.score - mean) / sd;
  }
  const absolute = top.score > 0.15 && top.score > second * 2.5;
  const relative = z !== null && z > 8 && (ratio === null || ratio > 2.5);
  if (exact) return { attributed: top, confidence: "exact", statistics: { z, ratio } };
  if (absolute) return { attributed: top, confidence: top.score > 0.3 ? "high" : "medium", statistics: { z, ratio } };
  if (relative) return { attributed: top, confidence: (z as number) > 15 ? "high" : "medium", statistics: { z, ratio } };
  return { attributed: null, confidence: "none", statistics: { z, ratio } };
}

/**
 * Correlate decoded audio against every copy issued for an asset. The suspect
 * is resampled to the asset's rate when needed, then each channel is folded
 * once; every candidate key correlates against the fold, so cost is
 * O(samples + issuances × period) rather than O(issuances × samples).
 */
async function runDetection(ctx: Ctx, a: any, d: Decoded, suspectSha: string) {
  const rate = Number(a.sample_rate) || d.sampleRate;
  const resampled = rate !== d.sampleRate;
  const folds = d.channels.map((ch) => foldChannel(resampled ? resample(ch, d.sampleRate, rate) : ch));
  const { data: issuances } = await admin
    .from("provenance_issuances")
    .select("id,recipient,watermark_id,delivered_sha256,pcm_sha256,created_at")
    .eq("asset_id", a.id)
    .limit(5000);
  const base = { asset_id: a.id, suspect_sha256: suspectSha, analyzed_sec: Number(d.durationSec.toFixed(3)), resampled_from: resampled ? d.sampleRate : null, truncated: d.truncated };
  if (!issuances?.length) {
    await chain(ctx, a.id, "detect", { suspect_sha256: suspectSha, candidates: 0, attributed: null });
    return { ...base, attributed: null, confidence: "none" as const, statistics: { z: null, ratio: null }, matches: [], candidates: 0, note: "No issuances exist for this asset yet." };
  }
  const pcm = d.truncated ? null : await pcmHash(d.channels, d.sampleRate);
  const exact = issuances.find((i: any) => i.delivered_sha256 === suspectSha || (pcm && i.pcm_sha256 === pcm));
  const matches: Match[] = [];
  const score = async (payload: string) => {
    const key = await deriveKey(WM_SECRET, payload);
    let sum = 0;
    for (const acc of folds) sum += detectFolded(acc, key);
    return sum / folds.length;
  };
  for (const i of issuances as any[]) {
    const s = await score(`${ctx.principal.orgId}|${a.id}|${i.recipient}|${i.watermark_id}`);
    matches.push({ issuance_id: i.id, recipient: i.recipient, watermark_id: i.watermark_id, score: Number(s.toFixed(6)), exact: i.id === exact?.id });
  }
  matches.sort((x, y) => y.score - x.score);
  // Null distribution: decoy keys that were never issued. They give the z-test a
  // stable population even when only one or two real candidates exist.
  const decoys: number[] = [];
  for (let k = matches.length; k < 12; k++) decoys.push(await score(`decoy|${ctx.principal.orgId}|${a.id}|${k}|${suspectSha}`));
  const decision = decide(matches, Boolean(exact), decoys);
  const attributed = exact ? matches.find((m) => m.exact) ?? null : decision.attributed;
  const confidence = exact ? ("exact" as const) : decision.confidence;
  await chain(ctx, a.id, "detect", { suspect_sha256: suspectSha, candidates: matches.length, attributed: attributed?.issuance_id ?? null, confidence });
  return { ...base, attributed, confidence, statistics: decision.statistics, matches: matches.slice(0, 25), candidates: matches.length };
}

async function detectOne(ctx: Ctx, a: any, file: FileInput) {
  await planCheck(ctx, "detect");
  const d = await decodeOrThrow(file.bytes);
  const sha = await sha256Hex(file.bytes);
  const r = await runDetection(ctx, a, d, sha);
  return { object: "provenance.detection", name: file.name, input: inputView(file.bytes, sha, sniff(file.bytes), d, null), ...r };
}

async function detect(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:detect");
  if (!WM_SECRET) throw new ApiError(503, "not_configured", "Watermark detection is not configured on this deployment.");
  const a = await getAsset(ctx, id);
  const file = await readOneFile(ctx);
  ctx.bytesIn = file.bytes.byteLength;
  return json(await detectOne(ctx, a, file), 200, ctx.headers);
}

async function detectBatch(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:detect");
  if (!WM_SECRET) throw new ApiError(503, "not_configured", "Watermark detection is not configured on this deployment.");
  const a = await getAsset(ctx, id);
  const { items } = await readBatch(ctx);
  ctx.bytesIn = items.reduce((s, it) => s + ("bytes" in it ? it.bytes.byteLength : 0), 0);
  const data: unknown[] = [];
  let attributed = 0, errors = 0;
  for (const it of items) {
    if ("error" in it) {
      data.push(itemError(it.name, it.error, ctx.requestId));
      errors++;
      continue;
    }
    try {
      const r = await detectOne(ctx, a, it);
      if (r.attributed) attributed++;
      data.push({ status: "ok", ...r });
    } catch (e) {
      data.push(itemError(it.name, e, ctx.requestId));
      errors++;
    }
  }
  return json({ object: "list", asset_id: a.id, data, summary: { total: items.length, attributed, errors } }, 200, ctx.headers);
}

// ── Verification ────────────────────────────────────────────────────────────

type VerifyOptions = { attribute: boolean; assetHint: string | null };

function verifyOptions(ctx: Ctx, fields: Record<string, string> = {}): VerifyOptions {
  const attr = fields.attribute ?? ctx.url.searchParams.get("attribute") ?? ctx.req.headers.get("x-vybz-attribute");
  const asset = fields.asset ?? ctx.url.searchParams.get("asset") ?? ctx.req.headers.get("x-vybz-asset");
  return { attribute: truthy(attr), assetHint: asset && isUuid(asset) ? asset : null };
}

/**
 * Every method of establishing what a file is, in order of cost, each
 * reported as evidence. Exact hash and PCM hash are free. The fingerprint
 * identifies the original without an asset id. Watermark attribution runs only
 * when asked for (it is metered) and only when there is an asset to test against.
 */
async function runVerification(ctx: Ctx, file: FileInput, opts: VerifyOptions) {
  const org = ctx.principal.orgId;
  const bytes = file.bytes;
  const sha = await sha256Hex(bytes);
  const sniffed = sniff(bytes);
  const evidence: Evidence[] = [];

  // 1. Exact bytes.
  const { data: original } = await admin.from("provenance_assets").select("*").eq("org_id", org).eq("sha256", sha).maybeSingle();
  const { data: issuedExact } = await admin.from("provenance_issuances").select("*").eq("org_id", org).eq("delivered_sha256", sha).maybeSingle();
  evidence.push({ method: "exact_hash", result: original || issuedExact ? "match" : "no_match", sha256: sha });
  let asset: any = original ?? null;
  let issuance: any = issuedExact ?? null;

  // 2. Decode.
  let d: Decoded | null = null;
  let decodeError: { code: string; message: string } | null = null;
  if (sniffed.decodable !== "none") {
    try {
      d = await decodeAudio(bytes, { maxFrames: MAX_ANALYSIS_FRAMES, worker: workerOpts() });
    } catch (e) {
      decodeError = e instanceof DecodeError ? { code: e.code, message: e.message } : { code: "decode_failed", message: e instanceof Error ? e.message : String(e) };
    }
  } else {
    decodeError = { code: "unsupported_audio", message: "Not a recognized audio format; only the exact hash was checked." };
  }

  // 3. Canonical PCM hash: same audio, any lossless container or metadata.
  if (d && !d.truncated) {
    const pcm = await pcmHash(d.channels, d.sampleRate);
    const { data: pcmOriginal } = asset ? { data: null } : await admin.from("provenance_assets").select("*").eq("org_id", org).eq("pcm_sha256", pcm).maybeSingle();
    const { data: pcmIssued } = issuance ? { data: null } : await admin.from("provenance_issuances").select("*").eq("org_id", org).eq("pcm_sha256", pcm).maybeSingle();
    if (pcmOriginal) asset = pcmOriginal;
    if (pcmIssued) issuance = pcmIssued;
    evidence.push({ method: "pcm_hash", result: pcmOriginal || pcmIssued || (asset?.pcm_sha256 === pcm) || (issuance?.pcm_sha256 === pcm) ? "match" : "no_match", pcm_sha256: pcm });
  } else {
    evidence.push({ method: "pcm_hash", result: "skipped", reason: d ? "truncated" : decodeError?.code ?? "not_decoded" });
  }

  // 4. Perceptual fingerprint: which original, and where in it.
  let fpAssetId: string | null = null;
  let fpEvidence: FingerprintEvidence | null = null;
  if (d) {
    fpEvidence = await identifyByFingerprint(ctx, d);
    evidence.push(fpEvidence);
    if (fpEvidence.result === "match" && fpEvidence.asset_id) fpAssetId = fpEvidence.asset_id;
  } else {
    evidence.push({ method: "fingerprint", result: "skipped", reason: decodeError?.code ?? "not_decoded" });
  }

  // 5. Content Credentials.
  const cc = await contentCredentials(ctx, bytes);
  evidence.push(cc);

  // 6. Watermark attribution, when asked for and there is an asset to test.
  const targetAssetId = opts.assetHint ?? asset?.id ?? issuance?.asset_id ?? fpAssetId ?? (cc.consistent ? (cc.asset_id as string | null) : null);
  let detection: Awaited<ReturnType<typeof runDetection>> | null = null;
  if (opts.attribute && d && targetAssetId && !issuance) {
    if (!ctx.principal.scopes.includes("provenance:detect")) {
      evidence.push({ method: "watermark", result: "skipped", reason: "insufficient_scope", required_scope: "provenance:detect" });
    } else if (!WM_SECRET) {
      evidence.push({ method: "watermark", result: "skipped", reason: "not_configured" });
    } else {
      try {
        const target = await getAsset(ctx, targetAssetId);
        await planCheck(ctx, "detect");
        detection = await runDetection(ctx, target, d, sha);
        evidence.push({
          method: "watermark",
          result: detection.attributed ? "attributed" : "inconclusive",
          asset_id: target.id,
          confidence: detection.confidence,
          attributed: detection.attributed,
          statistics: detection.statistics,
          candidates: detection.candidates,
          resampled_from: detection.resampled_from,
        });
        if (detection.attributed) {
          const { data: iss } = await admin.from("provenance_issuances").select("*").eq("id", detection.attributed.issuance_id).maybeSingle();
          if (iss) issuance = iss;
          if (!asset) asset = target;
        }
      } catch (e) {
        if (e instanceof ApiError) evidence.push({ method: "watermark", result: "skipped", reason: e.code, message: e.message });
        else throw e;
      }
    }
  } else if (opts.attribute) {
    evidence.push({ method: "watermark", result: "skipped", reason: issuance ? "already_identified" : !d ? decodeError?.code ?? "not_decoded" : "no_asset", note: !d || issuance ? undefined : "No original matched. Pass `asset` to test against a specific asset." });
  } else {
    evidence.push({ method: "watermark", result: "not_requested", note: "Pass `attribute=true` to run watermark attribution (metered as one detection)." });
  }

  if (!asset && issuance) {
    const { data: a2 } = await admin.from("provenance_assets").select("*").eq("id", issuance.asset_id).maybeSingle();
    asset = a2 ?? null;
  } else if (!asset && fpAssetId) {
    const { data: a3 } = await admin.from("provenance_assets").select("*").eq("id", fpAssetId).maybeSingle();
    asset = a3 ?? null;
  }

  // Verdict.
  const exactMatch = evidence.some((e) => (e.method === "exact_hash" || e.method === "pcm_hash") && e.result === "match");
  let verdict: "original" | "issued_copy" | "derived_copy" | "derived_unattributed" | "unknown";
  let confidence: "exact" | "high" | "medium" | "none";
  if (exactMatch && original) {
    verdict = "original"; confidence = "exact";
  } else if (exactMatch && asset && !issuance) {
    verdict = "original"; confidence = "exact";
  } else if (exactMatch && issuance) {
    verdict = "issued_copy"; confidence = "exact";
  } else if (detection?.attributed) {
    verdict = "derived_copy"; confidence = detection.confidence === "none" ? "medium" : detection.confidence;
  } else if (fpAssetId || cc.consistent) {
    verdict = "derived_unattributed";
    confidence = fpEvidence?.result === "match" && (fpEvidence.similarity ?? 0) >= 0.8 ? "high" : "medium";
  } else {
    verdict = "unknown"; confidence = "none";
  }
  const known = verdict !== "unknown";
  const kind = verdict === "original" ? "original" : verdict === "issued_copy" ? "issued_copy" : known ? "derived" : "unknown";

  await chain(ctx, asset?.id ?? null, "verify", {
    sha256: sha,
    known,
    kind,
    verdict,
    confidence,
    methods: evidence.filter((e) => e.result === "match" || e.result === "attributed" || e.result === "present").map((e) => e.method),
  });

  return {
    object: "provenance.verification",
    name: file.name,
    sha256: sha,
    known,
    kind,
    verdict,
    confidence,
    input: inputView(bytes, sha, sniffed, d, decodeError),
    asset: asset ? assetView(asset) : null,
    issuance: issuance ? issuanceView(issuance) : null,
    evidence,
    hint: known
      ? null
      : opts.attribute
        ? "No method matched. If you know which asset this may derive from, call POST /provenance/assets/{id}/detect."
        : "No exact or fingerprint match. Re-run with `attribute=true` to correlate the watermark, or call POST /provenance/assets/{id}/detect against a known asset.",
  };
}

async function verify(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:read");
  const ct = ctx.req.headers.get("content-type") ?? "";
  let file: FileInput;
  let fields: Record<string, string> = {};
  if (ct.includes("multipart/form-data")) {
    const r = await readMultipart(ctx, 1);
    if (!r.items.length) throw new ApiError(400, "empty_body", "Attach the file as a multipart part.");
    file = r.items[0];
    fields = r.fields;
  } else {
    file = await readOneFile(ctx);
  }
  ctx.bytesIn = file.bytes.byteLength;
  return json(await runVerification(ctx, file, verifyOptions(ctx, fields)), 200, ctx.headers);
}

async function verifyBatch(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:read");
  const { items, options } = await readBatch(ctx);
  const opts = verifyOptions(ctx, options);
  ctx.bytesIn = items.reduce((s, it) => s + ("bytes" in it ? it.bytes.byteLength : 0), 0);
  const data: unknown[] = [];
  const summary = { total: items.length, original: 0, issued_copy: 0, derived_copy: 0, derived_unattributed: 0, unknown: 0, errors: 0 };
  for (const it of items) {
    if ("error" in it) {
      data.push(itemError(it.name, it.error, ctx.requestId));
      summary.errors++;
      continue;
    }
    try {
      const r = await runVerification(ctx, it, opts);
      summary[r.verdict]++;
      data.push({ status: "ok", ...r });
    } catch (e) {
      data.push(itemError(it.name, e, ctx.requestId));
      summary.errors++;
    }
  }
  return json({ object: "list", data, summary }, 200, ctx.headers);
}

function formats(ctx: Ctx) {
  const worker = Boolean(workerOpts());
  return json(
    {
      object: "provenance.formats",
      decode: { native: NATIVE_FORMATS, worker: worker ? WORKER_FORMATS : [], worker_configured: worker },
      register: ["wav", "aiff", "flac"],
      verify: supportedFormats(worker),
      detect: supportedFormats(worker),
      limits: {
        max_bytes: MAX_AUDIO_BYTES,
        max_batch_items: MAX_BATCH_ITEMS,
        max_batch_bytes: MAX_BATCH_BYTES,
        max_analysis_seconds_at_44100: Math.round(MAX_ANALYSIS_FRAMES / 44100),
        fingerprint_index_seconds: FP_MAX_SECONDS,
      },
      methods: ["exact_hash", "pcm_hash", "fingerprint", "content_credentials", "watermark"],
    },
    200,
    ctx.headers,
  );
}

// ── Vault ───────────────────────────────────────────────────────────────────

async function createRepo(ctx: Ctx) {
  requireScope(ctx.principal, "vault:write");
  const body = await readJson<{ name?: string; slug?: string; description?: string; daw?: string; default_branch?: string }>(ctx.req);
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 120) throw new ApiError(422, "invalid_name", "`name` is required (1–120 characters).");
  const slug = slugify(body.slug ?? name);
  const { data, error } = await admin
    .from("vault_repos")
    .insert({
      org_id: ctx.principal.orgId,
      name,
      slug,
      description: body.description ? String(body.description).slice(0, 2000) : null,
      daw: body.daw ? String(body.daw).slice(0, 60) : null,
      default_branch: body.default_branch ? String(body.default_branch).slice(0, 80) : "main",
      created_by_key: ctx.principal.keyId,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw new ApiError(409, "slug_taken", `A repository with slug \`${slug}\` already exists.`, { slug });
  if (error || !data) throw new ApiError(500, "db_error", "The repository could not be created.");
  return json(repoView(data), 201, ctx.headers);
}

async function listRepos(ctx: Ctx) {
  requireScope(ctx.principal, "vault:read");
  const { data } = await admin
    .from("vault_repos")
    .select("*")
    .eq("org_id", ctx.principal.orgId)
    .order("updated_at", { ascending: false })
    .limit(200);
  return json({ object: "list", data: (data ?? []).map(repoView) }, 200, ctx.headers);
}

async function showRepo(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const { data: branches } = await admin.from("vault_branches").select("name,head_sha,updated_at").eq("repo_id", r.id).order("name");
  const { count } = await admin.from("vault_commits").select("id", { count: "exact", head: true }).eq("repo_id", r.id);
  return json({ ...repoView(r), branches: branches ?? [], commit_count: count ?? 0 }, 200, ctx.headers);
}

async function uploadBlob(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:write");
  const r = await getRepo(ctx, id);
  await planCheck(ctx, "storage");
  const bytes = await readBinary(ctx.req, MAX_BLOB_BYTES);
  ctx.bytesIn = bytes.byteLength;
  const hash = await sha256Hex(bytes);
  const declared = ctx.req.headers.get("x-vybz-content-sha256")?.toLowerCase();
  if (declared && declared !== hash) throw new ApiError(409, "checksum_mismatch", "Bytes do not match X-VYBZ-Content-SHA256.", { computed: hash });
  const org = ctx.principal.orgId;
  const { data: existing } = await admin.from("vault_blobs").select("hash,size").eq("org_id", org).eq("hash", hash).maybeSingle();
  if (existing) return json({ object: "vault.blob", repo_id: r.id, hash, size: Number(existing.size), existed: true }, 200, ctx.headers);
  const declaredMime = (ctx.req.headers.get("x-vybz-mime") ?? ctx.req.headers.get("content-type") ?? "").split(";")[0].trim();
  const mime = !declaredMime || /form-urlencoded|multipart/i.test(declaredMime) ? "application/octet-stream" : declaredMime;
  const path = `${org}/${hash.slice(0, 2)}/${hash}`;
  const up = await admin.storage.from(BLOBS).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) throw new ApiError(500, "storage_error", "The blob could not be stored.");
  const { error } = await admin.from("vault_blobs").insert({ org_id: org, hash, size: bytes.byteLength, mime, storage_path: path });
  if (error && error.code !== "23505") throw new ApiError(500, "db_error", "The blob record could not be created.");
  return json({ object: "vault.blob", repo_id: r.id, hash, size: bytes.byteLength, existed: false }, 201, ctx.headers);
}

async function blobsExist(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  await getRepo(ctx, id);
  const body = await readJson<{ hashes?: string[] }>(ctx.req);
  const hashes = [...new Set((body.hashes ?? []).map((h) => String(h).toLowerCase()).filter((h) => /^[a-f0-9]{64}$/.test(h)))];
  if (hashes.length > 5000) throw new ApiError(422, "too_many", "Send at most 5000 hashes per call.");
  const { data } = await admin.from("vault_blobs").select("hash").eq("org_id", ctx.principal.orgId).in("hash", hashes);
  const present = new Set((data ?? []).map((x: any) => x.hash));
  return json({ object: "vault.blob_check", present: hashes.filter((h) => present.has(h)), missing: hashes.filter((h) => !present.has(h)) }, 200, ctx.headers);
}

async function getBlob(ctx: Ctx, id: string, hash: string) {
  requireScope(ctx.principal, "vault:read");
  await getRepo(ctx, id);
  hash = hash.toLowerCase();
  const { data } = await admin.from("vault_blobs").select("*").eq("org_id", ctx.principal.orgId).eq("hash", hash).maybeSingle();
  if (!data) throw new ApiError(404, "not_found", "No such blob in this organization.");
  const signed = await admin.storage.from(BLOBS).createSignedUrl(data.storage_path, 900);
  if (signed.error || !signed.data) throw new ApiError(500, "storage_error", "A download link could not be minted.");
  return json({ object: "vault.blob", hash, size: Number(data.size), mime: data.mime, download: { url: signed.data.signedUrl, expires_in: 900 } }, 200, ctx.headers);
}

type Entry = { path: string; hash: string; size: number };

function normalizeEntries(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) throw new ApiError(422, "invalid_entries", "`entries` must be an array of { path, hash, size }.");
  if (raw.length > 20000) throw new ApiError(422, "too_many", "A commit may contain at most 20000 entries.");
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of raw as any[]) {
    const path = String(e?.path ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const hash = String(e?.hash ?? "").toLowerCase();
    const size = Number(e?.size ?? 0);
    if (!path || path.includes("..") || path.length > 1024) throw new ApiError(422, "invalid_path", `Invalid entry path: ${path || "(empty)"}`);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new ApiError(422, "invalid_hash", `Invalid SHA-256 for ${path}.`);
    if (!Number.isFinite(size) || size < 0) throw new ApiError(422, "invalid_size", `Invalid size for ${path}.`);
    if (seen.has(path)) throw new ApiError(422, "duplicate_path", `Duplicate entry path: ${path}`);
    seen.add(path);
    out.push({ path, hash, size });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

async function commit(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:write");
  const r = await getRepo(ctx, id);
  const body = await readJson<{ branch?: string; message?: string; entries?: unknown; parent?: string | null; meta?: Record<string, unknown> }>(ctx.req);
  const branch = String(body.branch ?? r.default_branch ?? "main");
  if (!/^[A-Za-z0-9._/-]{1,80}$/.test(branch)) throw new ApiError(422, "invalid_branch", "Branch names may use letters, digits, `._/-` (max 80).");
  const message = String(body.message ?? "").slice(0, 4000);
  const entries = normalizeEntries(body.entries);
  const org = ctx.principal.orgId;

  // Every referenced blob must already exist in this organization.
  const hashes = [...new Set(entries.map((e) => e.hash))];
  const present = new Set<string>();
  for (let i = 0; i < hashes.length; i += 1000) {
    const { data } = await admin.from("vault_blobs").select("hash").eq("org_id", org).in("hash", hashes.slice(i, i + 1000));
    for (const x of data ?? []) present.add(x.hash);
  }
  const missing = hashes.filter((h) => !present.has(h));
  if (missing.length) throw new ApiError(409, "missing_blobs", "Upload these blobs before committing.", { missing: missing.slice(0, 100), missing_count: missing.length });

  const { data: br } = await admin.from("vault_branches").select("head_sha").eq("repo_id", r.id).eq("name", branch).maybeSingle();
  const currentHead: string | null = br?.head_sha ?? null;
  const expected = body.parent === undefined ? currentHead : body.parent;
  if (expected !== currentHead) {
    throw new ApiError(409, "head_moved", "The branch head is not the parent you expected. Fetch the branch and retry.", { branch, head: currentHead, expected });
  }

  const treeSha = await sha256Hex(canonical(entries));
  if (currentHead) {
    const { data: headCommit } = await admin.from("vault_commits").select("*").eq("repo_id", r.id).eq("sha", currentHead).maybeSingle();
    if (headCommit?.tree_sha === treeSha) {
      return json({ ...commitView(headCommit), branch, unchanged: true }, 200, ctx.headers);
    }
  }
  const createdAt = new Date().toISOString();
  const sha = await sha256Hex(canonical({ tree: treeSha, parent: currentHead, message, created_at: createdAt, org }));
  const totalBytes = entries.reduce((s, e) => s + e.size, 0);
  const { data: c, error } = await admin
    .from("vault_commits")
    .insert({
      repo_id: r.id,
      org_id: org,
      sha,
      parent_sha: currentHead,
      tree_sha: treeSha,
      message,
      entries,
      meta: body.meta && typeof body.meta === "object" ? body.meta : {},
      file_count: entries.length,
      total_bytes: totalBytes,
      author_key: ctx.principal.keyId,
      created_at: createdAt,
    })
    .select("*")
    .single();
  if (error || !c) throw new ApiError(500, "db_error", "The commit could not be written.");
  const { data: advanced } = await admin.rpc("vault_advance_branch", { p_repo: r.id, p_org: org, p_branch: branch, p_expected_head: currentHead, p_new_head: sha });
  if (advanced !== true) {
    await admin.from("vault_commits").delete().eq("id", c.id);
    throw new ApiError(409, "head_moved", "Another writer advanced this branch first. Retry.", { branch });
  }
  return json({ ...commitView(c), branch, unchanged: false }, 201, ctx.headers);
}

async function resolveRef(ctx: Ctx, repoId: string, ref: string | null, fallback: string): Promise<any | null> {
  const name = ref ?? fallback;
  if (/^[a-f0-9]{64}$/i.test(name)) {
    const { data } = await admin.from("vault_commits").select("*").eq("repo_id", repoId).eq("sha", name.toLowerCase()).maybeSingle();
    return data ?? null;
  }
  const { data: br } = await admin.from("vault_branches").select("head_sha").eq("repo_id", repoId).eq("name", name).maybeSingle();
  if (!br?.head_sha) return null;
  const { data } = await admin.from("vault_commits").select("*").eq("repo_id", repoId).eq("sha", br.head_sha).maybeSingle();
  return data ?? null;
}

async function history(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const limit = Math.min(Math.max(Number(ctx.url.searchParams.get("limit") ?? 50), 1), 500);
  const head = await resolveRef(ctx, r.id, ctx.url.searchParams.get("ref"), r.default_branch);
  if (!head) return json({ object: "list", data: [] }, 200, ctx.headers);
  const { data: all } = await admin.from("vault_commits").select("id,sha,parent_sha,tree_sha,message,file_count,total_bytes,meta,created_at").eq("repo_id", r.id).order("created_at", { ascending: false }).limit(5000);
  const bySha = new Map((all ?? []).map((c: any) => [c.sha, c]));
  const out: any[] = [];
  let cur: any = bySha.get(head.sha) ?? head;
  while (cur && out.length < limit) {
    out.push(commitView(cur));
    cur = cur.parent_sha ? bySha.get(cur.parent_sha) : null;
  }
  return json({ object: "list", data: out }, 200, ctx.headers);
}

async function showCommit(ctx: Ctx, id: string, sha: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const c = await resolveRef(ctx, r.id, sha, r.default_branch);
  if (!c) throw new ApiError(404, "not_found", "No such commit.");
  return json(commitView(c, true), 200, ctx.headers);
}

async function tree(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const c = await resolveRef(ctx, r.id, ctx.url.searchParams.get("ref"), r.default_branch);
  if (!c) return json({ object: "vault.tree", ref: ctx.url.searchParams.get("ref") ?? r.default_branch, commit: null, entries: [] }, 200, ctx.headers);
  return json({ object: "vault.tree", ref: ctx.url.searchParams.get("ref") ?? r.default_branch, commit: commitView(c), entries: c.entries }, 200, ctx.headers);
}

async function diff(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const from = await resolveRef(ctx, r.id, ctx.url.searchParams.get("from"), r.default_branch);
  const to = await resolveRef(ctx, r.id, ctx.url.searchParams.get("to"), r.default_branch);
  if (!to) throw new ApiError(404, "not_found", "`to` does not resolve to a commit.");
  const a = new Map<string, Entry>((from?.entries ?? []).map((e: Entry) => [e.path, e]));
  const b = new Map<string, Entry>((to.entries ?? []).map((e: Entry) => [e.path, e]));
  const added: Entry[] = [], removed: Entry[] = [], modified: Array<{ path: string; before: string; after: string; size: number }> = [];
  for (const [p, e] of b) {
    const prev = a.get(p);
    if (!prev) added.push(e);
    else if (prev.hash !== e.hash) modified.push({ path: p, before: prev.hash, after: e.hash, size: e.size });
  }
  for (const [p, e] of a) if (!b.has(p)) removed.push(e);
  return json({ object: "vault.diff", from: from?.sha ?? null, to: to.sha, added, removed, modified, summary: { added: added.length, removed: removed.length, modified: modified.length } }, 200, ctx.headers);
}

async function listBranches(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:read");
  const r = await getRepo(ctx, id);
  const { data } = await admin.from("vault_branches").select("name,head_sha,updated_at").eq("repo_id", r.id).order("name");
  return json({ object: "list", default_branch: r.default_branch, data: data ?? [] }, 200, ctx.headers);
}

async function createBranch(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "vault:write");
  const r = await getRepo(ctx, id);
  const body = await readJson<{ name?: string; from?: string }>(ctx.req);
  const name = String(body.name ?? "");
  if (!/^[A-Za-z0-9._/-]{1,80}$/.test(name)) throw new ApiError(422, "invalid_branch", "Branch names may use letters, digits, `._/-` (max 80).");
  const src = await resolveRef(ctx, r.id, body.from ?? null, r.default_branch);
  const { data: existing } = await admin.from("vault_branches").select("name").eq("repo_id", r.id).eq("name", name).maybeSingle();
  if (existing) throw new ApiError(409, "branch_exists", "That branch already exists.");
  const { error } = await admin.from("vault_branches").insert({ repo_id: r.id, org_id: ctx.principal.orgId, name, head_sha: src?.sha ?? null });
  if (error) throw new ApiError(500, "db_error", "The branch could not be created.");
  return json({ object: "vault.branch", name, head_sha: src?.sha ?? null }, 201, ctx.headers);
}

// ── Router ──────────────────────────────────────────────────────────────────

async function route(ctx: Ctx): Promise<Response> {
  const { req, parts } = ctx;
  const m = req.method;
  const [p0, p1, p2, p3, p4] = parts;

  if (parts.length === 0 && m === "GET") return json(descriptor(), 200, ctx.headers);
  if (p0 === "me" && m === "GET") return me(ctx);

  if (p0 === "provenance") {
    if (p1 === "verify" && !p2 && m === "POST") return verify(ctx);
    if (p1 === "verify" && p2 === "batch" && m === "POST") return verifyBatch(ctx);
    if (p1 === "formats" && m === "GET") return formats(ctx);
    if (p1 === "chain" && m === "GET") return chainVerify(ctx);
    if (p1 === "assets") {
      if (!p2) return m === "POST" ? registerAsset(ctx) : m === "GET" ? listAssets(ctx) : methodNotAllowed();
      if (!p3 && m === "GET") return showAsset(ctx, p2);
      if (p3 === "issue" && m === "POST") return issue(ctx, p2);
      if (p3 === "detect" && !p4 && m === "POST") return detect(ctx, p2);
      if (p3 === "detect" && p4 === "batch" && m === "POST") return detectBatch(ctx, p2);
      if (p3 === "issuances" && m === "GET") return listIssuances(ctx, p2);
      if (p3 === "ledger" && m === "GET") return ledger(ctx, p2);
    }
  }

  if (p0 === "vault" && p1 === "repos") {
    if (!p2) return m === "POST" ? createRepo(ctx) : m === "GET" ? listRepos(ctx) : methodNotAllowed();
    if (!p3 && m === "GET") return showRepo(ctx, p2);
    if (p3 === "blobs") {
      if (!p4) return m === "POST" ? uploadBlob(ctx, p2) : methodNotAllowed();
      if (p4 === "exists" && m === "POST") return blobsExist(ctx, p2);
      if (m === "GET") return getBlob(ctx, p2, p4);
    }
    if (p3 === "commits") {
      if (!p4) return m === "POST" ? commit(ctx, p2) : m === "GET" ? history(ctx, p2) : methodNotAllowed();
      if (m === "GET") return showCommit(ctx, p2, p4);
    }
    if (p3 === "tree" && m === "GET") return tree(ctx, p2);
    if (p3 === "diff" && m === "GET") return diff(ctx, p2);
    if (p3 === "branches") return m === "POST" ? createBranch(ctx, p2) : m === "GET" ? listBranches(ctx, p2) : methodNotAllowed();
  }

  throw new ApiError(404, "route_not_found", `No route for ${m} /v1/${parts.join("/")}.`);
}

function methodNotAllowed(): never {
  throw new ApiError(405, "method_not_allowed", "That method is not supported on this route.");
}

function productOf(parts: string[]): "provenance" | "vault" | "platform" {
  return parts[0] === "provenance" ? "provenance" : parts[0] === "vault" ? "vault" : "platform";
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/api-v1/, "").replace(/^\/functions\/v1\/api-v1/, "");
  if (!path.startsWith("/v1")) path = `/v1${path}`;
  const parts = path.replace(/^\/v1/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const headers = baseHeaders(requestId);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (parts[0] === "openapi.json" && req.method === "GET") return json(openapiDocument(PUBLIC_BASE), 200, headers);
  if (parts.length === 0 && req.method === "GET" && !req.headers.get("authorization") && !req.headers.get("x-api-key")) {
    return json(descriptor(), 200, headers);
  }

  let principal: Principal | null = null;
  const agent = req.headers.get("user-agent") ?? "";
  try {
    principal = await authenticate(req);
    const ctx: Ctx = { req, requestId, principal, url, parts, headers: baseHeaders(requestId, principal), bytesIn: Number(req.headers.get("content-length") ?? 0) };
    const res = await route(ctx);
    const bytesOut = Number(res.headers.get("content-length") ?? 0);
    recordCall({ principal, method: req.method, path, status: res.status, startedAt, bytesIn: ctx.bytesIn, bytesOut, agent, requestId, product: productOf(parts) });
    return res;
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(500, "internal_error", "Something went wrong on our side. The request id is attached; contact support with it.");
    if (!(e instanceof ApiError)) console.error(requestId, e);
    recordCall({ principal, method: req.method, path, status: err.status, startedAt, bytesIn: Number(req.headers.get("content-length") ?? 0), bytesOut: 0, agent, requestId, product: productOf(parts), detail: { code: err.code } });
    const h = baseHeaders(requestId, principal);
    if (err.status === 429) h["Retry-After"] = "60";
    if (err.status === 401) h["WWW-Authenticate"] = 'Bearer realm="vybz-api"';
    return json(errorBody(err, requestId), err.status, h);
  }
});
