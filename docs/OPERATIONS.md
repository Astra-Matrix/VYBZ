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
supabase functions deploy billing-usage-report --no-verify-jwt --project-ref xixmneooyufbeftdfpcm

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

Two tiers. **Environment secrets** are set in the Supabase dashboard and read at request time. **Vault secrets** live in Postgres (`vault.create_secret`) and are read by edge functions through `platform_secret()`; they take precedence, so a value can be rotated with one SQL statement and no redeploy. Rotate a Vault secret:

```sql
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'STRIPE_WEBHOOK_SECRET';
```

| Name | Where | Purpose |
|---|---|---|
| `WM_SECRET` | Supabase Edge | HMAC root for watermark keys. Rotating it breaks detection of copies issued before rotation. Never rotate casually; if you must, keep the old value and add versioning first. |
| `API_PUBLIC_BASE` | Supabase Edge | Base URL in response `links`. |
| `C2PA_WORKER_URL`, `C2PA_WORKER_TOKEN` | Supabase Edge | Content Credentials signer. |
| `STRIPE_SECRET_KEY` | Supabase Edge (env) | Account secret key. Currently the **Astra Matrix sandbox** test key. Going live means replacing it with the live key of the same Stripe account and re-creating the webhook endpoint and price in live mode. |
| `STRIPE_WEBHOOK_SECRET` | Vault | Signing secret of the sandbox endpoint `we_1UCZafAfH0i9CqRvtEUTDMyE`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `account.updated`. |
| `STRIPE_PRICE_BUSINESS` | Vault | Recurring price for the Business plan (`price_1UCZbEAfH0i9CqRvGOkWYCGi`, product `prod_VCzamvFsytuSwW`, sandbox). |
| `BILLING_CRON_SECRET` | Vault | Header `x-cron-secret` for `billing-usage-report`; `run_billing_usage_report()` reads it for the pg_cron job. |
| `VYBZ_API_BASE` | Vercel | Hosted MCP → API base (default vybz.cloud/v1). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel | Console client. |

Nothing secret is ever prefixed `VITE_`.

## C2PA worker

Container on any glibc 2.39+ host (Ubuntu 24.04 image). `docker compose up -d --build` in `worker/c2pa` with `WORKER_TOKEN` set. A self-signed ES256 certificate is generated on first boot; production installs a CA-issued certificate into the `c2pa-certs` volume.

## Going live with Stripe

Everything is wired against the Stripe **sandbox** today, so upgrades can be exercised with test cards (4242 4242 4242 4242). To take real money:

1. In the live Stripe account, create the Business product and a $249/month recurring price. Note the price id.
2. Create a webhook endpoint for `https://xixmneooyufbeftdfpcm.supabase.co/functions/v1/stripe-webhook` with the four events above. Note the signing secret.
3. In Supabase → Edge Functions → Secrets, replace `STRIPE_SECRET_KEY` with the live key.
4. In SQL, rotate the two Vault values:

```sql
select vault.update_secret(id, 'whsec_…') from vault.secrets where name = 'STRIPE_WEBHOOK_SECRET';
select vault.update_secret(id, 'price_…') from vault.secrets where name = 'STRIPE_PRICE_BUSINESS';
```

No redeploy is needed.

## Runbooks

**Key compromised.** Console → API keys → Revoke. Confirm in the audit log that calls stop. Create a replacement with narrower scopes.

**Chain reports `ok: false`.** Do not write to the organization. Export `provenance_chain` for the org ordered by `seq`, locate `first_bad_seq`, compare `prev_hash` linkage. This indicates database tampering or a failed partial write; restore from point-in-time backup to before the bad sequence.

**Plan did not update after payment.** Check the Stripe webhook delivery for `checkout.session.completed` with `metadata.kind = org_plan`; replay it. `org_billing` holds the subscription id and status; `orgs.plan` is what the gateway enforces.

**Monthly overages.** The pg_cron job `billing-usage-report` (migration 0119) runs `run_billing_usage_report()` on the 1st of each month at 06:00 UTC. Inspect with `select * from cron.job_run_details order by start_time desc limit 5;` and `select * from net._http_response order by id desc limit 5;`. It computes last month's usage beyond the plan's included quantities for every Business and Enterprise organization with an active subscription and creates Stripe invoice items on the customer, which land on the next subscription invoice. Rates: $0.02 per issuance, $0.10 per detection, $0.015 per GB-month. Idempotent via `billing_usage_reports`; `?dry_run=1` previews, `?period=YYYY-MM-01` re-targets a month.

**Rate bucket growth.** `select public.api_rate_buckets_prune();` on a daily schedule (Supabase cron).

**Large detection latency.** Detection is O(issuances × samples). If an asset exceeds ~5,000 issuances, advise the customer to register per-campaign variants.

**Storage growth.** Unique bytes per org: `select org_id, sum(size) from vault_blobs group by 1;` plus `provenance_assets.bytes`.

## Repository shape

The legacy creator application was removed from the tree on 2026-09-06. `src/` now contains only the platform site, console, session, and Supabase client. Native shells, Playwright suites, perf tooling, and legacy edge-function sources are gone; their deployed edge functions keep running until retired from the Supabase dashboard. `native/vlink` (VST3 capture node) and `tools/vybz-bridge` (folder watcher) remain as Vault extraction candidates.

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
