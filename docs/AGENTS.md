# Agents and MCP

VYBZ is designed to be operated by AI agents. Every capability is a Model Context Protocol tool, and the same key that a human creates in the console authenticates an agent.

## Two ways to connect

| Mode | Endpoint | Files | Extra tools |
|---|---|---|---|
| **Hosted** | `https://vybz.cloud/api/mcp` (Streamable HTTP, stateless) | HTTPS URLs or base64 | — |
| **Local** | `npx -y @vybz/mcp-server` (stdio) | Local paths | `vault_commit_folder`, `vault_status`, `vault_restore` |

Both use `Authorization: Bearer vybz_live_…`. The hosted endpoint forwards the key per request and stores nothing.

### Claude Desktop (local)

```json
{
  "mcpServers": {
    "vybz": {
      "command": "npx",
      "args": ["-y", "@vybz/mcp-server"],
      "env": { "VYBZ_API_KEY": "vybz_live_…", "VYBZ_ROOTS": "D:/Projects;E:/Libraries" }
    }
  }
}
```

`VYBZ_ROOTS` confines filesystem tools to those folders (path-list separator of the OS). Omit it only on a machine you fully trust.

### Claude Code (hosted)

```bash
claude mcp add --transport http vybz https://vybz.cloud/api/mcp \
  --header "Authorization: Bearer vybz_live_…"
```

### Cursor (hosted)

```json
{ "mcpServers": { "vybz": { "url": "https://vybz.cloud/api/mcp", "headers": { "Authorization": "Bearer vybz_live_…" } } } }
```

### Any other model

Give it `https://vybz.cloud/v1/openapi.json` and `https://vybz.cloud/llms.txt`. Both are public.

## Tools

| Tool | Scope | Purpose |
|---|---|---|
| `vybz_whoami` | `org:read` | Organization, plan, key, scopes. |
| `vybz_billing_usage` | `org:read` | This month against the plan, plus one report per closed month with overage and the amount invoiced. Optional `months`. |
| `provenance_register` | `provenance:write` | Register a lossless original, WAV, AIFF, or FLAC (`file` / `url` / `base64`, `title`, `external_ref`). |
| `provenance_list_assets`, `provenance_get_asset` | `provenance:read` | Browse assets. |
| `provenance_issue` | `provenance:write` | Issue a copy to `recipient`. Returns a link, or writes `output_file` locally. |
| `provenance_list_issuances`, `provenance_ledger` | `provenance:read` | Who received what; chained history. |
| `provenance_verify` | `provenance:read` | What is this file? Exact hash, PCM hash, fingerprint (identifies the original, no id needed), Content Credentials, and with `attribute: true` the watermark. Any format. `files` / `urls` for batches of 25. |
| `provenance_detect` | `provenance:detect` | Attribute suspect files to a recipient of a known asset. Any format, resampled automatically. `files` / `urls` for batches. |
| `provenance_formats` | any | Formats this deployment decodes, and limits. |
| `provenance_chain_verify` | `provenance:read` | Recompute the organization chain. |
| `webhooks_list`, `webhooks_create`, `webhooks_update`, `webhooks_delete`, `webhooks_test`, `webhook_deliveries` | `org:read` / `webhooks:manage` | Signed event delivery to https endpoints; deliveries with status and retry. |
| `vault_create_repo`, `vault_list_repos`, `vault_get_repo` | `vault:*` | Repositories. |
| `vault_history`, `vault_get_commit`, `vault_tree`, `vault_diff`, `vault_branches`, `vault_create_branch` | `vault:read` / `vault:write` | Read and shape the graph. |
| `vault_blob_exists`, `vault_upload_blob`, `vault_blob_link` | `vault:read` / `vault:write` | Blob-level operations. |
| `vault_commit_entries` | `vault:write` | Commit an explicit tree. |
| `vault_commit_folder` (local) | `vault:write` | Hash a folder, upload only missing bytes, commit. `dry_run` reports first. |
| `vault_status` (local) | `vault:read` | Added / modified / deleted relative to a ref. |
| `vault_restore` (local) | `vault:read` | Materialize a ref into a folder; unchanged files untouched, changed files overwritten. |

### Results and errors

Each tool returns compact JSON. Errors return `isError: true` with:

