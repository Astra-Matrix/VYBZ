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

# 2. Edge functions (api-v1 ships as one esbuild bundle plus its import map;
#    the same bundle is what the Supabase connector deploys when the CLI is unavailable)
npx esbuild supabase/functions/api-v1/index.ts --bundle --minify --format=esm --platform=neutral --target=esnext   --external:mpg123-decoder --external:@wasm-audio-decoders/flac --external:@wasm-audio-decoders/ogg-vorbis   --external:ogg-opus-decoder --external:https://esm.sh/* --outfile=/tmp/api-v1/index.js
cp supabase/functions/api-v1/deno.json /tmp/api-v1/deno.json
supabase functions deploy api-v1 --no-verify-jwt --project-ref xixmneooyufbeftdfpcm --import-map /tmp/api-v1/deno.json
supabase functions deploy billing-checkout --no-verify-jwt --project-ref xixmneooyufbeftdfpcm
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref xixmneooyufbeftdfpcm
supabase functions deploy billing-usage-report --no-verify-jwt --project-ref xixmneooyufbeftdfpcm

# 3. Secrets (Edge)
supabase secrets set WM_SECRET="$(openssl rand -hex 32)" \
  API_PUBLIC_BASE="https://vybz.cloud/v1" \
  --project-ref xixmneooyufbeftdfpcm
# Optional Content Credentials:
supabase secrets set C2PA_WORKER_URL="https://c2pa.example" C2PA_WORKER_TOKEN="…" --project-ref xixmneooyufbeftdfpcm
# Optional AAC/MP4 input:
supabase secrets set DECODE_WORKER_URL="https://decode.example" DECODE_WORKER_TOKEN="…" --project-ref xixmneooyufbeftdfpcm

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
| `DECODE_WORKER_URL`, `DECODE_WORKER_TOKEN` | Supabase Edge | ffmpeg decode worker for AAC/M4A, ALAC, MP4, MOV, WebM, WMA input. Without it those formats answer `422 unsupported_audio`; WAV, AIFF, FLAC, MP3, Ogg, Opus decode in the edge regardless. |
| `STRIPE_SECRET_KEY` | Supabase Edge (env) | Secret key of the Stripe account in use. Live: the **VYBZ** account (`acct_1TwTEtAnnpt9OYZI`). Sandbox: Astra Matrix sandbox (`acct_1UBzybAfH0i9CqRv`). |
| `STRIPE_WEBHOOK_SECRET` | Vault | Signing secret of the webhook endpoint at `https://xixmneooyufbeftdfpcm.supabase.co/functions/v1/stripe-webhook`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `account.updated`. Sandbox endpoint: `we_1UCZafAfH0i9CqRvtEUTDMyE`. |
| `STRIPE_PRICE_BUSINESS` | Vault | Recurring $249/month price for the Business plan. Live (VYBZ): `price_1UChynAnnpt9OYZI6sxnvJ4p`, product `prod_VD8CIWhlFEW3ug`. Sandbox: `price_1UCZbEAfH0i9CqRvGOkWYCGi`, product `prod_VCzamvFsytuSwW`. |
| `BILLING_CRON_SECRET` | Vault | Header `x-cron-secret` for `billing-usage-report`; `run_billing_usage_report()` reads it for the pg_cron job. |
| `VYBZ_API_BASE` | Vercel | Hosted MCP → API base (default vybz.cloud/v1). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel | Console client. |

Nothing secret is ever prefixed `VITE_`.

## Decode worker

`worker/decode` is a Node service that runs ffmpeg. `docker compose up -d --build` with `WORKER_TOKEN` set, then point `DECODE_WORKER_URL` and `DECODE_WORKER_TOKEN` at it. It accepts up to 200 MB per request, caps decoded duration with `X-VYBZ-Max-Seconds`, and answers 32-bit float WAV. Health at `/healthz`. It never stores input; files are written to a temp directory for ffmpeg to seek and deleted after each request.

