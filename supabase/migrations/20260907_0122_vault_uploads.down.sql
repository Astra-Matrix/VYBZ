do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vault-uploads-prune';
  end if;
end $$;
drop function if exists public.vault_uploads_prune();
drop table if exists public.vault_uploads;
