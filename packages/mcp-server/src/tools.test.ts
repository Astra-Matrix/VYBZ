// The MCP tool surface, exercised end to end over the SDK's in-memory
// transport: a real MCP client talks to a real McpServer whose tools are
// registered against a recording fake of the VYBZ API client. Nothing here
// touches the network.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { VybzApiError, VybzClient, sha256 } from "./client.js";
import { guard, privateHost, registerTools, type ToolError, type ToolOptions } from "./tools.js";

type Call = { method: string; args: unknown[] };

/** A VybzClient stand-in that records every call and answers with canned data. */
function fakeClient(answers: Partial<Record<keyof VybzClient, unknown>> = {}) {
  const calls: Call[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "base") return "https://vybz.test/v1";
      return async (...args: unknown[]) => {
        calls.push({ method: prop, args });
        const a = answers[prop as keyof VybzClient];
        if (a instanceof Error) throw a;
        if (typeof a === "function") return (a as (...x: unknown[]) => unknown)(...args);
        return a ?? { ok: true, method: prop };
      };
    },
  };
  return { client: new Proxy({}, handler) as unknown as VybzClient, calls };
}

async function connect(client: VybzClient, opts: ToolOptions) {
  const server = new McpServer({ name: "vybz-test", version: "0.0.0" });
  registerTools(server, client, opts);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test-agent", version: "0.0.0" });
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    const text = r.content?.[0]?.text ?? "";
    // Tool bodies are JSON; schema rejections come from the SDK as plain "MCP error -32602: …" text.
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      body = { error: "invalid_arguments", message: text };
    }
    return { isError: Boolean(r.isError), body };
  };
  const close = async () => {
    await mcp.close();
    await server.close();
  };
  return { mcp, call, close };
}

const UUID = "0b7f2c1e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const HASH = "a".repeat(64);
const HOSTED_ONLY = ["vault_commit_folder", "vault_restore", "vault_status"];

describe("tool registry", () => {
  it("hosted mode lists every tool except the filesystem ones, each with annotations", async () => {
    const { client } = fakeClient();
    const { mcp, close } = await connect(client, { filesystem: false });
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "provenance_chain_verify", "provenance_detect", "provenance_formats", "provenance_get_asset", "provenance_issue", "provenance_ledger",
        "provenance_list_assets", "provenance_list_issuances", "provenance_register", "provenance_verify",
        "vault_blob_exists", "vault_blob_link", "vault_branches", "vault_commit_entries", "vault_create_branch", "vault_create_repo", "vault_diff",
        "vault_get_commit", "vault_get_repo", "vault_history", "vault_list_repos", "vault_tree", "vault_upload_blob",
        "vybz_whoami", "webhook_deliveries", "webhooks_create", "webhooks_delete", "webhooks_list", "webhooks_test", "webhooks_update",
      ].sort(),
    );
    for (const t of tools) {
      expect(t.description, `${t.name} needs a description`).toBeTruthy();
      const a = t.annotations ?? {};
      for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof a[k], `${t.name}.${k}`).toBe("boolean");
      }
    }
    await close();
  });

  it("local mode adds the folder tools", async () => {
    const { client } = fakeClient();
    const { mcp, close } = await connect(client, { filesystem: true });
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    for (const n of HOSTED_ONLY) expect(names).toContain(n);
    await close();
  });

  it("marks reads read-only, deletes destructive, and detection as metered (not read-only, not idempotent)", async () => {
    const { client } = fakeClient();
    const { mcp, close } = await connect(client, { filesystem: true });
    const by = Object.fromEntries((await mcp.listTools()).tools.map((t) => [t.name, t.annotations ?? {}]));
    expect(by.vybz_whoami.readOnlyHint).toBe(true);
    expect(by.vault_tree.readOnlyHint).toBe(true);
    expect(by.vault_status.readOnlyHint).toBe(true);
    expect(by.provenance_verify.readOnlyHint).toBe(true);
    expect(by.provenance_detect.readOnlyHint).toBe(false);
    expect(by.provenance_detect.idempotentHint).toBe(false);
    expect(by.provenance_issue.idempotentHint).toBe(false);
    expect(by.webhooks_delete.destructiveHint).toBe(true);
    expect(by.vault_restore.destructiveHint).toBe(true);
    expect(by.vault_commit_folder.destructiveHint).toBe(false);
    expect(by.webhooks_create.openWorldHint).toBe(true);
    expect(by.provenance_register.openWorldHint).toBe(true);
    expect(by.vault_list_repos.openWorldHint).toBe(false);
    await close();
  });
});

