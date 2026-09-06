select cron.unschedule(jobid) from cron.job where jobname = 'billing-usage-report';
drop function if exists public.run_billing_usage_report();
drop function if exists public.platform_secret(text);
