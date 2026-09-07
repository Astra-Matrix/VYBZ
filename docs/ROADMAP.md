# Roadmap

Ordered by revenue impact. Dates are targets, not promises.

## Now (Q4 2026)

- **Billing.** Shipped 2026-09-06: Business subscription, developer caps, members, invites, and monthly overage invoice items. Usage history in the console, `GET /billing/usage`, and `vybz_billing_usage` shipped 2026-09-06.
- **Compressed input.** Shipped 2026-09-07: WAV, AIFF, FLAC, MP3, Ogg Vorbis, and Opus decode in the edge; AAC/M4A, ALAC, MP4, MOV, WebM through the decode worker. Suspects are resampled to the asset's rate. Hosting: Fly.io configuration for the decode and Content Credentials workers shipped 2026-09-07 (`worker/*/fly.toml`); the first deploy is a one-time step in the operations doc.
- **Verification evidence.** Shipped 2026-09-07: exact hash, PCM hash, perceptual fingerprint with offset, Content Credentials check, and opt-in watermark attribution, in one call. Batches of 25 files or URLs. Console Verify page.
- **Chunked blob upload.** Shipped 2026-09-07: upload sessions with 6 MB parts, resumable for 24 hours, up to 50 GB, verified against the declared hash as the parts pass. The MCP tools and the console use it automatically above 200 MB.
- **Batch issue.** Shipped 2026-09-07: `POST /provenance/assets/{id}/issue/batch`, up to 50 recipients, a link per recipient and a stored manifest of links. Console Assets page for registering, issuing, and reviewing issuances.
- **Vault console.** Shipped 2026-09-07: repositories, branches, history, file lists with downloads, per-commit changes, and restore to a local folder in browsers with directory access.
- **Webhooks.** Shipped 2026-09-07: `asset.registered`, `issuance.created`, `detection.completed`, `detection.attributed`, `commit.created` with HMAC signatures, retries, delivery log, console page, and MCP tools.

## Next (Q1 2027)

- **Detection queue.** Asynchronous detection for assets with very large issuance counts, with a job id and webhook.
- **Watermark for delivered MP3.** Embed in the decoded domain and re-encode so customers who ship MP3 keep attribution.
- **Auto-snapshot daemon.** Local watcher that commits a project folder after each save, derived from `tools/vybz-bridge`.

## Later

- **DAW capture source.** The VST3 node becomes a Vault capture point for bounces with transport metadata.
- **Organization-level Content Credentials certificate provisioning** with a guided key ceremony.
- **Private deployment** for enterprise: dedicated Supabase project and worker per customer.
- **SDKs.** Generated TypeScript and Python clients from the OpenAPI document.

## Deliberately not

- A consumer social product.
- A marketplace.
- DRM. Provenance is attribution; it does not stop playback or copying.

Last updated: 2026-09-07
