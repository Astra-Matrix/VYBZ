-- ===========================================================================
-- VYBZ Platform — trial limits and one trial per person.
--
-- While a subscription is trialing, every plan is capped at 25 issuances,
-- 10 detections, and 10 GB with no overage; the plan's full quantities apply
-- from the first paid period. A trial is recorded against the user account
-- that started it, so a second subscription from the same person starts paid.
-- ===========================================================================

create table if not exists public.billing_trials (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid references public.orgs(id) on delete set null,
  plan       text,
  started_at timestamptz not null default now()
);
alter table public.billing_trials enable row level security;
-- No policies: read and written by the billing functions only.

create or replace function public.trial_limits()
returns table (issuances_month bigint, detections_month bigint, storage_bytes bigint)
language sql immutable as $$ select 25::bigint, 10::bigint, 10737418240::bigint $$;

create or replace function public.org_plan_usage(p_org uuid)
returns table (plan text, issuances_month bigint, detections_month bigint, storage_bytes bigint,
               limit_issuances bigint, limit_detections bigint, limit_storage bigint, hard_cap boolean, trial boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare pl text; st text; mstart timestamptz := date_trunc('month', now());
begin
  select o.plan into pl from public.orgs o where o.id = p_org;
  if pl is null then return; end if;
  select b.status into st from public.org_billing b where b.org_id = p_org;
  return query
    select pl,
      (select count(*) from public.provenance_issuances i where i.org_id = p_org and i.created_at >= mstart)::bigint,
      (select count(*) from public.provenance_chain c where c.org_id = p_org and c.event = 'detect' and c.created_at >= mstart)::bigint,
      ((select coalesce(sum(b.size),0) from public.vault_blobs b where b.org_id = p_org)
        + (select coalesce(sum(a.bytes),0) from public.provenance_assets a where a.org_id = p_org))::bigint,
      case when st = 'trialing' then t.issuances_month else l.issuances_month end,
      case when st = 'trialing' then t.detections_month else l.detections_month end,
      case when st = 'trialing' then t.storage_bytes else l.storage_bytes end,
      (st = 'trialing') or l.hard_cap,
      (st = 'trialing')
    from public.plan_limits(pl) l, public.trial_limits() t;
end $fn$;
revoke all on function public.org_plan_usage(uuid) from public, anon;
grant execute on function public.org_plan_usage(uuid) to authenticated, service_role;

-- True when this user has already had a trial, on any organization.
create or replace function public.billing_trial_used(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.billing_trials t where t.user_id = p_user);
$$;

-- Record a trial once; later calls are no-ops.
create or replace function public.billing_trial_record(p_user uuid, p_org uuid, p_plan text)
returns void language sql security definer set search_path = public as $$
  insert into public.billing_trials(user_id, org_id, plan) values (p_user, p_org, p_plan) on conflict (user_id) do nothing;
$$;

revoke all on function public.trial_limits() from public, anon;
revoke all on function public.billing_trial_used(uuid) from public, anon, authenticated;
revoke all on function public.billing_trial_record(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.trial_limits() to authenticated, service_role;
grant execute on function public.billing_trial_used(uuid) to service_role;
grant execute on function public.billing_trial_record(uuid, uuid, text) to service_role;
