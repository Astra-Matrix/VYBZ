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

Three shared modules run unchanged in Deno and Node and are tested in Node against real encoder output (`_shared/audio.test.ts`, fixtures made with ffmpeg):

- `_shared/watermark.mjs`: WAV parse/encode, HMAC key derivation, DSSS embed, and blind detection split into a key-independent fold plus per-key FFT correlation.
- `_shared/decode.mjs`: byte-level format sniffing, WAV/AIFF parsers, WASM decoders for FLAC, MP3, Vorbis, and Opus (chunked so a frame cap stops early), a windowed-sinc resampler, the canonical PCM hash, and the call-out to the ffmpeg decode worker.
- `_shared/fingerprint.mjs`: the perceptual fingerprint and its bit-error-rate matcher. The inverted index lives in `provenance_fingerprint_index` with vote and store RPCs.

See [Provenance](./PROVENANCE.md).

## Vault graph

Commits store their complete tree inline as JSON (path, hash, size). This keeps reads to a single row and makes diffs a map comparison. Blobs are shared per organization; a repository is a namespace over commits and branches, not over bytes.

## Front end

`src/site` and `src/console` are the whole front end: their own stylesheet (`site.css`), a thin session provider over Supabase Auth, and the Supabase client. `App.tsx` renders `SiteApp`; unknown paths redirect to `/`.

Docs are Markdown in `docs/` imported at build time and rendered with `marked`; the same files are the repository documentation. `src/site/docsIndex.ts` is the single list of public documents.

## Rendering and search

The site is a single-page application that ships prerendered. `npm run build` runs `vite build` and then `scripts/prerender.mjs`, which builds `src/entry-server.tsx` for Node, renders every indexable route with `renderToString`, and writes `dist/<route>/index.html` with route-specific head tags. `main.tsx` hydrates when the root already has markup and mounts fresh otherwise. Routes that are not prerendered (console, sign in, unknown paths) are served `app.html`, a clean shell, through the Vercel rewrite.

`src/site/seo.ts` is the single source of page metadata: title, description, canonical URL, robots directive, and JSON-LD for each route. The prerenderer reads it at build time, `SiteShell` applies it on every client navigation, and `seo.test.ts` enforces length limits and coverage of every doc and legal page. The same script writes `sitemap.xml` from the indexable routes with `lastmod` taken from each document's `Last updated` line, and `llms-full.txt` from the public documentation. `public/robots.txt` allows everything except the console, sign in, and `/api/`.

Adding a page: add the route in `SiteApp.tsx` and its entry in `seo.ts`. The tests fail if a doc has no metadata.

## Legacy

The creator application was removed from the repository on 2026-09-06. Its database tables and deployed edge functions still exist in the Supabase project and are inert; retire them from the dashboard when convenient. Two pieces were kept for extraction: the VST3 capture node (`native/vlink`) as a Vault capture source, and the folder watcher (`tools/vybz-bridge`) as a local auto-snapshot daemon.

Last updated: 2026-09-07
