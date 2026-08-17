-- Advanced legal intelligence: persistent case agent, adversarial memos,
-- judgment analysis, case prediction, court portal, contextual chat,
-- collaborative drafting, adaptive templates, approval workflow,
-- graduated notifications, auto embedding indexing, legal audit, case export.
begin;

-- ---------------------------------------------------------------------------
-- 1) Persistent Case Agent
-- ---------------------------------------------------------------------------
create table if not exists public.case_agent_runs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('new_document', 'hearing_scheduled', 'hearing_outcome', 'judgment', 'opponent_memo', 'manual', 'daily')),
  trigger_ref text,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  summary text,
  suggestions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists case_agent_runs_case_idx on public.case_agent_runs(office_id, case_id, created_at desc);

create table if not exists public.case_agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  run_id uuid references public.case_agent_runs(id) on delete cascade,
  kind text not null check (kind in ('defense', 'gap', 'action', 'document', 'risk')),
  title text not null,
  detail text,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists case_agent_suggestions_case_idx on public.case_agent_suggestions(office_id, case_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Adversarial memos (opponent's expected reply)
-- ---------------------------------------------------------------------------
create table if not exists public.adversarial_memos (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  draft_id uuid references public.legal_drafts(id) on delete set null,
  perspective text not null default 'opponent' check (perspective in ('opponent', 'court', 'claimant')),
  content text not null,
  weaknesses jsonb not null default '[]'::jsonb,
  counter_arguments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists adversarial_memos_case_idx on public.adversarial_memos(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) Judgment analysis → proposed precedents
-- ---------------------------------------------------------------------------
create table if not exists public.judgment_analyses (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  hearing_id uuid references public.hearings(id) on delete set null,
  outcome_text text not null,
  principle text,
  proposed_precedent jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists judgment_analyses_case_idx on public.judgment_analyses(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) Case outcome prediction
-- ---------------------------------------------------------------------------
create table if not exists public.case_predictions (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  success_probability numeric(5,4) not null check (success_probability between 0 and 1),
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  factors jsonb not null default '[]'::jsonb,
  what_if jsonb not null default '[]'::jsonb,
  model_version text not null default 'heuristic-v1',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists case_predictions_case_idx on public.case_predictions(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) Court portal sync + court holidays calendar
-- ---------------------------------------------------------------------------
create table if not exists public.court_schedule_syncs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  court_case_number text not null,
  synced_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'not_found', 'error'))
);
create index if not exists court_schedule_syncs_case_idx on public.court_schedule_syncs(office_id, case_id, synced_at desc);

create table if not exists public.court_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name_ar text not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6) Contextual case chat
-- ---------------------------------------------------------------------------
create table if not exists public.case_chat_messages (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  cited_sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists case_chat_messages_case_idx on public.case_chat_messages(office_id, case_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 7) Collaborative drafting: comments + revisions
-- ---------------------------------------------------------------------------
create table if not exists public.draft_comments (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  draft_id uuid not null references public.legal_drafts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists draft_comments_draft_idx on public.draft_comments(office_id, draft_id, created_at asc);

create table if not exists public.draft_revisions (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  draft_id uuid not null references public.legal_drafts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content_before text not null,
  content_after text not null,
  change_summary text,
  created_at timestamptz not null default now()
);
create index if not exists draft_revisions_draft_idx on public.draft_revisions(office_id, draft_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8) Adaptive template usage
-- ---------------------------------------------------------------------------
create table if not exists public.memo_template_usage (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  template_id uuid not null references public.memo_templates(id) on delete cascade,
  lawyer_id uuid references public.profiles(id) on delete set null,
  court_name text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists memo_template_usage_idx on public.memo_template_usage(office_id, template_id, court_name);

-- ---------------------------------------------------------------------------
-- 9) Approval workflow events (auto-approval chain)
-- ---------------------------------------------------------------------------
create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  draft_id uuid not null references public.legal_drafts(id) on delete cascade,
  current_step text not null default 'lawyer_review' check (current_step in ('lawyer_review', 'manager_review', 'approved', 'rejected')),
  history jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approval_workflows_draft_idx on public.approval_workflows(office_id, draft_id);

-- ---------------------------------------------------------------------------
-- 10) Graduated notification deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'whatsapp', 'urgent')),
  stage text not null check (stage in ('quiet', 'standard', 'urgent')),
  sent_at timestamptz not null default now(),
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped'))
);
create index if not exists notification_deliveries_notif_idx on public.notification_deliveries(notification_id);

