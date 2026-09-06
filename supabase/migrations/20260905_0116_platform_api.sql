-- ===========================================================================
-- VYBZ Platform — organizations, API keys, audit, Provenance assets, Vault.
--
-- This is the data model for the two products VYBZ now sells:
--   • Provenance  — watermark, sign, verify, and trace audio for businesses.
--   • Vault       — content-addressed version control for DAW projects.
--
-- Everything here is organization-scoped. Humans reach it through the Console
-- (Supabase Auth JWT + RLS). Machines and agents reach it through the public
-- API (`api-v1` edge function) with an organization API key.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ── Organizations ───────────────────────────────────────────────────────────
create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$'),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  plan        text not null default 'developer' check (plan in ('developer','business','enterprise')),
  created_at  timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members(user_id);

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create or replace function public.is_org_member(p_org uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members where org_id = p_org and user_id = p_uid);
$$;

create or replace function public.is_org_admin(p_org uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = p_uid and role in ('owner','admin')
  );
$$;

drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs for select using (public.is_org_member(id));
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members for select using (public.is_org_member(org_id));

-- ── API keys ────────────────────────────────────────────────────────────────
-- The plaintext key is shown exactly once at creation. Only its SHA-256 is
-- stored. `prefix` (the first 14 characters) is safe to display.
create table if not exists public.api_keys (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  prefix             text not null,
  key_hash           text not null unique,
  scopes             text[] not null default '{}',
  rate_limit_per_min int  not null default 300 check (rate_limit_per_min between 1 and 100000),
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  expires_at         timestamptz,
  revoked_at         timestamptz
);
create index if not exists api_keys_org_idx on public.api_keys(org_id);
alter table public.api_keys enable row level security;
-- Deny all direct access. Console reads go through `api_keys_list`.

create table if not exists public.api_rate_buckets (
  key_id    uuid not null references public.api_keys(id) on delete cascade,
  minute    timestamptz not null,
  hits      int not null default 0,
  primary key (key_id, minute)
);
alter table public.api_rate_buckets enable row level security;

create table if not exists public.api_audit_log (
  seq         bigint generated always as identity primary key,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  key_id      uuid references public.api_keys(id) on delete set null,
  actor_user  uuid references auth.users(id) on delete set null,
  method      text not null,
  path        text not null,
  status      int  not null,
  duration_ms int,
  bytes_in    bigint,
  bytes_out   bigint,
  agent       text,
  request_id  text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists api_audit_org_time_idx on public.api_audit_log(org_id, created_at desc);
alter table public.api_audit_log enable row level security;
drop policy if exists api_audit_select on public.api_audit_log;
create policy api_audit_select on public.api_audit_log for select using (public.is_org_member(org_id));

create table if not exists public.api_usage_daily (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  day        date not null,
  product    text not null check (product in ('provenance','vault','platform')),
  calls      bigint not null default 0,
  bytes_in   bigint not null default 0,
  bytes_out  bigint not null default 0,
  primary key (org_id, day, product)
);
alter table public.api_usage_daily enable row level security;
drop policy if exists api_usage_select on public.api_usage_daily;
create policy api_usage_select on public.api_usage_daily for select using (public.is_org_member(org_id));

-- ── Provenance ──────────────────────────────────────────────────────────────
create table if not exists public.provenance_assets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  title        text not null default 'Untitled',
  external_ref text,
  sha256       text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null,
  bytes        bigint not null,
  mime         text not null default 'audio/wav',
  sample_rate  int,
  channels     int,
  duration_sec numeric,
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (org_id, sha256)
);
create index if not exists provenance_assets_org_idx on public.provenance_assets(org_id, created_at desc);
create index if not exists provenance_assets_sha_idx on public.provenance_assets(sha256);
alter table public.provenance_assets enable row level security;
drop policy if exists provenance_assets_select on public.provenance_assets;
create policy provenance_assets_select on public.provenance_assets for select using (public.is_org_member(org_id));