```json
{ "error": "insufficient_scope", "message": "This key lacks the `vault:write` scope.", "status": 403, "request_id": "…", "details": { "required_scope": "vault:write" } }
```

`error` and `status` are the API's code and HTTP status. `details` carries the API's extra fields when there are any, so an agent can act on the cause: `required_scope` (403), `missing` and `missing_count` for `missing_blobs`, `head` and `expected` for `head_moved`, `plan`, `used`, `included`, `upgrade` for `plan_limit_reached`, `supported` for `unsupported_audio`, `retry_after_seconds` for `rate_limited`, `computed` for `checksum_mismatch`. Failures inside the server (an unreadable path, a URL that will not fetch) use `error: "tool_error"` and no status. Arguments that fail the tool's schema are rejected by the MCP layer before any API call.

### Annotations

Every tool declares the standard MCP annotations so a host can decide what to auto-approve:

| Annotation | Meaning here | Examples |
|---|---|---|
| `readOnlyHint: true` | Changes nothing the organization owns and costs nothing. | `vybz_whoami`, `vybz_billing_usage`, every list/get/tree/diff, `vault_status`, `provenance_verify` |
| `idempotentHint: false` | Repeating the call creates another record or another charge. | `provenance_issue` (new watermark each time), `provenance_detect` (metered per file), `vault_create_repo` |
| `destructiveHint: true` | Deletes or overwrites. | `webhooks_delete`, `vault_restore` |
| `openWorldHint: true` | Reaches outside VYBZ: fetches a URL you gave it, or contacts a customer endpoint. | `provenance_register` with `url`, `provenance_verify`, `provenance_detect`, `vault_upload_blob`, `webhooks_*` |

`provenance_verify` is read-only and free by default; with `attribute: true` each file is metered as one detection, exactly like `provenance_detect`. Hosts that auto-approve read-only tools should treat that flag as the boundary.

### One file, one result

`provenance_verify` and `provenance_detect` return the same shape however the file arrived: `file`, `url`, or `base64` give one verification or detection; `files` or `urls` give `{ data[], summary }` with one entry per file, even for a single entry. A `url` the API could not fetch or decode is reported as the tool's error with the API's code and details, not buried in a list.

### Hosted server limits

The hosted server has no filesystem: `file`, `files`, and `output_file` are refused with a message naming the alternatives. URLs it fetches itself (`provenance_register`, `vault_upload_blob`) must be `http` or `https` on public hosts; private, loopback, link-local, and `.internal` addresses are refused before and after redirects. URLs passed to `provenance_verify` and `provenance_detect` are forwarded to the API, which applies the same rule. Fetched files are capped at 200 MB.

## Recommended prompts

- "Snapshot `D:/Projects/Midnight Drive Project` into repo `midnight-drive` with message 'end of day'."
- "Issue a watermarked preview of asset `…` to each address in this list and give me the issuance ids."
- "Here is a file from a takedown notice: `https://…/leak.mp3`. Where does it come from and who leaked it?" (verify with `attribute: true`)
- "Verify `https://…/delivery.flac` is one of our issued copies before I approve the invoice."
- "Check every file in `D:/Takedowns/2026-09` and list the ones attributed to a recipient."
- "Show what changed in `midnight-drive` between yesterday's commit and now."
- "Register `https://ops.example.com/vybz` for `detection.attributed` and send a test."

## Safety model

- An agent can only act inside the organization of its key, within the key's scopes and rate limit.
- Revoking the key in the console stops the agent immediately.
- Every tool call appears in the audit log with the agent's user-agent string. Through the hosted endpoint it reads `vybz-mcp-hosted/1.2 (<the connecting client's user agent>)`, so Claude Code, Cursor, and a custom client are distinguishable in the log; through the local server it reads `vybz-mcp-local/1.2`.
- Local filesystem tools refuse paths outside `VYBZ_ROOTS` (case-insensitively on Windows).
- The MCP server never prints the key, and the hosted endpoint never persists it.

## Building your own integration

`@vybz/mcp-server` exports a typed client:

```ts
import { VybzClient } from "@vybz/mcp-server/client";
const vybz = new VybzClient({ apiKey: process.env.VYBZ_API_KEY! });
const asset = await vybz.registerAsset(wavBytes, { title: "Master" });
const link = await vybz.issueLink(asset.id as string, { recipient: "partner@example.com" });
```

Last updated: 2026-09-07
