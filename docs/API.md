# API reference

Base URL `https://vybz.cloud/v1`. Machine-readable: [`/v1/openapi.json`](https://vybz.cloud/v1/openapi.json).

## Conventions

- **Auth:** `Authorization: Bearer vybz_live_<48 hex>` or `X-API-Key`. Keys belong to an organization and carry scopes.
- **Request id:** every response has `X-Request-Id`. Quote it to support.
- **Rate limit:** per key per minute. `X-RateLimit-Remaining` on success; `429` with `Retry-After: 60` when exceeded.
- **Errors:** JSON body `{ "error": { "code", "message", "request_id", "docs", …extra } }`.
- **Binary in:** send raw bytes as the body, or one `multipart/form-data` file part. Batch routes take many parts, or JSON with URLs to fetch.
- **Audio in:** any format for verify and detect (WAV, AIFF, FLAC, MP3, Ogg Vorbis, Opus in the edge; AAC/M4A, ALAC, MP4, MOV, WebM through the decode worker). Lossless only for registration. `GET /provenance/formats` reports the live list.
- **Console sessions:** the console calls the same API with the member's session JWT plus `X-VYBZ-Org`. Integrations use keys.
- **Binary out:** watermarked copies return `audio/wav` by default; send `Accept: application/json` for a stored copy and a one-hour link.
- **Size limits:** audio 200 MB, blobs 500 MB per request. Batches: 25 files, 200 MB total. Analysis decodes up to about six minutes per file at 44.1 kHz and reports `truncated` beyond that.
- **Versioning:** `X-VYBZ-Api-Version` reports the contract date. Breaking changes ship as a new date and are announced 90 days ahead.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 401 | `unauthenticated`, `invalid_key`, `invalid_session` | Missing, unknown, revoked, or expired key; or an expired console session. |
| 402 | `plan_limit_reached` | Developer plan cap hit (`plan`, `used`, `included`, `upgrade` in extra). Business and Enterprise are metered, never blocked. |
| 403 | `insufficient_scope`, `not_a_member` | Key lacks the required scope (`required_scope` in extra); or the session user is not in the organization. |
| 404 | `not_found`, `route_not_found` | Object not in this organization, or no such route. |
| 405 | `method_not_allowed` | |
| 409 | `checksum_mismatch`, `slug_taken`, `missing_blobs`, `head_moved`, `branch_exists` | Conflict; the extra fields say what to fix. |
| 413 | `payload_too_large` | |
| 415 | `unsupported_media_type` | JSON or multipart expected. |
| 422 | `unsupported_audio`, `undecodable_audio`, `lossless_required`, `invalid_url`, `url_not_allowed`, `fetch_failed`, `too_many_items`, `invalid_multipart`, `invalid_recipient`, `invalid_entries`, `invalid_path`, `invalid_hash`, `invalid_branch`, … | Validation. Audio errors carry `supported` (formats) in extra. |
| 429 | `rate_limited` | |
| 503 | `not_configured` | Watermarking secret absent on this deployment. |
| 500 | `internal_error`, `db_error`, `storage_error` | Retry with backoff; include the request id when reporting. |

## Platform

### `GET /`
Service descriptor: products, agent entry points, docs. No auth required.

### `GET /me` — scope `org:read`
Organization and key metadata.

## Provenance

### `POST /provenance/assets` — `provenance:write`
Body: a lossless original (WAV 8 to 32-bit or float, AIFF/AIFC, FLAC), raw or as one multipart part. Headers: `X-VYBZ-Title`, `X-VYBZ-External-Ref`, optional `X-VYBZ-Content-SHA256`.
The file is stored as sent. It is hashed as bytes (`sha256`) and as canonical PCM (`pcm_sha256`, identical across lossless containers), and its first ten minutes are fingerprinted so later verifications can identify it without an id. Lossy input is refused with `lossless_required`.
Returns `201` with the asset, or `200` with `existed: true` when identical bytes were registered before.

```json
{ "id": "…", "object": "provenance.asset", "title": "…", "sha256": "…", "pcm_sha256": "…", "source_format": "flac", "fingerprint_frames": 12904, "bytes": 1, "sample_rate": 48000, "channels": 2, "duration_sec": 214.5, "links": { … } }
```

### `GET /provenance/assets?limit=` — `provenance:read`
### `GET /provenance/assets/{id}` — `provenance:read`
Adds `issuance_count`.

### `POST /provenance/assets/{id}/issue` — `provenance:write`
JSON `{ "recipient": string, "license"?: string, "store"?: boolean, "c2pa"?: boolean }`.
`recipient` is your stable identifier for the receiving party. Each call creates a new issuance with a new watermark, even for the same recipient.

Response `201`: WAV bytes with headers `X-VYBZ-Issuance-Id`, `X-VYBZ-Watermark-Id`, `X-VYBZ-C2PA` (`1` when a Content Credentials manifest was attached), `X-VYBZ-SHA256`.
With `Accept: application/json` or `store: true`: the copy is stored and the body is the issuance plus `download: { url, expires_in: 3600 }`.

### `GET /provenance/assets/{id}/issuances` — `provenance:read`
### `GET /provenance/assets/{id}/ledger` — `provenance:read`
Ordered chain events for the asset: `register`, `issue`, `c2pa`, `verify`, `detect`.

### `POST /provenance/assets/{id}/detect` — `provenance:detect`
Body: the suspect file in any supported format, raw or as one multipart part. It is decoded, resampled to the asset's sample rate when they differ, and correlated against every issuance of the asset. Metered as one detection.

```json
{ "object": "provenance.detection", "input": { "format": "mp3", "sample_rate": 48000, "analyzed_sec": 31.2, "truncated": false, … },
  "resampled_from": 48000, "attributed": { "issuance_id", "recipient", "watermark_id", "score", "exact" } | null,
  "confidence": "exact" | "high" | "medium" | "none", "statistics": { "z", "ratio" }, "matches": [ …top 25… ], "candidates": 212 }
```
Attribution is asserted on an exact byte or PCM match, when the top score exceeds 0.15 and is at least 2.5× the runner-up, or when the top score is a z-score outlier above 8 against the other candidates and a set of never-issued decoy keys. `statistics: { z, ratio }` is returned for your own policy. See [Provenance](./PROVENANCE.md).

### `POST /provenance/assets/{id}/detect/batch` — `provenance:detect`
Up to 25 suspect files: `multipart/form-data` with any number of file parts, or JSON `{ "items": [{ "url", "name"? }] }` for files to fetch (https, public hosts only). Each item is processed independently and metered as one detection.

```json
{ "object": "list", "asset_id": "…", "data": [ { "status": "ok", "name": "clip1.mp3", …detection }, { "status": "error", "name": "bad.txt", "error": { "code": "unsupported_audio", … } } ],
  "summary": { "total": 2, "attributed": 1, "errors": 1 } }
```

### `POST /provenance/verify` — `provenance:read`
Body: any file, raw or as one multipart part. Every method of establishing what the file is runs in order of cost and is reported as evidence:

| Method | Answers | Cost |
|---|---|---|
| `exact_hash` | Are these the exact bytes of an original or an issued copy? | Free |
| `pcm_hash` | Is the decoded audio identical to one we hold, in any lossless container or with different metadata? | Free |
| `fingerprint` | Which registered original does this audio derive from, and at what offset? Survives codecs, bitrate, gain, trimming. | Free |
| `content_credentials` | Is a C2PA manifest present, and does a VYBZ manifest match the issuance record? | Free |
| `watermark` | Which recipient's copy is this? Runs with `?attribute=true` on the identified asset, or on `?asset=<id>`. | One detection |

```json
{ "object": "provenance.verification", "verdict": "derived_copy", "confidence": "high", "known": true, "kind": "derived",
  "input": { "format": "opus", "codec": "opus", "sample_rate": 48000, "duration_sec": 42.1, "truncated": false, … },
  "asset": { … }, "issuance": { … },
  "evidence": [
    { "method": "exact_hash", "result": "no_match" },
    { "method": "pcm_hash", "result": "no_match" },
    { "method": "fingerprint", "result": "match", "asset_id": "…", "similarity": 0.91, "offset_sec": 41.2, "overlap_sec": 42.0, "votes": 388 },
    { "method": "content_credentials", "result": "absent" },
    { "method": "watermark", "result": "attributed", "confidence": "high", "attributed": { "recipient": "sync-house@partner.com", … }, "statistics": { "z": 37.1, "ratio": 6.2 } }
  ], "hint": null }
```

Verdicts: `original` (the registered original, by bytes or PCM), `issued_copy` (a copy we issued, by bytes or PCM), `derived_copy` (altered audio attributed to a recipient by watermark), `derived_unattributed` (derives from a known original, no recipient established), `unknown`. `known` and `kind` remain for older integrations.

### `POST /provenance/verify/batch` — `provenance:read`
Same body shapes as `detect/batch`; `attribute` and `asset` may be form fields, JSON fields, or query parameters. Returns one verification per item and a `summary` counted by verdict.

### `GET /provenance/formats` — any scope
Formats decoded in the edge, formats routed to the decode worker (and whether one is configured), what registration accepts, size and batch limits, and the list of verification methods.

### `GET /provenance/chain` — `provenance:read`
Recomputes the organization's hash chain: `{ ok, length, first_bad_seq }`.

## Vault

### `POST /vault/repos` — `vault:write`
JSON `{ "name", "slug"?, "description"?, "daw"?, "default_branch"? }`. `409 slug_taken` on collision.

### `GET /vault/repos` · `GET /vault/repos/{repo}` — `vault:read`
`{repo}` is an id or slug. Detail adds `branches[]` and `commit_count`.

### `POST /vault/repos/{repo}/blobs/exists` — `vault:read`
JSON `{ "hashes": [sha256…] }` (max 5000) → `{ "present": [], "missing": [] }`.

### `POST /vault/repos/{repo}/blobs` — `vault:write`
Body: raw bytes. Headers: optional `X-VYBZ-Content-SHA256` (rejected on mismatch), `X-VYBZ-Mime`.
Returns `{ hash, size, existed }`. Blobs are deduplicated across the whole organization.

### `GET /vault/repos/{repo}/blobs/{hash}` — `vault:read`
`{ hash, size, mime, download: { url, expires_in: 900 } }`.

### `POST /vault/repos/{repo}/commits` — `vault:write`
JSON:
```json
{ "branch": "main", "message": "…", "parent": "<expected head sha>" | null,
  "entries": [ { "path": "Samples/kick.wav", "hash": "…", "size": 88244 } ], "meta": { "daw": "ableton", "bpm": 124 } }
```
- `entries` is the complete tree. Paths are `/`-separated, no `..`, unique.
- Every hash must exist (`409 missing_blobs` lists up to 100).
- Omit `parent` to commit on the current head; pass it to enforce optimistic concurrency (`409 head_moved`).
- Identical tree to the head returns `200` with `unchanged: true`.
- `tree_sha` = SHA-256 of the canonical sorted entries; `sha` = SHA-256 of `{tree, parent, message, created_at, org}`.

### `GET /vault/repos/{repo}/commits?ref=&limit=` — `vault:read`
History by walking parents from `ref` (branch or sha; default branch when omitted).

### `GET /vault/repos/{repo}/commits/{sha}` — `vault:read`
Commit with full `entries`.

### `GET /vault/repos/{repo}/tree?ref=` · `GET /vault/repos/{repo}/diff?from=&to=` — `vault:read`
Diff returns `added[]`, `removed[]`, `modified[{path, before, after, size}]`.

### `GET /vault/repos/{repo}/branches` · `POST /vault/repos/{repo}/branches` — `vault:read` / `vault:write`
Create: `{ "name", "from"?: branch|sha }`.

## Scopes

| Scope | Grants |
|---|---|
| `org:read` | `/me` |
| `provenance:read` | list/get assets, issuances, ledger, verify, chain |
| `provenance:write` | register, issue |
| `provenance:detect` | detect |
| `vault:read` | repos, history, tree, diff, branches, blob links, exists |
| `vault:write` | create repo, upload blobs, commit, create branch |

Last updated: 2026-09-07
