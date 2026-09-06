-- ===========================================================================
-- VYBZ Platform — team invites, membership management, billing, plan limits.
-- ===========================================================================

-- ── Team invites ────────────────────────────────────────────────────────────
create table if not exists public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  email       text not null check (position('@' in email) > 1),
  role        text not null default 'member' check (role in ('admin','member')),
  token_hash  text not null unique,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz
);
create index if not exists org_invites_org_idx on public.org_invites(org_id, created_at desc);
alter table public.org_invites enable row level security;
drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites for select using (public.is_org_member(org_id));

-- Returns the plaintext token once. The invite link is /console/join?token=…
create or replace function public.org_invite_create(p_org uuid, p_email text, p_role text default 'member')
returns table (id uuid, token text, email text, role text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $fn$
#variable_conflict use_column
declare raw text; iid uuid; exp timestamptz := now() + interval '14 days'; e text := lower(trim(p_email));
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;
  if p_role not in ('admin','member') then raise exception 'invalid role'; end if;
  raw := 'vybz_inv_' || encode(gen_random_bytes(24), 'hex');
  insert into public.org_invites(org_id, email, role, token_hash, created_by, expires_at)
    values (p_org, e, p_role, encode(digest(raw, 'sha256'), 'hex'), auth.uid(), exp)
    returning org_invites.id into iid;
  return query select iid, raw, e, p_role, exp;
end $fn$;

create or replace function public.org_invite_accept(p_token text)
returns public.orgs language plpgsql security definer set search_path = public, extensions as $fn$
declare inv public.org_invites; o public.orgs; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select * into inv from public.org_invites i where i.token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if inv.id is null then raise exception 'invalid invite'; end if;
  if inv.revoked_at is not null then raise exception 'invite revoked'; end if;
  if inv.accepted_at is not null then raise exception 'invite already used'; end if;
  if inv.expires_at < now() then raise exception 'invite expired'; end if;
  insert into public.org_members(org_id, user_id, role) values (inv.org_id, uid, inv.role)
    on conflict (org_id, user_id) do update set role = excluded.role;
  update public.org_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  select * into o from public.orgs where id = inv.org_id;
  return o;
end $fn$;

create or replace function public.org_invite_revoke(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare org uuid;
begin
  select org_id into org from public.org_invites where id = p_id;
  if org is null or not public.is_org_admin(org) then raise exception 'forbidden'; end if;
  update public.org_invites set revoked_at = now() where id = p_id and accepted_at is null and revoked_at is null;
  return found;
end $fn$;

create or replace function public.org_invites_list(p_org uuid)
returns table (id uuid, email text, role text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.email, i.role, i.created_at, i.expires_at, i.accepted_at, i.revoked_at
  from public.org_invites i where i.org_id = p_org and public.is_org_member(p_org)
  order by i.created_at desc;
$$;

-- ── Members ─────────────────────────────────────────────────────────────────
create or replace function public.org_members_list(p_org uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.org_members m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and public.is_org_member(p_org)
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
$$;

create or replace function public.org_member_set_role(p_org uuid, p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;
  if p_role not in ('admin','member') then raise exception 'invalid role'; end if;
  if exists (select 1 from public.orgs where id = p_org and owner_id = p_user) then raise exception 'cannot change the owner'; end if;
  update public.org_members set role = p_role where org_id = p_org and user_id = p_user;
  return found;
end $fn$;

create or replace function public.org_member_remove(p_org uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if not (public.is_org_admin(p_org) or auth.uid() = p_user) then raise exception 'forbidden'; end if;
  if exists (select 1 from public.orgs where id = p_org and owner_id = p_user) then raise exception 'the owner cannot be removed'; end if;
  delete from public.org_members where org_id = p_org and user_id = p_user;
  return found;
end $fn$;

-- ── Billing ─────────────────────────────────────────────────────────────────
create table if not exists public.org_billing (
  org_id                 uuid primary key references public.orgs(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text not null default 'none'
                         check (status in ('none','trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')),
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);
alter table public.org_billing enable row level security;
drop policy if exists org_billing_select on public.org_billing;
create policy org_billing_select on public.org_billing for select using (public.is_org_member(org_id));

-- Service-role: link a Stripe customer/subscription and set the plan.
create or replace function public.billing_apply(
  p_org uuid, p_customer text, p_subscription text, p_status text, p_period_end timestamptz, p_plan text
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.org_billing(org_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, updated_at)
    values (p_org, p_customer, p_subscription, coalesce(p_status, 'none'), p_period_end, now())
    on conflict (org_id) do update set
      stripe_customer_id = coalesce(excluded.stripe_customer_id, org_billing.stripe_customer_id),
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, org_billing.stripe_subscription_id),
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      updated_at = now();
  if p_plan is not null then
    update public.orgs set plan = p_plan where id = p_org and plan <> 'enterprise';
  end if;
end $fn$;

create or replace function public.billing_org_for_subscription(p_subscription text)
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.org_billing where stripe_subscription_id = p_subscription limit 1;
$$;

-- ── Plan limits ─────────────────────────────────────────────────────────────
-- Monthly included quantities. Business/enterprise are metered beyond these
-- (billed in arrears); developer is hard-capped.
create or replace function public.plan_limits(p_plan text)
returns table (issuances_month bigint, detections_month bigint, storage_bytes bigint, hard_cap boolean)
language sql immutable as $$
  select case p_plan when 'developer' then 250::bigint when 'business' then 10000::bigint else 9223372036854775807::bigint end,
         case p_plan when 'developer' then 50::bigint  when 'business' then 2000::bigint  else 9223372036854775807::bigint end,
         case p_plan when 'developer' then 10737418240::bigint when 'business' then 1099511627776::bigint else 9223372036854775807::bigint end,
         p_plan = 'developer';
$$;

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

-- Gateway check: is this action allowed under the organization's plan?
create or replace function public.api_plan_check(p_org uuid, p_kind text)
returns table (allowed boolean, plan text, used bigint, included bigint)
language plpgsql stable security definer set search_path = public as $fn$
declare u record;
begin
  select * into u from public.org_plan_usage(p_org);
  if u.plan is null then return query select false, null::text, 0::bigint, 0::bigint; return; end if;
  if p_kind = 'issue' then
    return query select (not u.hard_cap) or u.issuances_month < u.limit_issuances, u.plan, u.issuances_month, u.limit_issuances;
  elsif p_kind = 'detect' then
    return query select (not u.hard_cap) or u.detections_month < u.limit_detections, u.plan, u.detections_month, u.limit_detections;
  elsif p_kind = 'storage' then
    return query select (not u.hard_cap) or u.storage_bytes < u.limit_storage, u.plan, u.storage_bytes, u.limit_storage;
  else
    return query select true, u.plan, 0::bigint, 0::bigint;
  end if;
end $fn$;

revoke all on function public.billing_apply(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.billing_org_for_subscription(text) from public, anon, authenticated;
revoke all on function public.api_plan_check(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_apply(uuid, text, text, text, timestamptz, text) to service_role;
grant execute on function public.billing_org_for_subscription(text) to service_role;
grant execute on function public.api_plan_check(uuid, text) to service_role;
