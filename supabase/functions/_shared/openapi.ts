// OpenAPI 3.1 description of the VYBZ public API. Served at GET /v1/openapi.json.
// Agents and SDK generators read this; keep it in step with api-v1/index.ts.
import { API_VERSION } from "./apiGateway.ts";

export function openapiDocument(base: string) {
  const bearer = [{ apiKey: [] }];
  const err = (desc: string) => ({ description: desc, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
  const jsonOf = (ref: string, desc = "OK") => ({ description: desc, content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });
  const bin = { schema: { type: "string", format: "binary" } };
  const audioBody = (desc: string) => ({
    required: true,
    description: desc,
    content: { "audio/wav": bin, "audio/aiff": bin, "audio/flac": bin, "audio/mpeg": bin, "audio/ogg": bin, "audio/opus": bin, "audio/mp4": bin, "application/octet-stream": bin, "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } },
  });
  const batchBody = (desc: string, extra: Record<string, unknown> = {}) => ({
    required: true,
    description: desc,
    content: {
      "multipart/form-data": { schema: { type: "object", properties: { files: { type: "array", items: { type: "string", format: "binary" } }, ...extra } } },
      "application/json": { schema: { type: "object", properties: { items: { type: "array", maxItems: 25, items: { type: "object", properties: { url: { type: "string", format: "uri" }, name: { type: "string" } }, required: ["url"] } }, ...extra }, required: ["items"] } },
    },
  });
  const attributeParams = [
    { name: "attribute", in: "query", schema: { type: "boolean", default: false }, description: "Run watermark attribution when an original is identified or `asset` is given. Metered as one detection per file. Requires `provenance:detect`." },
    { name: "asset", in: "query", schema: { type: "string" }, description: "Asset id to test the watermark against when the file cannot be identified by fingerprint." },
  ];
  const idParam = (name: string, desc: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description: desc });
  const nameHeader = { name: "X-VYBZ-Name", in: "header", schema: { type: "string" }, description: "Display name echoed back as `name` when the file is sent as a raw body. Multipart parts use their filename." };

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
        "All calls are organization-scoped, audited, and rate limited per key. Developer plans are hard-capped (402 plan_limit_reached); paid plans are metered.",
      contact: { name: "VYBZ", url: "https://vybz.cloud", email: "api@vybz.cloud" },
      termsOfService: "https://vybz.cloud/legal/terms",
    },
    servers: [{ url: base }],
    security: bearer,
    tags: [
      { name: "Platform" },
      { name: "Provenance" },
      { name: "Vault" },
      { name: "Webhooks" },
    ],
    paths: {
      "/": { get: { tags: ["Platform"], summary: "Service descriptor", security: [], responses: { "200": { description: "Products, agent entry points, docs." } } } },
      "/openapi.json": { get: { tags: ["Platform"], summary: "This document", security: [], responses: { "200": { description: "OpenAPI 3.1" } } } },
      "/me": { get: { tags: ["Platform"], summary: "Organization and key in use", responses: { "200": { description: "Org + key metadata" }, "401": err("Unauthenticated") } } },
      "/billing/usage": {
        get: {
          tags: ["Platform"], summary: "Metered usage: this month and closed months",
          description: "The running month against the plan's included quantities, followed by one report per closed month: totals, overage beyond the plan, and the amount invoiced in cents. Reports are written once a month after the period closes; developer plans have none.",
          parameters: [{ name: "months", in: "query", schema: { type: "integer", minimum: 1, maximum: 36, default: 12 }, description: "How many closed months to return, newest first." }],
          responses: { "200": { description: "`{ current, reports }`" }, "401": err("Unauthenticated") },
        },
      },

      "/provenance/assets": {
        post: {
          tags: ["Provenance"], summary: "Register an original",
          description: "Send a lossless original (WAV, AIFF, or FLAC) as the request body or as one multipart part. The file is stored as sent, hashed both as bytes and as canonical PCM, fingerprinted for later identification, and becomes an asset you can issue from. Re-registering identical bytes returns the existing asset. Lossy formats are refused with `lossless_required`.",
          parameters: [
            { name: "X-VYBZ-Title", in: "header", schema: { type: "string" } },
            { name: "X-VYBZ-External-Ref", in: "header", schema: { type: "string" }, description: "Your own id for this recording." },
            { name: "X-VYBZ-Content-SHA256", in: "header", schema: { type: "string" }, description: "Optional integrity check." },
          ],
          requestBody: audioBody("WAV (8 to 32-bit PCM or float, including extensible), AIFF/AIFC, or FLAC."),
          responses: { "201": jsonOf("Asset", "Registered"), "200": jsonOf("Asset", "Already registered"), "422": err("Not lossless audio (`lossless_required`, `unsupported_audio`)"), "413": err("Too large"), "402": err("Plan limit reached") },
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
            "422": err("Missing recipient"), "402": err("Plan limit reached"),
          },
        },
      },
      "/provenance/assets/{id}/issue/batch": {
        post: {
          tags: ["Provenance"], summary: "Issue watermarked copies to many recipients",
          description: "One call, up to 50 recipients. The original is decoded once and each recipient receives a distinct watermark, a stored copy, and a one-hour download link. The response lists every item in order with `status: ok` or an error; the same list is stored as a JSON manifest and linked under `manifest`. Each successful item counts as one issuance. When the plan runs out mid-batch, the remaining recipients are reported as `plan_limit_reached` and nothing more is charged.",
          parameters: [idParam("id", "Asset id")],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/IssueBatchRequest" } } } },
          responses: { "201": jsonOf("IssueBatch", "At least one copy issued"), "200": jsonOf("IssueBatch", "No copies issued"), "422": err("Missing or too many recipients"), "402": err("Plan limit reached before the first copy") },
        },
      },
      "/provenance/assets/{id}/issuances": { get: { tags: ["Provenance"], summary: "List issued copies", parameters: [idParam("id", "Asset id")], responses: { "200": jsonOf("IssuanceList") } } },
      "/provenance/assets/{id}/ledger": { get: { tags: ["Provenance"], summary: "Hash-chained event ledger for an asset", parameters: [idParam("id", "Asset id")], responses: { "200": { description: "Ordered chain events." } } } },
      "/provenance/assets/{id}/detect": {
        post: {
          tags: ["Provenance"], summary: "Attribute a suspect file",
          description: "Blind, alignment-tolerant correlation of the suspect audio against every copy issued for this asset. Accepts any supported format (see `/provenance/formats`); the suspect is decoded and resampled to the asset's rate. Returns ranked candidates and, when the evidence is decisive, the attributed issuance. Metered as one detection.",
          parameters: [idParam("id", "Asset id"), nameHeader],
          requestBody: audioBody("Suspect audio in any supported format, raw or as one multipart part."),
          responses: { "200": jsonOf("Detection"), "422": err("Undecodable or unsupported audio"), "402": err("Plan limit reached") },
        },
      },
      "/provenance/assets/{id}/detect/batch": {
        post: {
          tags: ["Provenance"], summary: "Attribute many suspect files",
          description: "Up to 25 files per call, as multipart parts or as URLs to fetch. Each file is processed independently and metered as one detection; failures are reported per item.",
          parameters: [idParam("id", "Asset id")],
          requestBody: batchBody("Files or URLs."),
          responses: { "200": jsonOf("DetectionBatch"), "413": err("Too large"), "422": err("Too many items") },
        },
      },
      "/provenance/verify": {
        post: {
          tags: ["Provenance"], summary: "Verify a file",
          description:
            "Establishes what a file is using every method available, each reported as evidence: exact byte hash, canonical PCM hash (same audio in any lossless container), perceptual fingerprint (which original it derives from and at what offset, without an asset id), Content Credentials presence cross-checked against the record, and, with `attribute=true`, watermark attribution on the identified asset. Any supported format. Verification is free; attribution is metered.",
          parameters: [...attributeParams, nameHeader],
          requestBody: audioBody("Any file, raw or as one multipart part. Non-audio bytes are checked by exact hash only."),
          responses: { "200": jsonOf("Verification"), "413": err("Too large") },
        },
      },
      "/provenance/verify/batch": {
        post: {
          tags: ["Provenance"], summary: "Verify many files",
          description: "Up to 25 files per call, as multipart parts or as URLs to fetch. Same evidence per file as `/provenance/verify`; failures are reported per item.",
          parameters: attributeParams,
          requestBody: batchBody("Files or URLs.", { attribute: { type: "boolean" }, asset: { type: "string" } }),
          responses: { "200": jsonOf("VerificationBatch"), "413": err("Too large"), "422": err("Too many items") },
        },
      },
      "/provenance/formats": {
        get: { tags: ["Provenance"], summary: "Supported input formats and limits", responses: { "200": jsonOf("Formats") } },
      },
      "/provenance/reports": {
        post: {
          tags: ["Provenance"], summary: "Create a leak report",
          description:
            "Verify a suspect file and store the finding as a report: verdict, confidence, the recipient of the matching copy, every method that ran, and an integrity hash. Attribution is on by default (metered as one detection when it runs); pass `attribute=false` to skip it. The report is available as JSON and as a PDF at `links.pdf`. Optional `note` (multipart field or `X-VYBZ-Note` header) is printed on the report.",
          parameters: [...attributeParams, nameHeader, { name: "X-VYBZ-Note", in: "header", schema: { type: "string", maxLength: 2000 }, description: "Free-text note printed on the report." }],
          requestBody: audioBody("The suspect file, raw or as one multipart part. Multipart may add `note`."),
          responses: { "201": jsonOf("Report", "Stored report."), "413": err("Too large") },
        },
        get: {
          tags: ["Provenance"], summary: "List leak reports",
          parameters: [{ name: "asset", in: "query", schema: { type: "string" }, description: "Only reports whose finding points at this asset." }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } }],
          responses: { "200": { description: "Newest first.", content: { "application/json": { schema: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Report" } } } } } } } },
        },
      },
      "/provenance/reports/{id}": {
        get: {
          tags: ["Provenance"], summary: "Get a leak report (JSON or PDF)",
          description: "Returns the report as JSON. Append `.pdf`, pass `?format=pdf`, or send `Accept: application/pdf` for the PDF; the `X-VYBZ-Report-Hash` header on the PDF equals `report_hash` in the JSON.",
          parameters: [idParam("id", "Report id, optionally with a `.pdf` suffix"), { name: "format", in: "query", schema: { type: "string", enum: ["json", "pdf"] } }],
          responses: { "200": { description: "The report.", content: { "application/json": { schema: { $ref: "#/components/schemas/Report" } }, "application/pdf": { schema: { type: "string", format: "binary" } } } }, "404": err("Not found") },
        },
      },
      "/provenance/chain": { get: { tags: ["Provenance"], summary: "Verify the organization's whole ledger chain", responses: { "200": { description: "{ ok, length, first_bad_seq }" } } } },

      "/webhooks": {
        get: { tags: ["Webhooks"], summary: "List webhook endpoints", responses: { "200": jsonOf("WebhookList") } },
        post: {
          tags: ["Webhooks"], summary: "Create a webhook endpoint",
          description: "Registers an https endpoint for events. The response carries the signing `secret` once; store it. Deliveries are signed as `X-VYBZ-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + '.' + body)>`. Failures retry with backoff over about 15 hours. Requires `webhooks:manage`.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookCreate" } } } },
          responses: { "201": jsonOf("WebhookWithSecret", "Created"), "422": err("Invalid url or events") },
        },
      },
      "/webhooks/{id}": {
        get: { tags: ["Webhooks"], summary: "Get an endpoint", parameters: [idParam("id", "Endpoint id")], responses: { "200": jsonOf("Webhook"), "404": err("Not found") } },
        patch: { tags: ["Webhooks"], summary: "Update an endpoint", description: "Any of url, events, description, active. `rotate_secret: true` issues a new secret and returns it once.", parameters: [idParam("id", "Endpoint id")], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookUpdate" } } } }, responses: { "200": jsonOf("WebhookWithSecret") } },
        delete: { tags: ["Webhooks"], summary: "Delete an endpoint", parameters: [idParam("id", "Endpoint id")], responses: { "200": { description: "{ id, deleted: true }" } } },
      },
      "/webhooks/{id}/test": { post: { tags: ["Webhooks"], summary: "Send a ping event", parameters: [idParam("id", "Endpoint id")], responses: { "202": { description: "{ endpoint_id, queued, dispatched }" } } } },
      "/webhooks/{id}/deliveries": { get: { tags: ["Webhooks"], summary: "Recent deliveries", parameters: [idParam("id", "Endpoint id"), { name: "status", in: "query", schema: { type: "string", enum: ["pending", "sending", "delivered", "failed"] } }, { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } }], responses: { "200": jsonOf("DeliveryList") } } },
      "/webhooks/{id}/deliveries/{delivery}/retry": { post: { tags: ["Webhooks"], summary: "Retry a delivery now", parameters: [idParam("id", "Endpoint id"), idParam("delivery", "Delivery id")], responses: { "202": jsonOf("Delivery") } } },

      "/vault/repos": {
        post: { tags: ["Vault"], summary: "Create a repository", requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RepoCreate" } } } }, responses: { "201": jsonOf("Repo"), "409": err("Slug taken") } },
        get: { tags: ["Vault"], summary: "List repositories", responses: { "200": jsonOf("RepoList") } },
      },
      "/vault/repos/{repo}": { get: { tags: ["Vault"], summary: "Get a repository", parameters: [idParam("repo", "Repo id or slug")], responses: { "200": jsonOf("Repo"), "404": err("Not found") } } },
      "/vault/repos/{repo}/blobs": {
        post: {
          tags: ["Vault"], summary: "Upload a blob (content-addressed)",
          description: "Send raw bytes, up to 500 MB. The SHA-256 is computed server-side and the blob is deduplicated across the organization. Send `X-VYBZ-Content-SHA256` to have the upload rejected on mismatch. Larger files go through `/uploads`.",
          parameters: [idParam("repo", "Repo id or slug"), { name: "X-VYBZ-Content-SHA256", in: "header", schema: { type: "string" } }, { name: "X-VYBZ-Mime", in: "header", schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          responses: { "201": jsonOf("Blob"), "200": jsonOf("Blob", "Already stored"), "402": err("Plan limit reached") },
        },
      },
      "/vault/repos/{repo}/blobs/exists": { post: { tags: ["Vault"], summary: "Check which hashes are missing", parameters: [idParam("repo", "Repo id or slug")], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { hashes: { type: "array", items: { type: "string" } } }, required: ["hashes"] } } } }, responses: { "200": { description: "{ present[], missing[] }" } } } },
      "/vault/repos/{repo}/uploads": {
        post: {
          tags: ["Vault"], summary: "Open a chunked upload",
          description: "For files above the single-request limit. Declare the complete file's `sha256` and `size`; the response gives `part_size` and `parts`. Send parts in order with PUT, then `complete`. If a blob with that hash already exists the response is the blob with `existed: true`. Re-opening for the same hash while a session is open returns that session (`resumed: true`) with `next_part` to continue from. Sessions expire after 24 hours.",
          parameters: [idParam("repo", "Repo id or slug")],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { sha256: { type: "string" }, size: { type: "integer" }, mime: { type: "string" } }, required: ["sha256", "size"] } } } },
          responses: { "201": jsonOf("Upload", "Session opened"), "200": { description: "Existing blob, or an open session to resume" }, "413": err("Above the chunked limit"), "402": err("Plan limit reached") },
        },
      },
      "/vault/repos/{repo}/uploads/{upload}": {
        get: { tags: ["Vault"], summary: "Upload session status", parameters: [idParam("repo", "Repo id or slug"), idParam("upload", "Upload id")], responses: { "200": jsonOf("Upload"), "404": err("Not found") } },
        delete: { tags: ["Vault"], summary: "Abort an upload", parameters: [idParam("repo", "Repo id or slug"), idParam("upload", "Upload id")], responses: { "200": { description: "{ id, aborted: true }" } } },
      },
      "/vault/repos/{repo}/uploads/{upload}/parts/{n}": {
        put: {
          tags: ["Vault"], summary: "Send one part",
          description: "Raw bytes of part `n` (zero-based). Every part is exactly `part_size` bytes except the last. Parts must arrive in order; `409 part_out_of_order` carries the `expected` part so a client can resume.",
          parameters: [idParam("repo", "Repo id or slug"), idParam("upload", "Upload id"), idParam("n", "Part number")],
          requestBody: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
          responses: { "200": jsonOf("Upload", "Part stored"), "409": err("`part_out_of_order`, `upload_closed`"), "410": err("`upload_expired`"), "422": err("`invalid_part_size`") },
        },
      },
      "/vault/repos/{repo}/uploads/{upload}/complete": {
        post: {
          tags: ["Vault"], summary: "Finish a chunked upload",
          description: "Verifies that every part arrived and that the assembled bytes hash to the declared sha256, then records the blob. On a mismatch the partial object is discarded and `409 checksum_mismatch` reports the computed hash.",
          parameters: [idParam("repo", "Repo id or slug"), idParam("upload", "Upload id")],
          responses: { "201": jsonOf("Blob", "Blob recorded"), "200": jsonOf("Blob", "Already completed"), "409": err("`upload_incomplete`, `checksum_mismatch`, `upload_closed`") },
        },
      },
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
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "vybz_live_<48 hex>", description: "Organization API key from the VYBZ Console. Scopes: org:read, provenance:read, provenance:write, provenance:detect, vault:read, vault:write, webhooks:manage. The console itself calls the API with a user session and `X-VYBZ-Org`; integrations use keys." },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, request_id: { type: "string" }, docs: { type: "string" } }, required: ["code", "message", "request_id"] } } },
        Asset: { type: "object", properties: { id: { type: "string" }, object: { const: "provenance.asset" }, title: { type: "string" }, external_ref: { type: ["string", "null"] }, sha256: { type: "string" }, pcm_sha256: { type: ["string", "null"], description: "Hash of the decoded audio; the same across lossless containers." }, source_format: { type: ["string", "null"] }, fingerprint_frames: { type: ["integer", "null"] }, bytes: { type: "integer" }, mime: { type: "string" }, sample_rate: { type: ["integer", "null"] }, channels: { type: ["integer", "null"] }, duration_sec: { type: ["number", "null"] }, created_at: { type: "string" }, links: { type: "object" } } },
        AssetList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Asset" } } } },
        IssueRequest: { type: "object", properties: { recipient: { type: "string", description: "Your stable identifier for the receiving party (email, account id, partner name)." }, license: { type: "string" }, store: { type: "boolean", description: "Store the delivered copy and return a download link instead of bytes." }, c2pa: { type: "boolean", default: true } }, required: ["recipient"] },
        IssueBatchRequest: {
          type: "object",
          properties: {
            recipients: { type: "array", minItems: 1, maxItems: 50, items: { oneOf: [{ type: "string" }, { type: "object", properties: { recipient: { type: "string" }, license: { type: "string" } }, required: ["recipient"] }] } },
            license: { type: "string", description: "Default license for recipients that do not carry their own." },
            c2pa: { type: "boolean", default: true },
          },
          required: ["recipients"],
        },
        IssueBatch: {
          type: "object",
          properties: {
            object: { const: "list" }, asset_id: { type: "string" }, batch_id: { type: "string" },
            data: { type: "array", items: { oneOf: [{ allOf: [{ type: "object", properties: { status: { const: "ok" } } }, { $ref: "#/components/schemas/IssuanceWithDownload" }] }, { $ref: "#/components/schemas/ItemError" }] } },
            summary: { type: "object", properties: { total: { type: "integer" }, issued: { type: "integer" }, errors: { type: "integer" } } },
            manifest: { type: ["object", "null"], properties: { url: { type: ["string", "null"] }, expires_in: { type: "integer" } }, description: "Stored JSON copy of this response, linked for one hour." },
          },
        },
        Issuance: { type: "object", properties: { id: { type: "string" }, object: { const: "provenance.issuance" }, asset_id: { type: "string" }, recipient: { type: "string" }, license: { type: ["string", "null"] }, watermark_id: { type: "string" }, delivered_sha256: { type: "string" }, pcm_sha256: { type: ["string", "null"] }, c2pa_signed: { type: "boolean" }, created_at: { type: "string" } } },
        IssuanceWithDownload: { allOf: [{ $ref: "#/components/schemas/Issuance" }, { type: "object", properties: { bytes: { type: "integer" }, download: { type: "object", properties: { url: { type: "string" }, expires_in: { type: "integer" } } } } }] },
        IssuanceList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Issuance" } } } },
        Input: { type: "object", description: "What was received and how it was decoded.", properties: { sha256: { type: "string" }, bytes: { type: "integer" }, format: { type: "string" }, codec: { type: "string" }, container: { type: "string" }, mime: { type: "string" }, decoded: { type: "boolean" }, decoder: { type: ["string", "null"], enum: ["native", "worker", null] }, decode_error: { type: ["object", "null"] }, sample_rate: { type: ["integer", "null"] }, channels: { type: ["integer", "null"] }, duration_sec: { type: ["number", "null"] }, analyzed_sec: { type: ["number", "null"] }, truncated: { type: "boolean", description: "True when the analysis cap cut the decoded audio; PCM hashing is skipped in that case." } } },
        Detection: { type: "object", properties: { object: { const: "provenance.detection" }, name: { type: "string" }, asset_id: { type: "string" }, suspect_sha256: { type: "string" }, input: { $ref: "#/components/schemas/Input" }, analyzed_sec: { type: "number" }, resampled_from: { type: ["integer", "null"], description: "Suspect sample rate when it differed from the asset and was resampled." }, confidence: { type: "string", enum: ["exact", "high", "medium", "none"] }, attributed: { type: ["object", "null"], properties: { issuance_id: { type: "string" }, recipient: { type: "string" }, watermark_id: { type: "string" }, score: { type: "number" }, exact: { type: "boolean" } } }, statistics: { type: "object", properties: { z: { type: ["number", "null"] }, ratio: { type: ["number", "null"] } } }, matches: { type: "array", items: { type: "object" } }, candidates: { type: "integer" } } },
        DetectionBatch: { type: "object", properties: { object: { const: "list" }, asset_id: { type: "string" }, data: { type: "array", items: { oneOf: [{ allOf: [{ type: "object", properties: { status: { const: "ok" } } }, { $ref: "#/components/schemas/Detection" }] }, { $ref: "#/components/schemas/ItemError" }] } }, summary: { type: "object", properties: { total: { type: "integer" }, attributed: { type: "integer" }, errors: { type: "integer" } } } } },
        ItemError: { type: "object", properties: { name: { type: "string" }, status: { const: "error" }, error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } },
        Evidence: {
          type: "object",
          description: "One verification method and its outcome. `method` is one of exact_hash, pcm_hash, fingerprint, content_credentials, watermark. Fingerprint evidence adds asset_id, similarity (1 - bit error rate), offset_sec (where the suspect starts within the original), overlap_sec, and votes. Watermark evidence mirrors a Detection.",
          properties: { method: { type: "string", enum: ["exact_hash", "pcm_hash", "fingerprint", "content_credentials", "watermark"] }, result: { type: "string", enum: ["match", "no_match", "attributed", "inconclusive", "present", "absent", "skipped", "not_requested"] }, reason: { type: "string" } },
          additionalProperties: true,
        },
        Report: {
          type: "object",
          description: "A stored verification with attribution: the document a rights holder forwards when a copy leaks.",
          properties: {
            id: { type: "string" },
            object: { const: "provenance.report" },
            name: { type: "string" },
            sha256: { type: "string", description: "SHA-256 of the submitted file." },
            verdict: { type: "string", enum: ["original", "issued_copy", "derived_copy", "derived_unattributed", "unknown"] },
            confidence: { type: "string", enum: ["exact", "high", "medium", "none"] },
            input: { type: "object" },
            asset: { oneOf: [{ $ref: "#/components/schemas/Asset" }, { type: "null" }] },
            issuance: { oneOf: [{ $ref: "#/components/schemas/Issuance" }, { type: "null" }], description: "The recipient's copy the file was matched to." },
            evidence: { type: "array", items: { type: "object" } },
            note: { type: ["string", "null"] },
            report_hash: { type: "string", description: "SHA-256 over id, created_at, sha256, verdict, confidence, asset_id, issuance_id, and evidence." },
            created_at: { type: "string" },
            links: { type: "object", properties: { self: { type: "string" }, pdf: { type: "string" }, asset: { type: ["string", "null"] } } },
          },
        },
        Verification: {
          type: "object",
          properties: {
            object: { const: "provenance.verification" },
            name: { type: "string" },
            sha256: { type: "string" },
            known: { type: "boolean" },
            kind: { type: "string", enum: ["original", "issued_copy", "derived", "unknown"] },
            verdict: { type: "string", enum: ["original", "issued_copy", "derived_copy", "derived_unattributed", "unknown"], description: "original: the registered original bytes or audio. issued_copy: a copy we issued, byte- or PCM-identical. derived_copy: altered audio attributed to a recipient by watermark. derived_unattributed: derives from a known original but no recipient could be established. unknown: nothing matched." },
            confidence: { type: "string", enum: ["exact", "high", "medium", "none"] },
            input: { $ref: "#/components/schemas/Input" },
            asset: { type: ["object", "null"] },
            issuance: { type: ["object", "null"] },
            evidence: { type: "array", items: { $ref: "#/components/schemas/Evidence" } },
            hint: { type: ["string", "null"] },
          },
        },
        VerificationBatch: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { oneOf: [{ allOf: [{ type: "object", properties: { status: { const: "ok" } } }, { $ref: "#/components/schemas/Verification" }] }, { $ref: "#/components/schemas/ItemError" }] } }, summary: { type: "object", properties: { total: { type: "integer" }, original: { type: "integer" }, issued_copy: { type: "integer" }, derived_copy: { type: "integer" }, derived_unattributed: { type: "integer" }, unknown: { type: "integer" }, errors: { type: "integer" } } } } },
        Formats: { type: "object", properties: { object: { const: "provenance.formats" }, decode: { type: "object", properties: { native: { type: "array", items: { type: "string" } }, worker: { type: "array", items: { type: "string" } }, worker_configured: { type: "boolean" } } }, register: { type: "array", items: { type: "string" } }, verify: { type: "array", items: { type: "string" } }, detect: { type: "array", items: { type: "string" } }, limits: { type: "object" }, methods: { type: "array", items: { type: "string" } } } },
        WebhookCreate: { type: "object", properties: { url: { type: "string", format: "uri", description: "https only, public host." }, events: { type: "array", items: { type: "string", enum: ["asset.registered", "issuance.created", "detection.completed", "detection.attributed", "commit.created", "ping", "*"] }, description: "Defaults to all events." }, description: { type: "string" } }, required: ["url"] },
        WebhookUpdate: { type: "object", properties: { url: { type: "string" }, events: { type: "array", items: { type: "string" } }, description: { type: "string" }, active: { type: "boolean" }, rotate_secret: { type: "boolean" } } },
        Webhook: { type: "object", properties: { id: { type: "string" }, object: { const: "webhook.endpoint" }, url: { type: "string" }, description: { type: ["string", "null"] }, events: { type: "array", items: { type: "string" } }, active: { type: "boolean" }, created_at: { type: "string" }, updated_at: { type: "string" }, links: { type: "object" } } },
        WebhookWithSecret: { allOf: [{ $ref: "#/components/schemas/Webhook" }, { type: "object", properties: { secret: { type: "string", description: "Shown once." } } }] },
        WebhookList: { type: "object", properties: { object: { const: "list" }, events: { type: "array", items: { type: "string" } }, data: { type: "array", items: { $ref: "#/components/schemas/Webhook" } } } },
        Delivery: { type: "object", properties: { id: { type: "string" }, object: { const: "webhook.delivery" }, endpoint_id: { type: "string" }, event: { type: "string" }, status: { type: "string", enum: ["pending", "sending", "delivered", "failed"] }, attempt: { type: "integer" }, next_attempt_at: { type: ["string", "null"] }, last_status: { type: ["integer", "null"] }, last_error: { type: ["string", "null"] }, created_at: { type: "string" }, delivered_at: { type: ["string", "null"] }, payload: { type: "object", description: "The event body as sent: { id, object: 'event', event, created_at, org_id, data }." } } },
        DeliveryList: { type: "object", properties: { object: { const: "list" }, endpoint_id: { type: "string" }, data: { type: "array", items: { $ref: "#/components/schemas/Delivery" } } } },
        RepoCreate: { type: "object", properties: { name: { type: "string" }, slug: { type: "string" }, description: { type: "string" }, daw: { type: "string", description: "e.g. ableton, fl-studio, logic, pro-tools, cubase, reaper, bitwig" }, default_branch: { type: "string", default: "main" } }, required: ["name"] },
        Repo: { type: "object", properties: { id: { type: "string" }, object: { const: "vault.repo" }, name: { type: "string" }, slug: { type: "string" }, description: { type: ["string", "null"] }, daw: { type: ["string", "null"] }, default_branch: { type: "string" }, created_at: { type: "string" }, updated_at: { type: "string" }, links: { type: "object" } } },
        RepoList: { type: "object", properties: { object: { const: "list" }, data: { type: "array", items: { $ref: "#/components/schemas/Repo" } } } },
        Upload: {
          type: "object",
          properties: {
            object: { const: "vault.upload" }, id: { type: "string" }, repo_id: { type: "string" }, sha256: { type: "string" }, size: { type: "integer" }, mime: { type: "string" },
            part_size: { type: "integer" }, parts: { type: "integer" }, received_bytes: { type: "integer" }, next_part: { type: "integer" },
            status: { type: "string", enum: ["open", "completed", "failed", "aborted"] }, created_at: { type: "string" }, expires_at: { type: "string" }, completed_at: { type: ["string", "null"] }, links: { type: "object" },
          },
        },
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
