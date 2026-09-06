# Roadmap

Ordered by revenue impact. Dates are targets, not promises.

## Now (Q4 2026)

- **Billing.** Shipped 2026-09-06: Business subscription, developer caps, members, invites, and monthly overage invoice items. Remaining: an in-console usage report history.
- **Compressed input.** Shipped 2026-09-07: WAV, AIFF, FLAC, MP3, Ogg Vorbis, and Opus decode in the edge; AAC/M4A, ALAC, MP4, MOV, WebM through the decode worker. Suspects are resampled to the asset's rate. Remaining: host the decode worker.
- **Verification evidence.** Shipped 2026-09-07: exact hash, PCM hash, perceptual fingerprint with offset, Content Credentials check, and opt-in watermark attribution, in one call. Batches of 25 files or URLs. Console Verify page.
- **Chunked blob upload.** Resumable uploads for files above 500 MB.
- **Webhooks.** `issuance.created`, `detection.attributed`, `commit.created` with signed payloads.

## Next (Q1 2027)

- **Batch issue.** One call, N recipients, a zip or a manifest of links.
- **Detection queue.** Asynchronous detection for assets with very large issuance counts, with a job id and webhook.
- **Watermark for delivered MP3.** Embed in the decoded domain and re-encode so customers who ship MP3 keep attribution.
- **Auto-snapshot daemon.** Local watcher that commits a project folder after each save, derived from `tools/vybz-bridge`.
- **Vault console.** Browse repositories, history, and diffs in the console; restore from the browser.

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
