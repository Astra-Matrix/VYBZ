# Product

## Position

VYBZ sells one answer first: **who leaked it**. The buyers are the people who hold a catalog before the world does and feel a leak the same week it happens: artist managers, labels, distributors, studios, and sync houses. Leak forensics is bought under pressure from a budget that already exists, so it is the front door. Vault is the expansion sale once the catalog is in the system, and the API and MCP tools are how larger accounts put both into their pipeline.

The pitch ladders in that order on every surface: home page, console overview, plan names.

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
| Report | `POST /provenance/reports`, `GET /provenance/reports/{id}.pdf` | The leak report: recipient, confidence, every method, integrity hash. PDF for people, JSON for systems. |
| Ledger | `GET /provenance/assets/{id}/ledger`, `GET /provenance/chain` | Tamper-evident history, verifiable in one call. |

**Why it wins:** competitors sell either watermarking or credentials, and none of them offer per-recipient attribution as an API with a ledger and an agent interface. The workflow is four calls and it is legible to a lawyer.

Plan ids in the database, the API (`plan`), and the Paddle catalog are unchanged: `developer`, `creator` (Manager), `pro` (Label), `ultimate` (Catalog), `enterprise`. Only the names shown to buyers changed on 2026-09-08.

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

## Webhooks

Every state change an integration cares about is an event: an original registered, a copy issued, a detection completed or attributed, a commit landed. Endpoints receive signed JSON with retries, a delivery log, and a test button, from the console, the API, or an agent.

## Agents

Every capability is an MCP tool. Hosted at `https://vybz.cloud/api/mcp` for zero-install use with URLs and base64, and as `@vybz/mcp-server` locally for folder workflows. `/v1/openapi.json` and `/llms.txt` serve non-MCP models.

## Plans

| Plan | Price | Includes |
|---|---|---|
| Manager | $9 / month, $90 / year | One member, 200 copies issued and 50 leak checks per month, leak reports, Content Credentials, 100 GB Vault. Hard limits. |
| Label | $85 / month, $850 / year | 5 members, 1,500 copies issued and 300 leak checks per month, then metered; batch issue, webhooks, audit export, 500 GB Vault. |
| Catalog | $245 / month, $2,450 / year | Unlimited members, 3 TB Vault, 10,000 issuances and 2,000 detections per month, then metered; CA-issued Content Credentials certificate; 99.9% SLA. |
| Enterprise | Custom | Volume pricing, dedicated signing certificate, private deployment, SSO, retention controls, named support. |
| Developer | $0 | For building an integration: 1 member, 3 keys, 100 copies and 20 leak checks per month, 2 GB Vault. Hard limits. Listed below the buyer plans on the pricing page. |

Every paid plan starts with a 14-day trial: a card is taken at checkout and charged when the trial ends unless the subscription is cancelled first. One trial per person. While trialing, every plan is capped at 25 issuances, 10 detections, and 10 GB with no overage; the plan's full quantities apply from the first paid period. Second subscriptions, from the same person or the same organization, start paid.

Meters: issuances, detections, unique stored bytes. Reads are free. Developer and Manager limits are hard caps enforced by the API with `402 plan_limit_reached`; Label, Catalog, and Enterprise are metered beyond the included quantities and billed in arrears with the next renewal.

Paid plans are sold by Paddle as merchant of record: checkout, invoices, tax, and refunds happen there, and the subscription is managed from Console → Billing. Prices exclude tax, which Paddle adds at checkout for the billing address given.

## Account

The avatar in the header opens the account menu: switch organization, jump to the console sections that belong to the account (API keys, billing, members, security, referrals), and sign out. **Security** changes the password and signs out every other device. **Referrals** gives each organization a link; organizations created by accounts that arrived on it are attributed to the referrer and listed, with rewards for converting referrals to follow.

## Teams

Organizations have an owner, admins, and members. Admins manage keys, members, and billing; members read everything. Invites are single-use links that expire in 14 days, created in **Console → Members** and accepted at `/console/join`.

## Non-goals

- No consumer social network, feed, profiles, live streaming, or discovery.
- No DAW plugin as a product. The VST3 in `native/` is retained only as a possible Vault capture source.
- No marketplace. Customers sell; VYBZ certifies and stores.

Last updated: 2026-09-08