describe("error envelope", () => {
  it("carries the API's code, status, request id, and extra details", async () => {
    const err = new VybzApiError(403, "insufficient_scope", "This key lacks the `vault:write` scope.", "req_1", { required_scope: "vault:write" });
    const { client } = fakeClient({ createRepo: err });
    const { call, close } = await connect(client, { filesystem: false });
    const r = await call("vault_create_repo", { name: "x" });
    expect(r.isError).toBe(true);
    const body = r.body as ToolError;
    expect(body).toEqual({ error: "insufficient_scope", message: "This key lacks the `vault:write` scope.", status: 403, request_id: "req_1", details: { required_scope: "vault:write" } });
    await close();
  });

  it("reports local failures as tool_error without a status", async () => {
    const { client } = fakeClient({ me: new Error("socket hang up") });
    const { call, close } = await connect(client, { filesystem: false });
    const r = await call("vybz_whoami");
    expect(r.isError).toBe(true);
    expect(r.body).toEqual({ error: "tool_error", message: "socket hang up" });
    await close();
  });

  it("rejects arguments that fail the schema before touching the API", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    const r = await call("provenance_get_asset", { asset_id: "not-a-uuid" });
    expect(r.isError).toBe(true);
    expect(String((r.body as ToolError).message)).toMatch(/asset_id/);
    expect(calls).toHaveLength(0);
    await close();
  });
});

