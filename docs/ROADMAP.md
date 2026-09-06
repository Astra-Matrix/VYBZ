# Roadmap

Ordered by revenue impact. Dates are targets, not promises.

## Now (Q4 2026)

- **Billing.** Stripe subscriptions for Business, metered issuances, detections, and unique stored bytes. Plan enforcement in `api_key_authenticate`.
- **Team invites.** `org_members` management in the console with owner, admin, member roles.
- **Compressed input.** Server-side decode of MP3, AAC, FLAC for `verify` and `detect` so customers do not pre-convert.
- **Chunked blob upload.** Resumable uploads for files above 500 MB.
- **Webhooks.** `issuance.created`, `detection.attributed`, `commit.created` with signed payloads.

## Next (Q1 2027)

- **Batch issue.** One call, N recipients, a zip or a manifest of links.
- **Detection queue.** Asynchronous detection for assets with very large issuance counts, with a job id and webhook.
- **Watermark for delivered MP3.** Embed in the decoded domain and re-encode so customers who ship MP3 keep attribution.
- **Auto-snapshot daemon.** Local watcher that commits a project folder after each save, derived from the existing folder-watch bridge.
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

Last updated: 2026-09-05