-- ---------------------------------------------------------------------------
-- 11) Embedding index jobs (auto vector indexing)
-- ---------------------------------------------------------------------------
create table if not exists public.embedding_index_jobs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete cascade,
  target text not null check (target in ('sections', 'precedents')),
  processed integer not null default 0,
  total integer not null default 0,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 12) Legal audit log (full governance trail)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_audit_logs (
  id bigint generated always as identity primary key,
  office_id uuid not null references public.offices(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists legal_audit_logs_entity_idx on public.legal_audit_logs(office_id, entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 13) Case exports (full case file PDF)
-- ---------------------------------------------------------------------------
create table if not exists public.case_exports (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  format text not null default 'pdf' check (format in ('pdf', 'zip')),
  status text not null default 'ready' check (status in ('ready', 'failed')),
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists case_exports_case_idx on public.case_exports(office_id, case_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
alter table public.case_agent_runs enable row level security;
alter table public.case_agent_suggestions enable row level security;
alter table public.adversarial_memos enable row level security;
alter table public.judgment_analyses enable row level security;
alter table public.case_predictions enable row level security;
alter table public.court_schedule_syncs enable row level security;
alter table public.court_holidays enable row level security;
alter table public.case_chat_messages enable row level security;
alter table public.draft_comments enable row level security;
alter table public.draft_revisions enable row level security;
alter table public.memo_template_usage enable row level security;
alter table public.approval_workflows enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.embedding_index_jobs enable row level security;
alter table public.legal_audit_logs enable row level security;
alter table public.case_exports enable row level security;

create policy agent_runs_read on public.case_agent_runs for select to authenticated using (office_id = (select public.current_office_id()));
create policy agent_runs_write on public.case_agent_runs for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy agent_suggestions_read on public.case_agent_suggestions for select to authenticated using (office_id = (select public.current_office_id()));
create policy agent_suggestions_write on public.case_agent_suggestions for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy adversarial_read on public.adversarial_memos for select to authenticated using (office_id = (select public.current_office_id()));
create policy adversarial_write on public.adversarial_memos for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy judgment_analyses_read on public.judgment_analyses for select to authenticated using (office_id = (select public.current_office_id()));
create policy judgment_analyses_write on public.judgment_analyses for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy predictions_read on public.case_predictions for select to authenticated using (office_id = (select public.current_office_id()));
create policy predictions_write on public.case_predictions for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy court_syncs_read on public.court_schedule_syncs for select to authenticated using (office_id = (select public.current_office_id()));
create policy court_syncs_write on public.court_schedule_syncs for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy court_holidays_read on public.court_holidays for select to authenticated using (true);
create policy court_holidays_write on public.court_holidays for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

create policy chat_read on public.case_chat_messages for select to authenticated using (office_id = (select public.current_office_id()));
create policy chat_write on public.case_chat_messages for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy draft_comments_read on public.draft_comments for select to authenticated using (office_id = (select public.current_office_id()));
create policy draft_comments_write on public.draft_comments for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy draft_revisions_read on public.draft_revisions for select to authenticated using (office_id = (select public.current_office_id()));
create policy draft_revisions_write on public.draft_revisions for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy template_usage_read on public.memo_template_usage for select to authenticated using (office_id = (select public.current_office_id()));
create policy template_usage_write on public.memo_template_usage for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy approval_workflows_read on public.approval_workflows for select to authenticated using (office_id = (select public.current_office_id()));
create policy approval_workflows_write on public.approval_workflows for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy notif_deliveries_read on public.notification_deliveries for select to authenticated using (office_id = (select public.current_office_id()));
create policy notif_deliveries_write on public.notification_deliveries for all to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));

create policy embedding_jobs_read on public.embedding_index_jobs for select to authenticated using (office_id is null or office_id = (select public.current_office_id()));
create policy embedding_jobs_write on public.embedding_index_jobs for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

create policy legal_audit_read on public.legal_audit_logs for select to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager()));
create policy legal_audit_write on public.legal_audit_logs for all to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));

create policy case_exports_read on public.case_exports for select to authenticated using (office_id = (select public.current_office_id()));
create policy case_exports_write on public.case_exports for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

grant select, insert, update, delete on public.case_agent_runs, public.case_agent_suggestions, public.adversarial_memos, public.judgment_analyses, public.case_predictions, public.court_schedule_syncs, public.court_holidays, public.case_chat_messages, public.draft_comments, public.draft_revisions, public.memo_template_usage, public.approval_workflows, public.notification_deliveries, public.embedding_index_jobs, public.case_exports to authenticated, service_role;
grant select, insert, update, delete on public.legal_audit_logs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed: Qatar public holidays 2026 (court calendar)
-- ---------------------------------------------------------------------------
insert into public.court_holidays (holiday_date, name_ar) values
('2026-01-01', 'رأس السنة الميلادية'),
('2026-02-18', 'اليوم الوطني لقطر'),
('2026-03-20', 'عيد الفطر (تقديري)'),
('2026-03-21', 'عيد الفطر (تقديري)'),
('2026-03-22', 'عيد الفطر (تقديري)'),
('2026-05-27', 'عيد الأضحى (تقديري)'),
('2026-05-28', 'عيد الأضحى (تقديري)'),
('2026-05-29', 'عيد الأضحى (تقديري)'),
('2026-06-17', 'رأس السنة الهجرية (تقديري)'),
('2026-08-25', 'المولد النبوي (تقديري)'),
('2026-12-18', 'اليوم الوطني لقطر')
on conflict (holiday_date) do nothing;

commit;
