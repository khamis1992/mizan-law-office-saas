begin;

-- The user explicitly requested a clean start. This removes the prior public schema only.
drop schema if exists public cascade;
create schema public;

grant usage on schema public to anon, authenticated, service_role;

create type public.app_role as enum ('manager', 'lawyer', 'employee');
create type public.client_kind as enum ('individual', 'company');
create type public.case_type as enum ('criminal', 'civil', 'commercial', 'labor', 'administrative', 'family', 'execution', 'real_estate', 'other');
create type public.case_status as enum ('new', 'active', 'on_hold', 'closed', 'appeal', 'archived');
create type public.hearing_status as enum ('scheduled', 'held', 'postponed', 'cancelled');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_status as enum ('not_started', 'in_progress', 'completed', 'cancelled');
create type public.document_category as enum ('court_filing', 'power_of_attorney', 'contract', 'evidence', 'identity', 'correspondence', 'memo', 'other');
create type public.communication_channel as enum ('phone', 'email', 'meeting', 'whatsapp', 'letter', 'other');
create type public.legal_source_type as enum ('constitution', 'law', 'regulation', 'decree', 'ministerial_decision', 'court_principle', 'judgment', 'guide');
create type public.draft_status as enum ('draft', 'review', 'approved', 'archived');

create table public.offices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) >= 3),
  commercial_registration text,
  address text,
  phone text,
  email text,
  timezone text not null default 'Asia/Qatar',
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  office_id uuid references public.offices(id) on delete set null,
  role public.app_role not null default 'employee',
  display_name text not null default '',
  email text,
  phone text,
  job_title text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.office_invitations (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'employee',
  invitation_token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (office_id, email)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  kind public.client_kind not null default 'individual',
  full_name text not null,
  national_id text,
  commercial_registration text,
  phone text,
  email text,
  address text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (office_id, national_id)
);

create table public.client_communications (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  channel public.communication_channel not null,
  subject text not null,
  content text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.legal_cases (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_number text not null,
  title text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  responsible_lawyer_id uuid references public.profiles(id) on delete set null,
  type public.case_type not null default 'other',
  status public.case_status not null default 'new',
  court_name text,
  court_circuit text,
  opponent_name text,
  opponent_representative text,
  opening_date date,
  closing_date date,
  description text,
  desired_outcome text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (office_id, case_number)
);

create table public.case_parties (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  party_type text not null check (party_type in ('claimant', 'defendant', 'appellant', 'respondent', 'intervenor', 'other')),
  party_name text not null,
  representative_name text,
  contact_details text,
  created_at timestamptz not null default now()
);

create table public.hearings (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  hearing_at timestamptz not null,
  court_name text,
  court_room text,
  hearing_type text,
  status public.hearing_status not null default 'scheduled',
  outcome text,
  next_hearing_at timestamptz,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  title text not null,
  description text,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'not_started',
  due_at timestamptz,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  category public.document_category not null default 'other',
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  description text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (case_id is not null or client_id is not null)
);

create table public.legal_sources (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete cascade,
  source_type public.legal_source_type not null,
  title text not null,
  official_number text,
  issuing_authority text,
  issued_on date,
  effective_on date,
  source_url text not null,
  source_version text,
  is_current boolean not null default true,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, official_number, source_version)
);

create table public.legal_source_sections (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.legal_sources(id) on delete cascade,
  section_order integer not null default 0,
  article_number text,
  heading text,
  body text not null,
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(article_number, '') || ' ' || coalesce(heading, '') || ' ' || body)) stored,
  created_at timestamptz not null default now()
);

