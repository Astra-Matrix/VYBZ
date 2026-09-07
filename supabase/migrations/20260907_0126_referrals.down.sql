drop function if exists public.org_referrals(uuid);
drop function if exists public.org_set_referrer(uuid, text);
alter table public.orgs drop column if exists referred_at;
alter table public.orgs drop column if exists referred_by;