-- One row per delivered copy. `recipient` is the customer's own identifier for
-- whoever received the file (an email, a user id, a partner name).
create table if not exists public.provenance_issuances (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  asset_id         uuid not null references public.provenance_assets(id) on delete cascade,
  recipient        text not null check (char_length(recipient) between 1 and 200),
  license          text,
  watermark_id     uuid not null default gen_random_uuid(),
  delivered_sha256 text check (delivered_sha256 ~ '^[a-f0-9]{64}$'),
  c2pa_signed      boolean not null default false,
  issued_by_key    uuid references public.api_keys(id) on delete set null,
  issued_by        uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists provenance_issuances_asset_idx on public.provenance_issuances(asset_id, created_at desc);
create index if not exists provenance_issuances_delivered_idx on public.provenance_issuances(delivered_sha256);
alter table public.provenance_issuances enable row level security;
drop policy if exists provenance_issuances_select on public.provenance_issuances;
create policy provenance_issuances_select on public.provenance_issuances for select using (public.is_org_member(org_id));

-- Hash-chained, append-only event log per organization. Independent of the
-- creator-side ledger so a customer's chain verifies on its own.
create table if not exists public.provenance_chain (
  seq        bigint generated always as identity primary key,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  asset_id   uuid references public.provenance_assets(id) on delete set null,
  event      text not null check (event in ('register','issue','c2pa','verify','detect','revoke')),
  payload    jsonb not null default '{}'::jsonb,
  prev_hash  text not null,
  row_hash   text not null,
  created_at timestamptz not null default now()
);
create index if not exists provenance_chain_org_idx on public.provenance_chain(org_id, seq);
create index if not exists provenance_chain_asset_idx on public.provenance_chain(asset_id, seq);
alter table public.provenance_chain enable row level security;
drop policy if exists provenance_chain_select on public.provenance_chain;
create policy provenance_chain_select on public.provenance_chain for select using (public.is_org_member(org_id));

create or replace function public.provenance_chain_append(
  p_org uuid, p_asset uuid, p_event text, p_payload jsonb
) returns table (seq bigint, row_hash text)
language plpgsql security definer set search_path = public, extensions as $fn$
declare prev text; body text; rh text; s bigint;
begin
  select c.row_hash into prev from public.provenance_chain c
    where c.org_id = p_org order by c.seq desc limit 1;
  prev := coalesce(prev, repeat('0', 64));
  body := p_event || '|' || coalesce(p_asset::text, '') || '|' || p_org::text
          || '|' || coalesce(p_payload::text, '{}') || '|' || prev;
  rh := encode(digest(body, 'sha256'), 'hex');
  insert into public.provenance_chain(org_id, asset_id, event, payload, prev_hash, row_hash)
    values (p_org, p_asset, p_event, coalesce(p_payload, '{}'::jsonb), prev, rh)
    returning provenance_chain.seq into s;
  return query select s, rh;
end $fn$;

-- Recompute the chain for an organization and report the first broken link.
create or replace function public.provenance_chain_verify(p_org uuid)
returns table (ok boolean, length bigint, first_bad_seq bigint)
language plpgsql security definer set search_path = public, extensions as $fn$
declare r record; prev text := repeat('0', 64); body text; n bigint := 0;
begin
  if not public.is_org_member(p_org) then
    raise exception 'forbidden';
  end if;
  for r in select * from public.provenance_chain where org_id = p_org order by seq loop
    body := r.event || '|' || coalesce(r.asset_id::text, '') || '|' || r.org_id::text
            || '|' || coalesce(r.payload::text, '{}') || '|' || prev;
    if r.prev_hash <> prev or r.row_hash <> encode(digest(body, 'sha256'), 'hex') then
      return query select false, n, r.seq; return;
    end if;
    prev := r.row_hash; n := n + 1;
  end loop;
  return query select true, n, null::bigint;
end $fn$;

-- Same recompute for the gateway (service role), without the membership check.
create or replace function public.provenance_chain_verify_service(p_org uuid)
returns table (ok boolean, length bigint, first_bad_seq bigint)
language plpgsql security definer set search_path = public, extensions as $fn$
declare r record; prev text := repeat('0', 64); body text; n bigint := 0;
begin
  for r in select * from public.provenance_chain where org_id = p_org order by seq loop
    body := r.event || '|' || coalesce(r.asset_id::text, '') || '|' || r.org_id::text
            || '|' || coalesce(r.payload::text, '{}') || '|' || prev;
    if r.prev_hash <> prev or r.row_hash <> encode(digest(body, 'sha256'), 'hex') then
      return query select false, n, r.seq; return;
    end if;
    prev := r.row_hash; n := n + 1;
  end loop;
  return query select true, n, null::bigint;
end $fn$;

-- ── Vault ───────────────────────────────────────────────────────────────────
create table if not exists public.vault_repos (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  slug         text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'),
  description  text,
  daw          text,
  default_branch text not null default 'main',
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, slug)
);
create index if not exists vault_repos_org_idx on public.vault_repos(org_id, updated_at desc);
alter table public.vault_repos enable row level security;
drop policy if exists vault_repos_select on public.vault_repos;
create policy vault_repos_select on public.vault_repos for select using (public.is_org_member(org_id));