create table public.legal_precedents (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete cascade,
  court_name text not null,
  reference_number text,
  decided_on date,
  classification text,
  title text not null,
  summary text not null,
  principle_text text,
  source_url text not null,
  source_version text,
  is_verified boolean not null default false,
  search_vector tsvector generated always as (to_tsvector('simple', title || ' ' || summary || ' ' || coalesce(principle_text, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (court_name, reference_number, source_version)
);

create table public.case_researches (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  research_query text not null,
  factual_context text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.research_results (
  id uuid primary key default gen_random_uuid(),
  research_id uuid not null references public.case_researches(id) on delete cascade,
  source_section_id uuid references public.legal_source_sections(id) on delete cascade,
  precedent_id uuid references public.legal_precedents(id) on delete cascade,
  relevance_score numeric(5,4) check (relevance_score between 0 and 1),
  rationale text,
  cited_excerpt text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_section_id, precedent_id) = 1)
);

create table public.legal_drafts (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  title text not null,
  document_type text not null default 'legal_memo',
  content text not null default '',
  status public.draft_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_runs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  draft_id uuid references public.legal_drafts(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  provider text not null default 'grok',
  model text not null,
  instruction text not null,
  response_markdown text not null,
  cited_sources jsonb not null default '[]'::jsonb,
  review_status text not null default 'requires_lawyer_review' check (review_status in ('requires_lawyer_review', 'reviewed', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  reference_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  office_id uuid references public.offices(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profiles_office_idx on public.profiles(office_id, role);
create index invitations_office_idx on public.office_invitations(office_id, expires_at) where accepted_at is null;
create index clients_office_name_idx on public.clients(office_id, full_name);
create index cases_office_status_idx on public.legal_cases(office_id, status, responsible_lawyer_id);
create index hearings_office_schedule_idx on public.hearings(office_id, hearing_at) where status = 'scheduled';
create index tasks_office_due_idx on public.tasks(office_id, due_at, status);
create index documents_office_case_idx on public.documents(office_id, case_id, client_id);
create index legal_source_sections_search_idx on public.legal_source_sections using gin(search_vector);
create index legal_precedents_search_idx on public.legal_precedents using gin(search_vector);
create index research_results_research_idx on public.research_results(research_id, relevance_score desc);
create index assistant_runs_case_idx on public.assistant_runs(office_id, case_id, created_at desc);
create index notifications_recipient_idx on public.notifications(recipient_id, is_read, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.current_office_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select office_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.current_user_role() = 'manager'::public.app_role), false)
$$;

create or replace function public.is_lawyer_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.current_user_role() in ('manager'::public.app_role, 'lawyer'::public.app_role)), false)
$$;

create or replace function public.create_office_with_manager(
  p_name text,
  p_phone text default null,
  p_email text default null,
  p_address text default null
)
returns public.offices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_office public.offices;
begin
  if v_user_id is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id and office_id is not null) then
    raise exception 'الحساب مرتبط بالفعل بمكتب';
  end if;

  insert into public.offices (name, phone, email, address, owner_id)
  values (trim(p_name), p_phone, p_email, p_address, v_user_id)
  returning * into v_office;

  perform set_config('app.allow_privileged_profile_write', 'true', true);
  update public.profiles
  set office_id = v_office.id, role = 'manager', is_active = true
  where id = v_user_id;

  return v_office;
end;
$$;

create or replace function public.accept_office_invitation(p_invitation_token uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_invitation public.office_invitations;
  v_profile public.profiles;
begin
  if v_user_id is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;

  select * into v_invitation
  from public.office_invitations
  where invitation_token = p_invitation_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'رمز الدعوة غير صالح أو منتهي';
  end if;

  if lower(v_invitation.email) <> lower(coalesce((select email from auth.users where id = v_user_id), '')) then
    raise exception 'هذه الدعوة مخصصة لبريد إلكتروني مختلف';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id and office_id is not null) then
    raise exception 'الحساب مرتبط بالفعل بمكتب';
  end if;

  perform set_config('app.allow_privileged_profile_write', 'true', true);
  update public.profiles
  set office_id = v_invitation.office_id, role = v_invitation.role, is_active = true
  where id = v_user_id
  returning * into v_profile;

  update public.office_invitations set accepted_at = now() where id = v_invitation.id;
  return v_profile;
end;
$$;

create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_privileged_profile_write', true) = 'true' then
    return new;
  end if;

  if not public.is_manager() and (
    new.office_id is distinct from old.office_id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email is distinct from old.email
  ) then
    raise exception 'لا تملك صلاحية تعديل الدور أو المكتب أو حالة المستخدم';
  end if;

  return new;
end;
$$;

create or replace function public.protect_employee_task_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.current_user_role() = 'employee'::public.app_role and (
    new.office_id is distinct from old.office_id
    or new.case_id is distinct from old.case_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.assigned_to is distinct from old.assigned_to
    or new.created_by is distinct from old.created_by
    or new.priority is distinct from old.priority
    or new.due_at is distinct from old.due_at
  ) then
    raise exception 'يمكن للموظف تحديث حالة المهمة وملاحظة الإنجاز فقط';
  end if;
  return new;
end;
$$;

create trigger set_offices_updated_at before update on public.offices for each row execute function public.set_updated_at();
create trigger set_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger set_clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger set_cases_updated_at before update on public.legal_cases for each row execute function public.set_updated_at();
create trigger set_hearings_updated_at before update on public.hearings for each row execute function public.set_updated_at();
create trigger set_tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger set_legal_sources_updated_at before update on public.legal_sources for each row execute function public.set_updated_at();
create trigger set_legal_precedents_updated_at before update on public.legal_precedents for each row execute function public.set_updated_at();
create trigger set_legal_drafts_updated_at before update on public.legal_drafts for each row execute function public.set_updated_at();
create trigger protect_profiles before update on public.profiles for each row execute function public.protect_profile_sensitive_fields();
create trigger protect_employee_tasks before update on public.tasks for each row execute function public.protect_employee_task_edit();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.offices enable row level security;
alter table public.profiles enable row level security;
alter table public.office_invitations enable row level security;
alter table public.clients enable row level security;
alter table public.client_communications enable row level security;
alter table public.legal_cases enable row level security;
alter table public.case_parties enable row level security;
alter table public.hearings enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.legal_sources enable row level security;
alter table public.legal_source_sections enable row level security;
alter table public.legal_precedents enable row level security;
alter table public.case_researches enable row level security;
alter table public.research_results enable row level security;
alter table public.legal_drafts enable row level security;
alter table public.assistant_runs enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy offices_select on public.offices for select to authenticated using (id = (select public.current_office_id()));
create policy offices_update on public.offices for update to authenticated using (id = (select public.current_office_id()) and (select public.is_manager())) with check (id = (select public.current_office_id()) and (select public.is_manager()));

create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or (office_id is not null and office_id = (select public.current_office_id())));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or (office_id = (select public.current_office_id()) and (select public.is_manager()))) with check (id = auth.uid() or (office_id = (select public.current_office_id()) and (select public.is_manager())));

create policy invitations_manager_all on public.office_invitations for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy clients_read on public.clients for select to authenticated using (office_id = (select public.current_office_id()));
create policy clients_write on public.clients for insert to authenticated with check (office_id = (select public.current_office_id()));
create policy clients_update on public.clients for update to authenticated using (office_id = (select public.current_office_id())) with check (office_id = (select public.current_office_id()));
create policy clients_delete on public.clients for delete to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy communications_read on public.client_communications for select to authenticated using (office_id = (select public.current_office_id()));
create policy communications_write on public.client_communications for insert to authenticated with check (office_id = (select public.current_office_id()));
create policy communications_update on public.client_communications for update to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_lawyer_or_manager()) or created_by = auth.uid())) with check (office_id = (select public.current_office_id()));
create policy communications_delete on public.client_communications for delete to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_manager()) or created_by = auth.uid()));

