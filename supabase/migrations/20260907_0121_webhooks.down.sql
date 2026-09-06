select cron.unschedule(jobid) from cron.job where jobname in ('webhook-dispatch', 'webhook-deliveries-prune');
drop function if exists public.webhook_deliveries_prune();
drop function if exists public.webhooks_list(uuid);
drop function if exists public.webhook_dispatch(int);
drop function if exists public.webhook_emit(uuid, text, jsonb);
drop table if exists public.webhook_deliveries;
drop table if exists public.webhook_endpoints;
-- api_key_create keeps accepting 'webhooks:manage'; re-run migration 0116's definition to remove it.
