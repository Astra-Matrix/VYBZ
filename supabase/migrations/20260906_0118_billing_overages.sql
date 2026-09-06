-- ===========================================================================
-- VYBZ Platform — monthly overage reporting for metered plans.
-- The `billing-usage-report` edge function runs after each month closes,
-- computes usage beyond the plan's included quantities, and creates Stripe
-- invoice items on the organization's subscription customer. This table makes
-- the run idempotent and auditable.
-- ===========================================================================

create table if not exists public.billing_usage_reports (
  org_id           uuid not null references public.orgs(id) on delete cascade,
  period           date not null,                   -- first day of the reported month
  plan             text not null,
  issuances        bigint not null default 0,
  detections       bigint not null default 0,
  storage_bytes    bigint not null default 0,
  over_issuances   bigint not null default 0,
  over_detections  bigint not null default 0,
  over_storage_gb  numeric not null default 0,
  amount_cents     bigint not null default 0,
  stripe_invoice_items text[] not null default '{}',
  reported_at      timestamptz not null default now(),
  primary key (org_id, period)
);
alter table public.billing_usage_reports enable row level security;
drop policy if exists billing_usage_reports_select on public.billing_usage_reports;
create policy billing_usage_reports_select on public.billing_usage_reports for select using (public.is_org_member(org_id));

-- Usage for a closed month per organization on a metered plan with an active subscription.
create or replace function public.billing_overages(p_period date)
returns table (org_id uuid, org_name text, plan text, stripe_customer_id text,
               issuances bigint, detections bigint, storage_bytes bigint,
               over_issuances bigint, over_detections bigint, over_storage_gb numeric)
language sql stable security definer set search_path = public as $$
  with m as (
    select date_trunc('month', p_period::timestamptz) as s, date_trunc('month', p_period::timestamptz) + interval '1 month' as e
  ),
  orgs_m as (
    select o.id, o.name, o.plan, b.stripe_customer_id
    from public.orgs o
    join public.org_billing b on b.org_id = o.id
    where o.plan in ('business','enterprise') and b.stripe_customer_id is not null
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
  select om.id, om.name, om.plan, om.stripe_customer_id,
         u.issuances, u.detections, u.storage_bytes,
         greatest(u.issuances - l.issuances_month, 0),
         greatest(u.detections - l.detections_month, 0),
         greatest((u.storage_bytes - l.storage_bytes)::numeric / 1073741824.0, 0)
  from orgs_m om
  join usage u on u.id = om.id
  cross join lateral public.plan_limits(om.plan) l;
$$;

create or replace function public.billing_usage_report_record(
  p_org uuid, p_period date, p_plan text, p_issuances bigint, p_detections bigint, p_storage_bytes bigint,
  p_over_issuances bigint, p_over_detections bigint, p_over_storage_gb numeric, p_amount_cents bigint, p_items text[]
) returns void language sql security definer set search_path = public as $$
  insert into public.billing_usage_reports(org_id, period, plan, issuances, detections, storage_bytes, over_issuances, over_detections, over_storage_gb, amount_cents, stripe_invoice_items)
  values (p_org, date_trunc('month', p_period::timestamptz)::date, p_plan, p_issuances, p_detections, p_storage_bytes, p_over_issuances, p_over_detections, p_over_storage_gb, p_amount_cents, coalesce(p_items, '{}'))
  on conflict (org_id, period) do nothing;
$$;

revoke all on function public.billing_overages(date) from public, anon, authenticated;
revoke all on function public.billing_usage_report_record(uuid, date, text, bigint, bigint, bigint, bigint, bigint, numeric, bigint, text[]) from public, anon, authenticated;
grant execute on function public.billing_overages(date) to service_role;
grant execute on function public.billing_usage_report_record(uuid, date, text, bigint, bigint, bigint, bigint, bigint, numeric, bigint, text[]) to service_role;
