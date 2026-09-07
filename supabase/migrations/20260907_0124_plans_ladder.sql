-- ===========================================================================
-- VYBZ Platform — plan ladder: developer, creator, pro, ultimate, enterprise.
--
-- Developer and Creator are hard-capped; Pro, Ultimate, and Enterprise are
-- metered beyond their included quantities. Every paid plan starts with a
-- 14-day trial handled by Paddle (status 'trialing' keeps the plan). The
-- legacy 'business' plan is mapped to 'ultimate'; the constraint keeps the
-- old name valid so nothing breaks while rows migrate.
-- ===========================================================================

alter table public.orgs drop constraint if exists orgs_plan_check;
alter table public.orgs add constraint orgs_plan_check
  check (plan in ('developer', 'creator', 'pro', 'ultimate', 'enterprise', 'business'));
update public.orgs set plan = 'ultimate' where plan = 'business';

-- Included quantities per month, storage cap, whether limits are hard, and the member cap.
drop function if exists public.plan_limits(text);
create function public.plan_limits(p_plan text)
returns table (issuances_month bigint, detections_month bigint, storage_bytes bigint, hard_cap boolean, members_max int)
language sql immutable as $$
  select
    case p_plan when 'developer' then 100::bigint when 'creator' then 200::bigint when 'pro' then 1500::bigint when 'ultimate' then 10000::bigint when 'business' then 10000::bigint else 9223372036854775807::bigint end,
    case p_plan when 'developer' then 20::bigint  when 'creator' then 50::bigint  when 'pro' then 300::bigint  when 'ultimate' then 2000::bigint  when 'business' then 2000::bigint  else 9223372036854775807::bigint end,
    case p_plan when 'developer' then 2147483648::bigint when 'creator' then 107374182400::bigint when 'pro' then 536870912000::bigint when 'ultimate' then 3298534883328::bigint when 'business' then 1099511627776::bigint else 9223372036854775807::bigint end,
    p_plan in ('developer', 'creator'),
    case p_plan when 'developer' then 1 when 'creator' then 1 when 'pro' then 5 else 2147483647 end;
$$;

-- org_plan_usage and api_plan_check read plan_limits by column name and need no change.
-- Recreate org_plan_usage so it binds to the new function signature.
create or replace function public.org_plan_usage(p_org uuid)
returns table (plan text, issuances_month bigint, detections_month bigint, storage_bytes bigint,
               limit_issuances bigint, limit_detections bigint, limit_storage bigint, hard_cap boolean)
language plpgsql stable security definer set search_path = public as $fn$
declare pl text; mstart timestamptz := date_trunc('month', now());
begin
  select o.plan into pl from public.orgs o where o.id = p_org;
  if pl is null then return; end if;
  return query
    select pl,
      (select count(*) from public.provenance_issuances i where i.org_id = p_org and i.created_at >= mstart)::bigint,
      (select count(*) from public.provenance_chain c where c.org_id = p_org and c.event = 'detect' and c.created_at >= mstart)::bigint,
      ((select coalesce(sum(b.size),0) from public.vault_blobs b where b.org_id = p_org)
        + (select coalesce(sum(a.bytes),0) from public.provenance_assets a where a.org_id = p_org))::bigint,
      l.issuances_month, l.detections_month, l.storage_bytes, l.hard_cap
    from public.plan_limits(pl) l;
end $fn$;

-- Member cap: invitations stop when members plus open invitations reach the plan's limit.
create or replace function public.org_invite_create(p_org uuid, p_email text, p_role text default 'member')
returns table (id uuid, token text, email text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $fn$
#variable_conflict use_column
declare raw text; iid uuid; exp timestamptz := now() + interval '14 days'; e text := lower(trim(p_email)); pl text; cap int; seats int;
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;
  if p_role not in ('admin','member') then raise exception 'invalid role'; end if;
  select o.plan into pl from public.orgs o where o.id = p_org;
  select l.members_max into cap from public.plan_limits(pl) l;
  select (select count(*) from public.org_members m where m.org_id = p_org)
       + (select count(*) from public.org_invites i where i.org_id = p_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    into seats;
  if seats >= cap then raise exception 'plan_members_limit: the % plan allows % member(s); upgrade to add more', pl, cap; end if;
  raw := 'vybz_inv_' || encode(gen_random_bytes(24), 'hex');
  insert into public.org_invites(org_id, email, role, token_hash, created_by, expires_at)
    values (p_org, e, p_role, encode(digest(raw, 'sha256'), 'hex'), auth.uid(), exp)
    returning org_invites.id into iid;
  return query select iid, raw, e, p_role, exp;
end $fn$;

-- Overages apply to metered plans only.
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
    where o.plan in ('pro','ultimate','business','enterprise')
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

revoke all on function public.billing_overages(date) from public, anon, authenticated;
grant execute on function public.billing_overages(date) to service_role;
revoke all on function public.org_plan_usage(uuid) from public, anon;
grant execute on function public.org_plan_usage(uuid) to authenticated, service_role;
