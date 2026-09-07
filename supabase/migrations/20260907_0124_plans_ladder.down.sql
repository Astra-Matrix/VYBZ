-- Restore the three-plan model. Organizations on creator/pro map back to developer, ultimate to business.
update public.orgs set plan = case plan when 'ultimate' then 'business' when 'creator' then 'developer' when 'pro' then 'business' else plan end;
alter table public.orgs drop constraint if exists orgs_plan_check;
alter table public.orgs add constraint orgs_plan_check check (plan in ('developer','business','enterprise'));

drop function if exists public.billing_overages(date);
drop function if exists public.org_plan_usage(uuid);
drop function if exists public.plan_limits(text);
create function public.plan_limits(p_plan text)
returns table (issuances_month bigint, detections_month bigint, storage_bytes bigint, hard_cap boolean)
language sql immutable as $$
  select case p_plan when 'developer' then 250::bigint when 'business' then 10000::bigint else 9223372036854775807::bigint end,
         case p_plan when 'developer' then 50::bigint  when 'business' then 2000::bigint  else 9223372036854775807::bigint end,
         case p_plan when 'developer' then 10737418240::bigint when 'business' then 1099511627776::bigint else 9223372036854775807::bigint end,
         p_plan = 'developer';
$$;
create function public.org_plan_usage(p_org uuid)
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
revoke all on function public.org_plan_usage(uuid) from public, anon;
grant execute on function public.org_plan_usage(uuid) to authenticated, service_role;
-- billing_overages and org_invite_create: re-run migration 0123 / 0117 definitions.
