// VYBZ public API — one gateway for Provenance and Vault.
//
//   Base URL (production):  https://vybz.cloud/v1     (Vercel rewrite → this function)
//   Direct:                 https://<ref>.supabase.co/functions/v1/api-v1/v1
//   Auth:                   Authorization: Bearer vybz_live_<48 hex>
//   Deploy:                 supabase functions deploy api-v1 --no-verify-jwt
//   Secrets:                WM_SECRET (required), C2PA_WORKER_URL + C2PA_WORKER_TOKEN (optional)
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
import { deriveKey, detectChannel, embedChannel, encodeWav, parseWav } from "../_shared/watermark.mjs";

const WM_SECRET = Deno.env.get("WM_SECRET") ?? "";
const C2PA_WORKER_URL = Deno.env.get("C2PA_WORKER_URL") ?? "";
const C2PA_WORKER_TOKEN = Deno.env.get("C2PA_WORKER_TOKEN") ?? "";
const PUBLIC_BASE = Deno.env.get("API_PUBLIC_BASE") ?? "https://vybz.cloud/v1";

const MAX_AUDIO_BYTES = 200 * 1_048_576;
const MAX_BLOB_BYTES = 500 * 1_048_576;
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
  const { data: key } = await admin
    .from("api_keys")
    .select("id,name,prefix,scopes,rate_limit_per_min,created_at,expires_at")
    .eq("id", ctx.principal.keyId)
    .single();
  return json({ object: "org", org, key }, 200, ctx.headers);
}

// ── Provenance ──────────────────────────────────────────────────────────────

