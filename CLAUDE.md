# VYBZ — engineering doctrine

VYBZ is **audio infrastructure for businesses**, sold as two products behind one API key:

- **Provenance** — forensic watermarking, C2PA Content Credentials, verification, and leak attribution for audio.
- **Vault** — content-addressed version control for DAW projects and sample libraries.

Humans use the **Console** (`/console`). Machines and AI agents use the **API** (`/v1`) and **MCP** (`/api/mcp`, `@vybz/mcp-server`).

## Documentation policy (binding)

1. The only official documentation is `docs/` and `public/legal/`. Nothing else in the repository, in git history, in chat transcripts, or in any prior planning artifact is authoritative.
2. Every document written before **2026-09-05** (the platform pivot) is **redacted**: it must not be read for direction, quoted, restored, or used as a source for new documents. This includes any file or heading that mentions a masterplan, phases, gates, "Suite Genesis", "Living Profile", "Find Yours", Echo, or creator-social features. Code comments that cite those documents are historical noise, not guidance.
3. New knowledge goes into `docs/` as a new section or a new file with a `Last updated` line. Do not create parallel docs elsewhere.
4. `docs/DOCUMENTATION_POLICY.md` is the long form of this rule.

## Product direction (binding)

- Ship for the buyer with a budget: sample libraries, sync houses, labels, distributors, AI music companies, studios, schools.
- The creator-social app that previously lived at `/` is **legacy**. It stays compiled behind `VITE_FEATURE_LEGACY_CREATOR=on` only until its useful pieces are extracted, then it is removed. Do not add features to it.
- Every capability must be reachable three ways: Console (human), REST (machine), MCP tool (agent). If a feature lacks one of the three, it is unfinished.
- Premium is the bar. Copy is short, precise, and confident. No exclamation marks, no emoji in product surfaces, no filler.

## Layout

| Path | What |
|---|---|
| `supabase/migrations/20260905_0116_platform_api.sql` | Organizations, API keys, audit, Provenance, Vault schema and RPCs |
| `supabase/functions/api-v1/` | The public API gateway (Deno). `_shared/apiGateway.ts`, `_shared/openapi.ts`, `_shared/watermark.mjs` |
| `packages/mcp-server/` | `@vybz/mcp-server` — MCP tools + typed client. Used locally (stdio) and by the hosted endpoint |
| `api/mcp.ts` | Hosted MCP endpoint on Vercel (Streamable HTTP, stateless) |
| `src/site/` | Public site: home, product pages, docs, legal, sign in |
| `src/console/` | Console: organizations, keys, usage, audit, agent setup |
| `worker/c2pa/` | Optional Content Credentials signer (Node + c2patool, container host) |
| `docs/` | Official documentation |

Legacy directories (`src/features`, `src/pages`, `src/shell`, `src/components`, `native/`, `apps/desktop`, `android/`, `ios/`, `tools/vybz-bridge`) are untouched until extraction. Read them only when extracting.

## Working rules

- `npm run validate` must pass before a commit: typecheck, tests, build.
- Secrets never appear in `VITE_*`. Keys: `WM_SECRET`, `C2PA_WORKER_URL`, `C2PA_WORKER_TOKEN`, `API_PUBLIC_BASE` are Supabase Edge secrets.
- API changes update three things together: `api-v1/index.ts`, `_shared/openapi.ts`, `docs/API.md`. MCP tool changes update `packages/mcp-server/src/tools.ts` and `docs/AGENTS.md`.
- Migrations are additive and paired with a `.down.sql`.
- Commit messages: imperative, scoped (`api:`, `console:`, `mcp:`, `docs:`, `db:`).
