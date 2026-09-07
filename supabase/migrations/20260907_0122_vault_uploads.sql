-- ===========================================================================
-- VYBZ Platform — chunked, resumable blob uploads for Vault.
--
-- Files above the single-request limit are sent in fixed-size parts. The
-- gateway opens a resumable upload on Storage, forwards each part in order,
-- and keeps the running SHA-256 state here between requests so the final
-- object is verified against the hash the client declared before any blob
-- record exists. Sessions are organization-scoped, expire after a day, and
-- are read only through the service role.
-- ===========================================================================

create table if not exists public.vault_uploads (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  repo_id        uuid not null references public.vault_repos(id) on delete cascade,
  sha256         text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size           bigint not null check (size > 0),
  mime           text not null default 'application/octet-stream',
  part_size      integer not null check (part_size > 0),
  storage_path   text not null,
  tus_url        text not null,
  received_bytes bigint not null default 0,
  next_part      integer not null default 0,
  hash_state     jsonb not null default '{}'::jsonb,
  status         text not null default 'open' check (status in ('open', 'completed', 'failed', 'aborted')),
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '24 hours',
  completed_at   timestamptz
);
create index if not exists vault_uploads_org_idx on public.vault_uploads(org_id, status, expires_at);
alter table public.vault_uploads enable row level security;
-- No policies: sessions carry a storage upload URL and are only touched by the gateway.

-- Drop sessions a day after they expire. Storage discards the partial data on its own schedule.
create or replace function public.vault_uploads_prune()
returns int language sql security definer set search_path = public as $$
  with d as (
    delete from public.vault_uploads
    where expires_at < now() - interval '1 day'
    returning 1
  ) select count(*)::int from d;
$$;
revoke all on function public.vault_uploads_prune() from public, anon, authenticated;
grant execute on function public.vault_uploads_prune() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'vault-uploads-prune';
    perform cron.schedule('vault-uploads-prune', '30 4 * * *', $cron$select public.vault_uploads_prune();$cron$);
  end if;
end $$;