create policy cases_read on public.legal_cases for select to authenticated using (office_id = (select public.current_office_id()));
create policy cases_insert on public.legal_cases for insert to authenticated with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy cases_update on public.legal_cases for update to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_manager()) or ((select public.current_user_role()) = 'lawyer'::public.app_role and responsible_lawyer_id = auth.uid()))) with check (office_id = (select public.current_office_id()));
create policy cases_delete on public.legal_cases for delete to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy case_parties_read on public.case_parties for select to authenticated using (office_id = (select public.current_office_id()));
create policy case_parties_write on public.case_parties for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy hearings_read on public.hearings for select to authenticated using (office_id = (select public.current_office_id()));
create policy hearings_write on public.hearings for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy tasks_read on public.tasks for select to authenticated using (office_id = (select public.current_office_id()));
create policy tasks_insert on public.tasks for insert to authenticated with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy tasks_update on public.tasks for update to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_lawyer_or_manager()) or assigned_to = auth.uid())) with check (office_id = (select public.current_office_id()) and ((select public.is_lawyer_or_manager()) or assigned_to = auth.uid()));
create policy tasks_delete on public.tasks for delete to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy documents_read on public.documents for select to authenticated using (office_id = (select public.current_office_id()));
create policy documents_insert on public.documents for insert to authenticated with check (office_id = (select public.current_office_id()));
create policy documents_update on public.documents for update to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_lawyer_or_manager()) or uploaded_by = auth.uid())) with check (office_id = (select public.current_office_id()));
create policy documents_delete on public.documents for delete to authenticated using (office_id = (select public.current_office_id()) and ((select public.is_lawyer_or_manager()) or uploaded_by = auth.uid()));

