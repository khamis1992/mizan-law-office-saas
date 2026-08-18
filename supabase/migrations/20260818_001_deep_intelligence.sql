-- Deep intelligence layer: knowledge graph, evidence mapping, deadlines engine,
-- expert analysis, settlement calculator, preference learning, consistency check,
-- redaction, circuit insights, gazette radar, executive client briefs, hearing prep.
begin;

-- ---------------------------------------------------------------------------
-- 1) Knowledge graph edges (entities/relations across cases)
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_graph_edges (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  source_type text not null check (source_type in ('case', 'client', 'party', 'lawyer', 'source', 'precedent', 'defense', 'court', 'circuit')),
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation text not null,
  strength numeric(5,2) not null default 1 check (strength between 0 and 1),
  created_at timestamptz not null default now(),
  unique (office_id, source_type, source_id, target_type, target_id, relation)
);
create index if not exists knowledge_graph_source_idx on public.knowledge_graph_edges(office_id, source_type, source_id);
create index if not exists knowledge_graph_target_idx on public.knowledge_graph_edges(office_id, target_type, target_id);

-- ---------------------------------------------------------------------------
-- 2) Evidence mapping per case (burden of proof)
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_map_nodes (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  requirement text not null,
  element_type text not null default 'element' check (element_type in ('element', 'defense', 'counter')),
  proof_status text not null default 'unproven' check (proof_status in ('proven', 'partial', 'unproven', 'n_a')),
  document_id uuid references public.documents(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists evidence_map_case_idx on public.evidence_map_nodes(office_id, case_id);

-- ---------------------------------------------------------------------------
-- 3) Statutory deadlines engine log
-- ---------------------------------------------------------------------------
create table if not exists public.procedural_deadlines (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  deadline_type text not null,
  label text not null,
  base_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'done', 'overdue', 'waived')),
  computed_rule text,
  created_at timestamptz not null default now()
);
create index if not exists procedural_deadlines_case_idx on public.procedural_deadlines(office_id, case_id, due_date);

-- ---------------------------------------------------------------------------
-- 4) Expert report analyses
-- ---------------------------------------------------------------------------
create table if not exists public.expert_report_analyses (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  report_text text not null,
  findings jsonb not null default '[]'::jsonb,
  objections_draft text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expert_report_analyses_case_idx on public.expert_report_analyses(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Settlement / trial valuation
-- ---------------------------------------------------------------------------
create table if not exists case_settlement_valuations (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  claim_amount numeric(14,2) not null default 0,
  success_probability numeric(5,4) not null default 0.5,
  expected_value numeric(14,2) not null default 0,
  costs numeric(14,2) not null default 0,
  settlement_offer numeric(14,2),
  recommendation text not null default 'neutral' check (recommendation in ('accept', 'reject', 'negotiate', 'neutral')),
  analysis jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists settlement_valuations_case_idx on public.case_settlement_valuations(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Preference learning signals (accepted/rejected AI outputs)
-- ---------------------------------------------------------------------------
create table if not exists ai_preference_signals (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  lawyer_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('citation', 'defense', 'wording', 'template', 'precedent')),
  value text not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  case_id uuid references public.legal_cases(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_preference_signals_office_idx on public.ai_preference_signals(office_id, kind, decision, created_at desc);

-- ---------------------------------------------------------------------------
-- 7) Gazette radar tracked queries
-- ---------------------------------------------------------------------------
create table if not exists gazette_radar_queries (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  query text not null,
  last_checked_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists gazette_radar_office_idx on public.gazette_radar_queries(office_id);

-- ---------------------------------------------------------------------------
-- 8) Executive client briefs
-- ---------------------------------------------------------------------------
create table if not exists client_briefs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  language text not null default 'ar' check (language in ('ar', 'en')),
  content text not null,
  sent boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_briefs_case_idx on public.client_briefs(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.knowledge_graph_edges enable row level security;
alter table public.evidence_map_nodes enable row level security;
alter table public.procedural_deadlines enable row level security;
alter table public.expert_report_analyses enable row level security;
alter table public.case_settlement_valuations enable row level security;
alter table public.ai_preference_signals enable row level security;
alter table public.gazette_radar_queries enable row level security;
alter table public.client_briefs enable row level security;

create policy kg_edges_read on public.knowledge_graph_edges for select to authenticated using (office_id = (select public.current_office_id()));
create policy kg_edges_write on public.knowledge_graph_edges for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy evidence_map_read on public.evidence_map_nodes for select to authenticated using (office_id = (select public.current_office_id()));
create policy evidence_map_write on public.evidence_map_nodes for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy deadlines_read on public.procedural_deadlines for select to authenticated using (office_id = (select public.current_office_id()));
create policy deadlines_write on public.procedural_deadlines for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy expert_analyses_read on public.expert_report_analyses for select to authenticated using (office_id = (select public.current_office_id()));
create policy expert_analyses_write on public.expert_report_analyses for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy settlement_read on public.case_settlement_valuations for select to authenticated using (office_id = (select public.current_office_id()));
create policy settlement_write on public.case_settlement_valuations for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy pref_signals_read on public.ai_preference_signals for select to authenticated using (office_id = (select public.current_office_id()));
create policy pref_signals_write on public.ai_preference_signals for all to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));

create policy gazette_read on public.gazette_radar_queries for select to authenticated using (office_id = (select public.current_office_id()));
create policy gazette_write on public.gazette_radar_queries for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy client_briefs_read on public.client_briefs for select to authenticated using (office_id = (select public.current_office_id()));
create policy client_briefs_write on public.client_briefs for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

grant select, insert, update, delete on public.knowledge_graph_edges, public.evidence_map_nodes, public.procedural_deadlines, public.expert_report_analyses, public.case_settlement_valuations, public.ai_preference_signals, public.gazette_radar_queries, public.client_briefs to authenticated, service_role;

commit;
