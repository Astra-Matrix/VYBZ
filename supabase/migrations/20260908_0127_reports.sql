-- ===========================================================================
-- VYBZ Platform — leak reports.
--
-- A report is a stored verification of a suspect file: what it derives from,
-- which recipient's copy it is, every method that ran, and a hash over the
-- findings so the PDF and the JSON can be checked against each other later.
-- Reports are immutable once written.
-- ===========================================================================

create table if not exists public.provenance_reports (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  asset_id       uuid references public.provenance_assets(id) on delete set null,
  issuance_id    uuid references public.provenance_issuances(id) on delete set null,
  name           text not null default 'file',
  sha256         text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  verdict        text not null check (verdict in ('original','issued_copy','derived_copy','derived_unattributed','unknown')),
  confidence     text not null check (confidence in ('exact','high','medium','none')),
  input          jsonb not null default '{}'::jsonb,
  evidence       jsonb not null default '[]'::jsonb,
  note           text check (char_length(note) <= 2000),
  report_hash    text not null check (report_hash ~ '^[a-f0-9]{64}$'),
  created_by_key uuid references public.api_keys(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists provenance_reports_org_idx on public.provenance_reports(org_id, created_at desc);
create index if not exists provenance_reports_asset_idx on public.provenance_reports(asset_id, created_at desc);
alter table public.provenance_reports enable row level security;
drop policy if exists provenance_reports_select on public.provenance_reports;
create policy provenance_reports_select on public.provenance_reports for select using (public.is_org_member(org_id));
