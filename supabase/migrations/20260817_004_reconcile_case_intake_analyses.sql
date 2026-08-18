-- Reconcile historical case-intake migration that exists in Supabase but was
-- not represented as a standalone local file. Safe for fresh and live schemas.
begin;

create table if not exists public.case_intake_analyses (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null unique references public.legal_cases(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  provider text not null,
  model text not null,
  status text not null default 'done' check (status in ('done', 'failed')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.case_intake_analyses enable row level security;
drop policy if exists intake_read on public.case_intake_analyses;
drop policy if exists intake_write on public.case_intake_analyses;
create policy intake_read on public.case_intake_analyses
  for select to authenticated
  using (office_id = (select public.current_office_id()));
create policy intake_write on public.case_intake_analyses
  for all to authenticated
  using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()))
  with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

grant select, insert, update, delete on public.case_intake_analyses to authenticated, service_role;

commit;
