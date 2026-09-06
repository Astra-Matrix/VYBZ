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
| `vault_history`, `vault_tree`, `vault_diff`, `vault_branches`, `vault_create_branch` | `vault:read` / `vault:write` | Read and shape the graph. |
| `vault_blob_exists`, `vault_upload_blob`, `vault_blob_link` | `vault:read` / `vault:write` | Blob-level operations. |
| `vault_commit_entries` | `vault:write` | Commit an explicit tree. |
| `vault_commit_folder` (local) | `vault:write` | Hash a folder, upload only missing bytes, commit. `dry_run` reports first. |
| `vault_status` (local) | `vault:read` | Added / modified / deleted relative to a ref. |
| `vault_restore` (local) | `vault:read` | Materialize a ref into a folder; unchanged files untouched. |

Each tool returns compact JSON. Errors return `{ error, message, status, request_id }` with `isError: true`.

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
- Every tool call appears in the audit log with the agent's user-agent string.
- Local filesystem tools refuse paths outside `VYBZ_ROOTS`.
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