create policy legal_sources_read on public.legal_sources for select to authenticated using (office_id is null or office_id = (select public.current_office_id()));
create policy legal_sources_manager_write on public.legal_sources for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));
create policy legal_sections_read on public.legal_source_sections for select to authenticated using (exists (select 1 from public.legal_sources s where s.id = source_id and (s.office_id is null or s.office_id = (select public.current_office_id()))));
create policy legal_sections_manager_write on public.legal_source_sections for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));
create policy precedents_read on public.legal_precedents for select to authenticated using (office_id is null or office_id = (select public.current_office_id()));
create policy precedents_manager_write on public.legal_precedents for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy research_read on public.case_researches for select to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy research_write on public.case_researches for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy research_results_read on public.research_results for select to authenticated using (exists (select 1 from public.case_researches r where r.id = research_id and r.office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())));
create policy research_results_write on public.research_results for all to authenticated using ((select public.is_lawyer_or_manager())) with check ((select public.is_lawyer_or_manager()));
create policy drafts_read on public.legal_drafts for select to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy drafts_write on public.legal_drafts for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy assistant_runs_read on public.assistant_runs for select to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy assistant_runs_insert on public.assistant_runs for insert to authenticated with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()) and requested_by = auth.uid());
create policy notifications_read on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy audit_read on public.audit_logs for select to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager()));

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_office_id() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;
grant execute on function public.is_lawyer_or_manager() to authenticated, service_role;
grant execute on function public.create_office_with_manager(text, text, text, text) to authenticated, service_role;
grant execute on function public.accept_office_invitation(uuid) to authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.protect_profile_sensitive_fields() to service_role;
grant execute on function public.protect_employee_task_edit() to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('legal-documents', 'legal-documents', false, 52428800, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists legal_documents_select on storage.objects;
drop policy if exists legal_documents_insert on storage.objects;
drop policy if exists legal_documents_update on storage.objects;
drop policy if exists legal_documents_delete on storage.objects;
create policy legal_documents_select on storage.objects for select to authenticated using (bucket_id = 'legal-documents' and (storage.foldername(name))[1] = (select public.current_office_id())::text);
create policy legal_documents_insert on storage.objects for insert to authenticated with check (bucket_id = 'legal-documents' and (storage.foldername(name))[1] = (select public.current_office_id())::text);
create policy legal_documents_update on storage.objects for update to authenticated using (bucket_id = 'legal-documents' and (storage.foldername(name))[1] = (select public.current_office_id())::text and ((select public.is_lawyer_or_manager()) or owner_id = auth.uid()::text)) with check (bucket_id = 'legal-documents' and (storage.foldername(name))[1] = (select public.current_office_id())::text);
create policy legal_documents_delete on storage.objects for delete to authenticated using (bucket_id = 'legal-documents' and (storage.foldername(name))[1] = (select public.current_office_id())::text and ((select public.is_lawyer_or_manager()) or owner_id = auth.uid()::text));

commit;
