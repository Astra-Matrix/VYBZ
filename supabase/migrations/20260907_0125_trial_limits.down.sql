drop function if exists public.billing_trial_record(uuid, uuid, text);
drop function if exists public.billing_trial_used(uuid);
drop function if exists public.org_plan_usage(uuid);
drop function if exists public.trial_limits();
drop table if exists public.billing_trials;
-- org_plan_usage: re-run the definition from migration 0124.
