# Architecture

## Services

| Service | Runtime | Role |
|---|---|---|
| **Site + Console** | Vite/React on Vercel, `src/site`, `src/console` | Marketing, docs, sign-in, organization and key management, usage, audit, agent setup. |
| **API gateway** | Supabase Edge (Deno), `supabase/functions/api-v1` | All `/v1` routes. Key auth, scopes, rate limiting, audit, Provenance DSP, Vault graph. |
| **Database** | Supabase Postgres | Organizations, keys, audit, assets, issuances, chain, repos, blobs, commits, branches. RLS + definer RPCs. |
| **Storage** | Supabase Storage | `provenance-originals` (originals and stored deliveries), `vault-blobs` (content-addressed). Private. |
| **Hosted MCP** | Vercel Node function, `api/mcp.ts` | Streamable HTTP MCP server; proxies to the gateway with the caller's key. |
| **Local MCP** | `packages/mcp-server` (npm `@vybz/mcp-server`) | stdio MCP with filesystem workflows. Also exports the typed client. |
| **C2PA worker** | Node + `c2patool` in a container, `worker/c2pa` | Optional Content Credentials signing. Called by the gateway when configured. |

## Request path

```
client / agent
   │  Authorization: Bearer vybz_live_…
   ▼
vybz.cloud/v1/*  ──(Vercel rewrite)──▶  Supabase Edge api-v1
                                            │ sha256(key) → api_key_authenticate (revocation, expiry, per-minute bucket)
                                            │ requireScope(route)
                                            │ handler (Postgres via service role, Storage, watermark DSP, optional C2PA worker)
                                            │ api_record_call (audit + daily usage, fire-and-forget)
                                            ▼
                                        JSON or audio/wav, X-Request-Id
```

The console talks to Postgres directly with the user's JWT; RLS restricts reads to organizations the user belongs to, and writes go through RPCs (`org_create`, `api_key_create`, `api_key_revoke`).

## Data model

```
orgs ─┬─ org_members
      ├─ api_keys ─── api_rate_buckets
      ├─ api_audit_log, api_usage_daily
      ├─ provenance_assets ─── provenance_issuances
      ├─ provenance_chain (hash-linked, per org)
      └─ vault_repos ─┬─ vault_commits (entries jsonb, sha, parent_sha, tree_sha)
                      └─ vault_branches (name → head_sha)
         vault_blobs (org, hash) → storage path
```

Definer RPCs used by the gateway (service role only): `api_key_authenticate`, `api_record_call`, `provenance_chain_append`, `provenance_chain_verify_service`, `vault_advance_branch`.

## Provenance DSP

`supabase/functions/_shared/watermark.mjs` is a dependency-free module that runs in Deno and Node: WAV parse/encode, HMAC key derivation, DSSS embed, FFT-based blind detection. See [Provenance](./PROVENANCE.md).

## Vault graph

Commits store their complete tree inline as JSON (path, hash, size). This keeps reads to a single row and makes diffs a map comparison. Blobs are shared per organization; a repository is a namespace over commits and branches, not over bytes.

## Front end

`src/site` and `src/console` are self-contained: their own stylesheet (`site.css`), no dependency on the legacy creator theme. `App.tsx` routes any site path to `SiteApp` before the legacy tree is considered; with `VITE_FEATURE_LEGACY_CREATOR` off, every other path redirects to `/`.

Docs are Markdown in `docs/` imported at build time and rendered with `marked`; the same files are the repository documentation.

## Legacy

The creator application (social, live, tools, native shells) remains in the tree behind a flag. It shares Supabase Auth and the `profiles` table but none of the platform tables. Extraction candidates: the VST3 capture node (`native/vlink`) as a Vault capture source; the folder watcher (`tools/vybz-bridge`) as a local auto-snapshot daemon.

Last updated: 2026-09-05