-- Content-addressed blobs, deduplicated per organization.
create table if not exists public.vault_blobs (
  org_id       uuid not null references public.orgs(id) on delete cascade,
  hash         text not null check (hash ~ '^[a-f0-9]{64}$'),
  size         bigint not null check (size >= 0),
  mime         text,
  storage_path text not null,
  created_at   timestamptz not null default now(),
  primary key (org_id, hash)
);
alter table public.vault_blobs enable row level security;
drop policy if exists vault_blobs_select on public.vault_blobs;
create policy vault_blobs_select on public.vault_blobs for select using (public.is_org_member(org_id));

create table if not exists public.vault_commits (
  id           uuid primary key default gen_random_uuid(),
  repo_id      uuid not null references public.vault_repos(id) on delete cascade,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  sha          text not null check (sha ~ '^[a-f0-9]{64}$'),
  parent_sha   text check (parent_sha ~ '^[a-f0-9]{64}$'),
  tree_sha     text not null check (tree_sha ~ '^[a-f0-9]{64}$'),
  message      text not null default '',
  -- entries: [{ "path": "Samples/kick.wav", "hash": "…", "size": 123 }]
  entries      jsonb not null default '[]'::jsonb,
  meta         jsonb not null default '{}'::jsonb,
  file_count   int not null default 0,
  total_bytes  bigint not null default 0,
  author_key   uuid references public.api_keys(id) on delete set null,
  author       uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (repo_id, sha)
);
create index if not exists vault_commits_repo_idx on public.vault_commits(repo_id, created_at desc);
alter table public.vault_commits enable row level security;
drop policy if exists vault_commits_select on public.vault_commits;
create policy vault_commits_select on public.vault_commits for select using (public.is_org_member(org_id));

