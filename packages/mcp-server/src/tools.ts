/**
 * MCP tool surface for VYBZ. One registration function serves both transports:
 *   • local (stdio) — has filesystem access: register files, commit folders, restore trees.
 *   • hosted (HTTP) — no filesystem: works with URLs and base64 payloads.
 *
 * Every tool returns compact JSON text so an agent can reason over it, and
 * never echoes the API key.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { join, relative, dirname, resolve, sep } from "node:path";
import { sha256, VybzApiError, type VybzClient } from "./client.js";

export interface ToolOptions {
  /** Allow tools that read and write the local filesystem. */
  filesystem: boolean;
  /** Restrict filesystem tools to paths under these roots (local mode). Empty = no restriction. */
  roots?: string[];
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown): ToolResult {
  if (e instanceof VybzApiError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: e.code, message: e.message, status: e.status, request_id: e.requestId }) }] };
  }
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "tool_error", message: e instanceof Error ? e.message : String(e) }) }] };
}

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

function guard(roots: string[] | undefined, p: string): string {
  const abs = resolve(p);
  if (!roots || roots.length === 0) return abs;
  const inside = roots.some((r) => {
    const base = resolve(r);
    return abs === base || abs.startsWith(base + sep);
  });
  if (!inside) throw new Error(`Path is outside the allowed roots: ${abs}`);
  return abs;
}

async function fetchBytes(url: string, max = 200 * 1_048_576): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not fetch ${url}: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength > max) throw new Error("Fetched file exceeds the size limit.");
  return buf;
}

function decodeInput(input: { url?: string; base64?: string }): Promise<Uint8Array> {
  if (input.base64) return Promise.resolve(new Uint8Array(Buffer.from(input.base64, "base64")));
  if (input.url) return fetchBytes(input.url);
  throw new Error("Provide `url` or `base64`.");
}

