-- Temporal legal versions: seed legal_source_versions from existing sources
-- so "effective at reference date" reasoning has real content.
begin;

-- Seed one version row per existing source (current version, effective from issued_on).
insert into public.legal_source_versions (source_id, version_label, effective_from, effective_to, is_current)
select
  s.id,
  coalesce(s.source_version, 'النسخة السارية'),
  coalesce(s.effective_on, s.issued_on, '2000-01-01'),
  null,
  true
from public.legal_sources s
where not exists (
  select 1 from public.legal_source_versions v where v.source_id = s.id
);

-- Backfill effective_to for superseded versions (none yet, but keep the pattern).
update public.legal_source_versions v
set effective_to = (
  select min(v2.effective_from) - interval '1 day'
  from public.legal_source_versions v2
  where v2.source_id = v.source_id and v2.effective_from > v.effective_from
)
where v.effective_to is null
  and exists (
    select 1 from public.legal_source_versions v2
    where v2.source_id = v.source_id and v2.effective_from > v.effective_from
  );

commit;
