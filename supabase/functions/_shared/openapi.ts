// OpenAPI 3.1 description of the VYBZ public API. Served at GET /v1/openapi.json.
// Agents and SDK generators read this; keep it in step with api-v1/index.ts.
import { API_VERSION } from "./apiGateway.ts";

export function openapiDocument(base: string) {
  const bearer = [{ apiKey: [] }];
  const err = (desc: string) => ({ description: desc, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
  const jsonOf = (ref: string, desc = "OK") => ({ description: desc, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
  const wavBody = (desc: string) => ({ required: true, description: desc, content: { "audio/wav": { schema: { type: "string", format: "binary" } } } });
  const idParam = (name: string, desc: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description: desc });

  return {
    openapi: "3.1.0",
    info: {
      title: "VYBZ API",
      version: API_VERSION,
      summary: "Provenance and Vault for audio businesses.",
      description:
        "Two products behind one key.\n\n" +
        "**Provenance** registers audio originals, issues per-recipient forensically watermarked copies (optionally with C2PA Content Credentials), verifies any file against the organization's record, and attributes leaked copies to the recipient who received them.\n\n" +
        "**Vault** is content-addressed version control for DAW projects and sample libraries: upload blobs by hash, commit trees, branch, diff, and restore.\n\n" +
        "All calls are organization-scoped, audited, and rate limited per key.",
      contact: { name: "VYBZ", url: "https://vybz.cloud", email: "api@vybz.cloud" },
      termsOfService: "https://vybz.cloud/legal/terms",
    },
    servers: [{ url: base }],
    security: bearer,
    tags: [
      { name: "Platform" },
      { name: "Provenance" },
      { name: "Vault" },
    ],
    paths: {
      "/": { get: { tags: ["Platform"], summary: "Service descriptor", security: [], responses: { "200": { description: "Products, agent entry points, docs." } } } },
      "/openapi.json": { get: { tags: ["Platform"], summary: "This document", security: [], responses: { "200": { description: "OpenAPI 3.1" } } } },
      "/me": { get: { tags: ["Platform"], summary: "Organization and key in use", responses: { "200": { description: "Org + key metadata" }, "401": err("Unauthenticated") } } },

      "/provenance/assets": {
        post: {
          tags: ["Provenance"], summary: "Register an original",
          description: "Send the PCM WAV bytes as the request body. The file is hashed, stored privately, and becomes an asset you can issue from. Re-registering identical bytes returns the existing asset.",
          parameters: [
            { name: "X-VYBZ-Title", in: "header", schema: { type: "string" } },
            { name: "X-VYBZ-External-Ref", in: "header", schema: { type: "string" }, description: "Your own id for this recording." },
            { name: "X-VYBZ-Content-SHA256", in: "header", schema: { type: "string" }, description: "Optional integrity check." },
          ],
          requestBody: wavBody("Raw WAV bytes (16/24/32-bit PCM or 32-bit float)."),
          responses: { "201": jsonOf("Asset", "Registered"), "200": jsonOf("Asset", "Already registered"), "422": err("Not a PCM WAV"), "413": err("Too large") },
        },
        get: { tags: ["Provenance"], summary: "List assets", parameters: [{ name: "limit", in: "query", schema: { type: "integer", maximum: 200 } }], responses: { "200": jsonOf("AssetList") } },
      },
      "/provenance/assets/{id}": { get: { tags: ["Provenance"], summary: "Get an asset", parameters: [idParam("id", "Asset id")], responses: { "200": jsonOf("Asset"), "404": err("Not found") } } },
      "/provenance/assets/{id}/issue": {
        post: {
          tags: ["Provenance"], summary: "Issue a watermarked copy",
          description: "Embeds a unique, inaudible forensic watermark keyed to `recipient` and returns the copy. With `Accept: application/json` (or `store: true`) the copy is stored and a one-hour download link is returned instead of the bytes. When Content Credentials signing is configured, the copy also carries a C2PA manifest.",
          parameters: [idParam("id", "Asset id")],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/IssueRequest" } } } },
          responses: {
            "201": { description: "Watermarked WAV bytes, or JSON with a download link.", headers: { "X-VYBZ-Issuance-Id": { schema: { type: "string" } }, "X-VYBZ-Watermark-Id": { schema: { type: "string" } }, "X-VYBZ-C2PA": { schema: { type: "string", enum: ["0", "1"] } }, "X-VYBZ-SHA256": { schema: { type: "string" } } }, content: { "audio/wav": { schema: { type: "string", format: "binary" } }, "application/json": { schema: { $ref: "#/components/schemas/IssuanceWithDownload" } } } },
            "422": err("Missing recipient"),
          },
        },
      },
      "/provenance/assets/{id}/issuances": { get: { tags: ["Provenance"], summary: "List issued copies", parameters: [idParam("id", "Asset id")], responses: { "200": jsonOf("IssuanceList") } } },
      "/provenance/assets/{id}/ledger": { get: { tags: ["Provenance"], summary: "Hash-chained event ledger for an asset", parameters: [idParam("id", "Asset id")], responses: { "200": { description: "Ordered chain events." } } } },
      "/provenance/assets/{id}/detect": {
        post: {
          tags: ["Provenance"], summary: "Attribute a suspect file",
          description: "Blind, alignment-tolerant correlation of the suspect audio against every copy issued for this asset. Returns ranked candidates and, when the evidence is decisive, the attributed issuance.",
          parameters: [idParam("id", "Asset id")],
          requestBody: wavBody("Suspect audio as PCM WAV. Decode compressed formats first."),
          responses: { "200": jsonOf("Detection"), "422": err("Not a PCM WAV") },
        },
      },
      "/provenance/verify": {
        post: {
          tags: ["Provenance"], summary: "Verify a file by exact hash",
          description: "Answers whether these exact bytes are a registered original or an issued copy of this organization, and for whom.",
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } }, "audio/wav": { schema: { type: "string", format: "binary" } } } },
          responses: { "200": jsonOf("Verification") },
        },
      },
      "/provenance/chain": { get: { tags: ["Provenance"], summary: "Verify the organization's whole ledger chain", responses: { "200": { description: "{ ok, length, first_bad_seq }" } } } },

      "/vault/repos": {
        post: { tags: ["Vault"], summary: "Create a repository", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RepoCreate" } } } }, responses: { "201": jsonOf("Repo"), "409": err("Slug taken") } },
        get: { tags: ["Vault"], summary: "List repositories", responses: { "200": jsonOf("RepoList") } },
      },
      "/vault/repos/{repo}": { get: { tags: ["Vault"], summary: "Get a repository", parameters: [idParam("repo", "Repo id or slug")], responses: { "200": jsonOf("Repo"), "404": err("Not found") } } },
      "/vault/repos/{repo}/blobs": {
        post: {
          tags: ["Vault"], summary: "Upload a blob (content-addressed)",
          description: "Send raw bytes. The SHA-256 is computed server-side and the blob is deduplicated across the organization. Send `X-VYBZ-Content-SHA256` to have the upload rejected on mismatch.",
          parameters: [idParam("repo", "Repo id or slug"), { name: "X-VYBZ-Content-SHA256", in: "header", schema: { type: "string" } }, { name: "X-VYBZ-Mime", in: "header", schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          responses: { "201": jsonOf("Blob"), "200": jsonOf("Blob", "Already stored") },
        },
      },
      "/vault/repos/{repo}/blobs/exists": { post: { tags: ["Vault"], summary: "Check which hashes are missing", parameters: [idParam("repo", "Repo id or slug")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { hashes: { type: "array", items: { type: "string" } } }, required: ["hashes"] } } } }, responses: { "200": { description: "{ present[], missing[] }" } } } },
      "/vault/repos/{repo}/blobs/{hash}": { get: { tags: ["Vault"], summary: "Get a 15-minute download link for a blob", parameters: [idParam("repo", "Repo id or slug"), idParam("hash", "SHA-256")], responses: { "200": jsonOf("BlobDownload"), "404": err("Not found") } } },
      "/vault/repos/{repo}/commits": {
        post: {
          tags: ["Vault"], summary: "Commit a tree",
          description: "Entries describe the complete tree at this commit (path, hash, size). All hashes must already be uploaded. Pass `parent` to require a specific head (optimistic concurrency); omit it to commit on the current head. Committing an identical tree returns the head with `unchanged: true`.",
          parameters: [idParam("repo", "Repo id or slug")],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CommitRequest" } } } },
          responses: { "201": jsonOf("Commit"), "200": jsonOf("Commit", "Unchanged"), "409": err("Missing blobs or head moved") },
        },
        get: { tags: ["Vault"], summary: "History from a ref", parameters: [idParam("repo", "Repo id or slug"), { name: "ref", in: "query", schema: { type: "string" }, description: "Branch name or commit sha. Default branch when omitted." }, { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } }], responses: { "200": jsonOf("CommitList") } },
      },
      "/vault/repos/{repo}/commits/{sha}": { get: { tags: ["Vault"], summary: "Get a commit with its full tree", parameters: [idParam("repo", "Repo id or slug"), idParam("sha", "Commit sha")], responses: { "200": jsonOf("CommitFull"), "404": err("Not found") } } },
      "/vault/repos/{repo}/tree": { get: { tags: ["Vault"], summary: "Tree at a ref", parameters: [idParam("repo", "Repo id or slug"), { name: "ref", in: "query", schema: { type: "string" } }], responses: { "200": { description: "{ ref, commit, entries[] }" } } } },
      "/vault/repos/{repo}/diff": { get: { tags: ["Vault"], summary: "Diff two refs", parameters: [idParam("repo", "Repo id or slug"), { name: "from", in: "query", schema: { type: "string" } }, { name: "to", in: "query", schema: { type: "string" } }], responses: { "200": { description: "{ added[], removed[], modified[] }" } } } },
      "/vault/repos/{repo}/branches": {
        get: { tags: ["Vault"], summary: "List branches", parameters: [idParam("repo", "Repo id or slug")], responses: { "200": { description: "Branches with heads." } } },
        post: { tags: ["Vault"], summary: "Create a branch", parameters: [idParam("repo", "Repo id or slug")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, from: { type: "string", description: "Branch or sha to start from" } }, required: ["name"] } } } }, responses: { "201": { description: "Created" }, "409": err("Exists") } },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "vybz_live_<48 hex>", description: "Organization API key from the VYBZ Console. Scopes: org:read, provenance:read, provenance:write, provenance:detect, vault:read, vault:write." },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string" }, docs: { type: "string" } }, required: ["code", "message", "request_id"] } } },
        Asset: { type: "object", properties: { id: { type: "string" }, object: { const: "provenance.asset" }, title: { type: "string" }, external_ref: { type: ["string", "null"] }, sha256: { type: "string" }, bytes: { type: "integer" }, sample_rate: { type: ["integer", "null"] }, channels: { type: ["integer", "null"] }, duration_sec: { type: ["number", "null"] }, created_at: { type: "string" }, links: { type: "object" } } },
        AssetList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Asset" } } } },
        IssueRequest: { type: "object", properties: { recipient: { type: "string", description: "Your stable identifier for the receiving party (email, account id, partner name)." }, license: { type: "string" }, store: { type: "boolean", description: "Store the delivered copy and return a download link instead of bytes." }, c2pa: { type: "boolean", default: true } }, required: ["recipient"] },
        Issuance: { type: "object", properties: { id: { type: "string" }, object: { const: "provenance.issuance" }, asset_id: { type: "string" }, recipient: { type: "string" }, license: { type: ["string", "null"] }, watermark_id: { type: "string" }, delivered_sha256: { type: "string" }, c2pa_signed: { type: "boolean" }, created_at: { type: "string" } } },
        IssuanceWithDownload: { allOf: [{ $ref: "#/components/schemas/Issuance" }, { type: "object", properties: { bytes: { type: "integer" }, download: { type: "object", properties: { url: { type: "string" }, expires_in: { type: "integer" } } } } }] },
        IssuanceList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Issuance" } } } },
        Detection: { type: "object", properties: { object: { const: "provenance.detection" }, asset_id: { type: "string" }, suspect_sha256: { type: "string" }, confidence: { type: "string", enum: ["exact", "high", "medium", "none"] }, attributed: { type: ["object", "null"], properties: { issuance_id: { type: "string" }, recipient: { type: "string" }, watermark_id: { type: "string" }, score: { type: "number" }, exact: { type: "boolean" } } }, matches: { type: "array", items: { type: "object" } }, candidates: { type: "integer" } } },
        Verification: { type: "object", properties: { object: { const: "provenance.verification" }, sha256: { type: "string" }, known: { type: "boolean" }, kind: { type: "string", enum: ["original", "issued_copy", "unknown"] }, asset: { type: ["object", "null"] }, issuance: { type: ["object", "null"] }, hint: { type: ["string", "null"] } } },
        RepoCreate: { type: "object", properties: { name: { type: "string" }, slug: { type: "string" }, description: { type: "string" }, daw: { type: "string", description: "e.g. ableton, fl-studio, logic, pro-tools, cubase, reaper, bitwig" }, default_branch: { type: "string", default: "main" } }, required: ["name"] },
        Repo: { type: "object", properties: { id: { type: "string" }, object: { const: "vault.repo" }, name: { type: "string" }, slug: { type: "string" }, description: { type: ["string", "null"] }, daw: { type: ["string", "null"] }, default_branch: { type: "string" }, created_at: { type: "string" }, updated_at: { type: "string" }, links: { type: "object" } } },
        RepoList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Repo" } } } },
        Blob: { type: "object", properties: { object: { const: "vault.blob" }, hash: { type: "string" }, size: { type: "integer" }, existed: { type: "boolean" } } },
        BlobDownload: { type: "object", properties: { object: { const: "vault.blob" }, hash: { type: "string" }, size: { type: "integer" }, mime: { type: ["string", "null"] }, download: { type: "object", properties: { url: { type: "string" }, expires_in: { type: "integer" } } } } },
        Entry: { type: "object", properties: { path: { type: "string" }, hash: { type: "string" }, size: { type: "integer" } }, required: ["path", "hash", "size"] },
        CommitRequest: { type: "object", properties: { branch: { type: "string", default: "main" }, message: { type: "string" }, entries: { type: "array", items: { $ref: "#/components/schemas/Entry" } }, parent: { type: ["string", "null"], description: "Expected head sha. Omit to commit on the current head." }, meta: { type: "object", description: "Free-form: daw, version, plugin list, tempo, key." } }, required: ["entries"] },
        Commit: { type: "object", properties: { id: { type: "string" }, object: { const: "vault.commit" }, sha: { type: "string" }, parent_sha: { type: ["string", "null"] }, tree_sha: { type: "string" }, message: { type: "string" }, file_count: { type: "integer" }, total_bytes: { type: "integer" }, meta: { type: "object" }, created_at: { type: "string" }, branch: { type: "string" }, unchanged: { type: "boolean" } } },
        CommitFull: { allOf: [{ $ref: "#/components/schemas/Commit" }, { type: "object", properties: { entries: { type: "array", items: { $ref: "#/components/schemas/Entry" } } } }] },
        CommitList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Commit" } } } },
      },
    },
  };
}
