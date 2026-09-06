# Operations

## Environments

| | Production | Preview |
|---|---|---|
| Site | https://vybz.cloud | https://vybz-astramatrix.vercel.app |
| API | https://vybz.cloud/v1 | same Supabase project |
| Supabase | project `xixmneooyufbeftdfpcm` (us-west-1) | — |

## Deploy

```bash
# 1. Database
supabase db push                       # applies supabase/migrations/*

# 2. Edge functions
supabase functions deploy api-v1 --no-verify-jwt --project-ref xixmneooyufbeftdfpcm
supabase functions deploy billing-checkout --no-verify-jwt --project-ref xixmneooyufbeftdfpcm
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref xixmneooyufbeftdfpcm

# 3. Secrets (Edge)
supabase secrets set WM_SECRET="$(openssl rand -hex 32)" \
  API_PUBLIC_BASE="https://vybz.cloud/v1" \
  --project-ref xixmneooyufbeftdfpcm
# Optional Content Credentials:
supabase secrets set C2PA_WORKER_URL="https://c2pa.example" C2PA_WORKER_TOKEN="…" --project-ref xixmneooyufbeftdfpcm

# 4. Site + hosted MCP (Vercel, from main)
npm run validate && git push
```

`vercel.json` rewrites `/v1/*` to the Edge function and serves `/api/mcp` from `api/mcp.ts`.

## Secrets

| Name | Where | Purpose |
|---|---|---|
| `WM_SECRET` | Supabase Edge | HMAC root for watermark keys. Rotating it breaks detection of copies issued before rotation. Never rotate casually; if you must, keep the old value and add versioning first. |
| `API_PUBLIC_BASE` | Supabase Edge | Base URL in response `links`. |
| `C2PA_WORKER_URL`, `C2PA_WORKER_TOKEN` | Supabase Edge | Content Credentials signer. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Supabase Edge | Subscriptions. The webhook must subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. |
| `STRIPE_PRICE_BUSINESS` | Supabase Edge | Optional recurring price id for the Business plan. Without it Checkout uses inline pricing at $249/month. |
| `VYBZ_API_BASE` | Vercel | Hosted MCP → API base (default vybz.cloud/v1). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel | Console client. |

Nothing secret is ever prefixed `VITE_`.

## C2PA worker

Container on any glibc 2.39+ host (Ubuntu 24.04 image). `docker compose up -d --build` in `worker/c2pa` with `WORKER_TOKEN` set. A self-signed ES256 certificate is generated on first boot; production installs a CA-issued certificate into the `c2pa-certs` volume.

## Runbooks

**Key compromised.** Console → API keys → Revoke. Confirm in the audit log that calls stop. Create a replacement with narrower scopes.

**Chain reports `ok: false`.** Do not write to the organization. Export `provenance_chain` for the org ordered by `seq`, locate `first_bad_seq`, compare `prev_hash` linkage. This indicates database tampering or a failed partial write; restore from point-in-time backup to before the bad sequence.

**Plan did not update after payment.** Check the Stripe webhook delivery for `checkout.session.completed` with `metadata.kind = org_plan`; replay it. `org_billing` holds the subscription id and status; `orgs.plan` is what the gateway enforces.

**Rate bucket growth.** `select public.api_rate_buckets_prune();` on a daily schedule (Supabase cron).

**Large detection latency.** Detection is O(issuances × samples). If an asset exceeds ~5,000 issuances, advise the customer to register per-campaign variants.

**Storage growth.** Unique bytes per org: `select org_id, sum(size) from vault_blobs group by 1;` plus `provenance_assets.bytes`.

## Local development

```bash
cp .env.example .env.local        # fill VITE_SUPABASE_*
npm install
npm run dev                       # site + console
supabase functions serve api-v1 --no-verify-jwt --env-file supabase/.env.local
npm run mcp:dev                   # local MCP against VYBZ_API_BASE
```

## Quality gates

`npm run validate` = typecheck + unit tests + production build. CI runs it on every push. Do not merge red.

Last updated: 2026-09-05
