-- Complete intelligence layer: procedural state machine, case twin, deliberative moot,
-- temporal legal reasoning, contract opportunity radar, post-judgment engine,
-- matter economics, evaluation loop, office doctrine, fee proposals, financial transparency.
begin;

-- ---------------------------------------------------------------------------
-- 1) Procedural state machine (case procedural lifecycle)
-- ---------------------------------------------------------------------------
create table if not exists public.case_procedural_states (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  current_state text not null default 'new_filing' check (current_state in
    ('new_filing', 'pending_review', 'expert_appointment', 'hearings', 'judgment_reserved', 'judgment_issued', 'appeal', 'execution', 'closed')),
  transitions jsonb not null default '[]'::jsonb,
  auto_tasks jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists case_procedural_states_case_idx on public.case_procedural_states(office_id, case_id);

-- ---------------------------------------------------------------------------
-- 2) Contract opportunity radar (pre-dispute intelligence)
-- ---------------------------------------------------------------------------
create table if not exists contract_opportunity_alerts (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  contract_title text not null,
  alert_type text not null check (alert_type in ('expiry', 'breach_risk', 'claim_opportunity', 'renewal')),
  detail text not null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'acted', 'dismissed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists contract_opportunity_office_idx on public.contract_opportunity_alerts(office_id, status);

-- ---------------------------------------------------------------------------
-- 3) Post-judgment engine (execution / seizure / collection)
-- ---------------------------------------------------------------------------
create table if not exists post_judgment_actions (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  judgment_id uuid references public.judgment_analyses(id) on delete set null,
  action_type text not null check (action_type in ('execution', 'seizure', 'appeal', 'settlement', 'collection', 'other')),
  title text not null,
  due_date date,
  status text not null default 'pending' check (status in ('pending', 'done', 'blocked', 'cancelled')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists post_judgment_case_idx on public.post_judgment_actions(office_id, case_id);

-- ---------------------------------------------------------------------------
-- 4) Matter economics (profitability intelligence)
-- ---------------------------------------------------------------------------
create table if not exists matter_economics (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  billed_hours numeric(10,2) not null default 0,
  billed_amount numeric(14,2) not null default 0,
  actual_hours numeric(10,2) not null default 0,
  actual_cost numeric(14,2) not null default 0,
  margin numeric(14,2) not null default 0,
  health text not null default 'unknown' check (health in ('healthy', 'warning', 'loss', 'unknown')),
  computed_at timestamptz not null default now()
);
create index if not exists matter_economics_case_idx on public.matter_economics(office_id, case_id, computed_at desc);

-- ---------------------------------------------------------------------------
-- 5) Evaluation loop (weekly quality benchmarks)
-- ---------------------------------------------------------------------------
create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  run_type text not null check (run_type in ('weekly', 'manual')),
  total_checks integer not null default 0,
  passed integer not null default 0,
  failed integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists eval_runs_office_idx on public.eval_runs(office_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Office doctrine (distilled from approved memos)
-- ---------------------------------------------------------------------------
create table if not exists office_doctrines (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  topic text not null,
  principle text not null,
  source_drafts jsonb not null default '[]'::jsonb,
  usage_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists office_doctrines_topic_idx on public.office_doctrines(office_id, topic);

-- ---------------------------------------------------------------------------
-- 7) Smart fee proposals
-- ---------------------------------------------------------------------------
create table if not exists fee_proposals (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  fee_type text not null check (fee_type in ('lump_sum', 'hourly', 'contingency', 'hybrid')),
  amount numeric(14,2) not null default 0,
  scope text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fee_proposals_office_idx on public.fee_proposals(office_id, status);

-- ---------------------------------------------------------------------------
-- 8) Client financial transparency portal
-- ---------------------------------------------------------------------------
create table if not exists client_financial_views (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_financial_views_client_idx on public.client_financial_views(office_id, client_id);

-- ---------------------------------------------------------------------------
-- 9) Temporal legal versions (laws effective over time)
-- ---------------------------------------------------------------------------
create table if not exists legal_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.legal_sources(id) on delete cascade,
  version_label text not null,
  effective_from date,
  effective_to date,
  content_snapshot jsonb not null default '{}'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists legal_source_versions_source_idx on public.legal_source_versions(source_id, effective_from);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.case_procedural_states enable row level security;
alter table public.contract_opportunity_alerts enable row level security;
alter table public.post_judgment_actions enable row level security;
alter table public.matter_economics enable row level security;
alter table public.eval_runs enable row level security;
alter table public.office_doctrines enable row level security;
alter table public.fee_proposals enable row level security;
alter table public.client_financial_views enable row level security;
alter table public.legal_source_versions enable row level security;

create policy procedural_states_read on public.case_procedural_states for select to authenticated using (office_id = (select public.current_office_id()));
create policy procedural_states_write on public.case_procedural_states for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy opportunity_alerts_read on public.contract_opportunity_alerts for select to authenticated using (office_id = (select public.current_office_id()));
create policy opportunity_alerts_write on public.contract_opportunity_alerts for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy post_judgment_read on public.post_judgment_actions for select to authenticated using (office_id = (select public.current_office_id()));
create policy post_judgment_write on public.post_judgment_actions for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy matter_economics_read on public.matter_economics for select to authenticated using (office_id = (select public.current_office_id()));
create policy matter_economics_write on public.matter_economics for all to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));

create policy eval_runs_read on public.eval_runs for select to authenticated using (office_id = (select public.current_office_id()));
create policy eval_runs_write on public.eval_runs for all to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));

create policy doctrines_read on public.office_doctrines for select to authenticated using (office_id = (select public.current_office_id()));
create policy doctrines_write on public.office_doctrines for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy fee_proposals_read on public.fee_proposals for select to authenticated using (office_id = (select public.current_office_id()));
create policy fee_proposals_write on public.fee_proposals for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy client_financial_read on public.client_financial_views for select to authenticated using (office_id = (select public.current_office_id()));
create policy client_financial_write on public.client_financial_views for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy legal_versions_read on public.legal_source_versions for select to authenticated using (exists (select 1 from public.legal_sources s where s.id = source_id and (s.office_id is null or s.office_id = (select public.current_office_id()))));
create policy legal_versions_write on public.legal_source_versions for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

grant select, insert, update, delete on public.case_procedural_states, public.contract_opportunity_alerts, public.post_judgment_actions, public.matter_economics, public.eval_runs, public.office_doctrines, public.fee_proposals, public.client_financial_views, public.legal_source_versions to authenticated, service_role;

commit;
