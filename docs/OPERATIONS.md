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

# 2. Edge functions. Fastest path, no CLI login needed: a personal access token from
#    supabase.com/dashboard/account/tokens, then one command. It bundles, uploads through the
#    Management API, and smoke-checks the descriptor and OpenAPI document.
#      SUPABASE_ACCESS_TOKEN=sbp_... npm run api:deploy
#    Manual equivalent (api-v1 ships as one esbuild bundle plus its import map; the same
#    bundle is what the Supabase connector deploys when the CLI is unavailable):
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
| `BILLING_PROVIDER` | Supabase Edge (env) | `paddle` (default when `PADDLE_API_KEY` is set) or `stripe`. Selects which provider new checkouts use; existing links keep their own provider. |
| `PADDLE_API_KEY`, `PADDLE_ENV` | Supabase Edge (env) | Paddle Billing API key and `sandbox` or `live`. Paddle is the merchant of record: it sells the subscription, collects tax, and bills overages. |
| `PADDLE_PRICE_BUSINESS` | Supabase Edge (env) | Monthly Business price used by the console's Upgrade button. Yearly: live `pri_01m1ysawsyk0n263k6ktrhbfbq`, sandbox `pri_01m1yrnhtqh0q9q60e23zvvbz7`. Live: `pri_01m1yqesgyjw5ysj92svmhxn3v` on product `pro_01m1yqes0gs9m80gxehk1gkhxk`. Sandbox: `pri_01m1ybdqphgqerhccne3my186b` on product `pro_01m1ybdqa5gvs29syp4bayhr6g`. |
| `PADDLE_CLIENT_TOKEN` | Supabase Edge (env) | Public client-side token handed to the console so Paddle.js can open the checkout overlay. Not secret, but kept with the rest so the console has no provider configuration of its own. |
| `PADDLE_WEBHOOK_SECRET` | Supabase Edge (env) or Vault | Endpoint secret of the notification destination pointing at `https://xixmneooyufbeftdfpcm.supabase.co/functions/v1/paddle-webhook`, subscribed to `transaction.completed` and `subscription.*`. Live destination `ntfset_01m1yqfc4vc95e14ncv50aqmrm`; sandbox `ntfset_01m1ybpgz6tmxdpfy12z61rfcy`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BUSINESS` | Edge / Vault | Legacy Stripe path, kept for organizations linked before the Paddle switch. See "Stripe modes". |
| `BILLING_CRON_SECRET` | Vault | Header `x-cron-secret` for `billing-usage-report`; `run_billing_usage_report()` reads it for the pg_cron job. |
| `VYBZ_API_BASE` | Vercel | Hosted MCP → API base (default vybz.cloud/v1). |
| `VITE_PADDLE_ENV`, `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICE_BUSINESS_MONTH`, `VITE_PADDLE_PRICE_BUSINESS_YEAR` | Vercel (public) | The pricing page's Paddle configuration: environment (`sandbox` or `live`, never defaulted), the client-side token, and the Business price ids for that environment. Without them the page shows static prices and sends buyers to the console. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel | Console client. |

Nothing secret is ever prefixed `VITE_`.

## Decode worker

`worker/decode` is a Node service that runs ffmpeg. It accepts up to 200 MB per request, caps decoded duration with `X-VYBZ-Max-Seconds`, and answers 32-bit float WAV. Health at `/healthz`. It never stores input; files are written to a temp directory for ffmpeg to seek and deleted after each request.

Hosted on Fly.io as one always-on machine in `sjc`, next to the Supabase project. `worker/decode/fly.toml` carries the whole configuration. First deploy, from a machine with `flyctl` signed in (`fly auth login`):

```sh
cd worker/decode
fly apps create vybz-decode
fly secrets set WORKER_TOKEN=$(openssl rand -hex 24) --app vybz-decode   # keep the value; the gateway needs it
fly deploy --app vybz-decode
curl https://vybz-decode.fly.dev/healthz
```

Then tell the gateway where it is. With a Supabase personal access token in `SUPABASE_ACCESS_TOKEN`:

```sh
npm run secrets:set -- DECODE_WORKER_URL=https://vybz-decode.fly.dev DECODE_WORKER_TOKEN=<the token above>
```

No redeploy is needed; edge functions read secrets on each invocation. Confirm with `GET /v1/provenance/formats`: `decode.worker_configured` turns `true` and the worker formats appear under `verify` and `detect`. Later deploys are `fly deploy --app vybz-decode` from `worker/decode`. Local alternative: `docker compose up -d --build` with `WORKER_TOKEN` set.

## C2PA worker

Container on any glibc 2.39+ host (Ubuntu 24.04 image). `worker/c2pa/fly.toml` runs it on Fly.io with a 1 GB volume for the certificate:

```sh
cd worker/c2pa
fly apps create vybz-c2pa
fly volumes create c2pa_certs --size 1 --region sjc --app vybz-c2pa
fly secrets set WORKER_TOKEN=$(openssl rand -hex 24) --app vybz-c2pa
fly deploy --app vybz-c2pa
npm run secrets:set -- C2PA_WORKER_URL=https://vybz-c2pa.fly.dev C2PA_WORKER_TOKEN=<the token>
```

A self-signed ES256 certificate is generated into the volume on first boot, which marks copies as signed by an untrusted issuer. Production installs a CA-issued certificate into the volume (`fly ssh console --app vybz-c2pa`, replace the files under `/certs`, restart). Local alternative: `docker compose up -d --build` in `worker/c2pa`.

## Edge function inventory

Four functions belong to the platform: `api-v1`, `billing-checkout`, `billing-usage-report`, `stripe-webhook`. Everything else in the project is the retired creator application or a temporary probe and can be deleted at any time; their tables are inert. `npm run functions:list` shows what is deployed and `npm run functions:retire` deletes the legacy set in one pass (both need `SUPABASE_ACCESS_TOKEN`). `npm run secrets:set -- NAME=value` sets edge secrets the same way.

## Paddle

Paddle Billing is the merchant of record. The console calls `billing-checkout`, which creates a Paddle transaction for the Business price against the organization's Paddle customer and returns its id; the console opens Paddle's overlay with Paddle.js. `paddle-webhook` syncs `transaction.completed` and every `subscription.*` event into `org_billing` and `orgs.plan`. Monthly overages are one-time charges on the subscription (`billing-usage-report`), collected with the next renewal.

Live since 2026-09-07: verified with a real zero-total checkout, a no-charge plan change, a scheduled cancellation, and an immediate cancellation, each confirmed through the webhook into `org_billing`. To switch environments the command is the same one used to go live (until then live transactions fail with `transaction_checkout_not_enabled`): `npm run secrets:set -- PADDLE_ENV=live PADDLE_API_KEY=<live key> PADDLE_CLIENT_TOKEN=<live client token> PADDLE_PRICE_BUSINESS=pri_01m1yqesgyjw5ysj92svmhxn3v PADDLE_WEBHOOK_SECRET=<live destination secret>`. The live dashboard also needs the default payment link set to `https://vybz.cloud/console/billing` under Checkout settings, with the domain approved. Paddle reviews the website before enabling live payments; the pricing and legal pages satisfy that review.

**Plan did not update after payment.** Paddle → Developer Tools → Notifications shows each delivery and its response; replay it. The webhook logs "no organization for subscription" when the transaction lacked `custom_data.org_id`, which only happens for transactions not created by the console.

## Stripe modes (legacy)

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

**Storage size limit.** Supabase enforces a project-wide file size limit on every object, single-request or chunked. On the free plan it is fixed at 50 MB, which is below the API's 200 MB audio, 500 MB blob, and 50 GB chunked limits; uploads above it fail with `storage_error` or `413`. On Pro the limit can be raised to 50 GB: `PATCH https://api.supabase.com/v1/projects/xixmneooyufbeftdfpcm/config/storage` with `{"fileSizeLimit": 53687091200}` and a personal access token, or Storage settings in the dashboard. Buckets have no limits of their own.

**Chunked uploads.** Sessions live in `vault_uploads` and are pruned a day after expiry by the `vault-uploads-prune` cron job. Storage's resumable protocol wants 6 MB parts, which is what the gateway uses.

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
