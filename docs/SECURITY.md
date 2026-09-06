# Security

## Identity and keys

- People sign in with email and password through Supabase Auth; passkeys are supported.
- Machines and agents use **organization API keys**: `vybz_live_` plus 48 hex characters from 24 random bytes.
- Only the SHA-256 of a key is stored. The plaintext is returned once at creation and never again.
- Keys carry **scopes**, a **per-minute rate limit**, an optional **expiry**, and can be **revoked** instantly. A revoked key fails on the next request.
- Key creation and revocation require the `owner` or `admin` role in the organization.
- Team invites are single-use tokens (`vybz_inv_` + 48 hex), stored only as SHA-256, expiring in 14 days, revocable. The owner cannot be removed or demoted.

## Isolation

- Every table in the platform schema carries `org_id`. Row-level security allows reads only to organization members; writes happen only through `SECURITY DEFINER` functions or the gateway's service role.
- The gateway resolves the organization from the key and scopes every query by it. There is no route that accepts an organization id from the caller.
- Storage buckets `provenance-originals` and `vault-blobs` are private. Objects are namespaced by organization id. Access is by short-lived signed URL (1 hour for deliveries, 15 minutes for blobs) or by the gateway streaming bytes.

## Audit

- Every API and MCP call is recorded: method, path, status, latency, bytes in and out, user agent, request id, key id.
- Console members can read the log; nobody can edit or delete rows through the API.
- Daily usage per product is aggregated for billing and dashboards.

## Provenance integrity

- The watermark secret (`WM_SECRET`) exists only as an Edge secret. Watermark keys are HMAC-derived per organization, asset, recipient, and issuance; a compromised copy reveals nothing about other copies.
- Chain events are hash-linked. `GET /provenance/chain` recomputes the chain; the console shows the result.
- Content Credentials signing keys live only in the signing worker container.

## Transport and headers

- TLS everywhere. HSTS via `upgrade-insecure-requests` in the CSP.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict CSP on the site.
- CORS on the API is open by design (keys are bearer secrets, not cookies), and every response is `Cache-Control: no-store`.

## Agent safety

- Agents inherit the key's scopes and rate limit; nothing more.
- Local MCP filesystem tools are confined to `VYBZ_ROOTS`.
- The hosted MCP endpoint is stateless and never persists a key.

## Data handling

- Originals and blobs are stored in the region of the Supabase project (us-west-1). Enterprise can request a dedicated project in another region.
- Deleting an organization cascades to its keys, assets, issuances, chain, repositories, and blobs.
- Backups follow the database provider's point-in-time recovery.

## Webhooks

Every delivery is signed with the endpoint's secret over the timestamp and the exact body. Secrets are generated server-side, shown once, and rotatable. Endpoints must be https on public hosts; private and link-local addresses are refused. Deliveries never include API keys or secrets. See the signature recipe in [API](./API.md#webhooks).

## Reporting

Email security@vybz.cloud. Include a request id when relevant. We acknowledge within two business days.

Last updated: 2026-09-05
