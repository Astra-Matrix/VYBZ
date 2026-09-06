# API reference

Base URL `https://vybz.cloud/v1`. Machine-readable: [`/v1/openapi.json`](https://vybz.cloud/v1/openapi.json).

## Conventions

- **Auth:** `Authorization: Bearer vybz_live_<48 hex>` or `X-API-Key`. Keys belong to an organization and carry scopes.
- **Request id:** every response has `X-Request-Id`. Quote it to support.
- **Rate limit:** per key per minute. `X-RateLimit-Remaining` on success; `429` with `Retry-After: 60` when exceeded.
- **Errors:** JSON body `{ "error": { "code", "message", "request_id", "docs", …extra } }`.
- **Binary in:** send raw bytes as the body with a matching `Content-Type`. Never multipart.
- **Binary out:** watermarked copies return `audio/wav` by default; send `Accept: application/json` for a stored copy and a one-hour link.
- **Size limits:** audio 200 MB, blobs 500 MB per request.
- **Versioning:** `X-VYBZ-Api-Version` reports the contract date. Breaking changes ship as a new date and are announced 90 days ahead.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 401 | `unauthenticated`, `invalid_key` | Missing, unknown, revoked, or expired key. |
| 402 | `plan_limit_reached` | Developer plan cap hit (`plan`, `used`, `included`, `upgrade` in extra). Business and Enterprise are metered, never blocked. |
| 403 | `insufficient_scope` | Key lacks the required scope (`required_scope` in extra). |
| 404 | `not_found`, `route_not_found` | Object not in this organization, or no such route. |
| 405 | `method_not_allowed` | |
| 409 | `checksum_mismatch`, `slug_taken`, `missing_blobs`, `head_moved`, `branch_exists` | Conflict; the extra fields say what to fix. |
| 413 | `payload_too_large` | |
| 415 | `unsupported_media_type` | JSON expected. |
| 422 | `unsupported_audio`, `invalid_recipient`, `invalid_entries`, `invalid_path`, `invalid_hash`, `invalid_branch`, … | Validation. |
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
Body: PCM WAV bytes (16/24/32-bit int or 32-bit float). Headers: `X-VYBZ-Title`, `X-VYBZ-External-Ref`, optional `X-VYBZ-Content-SHA256`.
Returns `201` with the asset, or `200` with `existed: true` when identical bytes were registered before.

```json
{ "id": "…", "object": "provenance.asset", "title": "…", "sha256": "…", "bytes": 1, "sample_rate": 48000, "channels": 2, "duration_sec": 214.5, "links": { … } }
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
Body: suspect audio as PCM WAV. Correlates against every issuance of the asset.

```json
{ "object": "provenance.detection", "attributed": { "issuance_id", "recipient", "watermark_id", "score", "exact" } | null,
  "confidence": "exact" | "high" | "medium" | "none", "matches": [ …top 25… ], "candidates": 212 }
```
Attribution is asserted on an exact byte match, when the top score exceeds 0.15 and is at least 2.5× the runner-up, or when the top score is a z-score outlier above 8 against the other candidates and a set of never-issued decoy keys. `statistics: { z, ratio }` is returned for your own policy. See [Provenance](./PROVENANCE.md).

### `POST /provenance/verify` — `provenance:read`
Body: any bytes. Exact-hash lookup against originals and issued copies of the organization.

```json
{ "known": true, "kind": "issued_copy", "asset": { … }, "issuance": { … } }
```

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

Last updated: 2026-09-05