export function registerTools(server: McpServer, client: VybzClient, opts: ToolOptions): void {
  const fs = opts.filesystem;

  // ── Platform ──────────────────────────────────────────────────────────────
  server.registerTool(
    "vybz_whoami",
    { title: "Who am I", description: "Show the organization, plan, key name, and scopes behind the configured API key." },
    async () => run(() => client.me()),
  );

  // ── Provenance ────────────────────────────────────────────────────────────
  server.registerTool(
    "provenance_register",
    {
      title: "Register an original",
      description:
        "Register a PCM WAV as a provenance asset. Returns the asset id and SHA-256. Idempotent for identical bytes. " +
        (fs ? "Provide `file` (local path), `url`, or `base64`." : "Provide `url` or `base64`."),
      inputSchema: {
        file: z.string().optional().describe(fs ? "Local path to a .wav" : "Unavailable in hosted mode"),
        url: z.string().url().optional().describe("HTTPS URL of a .wav"),
        base64: z.string().optional().describe("Base64 WAV bytes (small files only)"),
        title: z.string().max(200).optional(),
        external_ref: z.string().max(200).optional().describe("Your own id for this recording"),
      },
    },
    async (a) =>
      run(async () => {
        const bytes = fs && a.file ? new Uint8Array(await readFile(guard(opts.roots, a.file))) : await decodeInput(a);
        return client.registerAsset(bytes, { title: a.title, externalRef: a.external_ref });
      }),
  );

  server.registerTool(
    "provenance_list_assets",
    { title: "List assets", description: "List registered provenance assets, newest first.", inputSchema: { limit: z.number().int().min(1).max(200).optional() } },
    async (a) => run(() => client.listAssets(a.limit ?? 50)),
  );

  server.registerTool(
    "provenance_get_asset",
    { title: "Get asset", description: "Fetch one asset with its issuance count.", inputSchema: { asset_id: z.string().uuid() } },
    async (a) => run(() => client.getAsset(a.asset_id)),
  );

  server.registerTool(
    "provenance_issue",
    {
      title: "Issue a watermarked copy",
      description:
        "Create a uniquely watermarked copy of an asset for a recipient. Returns the issuance record and a one-hour download link" +
        (fs ? ", or writes the WAV to `output_file` when given." : "."),
      inputSchema: {
        asset_id: z.string().uuid(),
        recipient: z.string().min(1).max(200).describe("Stable identifier for the receiving party (email, account id, partner)"),
        license: z.string().max(200).optional(),
        c2pa: z.boolean().optional().describe("Attach Content Credentials when the deployment supports it (default true)"),
        output_file: z.string().optional().describe(fs ? "Local path to write the delivered WAV" : "Unavailable in hosted mode"),
      },
    },
    async (a) =>
      run(async () => {
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
    "provenance_list_issuances",
    { title: "List issuances", description: "Every copy issued for an asset, with recipients and watermark ids.", inputSchema: { asset_id: z.string().uuid() } },
    async (a) => run(() => client.listIssuances(a.asset_id)),
  );

  server.registerTool(
    "provenance_ledger",
    { title: "Asset ledger", description: "Hash-chained event history for an asset (register, issue, c2pa, verify, detect).", inputSchema: { asset_id: z.string().uuid() } },
    async (a) => run(() => client.ledger(a.asset_id)),
  );

  server.registerTool(
    "provenance_verify",
    {
      title: "Verify a file",
      description: "Exact-hash verification: is this file a registered original or an issued copy, and for whom? " + (fs ? "Provide `file`, `url`, or `base64`." : "Provide `url` or `base64`."),
      inputSchema: { file: z.string().optional(), url: z.string().url().optional(), base64: z.string().optional() },
    },
    async (a) =>
      run(async () => {
        const bytes = fs && a.file ? new Uint8Array(await readFile(guard(opts.roots, a.file))) : await decodeInput(a);
        return client.verify(bytes);
      }),
  );

  server.registerTool(
    "provenance_detect",
    {
      title: "Attribute a leak",
      description:
        "Blind watermark correlation of a suspect WAV against every copy issued for an asset. Returns ranked candidates and the attributed recipient when decisive. " +
        (fs ? "Provide `file`, `url`, or `base64`." : "Provide `url` or `base64`."),
      inputSchema: { asset_id: z.string().uuid(), file: z.string().optional(), url: z.string().url().optional(), base64: z.string().optional() },
    },
    async (a) =>
      run(async () => {
        const bytes = fs && a.file ? new Uint8Array(await readFile(guard(opts.roots, a.file))) : await decodeInput(a);
        return client.detect(a.asset_id, bytes);
      }),
  );

  server.registerTool(
    "provenance_chain_verify",
    { title: "Verify ledger chain", description: "Recompute the organization's entire hash chain and report the first broken link, if any." },
    async () => run(() => client.chain()),
  );

  // ── Vault ─────────────────────────────────────────────────────────────────
  server.registerTool(
    "vault_create_repo",
    {
      title: "Create repository",
      description: "Create a content-addressed repository for a DAW project or sample library.",
      inputSchema: { name: z.string().min(1).max(120), slug: z.string().optional(), description: z.string().optional(), daw: z.string().optional().describe("ableton, fl-studio, logic, pro-tools, cubase, reaper, bitwig, other") },
    },
    async (a) => run(() => client.createRepo(a)),
  );

  server.registerTool("vault_list_repos", { title: "List repositories", description: "All repositories in the organization." }, async () => run(() => client.listRepos()));

  server.registerTool(
    "vault_get_repo",
    { title: "Get repository", description: "Repository with branches and commit count.", inputSchema: { repo: z.string().describe("Repo id or slug") } },
    async (a) => run(() => client.getRepo(a.repo)),
  );

  server.registerTool(
    "vault_history",
    { title: "Commit history", description: "Commits reachable from a ref, newest first.", inputSchema: { repo: z.string(), ref: z.string().optional().describe("Branch or sha"), limit: z.number().int().min(1).max(500).optional() } },
    async (a) => run(() => client.history(a.repo, a.ref, a.limit ?? 50)),
  );

  server.registerTool(
    "vault_tree",
    { title: "Tree at ref", description: "Full file list (path, hash, size) at a branch or commit.", inputSchema: { repo: z.string(), ref: z.string().optional() } },
    async (a) => run(() => client.tree(a.repo, a.ref)),
  );

  server.registerTool(
    "vault_diff",
    { title: "Diff refs", description: "Added, removed, and modified paths between two refs.", inputSchema: { repo: z.string(), from: z.string(), to: z.string() } },
    async (a) => run(() => client.diff(a.repo, a.from, a.to)),
  );

  server.registerTool(
    "vault_branches",
    { title: "Branches", description: "List branches and their heads.", inputSchema: { repo: z.string() } },
    async (a) => run(() => client.branches(a.repo)),
  );

  server.registerTool(
    "vault_create_branch",
    { title: "Create branch", description: "Create a branch from another branch or a commit.", inputSchema: { repo: z.string(), name: z.string(), from: z.string().optional() } },
    async (a) => run(() => client.createBranch(a.repo, a.name, a.from)),
  );

  server.registerTool(
    "vault_commit_entries",
    {
      title: "Commit a tree (entries)",
      description: "Commit an explicit tree. Every hash must already be uploaded (use vault_blob_exists / vault_upload_blob). Pass `parent` to require a specific head.",
      inputSchema: {
        repo: z.string(),
        branch: z.string().optional(),
        message: z.string().optional(),
        entries: z.array(z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0) })),
        parent: z.string().nullable().optional(),
        meta: z.record(z.unknown()).optional(),
      },
    },
    async (a) => run(() => client.commit(a.repo, a)),
  );

  server.registerTool(
    "vault_blob_exists",
    { title: "Check blobs", description: "Which of these SHA-256 hashes are already stored for the organization.", inputSchema: { repo: z.string(), hashes: z.array(z.string()).max(5000) } },
    async (a) => run(() => client.blobsExist(a.repo, a.hashes)),
  );

  server.registerTool(
    "vault_upload_blob",
    {
      title: "Upload blob",
      description: "Upload one file's bytes as a content-addressed blob. " + (fs ? "Provide `file`, `url`, or `base64`." : "Provide `url` or `base64`."),
      inputSchema: { repo: z.string(), file: z.string().optional(), url: z.string().url().optional(), base64: z.string().optional(), mime: z.string().optional() },
    },
    async (a) =>
      run(async () => {
        const bytes = fs && a.file ? new Uint8Array(await readFile(guard(opts.roots, a.file))) : await decodeInput(a);
        return client.uploadBlob(a.repo, bytes, a.mime);
      }),
  );

  server.registerTool(
    "vault_blob_link",
    { title: "Blob download link", description: "Mint a 15-minute download link for a blob by hash.", inputSchema: { repo: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) } },
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
    },
    async (a) =>
      run(async () => {
        const root = guard(opts.roots, a.folder);
        const files = await walk(root);
        const entries: Array<{ path: string; hash: string; size: number; abs: string }> = [];
        for (const f of files) {
          const bytes = new Uint8Array(await readFile(f.abs));
          entries.push({ path: f.path, hash: sha256(bytes), size: f.size, abs: f.abs });
        }
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
          await client.uploadBlob(a.repo, new Uint8Array(await readFile(e.abs)));
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
      description: "Download every file of a ref into a local folder, recreating the project layout. Existing files with the same hash are left untouched.",
      inputSchema: { repo: z.string(), ref: z.string().optional(), folder: z.string().describe("Destination folder") },
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
          const bytes = await fetchBytes(link.download.url, 2 * 1024 * 1_048_576);
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
