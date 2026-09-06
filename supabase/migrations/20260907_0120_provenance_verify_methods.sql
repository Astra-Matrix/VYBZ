-- Provenance verification methods: canonical PCM hashes for assets and issued
-- copies, and a perceptual fingerprint index so a suspect file can be matched
-- to the original it derives from without the caller knowing the asset id.

alter table public.provenance_assets
  add column if not exists pcm_sha256 text check (pcm_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists source_format text,
  add column if not exists fingerprint_frames int;
create index if not exists provenance_assets_pcm_idx on public.provenance_assets(org_id, pcm_sha256) where pcm_sha256 is not null;

alter table public.provenance_issuances
  add column if not exists pcm_sha256 text check (pcm_sha256 ~ '^[a-f0-9]{64}$');
create index if not exists provenance_issuances_pcm_idx on public.provenance_issuances(org_id, pcm_sha256) where pcm_sha256 is not null;

-- One fingerprint per asset: 32-bit sub-fingerprints, little-endian, one per frame.
create table if not exists public.provenance_fingerprints (
  asset_id   uuid primary key references public.provenance_assets(id) on delete cascade,
  org_id     uuid not null references public.orgs(id) on delete cascade,
  sample_hz  int not null,
  window_len int not null,
  hop        int not null,
  frames     int not null,
  bits       bytea not null,
  created_at timestamptz not null default now()
);
alter table public.provenance_fingerprints enable row level security;

-- Inverted index: sub-fingerprint value → (asset, frame). Service role only.
create table if not exists public.provenance_fingerprint_index (
  org_id   uuid not null,
  hash     int4 not null,
  asset_id uuid not null references public.provenance_assets(id) on delete cascade,
  frame    int4 not null
);
create index if not exists provenance_fp_lookup_idx on public.provenance_fingerprint_index(org_id, hash);
create index if not exists provenance_fp_asset_idx on public.provenance_fingerprint_index(asset_id);
alter table public.provenance_fingerprint_index enable row level security;

create or replace function public.provenance_fingerprint_store(
  p_asset uuid, p_org uuid, p_sample_hz int, p_window int, p_hop int, p_bits bytea, p_hashes int4[]
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.provenance_fingerprints(asset_id, org_id, sample_hz, window_len, hop, frames, bits)
  values (p_asset, p_org, p_sample_hz, p_window, p_hop, coalesce(array_length(p_hashes, 1), 0), p_bits)
  on conflict (asset_id) do update
    set sample_hz = excluded.sample_hz, window_len = excluded.window_len, hop = excluded.hop,
        frames = excluded.frames, bits = excluded.bits, created_at = now();
  delete from public.provenance_fingerprint_index where asset_id = p_asset;
  insert into public.provenance_fingerprint_index(org_id, hash, asset_id, frame)
  select p_org, h, p_asset, (ord - 1)::int
  from unnest(p_hashes) with ordinality as t(h, ord)
  where h <> 0 and h <> -1;
  update public.provenance_assets set fingerprint_frames = coalesce(array_length(p_hashes, 1), 0) where id = p_asset;
end $fn$;

-- Vote for (asset, offset) pairs from exact sub-fingerprint hits.
create or replace function public.provenance_fingerprint_lookup(p_org uuid, p_hashes int4[], p_limit int default 20)
returns table (asset_id uuid, offset_frames int, votes bigint)
language sql stable security definer set search_path = public as $fn$
  with q as (
    select h, (ord - 1)::int as pos from unnest(p_hashes) with ordinality as t(h, ord)
    where h <> 0 and h <> -1
  )
  select f.asset_id, (f.frame - q.pos)::int as offset_frames, count(*)::bigint as votes
  from q join public.provenance_fingerprint_index f on f.org_id = p_org and f.hash = q.h
  group by f.asset_id, (f.frame - q.pos)
  order by votes desc
  limit greatest(1, least(p_limit, 200));
$fn$;

revoke all on function public.provenance_fingerprint_store(uuid, uuid, int, int, int, bytea, int4[]) from public, anon, authenticated;
revoke all on function public.provenance_fingerprint_lookup(uuid, int4[], int) from public, anon, authenticated;
grant execute on function public.provenance_fingerprint_store(uuid, uuid, int, int, int, bytea, int4[]) to service_role;
grant execute on function public.provenance_fingerprint_lookup(uuid, int4[], int) to service_role;
