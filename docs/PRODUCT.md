# Product

## Position

VYBZ sells certainty about audio files to companies whose business depends on sending audio to people they do not control.

- A sample library sends thousands of packs to subscribers and finds them on piracy sites.
- A sync house sends previews to fifty music supervisors and one leaks a film cue.
- A distributor receives masters and needs proof of origin before delivery.
- An AI music company needs to prove which outputs it generated and to whom it licensed them.
- A studio loses a session to a corrupted drive or an overwritten save.

Two products answer these. They share the account, key, audit log, console, and MCP server.

## Provenance

**Promise:** every copy you send is unique and traceable, and any file you are handed can be checked.

| Capability | Route | Outcome |
|---|---|---|
| Register | `POST /provenance/assets` | Original stored privately, hashed, chained. |
| Issue | `POST /provenance/assets/{id}/issue` | Unique inaudible watermark per recipient. C2PA manifest when enabled. |
| Verify | `POST /provenance/verify` | Is this exact file ours, and for whom was it issued? |
| Detect | `POST /provenance/assets/{id}/detect` | Which recipient did a leaked copy come from, with confidence. |
| Ledger | `GET /provenance/assets/{id}/ledger`, `GET /provenance/chain` | Tamper-evident history, verifiable in one call. |

**Why it wins:** competitors sell either watermarking or credentials, and none of them offer per-recipient attribution as an API with a ledger and an agent interface. The workflow is four calls and it is legible to a lawyer.

## Vault

**Promise:** no session is ever lost, and no project is ever emailed as a zip again.

| Capability | Route | Outcome |
|---|---|---|
| Repository | `POST /vault/repos` | A named home for a project or library. |
| Blobs | `POST /vault/repos/{repo}/blobs`, `…/blobs/exists` | Content-addressed, deduplicated per organization. |
| Commit | `POST /vault/repos/{repo}/commits` | Whole-tree snapshot with metadata and optimistic concurrency. |
| Read | `…/commits`, `…/tree`, `…/diff`, `…/branches` | Navigate history like a code repository. |
| Restore | MCP `vault_restore`, or `GET …/blobs/{hash}` | Materialize any ref into a folder. |

**Why it wins:** DAW folders are large binaries with tiny daily deltas. Organization-wide dedupe means a 300-project studio pays for unique bytes, not for 300 copies of the same drum library. The agent tools make snapshots automatic.

## Agents

Every capability is an MCP tool. Hosted at `https://vybz.cloud/api/mcp` for zero-install use with URLs and base64, and as `@vybz/mcp-server` locally for folder workflows. `/v1/openapi.json` and `/llms.txt` serve non-MCP models.

## Plans

| Plan | Price | Includes |
|---|---|---|
| Developer | $0 | 1 org, 3 keys, 250 issuances and 50 detections per month, 10 GB Vault. |
| Business | $249 / month | Unlimited keys and members; 10,000 issuances and 2,000 detections included, then metered; 1 TB Vault; CA-issued Content Credentials certificate; audit export; 99.9% SLA. |
| Enterprise | Custom | Volume pricing, dedicated signing certificate, private deployment, SSO, retention controls, named support. |

Meters: issuances, detections, unique stored bytes. Reads are free. Developer limits are hard caps enforced by the API with `402 plan_limit_reached`; Business and Enterprise are metered beyond the included quantities and billed in arrears.

## Teams

Organizations have an owner, admins, and members. Admins manage keys, members, and billing; members read everything. Invites are single-use links that expire in 14 days, created in **Console → Members** and accepted at `/console/join`.

## Non-goals

- No consumer social network, feed, profiles, live streaming, or discovery.
- No DAW plugin as a product. The VST3 in `native/` is retained only as a possible Vault capture source.
- No marketplace. Customers sell; VYBZ certifies and stores.

Last updated: 2026-09-05