describe("hosted mode input handling", () => {
  it("refuses local paths with a message that names the alternatives", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    for (const [tool, args] of [
      ["provenance_verify", { file: "C:/x.wav" }],
      ["provenance_detect", { asset_id: UUID, files: ["C:/x.wav"] }],
      ["provenance_register", { file: "C:/x.wav" }],
      ["vault_upload_blob", { repo: "r", file: "C:/x.wav" }],
      ["provenance_issue", { asset_id: UUID, recipient: "a@b.c", output_file: "C:/out.wav" }],
    ] as const) {
      const r = await call(tool, args as Record<string, unknown>);
      expect(r.isError, tool).toBe(true);
      expect(String((r.body as ToolError).message), tool).toMatch(/hosted server/);
    }
    expect(calls).toHaveLength(0);
    await close();
  });

  it("refuses private and local hosts for URL fetches, before any network call", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    for (const url of ["http://localhost:8080/a.wav", "http://127.0.0.1/a.wav", "http://10.0.0.5/a.wav", "http://169.254.169.254/latest", "http://metadata.google.internal/x", "http://192.168.1.10/a.wav"]) {
      const r = await call("provenance_register", { url });
      expect(r.isError, url).toBe(true);
      expect(String((r.body as ToolError).message), url).toMatch(/private or local/);
    }
    expect(calls).toHaveLength(0);
    await close();
  });

  it("forwards URLs for verify and detect to the API's batch route with the options as query", async () => {
    const { client, calls } = fakeClient({ verifyUrls: { data: [], summary: {} }, detectUrls: { data: [], summary: {} } });
    const { call, close } = await connect(client, { filesystem: false });
    await call("provenance_verify", { urls: ["https://cdn.example.com/a.mp3", "https://cdn.example.com/b.mp3"], attribute: true, asset_id: UUID });
    await call("provenance_detect", { asset_id: UUID, url: "https://cdn.example.com/leak.mp3" });
    expect(calls[0]).toEqual({
      method: "verifyUrls",
      args: [[{ url: "https://cdn.example.com/a.mp3", name: "https://cdn.example.com/a.mp3" }, { url: "https://cdn.example.com/b.mp3", name: "https://cdn.example.com/b.mp3" }], { attribute: true, asset: UUID }],
    });
    expect(calls[1]).toEqual({ method: "detectUrls", args: [UUID, [{ url: "https://cdn.example.com/leak.mp3", name: "https://cdn.example.com/leak.mp3" }]] });
    await close();
  });

  it("sends base64 as a single-file verify with the bytes decoded", async () => {
    const { client, calls } = fakeClient({ verify: { verdict: "unknown" } });
    const { call, close } = await connect(client, { filesystem: false });
    const r = await call("provenance_verify", { base64: Buffer.from("RIFF....").toString("base64") });
    expect(r.isError).toBe(false);
    expect(calls[0].method).toBe("verify");
    expect(Buffer.from(calls[0].args[0] as Uint8Array).toString()).toBe("RIFF....");
    expect(calls[0].args[1]).toEqual({ attribute: undefined, asset: undefined, name: "base64" });
    await close();
  });

  it("refuses a call that mixes files and URLs, and one with no input at all", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    const mixed = await call("provenance_verify", { base64: "AAAA", url: "https://cdn.example.com/a.mp3" });
    expect(mixed.isError).toBe(true);
    expect((mixed.body as ToolError).message).toMatch(/not both/);
    const none = await call("provenance_verify", {});
    expect(none.isError).toBe(true);
    expect((none.body as ToolError).message).toMatch(/Provide/);
    expect(calls).toHaveLength(0);
    await close();
  });

  it("issues a download link, never bytes, and passes the request through unchanged", async () => {
    const { client, calls } = fakeClient({ issueLink: { id: "iss_1", download: { url: "https://signed" } } });
    const { call, close } = await connect(client, { filesystem: false });
    const r = await call("provenance_issue", { asset_id: UUID, recipient: "partner@example.com", license: "preview", c2pa: false });
    expect(r.body).toEqual({ id: "iss_1", download: { url: "https://signed" } });
    expect(calls).toEqual([{ method: "issueLink", args: [UUID, { recipient: "partner@example.com", license: "preview", c2pa: false }] }]);
    await close();
  });

  it("commits only the fields the API accepts and lowercases commit shas", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    await call("vault_commit_entries", { repo: "midnight", branch: "main", message: "m", entries: [{ path: "a.wav", hash: HASH, size: 1 }], parent: null });
    await call("vault_get_commit", { repo: "midnight", sha: HASH.toUpperCase() });
    expect(calls[0]).toEqual({ method: "commit", args: ["midnight", { branch: "main", message: "m", entries: [{ path: "a.wav", hash: HASH, size: 1 }], parent: null, meta: undefined }] });
    expect(calls[1]).toEqual({ method: "commitDetail", args: ["midnight", HASH] });
    await close();
  });

  it("routes a delivery retry and a delivery listing through webhook_deliveries", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: false });
    await call("webhook_deliveries", { id: UUID, status: "failed" });
    await call("webhook_deliveries", { id: UUID, retry_delivery_id: UUID });
    expect(calls[0]).toEqual({ method: "webhookDeliveries", args: [UUID, "failed", 50] });
    expect(calls[1]).toEqual({ method: "retryDelivery", args: [UUID, UUID] });
    await close();
  });
});

