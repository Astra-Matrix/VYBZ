drop function if exists public.billing_overages(date);
create function public.billing_overages(p_period date)
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
revoke all on function public.billing_overages(date) from public, anon, authenticated;
grant execute on function public.billing_overages(date) to service_role;
drop function if exists public.billing_org_for_paddle_customer(text);
drop function if exists public.billing_org_for_paddle_subscription(text);
drop function if exists public.billing_apply_paddle(uuid, text, text, text, timestamptz, text);
alter table public.org_billing drop column if exists paddle_subscription_id;
alter table public.org_billing drop column if exists paddle_customer_id;
alter table public.org_billing drop constraint if exists org_billing_provider_check;
alter table public.org_billing drop column if exists provider;