create table if not exists public.vault_branches (
  repo_id    uuid not null references public.vault_repos(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null check (name ~ '^[A-Za-z0-9._/-]{1,80}$'),
  head_sha   text check (head_sha ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (repo_id, name)
);
alter table public.vault_branches enable row level security;
drop policy if exists vault_branches_select on public.vault_branches;
create policy vault_branches_select on public.vault_branches for select using (public.is_org_member(org_id));

-- ── Storage buckets (private) ───────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('provenance-originals', 'provenance-originals', false)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('vault-blobs', 'vault-blobs', false)
  on conflict (id) do nothing;

-- ── Console RPCs (JWT callers) ──────────────────────────────────────────────
create or replace function public.org_create(p_name text, p_slug text)
returns public.orgs language plpgsql security definer set search_path = public as $fn$
declare o public.orgs; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'unauthorized'; end if;
  insert into public.orgs(name, slug, owner_id) values (trim(p_name), lower(trim(p_slug)), uid) returning * into o;
  insert into public.org_members(org_id, user_id, role) values (o.id, uid, 'owner');
  return o;
end $fn$;

create or replace function public.my_orgs()
returns setof public.orgs language sql stable security definer set search_path = public as $$
  select o.* from public.orgs o
  join public.org_members m on m.org_id = o.id and m.user_id = auth.uid()
  order by o.created_at;
$$;

-- Returns the plaintext key exactly once.
create or replace function public.api_key_create(
  p_org uuid, p_name text, p_scopes text[], p_rate_limit int default 300, p_expires_at timestamptz default null
) returns table (id uuid, prefix text, key text, scopes text[], created_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $fn$
declare raw text; kid uuid; pfx text; now_ts timestamptz := now();
        allowed text[] := array['org:read','provenance:read','provenance:write','provenance:detect','vault:read','vault:write'];
        s text;
begin
  if not public.is_org_admin(p_org) then raise exception 'forbidden'; end if;
  foreach s in array coalesce(p_scopes, '{}') loop
    if not (s = any(allowed)) then raise exception 'unknown scope: %', s; end if;
  end loop;
  raw := 'vybz_live_' || encode(gen_random_bytes(24), 'hex');
  pfx := substr(raw, 1, 14);
  insert into public.api_keys(org_id, name, prefix, key_hash, scopes, rate_limit_per_min, created_by, expires_at)
    values (p_org, trim(p_name), pfx, encode(digest(raw, 'sha256'), 'hex'), coalesce(p_scopes, '{}'),
            coalesce(p_rate_limit, 300), auth.uid(), p_expires_at)
    returning api_keys.id into kid;
  return query select kid, pfx, raw, coalesce(p_scopes, '{}'), now_ts;
end $fn$;

create or replace function public.api_key_revoke(p_key uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare org uuid;
begin
  select org_id into org from public.api_keys where id = p_key;
  if org is null or not public.is_org_admin(org) then raise exception 'forbidden'; end if;
  update public.api_keys set revoked_at = now() where id = p_key and revoked_at is null;
  return found;
end $fn$;

create or replace function public.api_keys_list(p_org uuid)
returns table (id uuid, name text, prefix text, scopes text[], rate_limit_per_min int,
               created_at timestamptz, last_used_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.id, k.name, k.prefix, k.scopes, k.rate_limit_per_min, k.created_at, k.last_used_at, k.expires_at, k.revoked_at
  from public.api_keys k
  where k.org_id = p_org and public.is_org_member(p_org)
  order by k.created_at desc;
$$;

-- ── Gateway RPCs (service role) ─────────────────────────────────────────────
-- Resolve a key by hash; enforce revocation, expiry, and the per-minute limit.
create or replace function public.api_key_authenticate(p_hash text)
returns table (key_id uuid, org_id uuid, scopes text[], plan text, limited boolean, remaining int)
language plpgsql security definer set search_path = public as $fn$
declare k public.api_keys; m timestamptz := date_trunc('minute', now()); h int; p text;
begin
  select * into k from public.api_keys where key_hash = p_hash;
  if k.id is null then return; end if;
  if k.revoked_at is not null then return; end if;
  if k.expires_at is not null and k.expires_at < now() then return; end if;
  insert into public.api_rate_buckets(key_id, minute, hits) values (k.id, m, 1)
    on conflict (key_id, minute) do update set hits = api_rate_buckets.hits + 1
    returning hits into h;
  update public.api_keys set last_used_at = now() where id = k.id;
  select o.plan into p from public.orgs o where o.id = k.org_id;
  return query select k.id, k.org_id, k.scopes, p, (h > k.rate_limit_per_min), greatest(k.rate_limit_per_min - h, 0);
end $fn$;

create or replace function public.api_record_call(
  p_org uuid, p_key uuid, p_method text, p_path text, p_status int, p_duration_ms int,
  p_bytes_in bigint, p_bytes_out bigint, p_agent text, p_request_id text, p_product text, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.api_audit_log(org_id, key_id, method, path, status, duration_ms, bytes_in, bytes_out, agent, request_id, detail)
    values (p_org, p_key, p_method, p_path, p_status, p_duration_ms, p_bytes_in, p_bytes_out, left(p_agent, 200), p_request_id, coalesce(p_detail, '{}'::jsonb));
  insert into public.api_usage_daily(org_id, day, product, calls, bytes_in, bytes_out)
    values (p_org, current_date, p_product, 1, coalesce(p_bytes_in, 0), coalesce(p_bytes_out, 0))
    on conflict (org_id, day, product) do update
      set calls = api_usage_daily.calls + 1,
          bytes_in = api_usage_daily.bytes_in + excluded.bytes_in,
          bytes_out = api_usage_daily.bytes_out + excluded.bytes_out;
end $fn$;

-- Advance a branch atomically. Returns false when the expected head does not match.
create or replace function public.vault_advance_branch(
  p_repo uuid, p_org uuid, p_branch text, p_expected_head text, p_new_head text
) returns boolean language plpgsql security definer set search_path = public as $fn$
declare cur text; existed boolean;
begin
  select head_sha into cur from public.vault_branches where repo_id = p_repo and name = p_branch for update;
  existed := found;
  if existed and cur is distinct from p_expected_head then return false; end if;
  if existed then
    update public.vault_branches set head_sha = p_new_head, updated_at = now() where repo_id = p_repo and name = p_branch;
  else
    insert into public.vault_branches(repo_id, org_id, name, head_sha) values (p_repo, p_org, p_branch, p_new_head);
  end if;
  update public.vault_repos set updated_at = now() where id = p_repo;
  return true;
end $fn$;

-- Old rate buckets are noise after an hour.
create or replace function public.api_rate_buckets_prune()
returns void language sql security definer set search_path = public as $$
  delete from public.api_rate_buckets where minute < now() - interval '2 hours';
$$;

revoke all on function public.api_key_authenticate(text) from public, anon, authenticated;
revoke all on function public.api_record_call(uuid, uuid, text, text, int, int, bigint, bigint, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.vault_advance_branch(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.provenance_chain_append(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.api_rate_buckets_prune() from public, anon, authenticated;
revoke all on function public.provenance_chain_verify_service(uuid) from public, anon, authenticated;

-- The gateway runs as service_role, which does not inherit PUBLIC grants once revoked.
grant execute on function public.api_key_authenticate(text) to service_role;
grant execute on function public.api_record_call(uuid, uuid, text, text, int, int, bigint, bigint, text, text, text, jsonb) to service_role;
grant execute on function public.vault_advance_branch(uuid, uuid, text, text, text) to service_role;
grant execute on function public.provenance_chain_append(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.api_rate_buckets_prune() to service_role;
grant execute on function public.provenance_chain_verify_service(uuid) to service_role;