## C2PA worker

Container on any glibc 2.39+ host (Ubuntu 24.04 image). `docker compose up -d --build` in `worker/c2pa` with `WORKER_TOKEN` set. A self-signed ES256 certificate is generated on first boot; production installs a CA-issued certificate into the `c2pa-certs` volume.

## Stripe modes

Live objects exist in the VYBZ account (product and price above). Switching between sandbox and live is one dashboard action plus one SQL statement, no redeploy:

1. Supabase → Edge Functions → Secrets: set `STRIPE_SECRET_KEY` to the key of the target account.
2. Rotate the two Vault values to the matching endpoint signing secret and price id from the table above:

```sql
select vault.update_secret(id, '<signing secret of the endpoint>') from vault.secrets where name = 'STRIPE_WEBHOOK_SECRET';
select vault.update_secret(id, '<price id>') from vault.secrets where name = 'STRIPE_PRICE_BUSINESS';
```

While the key and the Vault values disagree, checkout fails and webhook signatures are rejected. Only one enabled endpoint per account should point at the edge function, otherwise every event is delivered twice and one copy fails signature verification. Sandbox mode accepts test cards (4242 4242 4242 4242); live mode takes real money.

## Runbooks

**Key compromised.** Console → API keys → Revoke. Confirm in the audit log that calls stop. Create a replacement with narrower scopes.

**Chain reports `ok: false`.** Do not write to the organization. Export `provenance_chain` for the org ordered by `seq`, locate `first_bad_seq`, compare `prev_hash` linkage. This indicates database tampering or a failed partial write; restore from point-in-time backup to before the bad sequence.

**Plan did not update after payment.** Check the Stripe webhook delivery for `checkout.session.completed` with `metadata.kind = org_plan`; replay it. `org_billing` holds the subscription id and status; `orgs.plan` is what the gateway enforces.

**Monthly overages.** The pg_cron job `billing-usage-report` (migration 0119) runs `run_billing_usage_report()` on the 1st of each month at 06:00 UTC. Inspect with `select * from cron.job_run_details order by start_time desc limit 5;` and `select * from net._http_response order by id desc limit 5;`. It computes last month's usage beyond the plan's included quantities for every Business and Enterprise organization with an active subscription and creates Stripe invoice items on the customer, which land on the next subscription invoice. Rates: $0.02 per issuance, $0.10 per detection, $0.015 per GB-month. Idempotent via `billing_usage_reports`; `?dry_run=1` previews, `?period=YYYY-MM-01` re-targets a month.

**Webhook backlog.** `select status, count(*) from webhook_deliveries group by 1;`. The pg_cron job `webhook-dispatch` runs every minute and the gateway dispatches immediately after each event; `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'webhook-dispatch') order by start_time desc limit 5;` shows the sweep. Responses arrive through pg_net into `net._http_response` and are reconciled on the next pass. Endpoints that fail six times leave deliveries `failed`; the customer retries them from the console or the API. `webhook-deliveries-prune` drops rows older than 30 days at 04:30 UTC.

**Rate bucket growth.** `select public.api_rate_buckets_prune();` on a daily schedule (Supabase cron).

**Large detection latency.** Decoding dominates for long files; correlation is one 8192-point FFT per issuance. If an asset exceeds ~5,000 issuances, advise the customer to register per-campaign variants.

**Fingerprint index growth.** `select count(*) from provenance_fingerprint_index;` grows by about 21 rows per second of registered audio, capped at ten minutes per asset. Rebuild an asset's entry by re-registering is not possible; use `provenance_fingerprint_store` from SQL with a fresh fingerprint if an index is ever lost.

**Edge function dependencies.** `api-v1` imports WASM decoders through `supabase/functions/api-v1/deno.json`. Deploy with that file alongside `index.ts` and the `_shared` modules.

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

Last updated: 2026-09-07