describe("local mode filesystem tools", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vybz-mcp-"));
    await mkdir(join(dir, "project", "Samples"), { recursive: true });
    await mkdir(join(dir, "project", "Backup"), { recursive: true });
    await writeFile(join(dir, "project", "song.als"), "als-bytes");
    await writeFile(join(dir, "project", "Samples", "kick.wav"), "kick-bytes");
    await writeFile(join(dir, "project", "Samples", "kick copy.wav"), "kick-bytes"); // duplicate content
    await writeFile(join(dir, "project", "Backup", "old.als"), "ignored");
    await writeFile(join(dir, "project", "song.als.tmp"), "ignored");
    await writeFile(join(dir, "outside.wav"), "outside");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("guard admits paths under a root, including the root itself, and refuses everything else", () => {
    const root = join(dir, "project");
    expect(guard([root], root)).toBe(resolve(root));
    expect(guard([root], join(root, "Samples", "kick.wav"))).toBe(resolve(root, "Samples", "kick.wav"));
    expect(() => guard([root], join(dir, "outside.wav"))).toThrow(/outside the allowed roots/);
    expect(() => guard([root], root + "-sibling")).toThrow(/outside the allowed roots/);
    expect(() => guard([root], join(root, "..", "outside.wav"))).toThrow(/outside the allowed roots/);
    expect(guard([], join(dir, "outside.wav"))).toBe(resolve(dir, "outside.wav"));
    if (process.platform === "win32") {
      expect(guard([root.toUpperCase()], join(root, "song.als").toLowerCase())).toBe(resolve(root, "song.als").toLowerCase());
    }
  });

  it("vault_commit_folder dry run hashes the tree, skips backups and temp files, and deduplicates", async () => {
    const { client, calls } = fakeClient({ blobsExist: (_repo: unknown, hashes: string[]) => ({ present: [], missing: hashes }) });
    const { call, close } = await connect(client, { filesystem: true, roots: [dir] });
    const r = await call("vault_commit_folder", { repo: "midnight", folder: join(dir, "project"), dry_run: true });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ dry_run: true, files: 3, to_upload: 2, total_bytes: 29, upload_bytes: 19 });
    // One upload per distinct hash; the first path in sorted order represents the duplicate pair.
    expect((r.body as { sample: string[] }).sample.sort()).toEqual(["Samples/kick copy.wav", "song.als"]);
    expect(calls.map((c) => c.method)).toEqual(["blobsExist"]);
    expect(new Set(calls[0].args[1] as string[])).toEqual(new Set([sha256(Buffer.from("als-bytes")), sha256(Buffer.from("kick-bytes"))]));
    await close();
  });

  it("vault_commit_folder uploads only missing blobs, then commits the complete sorted tree", async () => {
    const kick = sha256(Buffer.from("kick-bytes"));
    const als = sha256(Buffer.from("als-bytes"));
    const { client, calls } = fakeClient({
      blobsExist: () => ({ present: [kick], missing: [als] }),
      uploadBlob: { hash: als, size: 9, existed: false },
      commit: { sha: "c1", unchanged: false },
    });
    const { call, close } = await connect(client, { filesystem: true, roots: [dir] });
    const r = await call("vault_commit_folder", { repo: "midnight", folder: join(dir, "project"), message: "end of day", meta: { daw: "ableton" } });
    expect(r.body).toMatchObject({ commit: { sha: "c1" }, files: 3, uploaded: 1, upload_bytes: 9, deduplicated: 2 });
    const uploads = calls.filter((c) => c.method === "uploadBlob");
    expect(uploads).toHaveLength(1);
    expect(Buffer.from(uploads[0].args[1] as Uint8Array).toString()).toBe("als-bytes");
    const commit = calls.find((c) => c.method === "commit")!;
    expect(commit.args[1]).toEqual({
      branch: undefined,
      message: "end of day",
      entries: [
        { path: "Samples/kick copy.wav", hash: kick, size: 10 },
        { path: "Samples/kick.wav", hash: kick, size: 10 },
        { path: "song.als", hash: als, size: 9 },
      ],
      meta: { daw: "ableton" },
    });
    await close();
  });

  it("vault_status reports added, modified, and deleted paths against the remote tree", async () => {
    const kick = sha256(Buffer.from("kick-bytes"));
    const { client } = fakeClient({
      tree: { commit: { sha: "c0" }, entries: [{ path: "Samples/kick.wav", hash: kick, size: 10 }, { path: "song.als", hash: "b".repeat(64), size: 1 }, { path: "gone.wav", hash: "c".repeat(64), size: 1 }] },
    });
    const { call, close } = await connect(client, { filesystem: true, roots: [dir] });
    const r = await call("vault_status", { repo: "midnight", folder: join(dir, "project") });
    expect(r.body).toEqual({ ref: "default", head: { sha: "c0" }, clean: false, added: ["Samples/kick copy.wav"], modified: ["song.als"], deleted: ["gone.wav"] });
    await close();
  });

  it("every filesystem tool refuses a path outside VYBZ_ROOTS before calling the API", async () => {
    const { client, calls } = fakeClient();
    const { call, close } = await connect(client, { filesystem: true, roots: [join(dir, "project")] });
    const outside = join(dir, "outside.wav");
    for (const [tool, args] of [
      ["provenance_register", { file: outside }],
      ["provenance_verify", { file: outside }],
      ["provenance_detect", { asset_id: UUID, files: [outside] }],
      ["vault_upload_blob", { repo: "r", file: outside }],
      ["vault_commit_folder", { repo: "r", folder: dir }],
      ["vault_status", { repo: "r", folder: dir }],
      ["vault_restore", { repo: "r", folder: join(dir, "restore") }],
      ["provenance_issue", { asset_id: UUID, recipient: "x", output_file: join(dir, "out.wav") }],
    ] as const) {
      const r = await call(tool, args as Record<string, unknown>);
      expect(r.isError, tool).toBe(true);
      expect(String((r.body as ToolError).message), tool).toMatch(/outside the allowed roots/);
    }
    expect(calls).toHaveLength(0);
    await close();
  });

  it("reads a local file for verify and names it by basename", async () => {
    const { client, calls } = fakeClient({ verify: { verdict: "original" } });
    const { call, close } = await connect(client, { filesystem: true, roots: [dir] });
    const r = await call("provenance_verify", { file: join(dir, "project", "Samples", "kick.wav"), attribute: true });
    expect(r.body).toEqual({ verdict: "original" });
    expect(Buffer.from(calls[0].args[0] as Uint8Array).toString()).toBe("kick-bytes");
    expect(calls[0].args[1]).toEqual({ attribute: true, asset: undefined, name: "kick.wav" });
    await close();
  });
});

