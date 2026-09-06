drop function if exists public.provenance_fingerprint_lookup(uuid, int4[], int);
drop function if exists public.provenance_fingerprint_store(uuid, uuid, int, int, int, bytea, int4[]);
drop table if exists public.provenance_fingerprint_index;
drop table if exists public.provenance_fingerprints;
drop index if exists public.provenance_issuances_pcm_idx;
alter table public.provenance_issuances drop column if exists pcm_sha256;
drop index if exists public.provenance_assets_pcm_idx;
alter table public.provenance_assets
  drop column if exists pcm_sha256,
  drop column if exists source_format,
  drop column if exists fingerprint_frames;