async function registerAsset(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:write");
  await planCheck(ctx, "storage");
  const bytes = await readBinary(ctx.req, MAX_AUDIO_BYTES);
  ctx.bytesIn = bytes.byteLength;
  const wav = parseWav(bytes);
  if (!wav) throw new ApiError(422, "unsupported_audio", "Only PCM WAV (16/24/32-bit or float) is accepted for registration.");
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

  const path = `${ctx.principal.orgId}/${sha.slice(0, 2)}/${sha}.wav`;
  const up = await admin.storage.from(ORIGINALS).upload(path, bytes, { contentType: "audio/wav", upsert: true });
  if (up.error) throw new ApiError(500, "storage_error", "The original could not be stored.");

  const frames = wav.channels[0]?.length ?? 0;
  const { data: row, error } = await admin
    .from("provenance_assets")
    .insert({
      org_id: ctx.principal.orgId,
      title,
      external_ref: externalRef,
      sha256: sha,
      storage_path: path,
      bytes: bytes.byteLength,
      mime: "audio/wav",
      sample_rate: wav.sampleRate,
      channels: wav.channels.length,
      duration_sec: wav.sampleRate ? Number((frames / wav.sampleRate).toFixed(3)) : null,
      created_by_key: ctx.principal.keyId,
    })
    .select("*")
    .single();
  if (error || !row) throw new ApiError(500, "db_error", "The asset record could not be created.");
  await chain(ctx, row.id, "register", { sha256: sha, bytes: bytes.byteLength, title });
  ctx.headers["X-VYBZ-SHA256"] = sha;
  return json({ ...assetView(row), existed: false }, 201, ctx.headers);
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
  const wav = parseWav(new Uint8Array(await dl.data.arrayBuffer()));
  if (!wav) throw new ApiError(500, "corrupt_original", "The stored original is not a readable WAV.");

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
  const { data: iss, error } = await admin
    .from("provenance_issuances")
    .insert({
      org_id: ctx.principal.orgId,
      asset_id: a.id,
      recipient,
      license,
      watermark_id: watermarkId,
      delivered_sha256: deliveredSha,
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

/**
 * Attribution decision. Two independent tests, either suffices:
 *  • absolute: top score above the empirical floor and well clear of the runner-up;
 *  • relative: top score is a statistical outlier against every other candidate
 *    (z-score over the rest plus never-issued decoy keys), which is what a true
 *    recipient looks like when the material is tonal or short and absolute scores
 *    run low. Decoys make the test valid even with a single real candidate.
 */
function decide(
  matches: Array<{ issuance_id: string; recipient: string; watermark_id: string; score: number; exact: boolean }>,
  exact: boolean,
  decoys: number[] = [],
): { attributed: (typeof matches)[number] | null; confidence: "exact" | "high" | "medium" | "none"; statistics: Record<string, number | null> } {
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

async function detect(ctx: Ctx, id: string) {
  requireScope(ctx.principal, "provenance:detect");
  if (!WM_SECRET) throw new ApiError(503, "not_configured", "Watermark detection is not configured on this deployment.");
  await planCheck(ctx, "detect");
  const a = await getAsset(ctx, id);
  const bytes = await readBinary(ctx.req, MAX_AUDIO_BYTES);
  ctx.bytesIn = bytes.byteLength;
  const wav = parseWav(bytes);
  if (!wav) throw new ApiError(422, "unsupported_audio", "Send the suspect file as PCM WAV. Decode compressed formats before calling.");
  const suspectSha = await sha256Hex(bytes);

  const { data: issuances } = await admin
    .from("provenance_issuances")
    .select("id,recipient,watermark_id,delivered_sha256,created_at")
    .eq("asset_id", a.id)
    .limit(5000);
  if (!issuances?.length) {
    await chain(ctx, a.id, "detect", { suspect_sha256: suspectSha, candidates: 0, attributed: null });
    return json({ object: "provenance.detection", asset_id: a.id, suspect_sha256: suspectSha, attributed: null, matches: [], note: "No issuances exist for this asset yet." }, 200, ctx.headers);
  }

  // Exact byte match short-circuits the correlation.
  const exact = issuances.find((i: any) => i.delivered_sha256 === suspectSha);
  const signals = wav.channels.map((c) => Float64Array.from(c));
  const matches: Array<{ issuance_id: string; recipient: string; watermark_id: string; score: number; exact: boolean }> = [];
  for (const i of issuances as any[]) {
    const key = await deriveKey(WM_SECRET, `${ctx.principal.orgId}|${a.id}|${i.recipient}|${i.watermark_id}`);
    let sum = 0;
    for (const sig of signals) sum += detectChannel(sig, key);
    const score = sum / signals.length;
    matches.push({ issuance_id: i.id, recipient: i.recipient, watermark_id: i.watermark_id, score: Number(score.toFixed(6)), exact: i.id === exact?.id });
  }
  matches.sort((x, y) => y.score - x.score);
  // Null distribution: decoy keys that were never issued. They give the z-test a
  // stable population even when only one or two real candidates exist.
  const decoys: number[] = [];
  for (let d = matches.length; d < 12; d++) {
    const key = await deriveKey(WM_SECRET, `decoy|${ctx.principal.orgId}|${a.id}|${d}|${suspectSha}`);
    let sum = 0;
    for (const sig of signals) sum += detectChannel(sig, key);
    decoys.push(sum / signals.length);
  }
  const decision = decide(matches, Boolean(exact), decoys);
  const attributed = exact ? matches.find((m) => m.exact) ?? null : decision.attributed;
  const confidence = exact ? "exact" : decision.confidence;

  await chain(ctx, a.id, "detect", { suspect_sha256: suspectSha, candidates: matches.length, attributed: attributed?.issuance_id ?? null, confidence });
  return json(
    {
      object: "provenance.detection",
      asset_id: a.id,
      suspect_sha256: suspectSha,
      attributed,
      confidence,
      statistics: decision.statistics,
      matches: matches.slice(0, 25),
      candidates: matches.length,
    },
    200,
    ctx.headers,
  );
}

async function verify(ctx: Ctx) {
  requireScope(ctx.principal, "provenance:read");
  const bytes = await readBinary(ctx.req, MAX_AUDIO_BYTES);
  ctx.bytesIn = bytes.byteLength;
  const sha = await sha256Hex(bytes);
  const org = ctx.principal.orgId;

  const { data: original } = await admin.from("provenance_assets").select("*").eq("org_id", org).eq("sha256", sha).maybeSingle();
  const { data: issuance } = await admin
    .from("provenance_issuances")
    .select("*, provenance_assets!inner(id,title,org_id)")
    .eq("org_id", org)
    .eq("delivered_sha256", sha)
    .maybeSingle();

  const known = Boolean(original || issuance);
  await chain(ctx, original?.id ?? issuance?.asset_id ?? null, "verify", { sha256: sha, known, kind: original ? "original" : issuance ? "issued_copy" : "unknown" });
  return json(
    {
      object: "provenance.verification",
      sha256: sha,
      known,
      kind: original ? "original" : issuance ? "issued_copy" : "unknown",
      asset: original ? assetView(original) : issuance ? { id: issuance.asset_id, title: issuance.provenance_assets?.title } : null,
      issuance: issuance ? issuanceView(issuance) : null,
      hint: known ? null : "No exact match. If you know which asset this may derive from, call POST /provenance/assets/{id}/detect for blind watermark correlation.",
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
    if (p1 === "verify" && m === "POST") return verify(ctx);
    if (p1 === "chain" && m === "GET") return chainVerify(ctx);
    if (p1 === "assets") {
      if (!p2) return m === "POST" ? registerAsset(ctx) : m === "GET" ? listAssets(ctx) : methodNotAllowed();
      if (!p3 && m === "GET") return showAsset(ctx, p2);
      if (p3 === "issue" && m === "POST") return issue(ctx, p2);
      if (p3 === "detect" && m === "POST") return detect(ctx, p2);
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