describe("privateHost", () => {
  it("classifies loopback, RFC 1918, link-local, CGNAT, and internal names as private", () => {
    for (const h of ["localhost", "a.localhost", "printer.local", "db.internal", "metadata.google.internal", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "[::1]", "::1"]) {
      expect(privateHost(h), h).toBe(true);
    }
    for (const h of ["vybz.cloud", "cdn.example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "xixmneooyufbeftdfpcm.supabase.co"]) {
      expect(privateHost(h), h).toBe(false);
    }
  });
});

describe("VybzClient", () => {
  const KEY = `vybz_live_${"0".repeat(48)}`;
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("refuses anything that is not an organization key", () => {
    expect(() => new VybzClient({ apiKey: "" })).toThrow(/organization API key/);
    expect(() => new VybzClient({ apiKey: "sk_live_abc" })).toThrow(/organization API key/);
    expect(() => new VybzClient({ apiKey: KEY })).not.toThrow();
  });

  it("sends the bearer key, user agent, and content hash, and parses error details", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ error: { code: "head_moved", message: "The branch head is not the parent you expected.", request_id: "req_9", docs: "https://vybz.cloud/docs/api#errors", branch: "main", head: "h1", expected: null } }), {
        status: 409,
        headers: { "content-type": "application/json", "x-request-id": "req_9" },
      });
    }) as typeof fetch;
    const c = new VybzClient({ apiKey: KEY, base: "https://vybz.test/v1/", userAgent: "vybz-mcp-test/1" });
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(c.uploadBlob("repo", bytes, "audio/wav")).rejects.toMatchObject({
      status: 409,
      code: "head_moved",
      requestId: "req_9",
      details: { branch: "main", head: "h1", expected: null },
    });
    expect(seen[0].url).toBe("https://vybz.test/v1/vault/repos/repo/blobs");
    const h = seen[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(h["User-Agent"]).toBe("vybz-mcp-test/1");
    expect(h["X-VYBZ-Content-SHA256"]).toBe(sha256(bytes));
    expect(h["X-VYBZ-Mime"]).toBe("audio/wav");
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    globalThis.fetch = (async () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway", headers: { "content-type": "text/plain" } })) as typeof fetch;
    const c = new VybzClient({ apiKey: KEY });
    await expect(c.me()).rejects.toMatchObject({ status: 502, code: "http_error", message: "502 Bad Gateway", details: undefined });
  });

  it("encodes verify options as query parameters and the name as a header", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const c = new VybzClient({ apiKey: KEY, base: "https://vybz.test/v1" });
    await c.verify(new Uint8Array([0]), { attribute: true, asset: UUID, name: "leak.mp3" });
    expect(url).toBe(`https://vybz.test/v1/provenance/verify?attribute=true&asset=${UUID}`);
    expect(headers["X-VYBZ-Name"]).toBe("leak.mp3");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });
});

