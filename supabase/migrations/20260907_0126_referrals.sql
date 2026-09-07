-- ===========================================================================
-- VYBZ Platform — referrals.
--
-- An organization can be attributed to the organization whose link the
-- account used at sign-up. Attribution is set once, by the new organization's
-- owner, within a day of creation, and never to itself. Members of the
-- referring organization can list what was referred; nothing else is exposed.
-- ===========================================================================

alter table public.orgs add column if not exists referred_by uuid references public.orgs(id) on delete set null;
alter table public.orgs add column if not exists referred_at timestamptz;
create index if not exists orgs_referred_by_idx on public.orgs(referred_by);

create or replace function public.org_set_referrer(p_org uuid, p_ref_slug text)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare uid uuid := auth.uid(); ref_id uuid;
begin
  if uid is null then raise exception 'unauthorized'; end if;
  select id into ref_id from public.orgs where slug = lower(trim(p_ref_slug));
  if ref_id is null or ref_id = p_org then return false; end if;
  update public.orgs o set referred_by = ref_id, referred_at = now()
    where o.id = p_org and o.owner_id = uid and o.referred_by is null and o.created_at > now() - interval '1 day';
  return found;
end $fn$;

create or replace function public.org_referrals(p_org uuid)
returns table (id uuid, name text, plan text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.plan, o.created_at
  from public.orgs o
  where o.referred_by = p_org and public.is_org_member(p_org)
  order by o.created_at desc;
$$;

revoke all on function public.org_set_referrer(uuid, text) from public, anon;
revoke all on function public.org_referrals(uuid) from public, anon;
grant execute on function public.org_set_referrer(uuid, text) to authenticated;
grant execute on function public.org_referrals(uuid) to authenticated, service_role;
