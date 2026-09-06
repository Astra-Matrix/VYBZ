-- ===========================================================================
-- VYBZ Platform — secrets in Supabase Vault and the monthly billing cron.
--
-- Secrets that must rotate without a redeploy live in Vault:
--   select vault.create_secret('<value>', 'STRIPE_WEBHOOK_SECRET', 'note');
--   select vault.create_secret('<value>', 'STRIPE_PRICE_BUSINESS', 'note');
--   select vault.create_secret('<value>', 'BILLING_CRON_SECRET', 'note');
-- Edge functions read them through platform_secret() (service role only) and
-- fall back to environment variables when a name is absent.
-- ===========================================================================

create or replace function public.platform_secret(p_name text)
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name order by created_at desc limit 1;
$$;
revoke all on function public.platform_secret(text) from public, anon, authenticated;
grant execute on function public.platform_secret(text) to service_role;

-- Monthly overage run at 06:00 UTC on the 1st, via pg_cron + pg_net. The wrapper
-- reads the cron secret from Vault so it never appears in the job definition.
create or replace function public.run_billing_usage_report()
returns bigint language plpgsql security definer set search_path = public, net, vault as $fn$
declare rid bigint;
begin
  select net.http_post(
    url := 'https://xixmneooyufbeftdfpcm.supabase.co/functions/v1/billing-usage-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.platform_secret('BILLING_CRON_SECRET')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into rid;
  return rid;
end $fn$;
revoke all on function public.run_billing_usage_report() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'billing-usage-report';
select cron.schedule('billing-usage-report', '0 6 1 * *', $$select public.run_billing_usage_report();$$);
