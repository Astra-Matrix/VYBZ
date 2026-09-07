-- ===========================================================================
-- VYBZ Platform — Paddle as billing provider.
--
-- Paddle Billing is the merchant of record for subscriptions and overages.
-- org_billing keeps the Stripe columns for organizations linked before the
-- switch and gains Paddle ids plus a provider marker; the overage report
-- returns whichever ids exist so the edge function can bill through the
-- right provider. Plan enforcement (orgs.plan, plan_limits) is unchanged.
-- ===========================================================================

alter table public.org_billing add column if not exists provider text not null default 'stripe';
alter table public.org_billing drop constraint if exists org_billing_provider_check;
alter table public.org_billing add constraint org_billing_provider_check check (provider in ('stripe', 'paddle'));
alter table public.org_billing add column if not exists paddle_customer_id text unique;
alter table public.org_billing add column if not exists paddle_subscription_id text unique;

-- Service-role: link a Paddle customer/subscription and set the plan.
create or replace function public.billing_apply_paddle(
  p_org uuid, p_customer text, p_subscription text, p_status text, p_period_end timestamptz, p_plan text
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.org_billing(org_id, provider, paddle_customer_id, paddle_subscription_id, status, current_period_end, updated_at)
    values (p_org, 'paddle', p_customer, p_subscription, coalesce(p_status, 'none'), p_period_end, now())
    on conflict (org_id) do update set
      provider = 'paddle',
      paddle_customer_id = coalesce(excluded.paddle_customer_id, org_billing.paddle_customer_id),
      paddle_subscription_id = coalesce(excluded.paddle_subscription_id, org_billing.paddle_subscription_id),
      status = excluded.status,
      current_period_end = coalesce(excluded.current_period_end, org_billing.current_period_end),
      updated_at = now();
  if p_plan is not null then
    update public.orgs set plan = p_plan where id = p_org and plan <> 'enterprise';
  end if;
end $fn$;

create or replace function public.billing_org_for_paddle_subscription(p_subscription text)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_billing where paddle_subscription_id = p_subscription limit 1;
$$;

create or replace function public.billing_org_for_paddle_customer(p_customer text)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_billing where paddle_customer_id = p_customer limit 1;
$$;

-- Overage rows now carry the provider and both sets of ids.
drop function if exists public.billing_overages(date);
create function public.billing_overages(p_period date)
returns table (org_id uuid, org_name text, plan text, provider text,
               stripe_customer_id text, paddle_customer_id text, paddle_subscription_id text,
               issuances bigint, detections bigint, storage_bytes bigint,
               over_issuances bigint, over_detections bigint, over_storage_gb numeric)
language sql stable security definer set search_path = public as $$
  with m as (
    select date_trunc('month', p_period::timestamptz) as s, date_trunc('month', p_period::timestamptz) + interval '1 month' as e
  ),
  orgs_m as (
    select o.id, o.name, o.plan, b.provider, b.stripe_customer_id, b.paddle_customer_id, b.paddle_subscription_id
    from public.orgs o
    join public.org_billing b on b.org_id = o.id
    where o.plan in ('business','enterprise')
      and (b.stripe_customer_id is not null or b.paddle_subscription_id is not null)
      and b.status in ('active','trialing','past_due')
      and not exists (select 1 from public.billing_usage_reports r where r.org_id = o.id and r.period = date_trunc('month', p_period::timestamptz)::date)
  ),
  usage as (
    select om.id,
      (select count(*) from public.provenance_issuances i, m where i.org_id = om.id and i.created_at >= m.s and i.created_at < m.e)::bigint as issuances,
      (select count(*) from public.provenance_chain c, m where c.org_id = om.id and c.event = 'detect' and c.created_at >= m.s and c.created_at < m.e)::bigint as detections,
      ((select coalesce(sum(b.size),0) from public.vault_blobs b where b.org_id = om.id)
        + (select coalesce(sum(a.bytes),0) from public.provenance_assets a where a.org_id = om.id))::bigint as storage_bytes
    from orgs_m om
  )
  select om.id, om.name, om.plan, om.provider, om.stripe_customer_id, om.paddle_customer_id, om.paddle_subscription_id,
         u.issuances, u.detections, u.storage_bytes,
         greatest(u.issuances - l.issuances_month, 0),
         greatest(u.detections - l.detections_month, 0),
         greatest((u.storage_bytes - l.storage_bytes)::numeric / 1073741824.0, 0)
  from orgs_m om
  join usage u on u.id = om.id
  cross join lateral public.plan_limits(om.plan) l;
$$;

revoke all on function public.billing_apply_paddle(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.billing_org_for_paddle_subscription(text) from public, anon, authenticated;
revoke all on function public.billing_org_for_paddle_customer(text) from public, anon, authenticated;
revoke all on function public.billing_overages(date) from public, anon, authenticated;
grant execute on function public.billing_apply_paddle(uuid, text, text, text, timestamptz, text) to service_role;
grant execute on function public.billing_org_for_paddle_subscription(text) to service_role;
grant execute on function public.billing_org_for_paddle_customer(text) to service_role;
grant execute on function public.billing_overages(date) to service_role;
