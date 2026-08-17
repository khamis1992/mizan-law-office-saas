-- Office legal features: limitation dates, time tracking, memo templates,
-- conflict checks, OCR text, notification preferences, and pgvector hybrid search.
begin;

-- ---------------------------------------------------------------------------
-- 1) Limitation tracking: legal_cases.limitation_date + alert window
-- ---------------------------------------------------------------------------
alter table public.legal_cases add column if not exists limitation_date date;
alter table public.legal_cases add column if not exists limitation_alerted_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Time tracking per case (billable hours)
-- ---------------------------------------------------------------------------
create table if not exists public.case_time_entries (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  lawyer_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes integer not null default 0 check (minutes >= 0),
  description text,
  billable boolean not null default true,
  hourly_rate numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists case_time_entries_case_idx on public.case_time_entries(office_id, case_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 3) Case invoices (per-case billing, separate from SaaS subscription invoices)
-- ---------------------------------------------------------------------------
create table if not exists public.case_invoices (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid not null references public.legal_cases(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'cancelled')),
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(12,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_amount numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (office_id, invoice_number)
);
create table if not exists public.case_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.case_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  time_entry_id uuid references public.case_time_entries(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists case_invoices_case_idx on public.case_invoices(office_id, case_id, created_at desc);
create index if not exists case_invoice_items_invoice_idx on public.case_invoice_items(invoice_id);

-- ---------------------------------------------------------------------------
-- 4) Memo templates (defense / reply / appeal) mirroring contract_templates
-- ---------------------------------------------------------------------------
create table if not exists public.memo_templates (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete cascade,
  code text not null,
  title_ar text not null,
  description_ar text,
  memo_type text not null default 'defense' check (memo_type in ('defense', 'reply', 'appeal', 'general')),
  jurisdiction text not null default 'QA',
  structure jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);
create table if not exists public.memo_template_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.memo_templates(id) on delete cascade,
  code text not null,
  title_ar text not null,
  body_template text not null,
  section_order integer not null default 0,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_id, code)
);
create index if not exists memo_template_sections_template_idx on public.memo_template_sections(template_id, section_order);

-- ---------------------------------------------------------------------------
-- 5) Conflict-of-interest checks log
-- ---------------------------------------------------------------------------
create table if not exists public.conflict_checks (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  checked_by uuid not null references public.profiles(id) on delete cascade,
  party_name text not null,
  party_identifier text,
  matches jsonb not null default '[]'::jsonb,
  verdict text not null check (verdict in ('clear', 'conflict', 'review')),
  created_at timestamptz not null default now()
);
create index if not exists conflict_checks_office_idx on public.conflict_checks(office_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) OCR text on documents
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists ocr_text text;
alter table public.documents add column if not exists ocr_status text not null default 'none' check (ocr_status in ('none', 'pending', 'done', 'failed'));

-- ---------------------------------------------------------------------------
-- 7) Notification preferences per office (email / whatsapp toggles)
-- ---------------------------------------------------------------------------
create table if not exists public.office_notification_prefs (
  office_id uuid primary key references public.offices(id) on delete cascade,
  hearing_email boolean not null default false,
  hearing_whatsapp boolean not null default false,
  hearing_lead_days integer not null default 1,
  limitation_email boolean not null default false,
  limitation_lead_months integer not null default 6,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8) pgvector hybrid search: embeddings on sections & precedents
-- ---------------------------------------------------------------------------
create extension if not exists vector with schema extensions;

alter table public.legal_source_sections add column if not exists embedding vector(1536);
alter table public.legal_precedents add column if not exists embedding vector(1536);

create index if not exists legal_source_sections_embedding_idx on public.legal_source_sections using hnsw (embedding vector_cosine_ops);
create index if not exists legal_precedents_embedding_idx on public.legal_precedents using hnsw (embedding vector_cosine_ops);

-- Hybrid search: ts_rank + cosine similarity (embedding optional; falls back to text-only)
create or replace function public.search_legal_sections_hybrid(p_query text, p_embedding vector(1536) default null, p_limit integer default 12)
returns table (id uuid, source_id uuid, article_number text, heading text, snippet text, title text, source_url text, official_number text, rank real, similarity real)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_term tsquery;
begin
  select coalesce(
    string_agg(to_tsquery('simple', w)::text, ' | ')::tsquery,
    to_tsquery('simple', '')
  ) into v_term
  from unnest(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+')) w
  where length(w) >= 2;

  if p_embedding is not null then
    return query
    select s.id, s.source_id, s.article_number, s.heading,
           left(s.body, 320) as snippet,
           ls.title, ls.source_url, ls.official_number,
           ts_rank(s.search_vector, v_term) as rank,
           1 - (s.embedding <=> p_embedding) as similarity
    from public.legal_source_sections s
    join public.legal_sources ls on ls.id = s.source_id
    where s.embedding is not null
      and (v_term = ''::tsquery or s.search_vector @@ v_term)
    order by (0.5 * coalesce(ts_rank(s.search_vector, v_term), 0) + 0.5 * (1 - (s.embedding <=> p_embedding))) desc
    limit greatest(coalesce(p_limit, 12), 1);
  end if;

  return query
  select s.id, s.source_id, s.article_number, s.heading,
         left(s.body, 320) as snippet,
         ls.title, ls.source_url, ls.official_number,
         ts_rank(s.search_vector, v_term) as rank,
         0::real as similarity
  from public.legal_source_sections s
  join public.legal_sources ls on ls.id = s.source_id
  where s.search_vector @@ v_term
  order by rank desc, s.section_order
  limit greatest(coalesce(p_limit, 12), 1);
end;
$$;

create or replace function public.search_precedents_hybrid(p_query text, p_embedding vector(1536) default null, p_limit integer default 8)
returns table (id uuid, court_name text, reference_number text, decided_on date, title text, summary text, principle_text text, source_url text, similarity real)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_embedding is not null then
    return query
    select p.id, p.court_name, p.reference_number, p.decided_on, p.title, p.summary, p.principle_text, p.source_url,
           1 - (p.embedding <=> p_embedding) as similarity
    from public.legal_precedents p
    where p.is_verified and p.embedding is not null
    order by (1 - (p.embedding <=> p_embedding)) desc
    limit greatest(coalesce(p_limit, 8), 1);
  end if;

  return query
  select p.id, p.court_name, p.reference_number, p.decided_on, p.title, p.summary, p.principle_text, p.source_url,
         0::real as similarity
  from public.legal_precedents p
  where p.is_verified
  order by p.created_at desc
  limit greatest(coalesce(p_limit, 8), 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Hearing reminder dispatch: creates in-app notifications for upcoming hearings
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_hearing_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_lead interval;
  v_row record;
begin
  for v_row in
    select h.id, h.case_id, h.hearing_at, h.court_name, h.office_id,
           c.case_number, c.title as case_title,
           p.id as lawyer_id, p.display_name as lawyer_name,
           cl.full_name as client_name,
           coalesce(prefs.hearing_lead_days, 1) as lead_days
    from public.hearings h
    join public.legal_cases c on c.id = h.case_id
    left join public.profiles p on p.id = c.responsible_lawyer_id
    left join public.clients cl on cl.id = c.client_id
    left join public.office_notification_prefs prefs on prefs.office_id = h.office_id
    where h.status = 'scheduled'
      and h.reminder_sent_at is null
      and h.hearing_at > now()
      and h.hearing_at <= now() + (coalesce(prefs.hearing_lead_days, 1) || ' days')::interval
  loop
    insert into public.notifications (office_id, recipient_id, type, title, body, reference_url)
    values (
      v_row.office_id,
      coalesce(v_row.lawyer_id, (select created_by from public.legal_cases where id = v_row.case_id)),
      'hearing_reminder',
      'جلسة قريبة: ' || v_row.case_number,
      'جلسة «' || v_row.case_title || '» يوم ' || to_char(v_row.hearing_at, 'YYYY-MM-DD HH24:MI') ||
      coalesce(' في ' || v_row.court_name, '') || coalesce(' — العميل: ' || v_row.client_name, ''),
      '/cases/' || v_row.case_id
    );
    update public.hearings set reminder_sent_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Limitation alerts: notify 6 months before limitation date
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_limitation_alerts()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_row record;
begin
  for v_row in
    select c.id, c.case_number, c.title, c.limitation_date, c.office_id,
           c.responsible_lawyer_id,
           coalesce(prefs.limitation_lead_months, 6) as lead_months
    from public.legal_cases c
    left join public.office_notification_prefs prefs on prefs.office_id = c.office_id
    where c.limitation_date is not null
      and c.status not in ('closed', 'archived')
      and c.limitation_alerted_at is null
      and c.limitation_date <= current_date + (coalesce(prefs.limitation_lead_months, 6) || ' months')::interval
      and c.limitation_date >= current_date
  loop
    insert into public.notifications (office_id, recipient_id, type, title, body, reference_url)
    values (
      v_row.office_id,
      coalesce(v_row.responsible_lawyer_id, (select created_by from public.legal_cases where id = v_row.id)),
      'limitation_alert',
      'اقتراب التقادم: ' || v_row.case_number,
      'تنقضي الدعوى «' || v_row.title || '» بتاريخ ' || to_char(v_row.limitation_date, 'YYYY-MM-DD') ||
      ' — يلزم اتخاذ إجراء قبل انقضاء المدة.',
      '/cases/' || v_row.id
    );
    update public.legal_cases set limitation_alerted_at = now() where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS policies for new tables
-- ---------------------------------------------------------------------------
alter table public.case_time_entries enable row level security;
alter table public.case_invoices enable row level security;
alter table public.case_invoice_items enable row level security;
alter table public.memo_templates enable row level security;
alter table public.memo_template_sections enable row level security;
alter table public.conflict_checks enable row level security;
alter table public.office_notification_prefs enable row level security;

create policy time_entries_read on public.case_time_entries for select to authenticated using (office_id = (select public.current_office_id()));
create policy time_entries_write on public.case_time_entries for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy case_invoices_read on public.case_invoices for select to authenticated using (office_id = (select public.current_office_id()));
create policy case_invoices_write on public.case_invoices for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy case_invoice_items_read on public.case_invoice_items for select to authenticated using (exists (select 1 from public.case_invoices i where i.id = invoice_id and i.office_id = (select public.current_office_id())));
create policy case_invoice_items_write on public.case_invoice_items for all to authenticated using ((select public.is_lawyer_or_manager())) with check ((select public.is_lawyer_or_manager()));

create policy memo_templates_read on public.memo_templates for select to authenticated using (office_id is null or office_id = (select public.current_office_id()));
create policy memo_templates_write on public.memo_templates for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));
create policy memo_sections_read on public.memo_template_sections for select to authenticated using (exists (select 1 from public.memo_templates t where t.id = template_id and (t.office_id is null or t.office_id = (select public.current_office_id()))));
create policy memo_sections_write on public.memo_template_sections for all to authenticated using ((select public.is_manager())) with check ((select public.is_manager()));

create policy conflict_checks_read on public.conflict_checks for select to authenticated using (office_id = (select public.current_office_id()));
create policy conflict_checks_write on public.conflict_checks for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy notif_prefs_read on public.office_notification_prefs for select to authenticated using (office_id = (select public.current_office_id()));
create policy notif_prefs_write on public.office_notification_prefs for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

grant select, insert, update, delete on public.case_time_entries, public.case_invoices, public.case_invoice_items, public.memo_templates, public.memo_template_sections, public.conflict_checks, public.office_notification_prefs to authenticated, service_role;
grant execute on function public.search_legal_sections_hybrid(text, vector, integer) to authenticated, service_role;
grant execute on function public.search_precedents_hybrid(text, vector, integer) to authenticated, service_role;
grant execute on function public.dispatch_hearing_reminders() to service_role;
grant execute on function public.dispatch_limitation_alerts() to service_role;

-- ---------------------------------------------------------------------------
-- Seed: three memo templates (defense / reply / appeal)
-- ---------------------------------------------------------------------------
insert into public.memo_templates (code, title_ar, description_ar, memo_type, structure) values
('defense_memo_qa', 'مذكرة دفاع', 'مذكرة دفاع أمام المحاكم القطرية: ترويسة، تمهيد، وقائع، دفوع شكلية وموضوعية، طلبات ختامية.', 'defense', '[
  {"key":"court_name","label_ar":"المحكمة","type":"text","required":true},
  {"key":"case_number","label_ar":"رقم الدعوى","type":"text","required":true},
  {"key":"claimant","label_ar":"المدعي","type":"text","required":true},
  {"key":"defendant","label_ar":"المدعى عليه","type":"text","required":true},
  {"key":"facts","label_ar":"الوقائع","type":"textarea","required":true},
  {"key":"defenses","label_ar":"الدفوع","type":"textarea","required":true},
  {"key":"requests","label_ar":"الطلبات الختامية","type":"textarea","required":true}
]'),
('reply_memo_qa', 'مذكرة رد', 'مذكرة رد على مذكرة الخصم: الرد على الدفوع والطلبات ببيان سندها القانوني.', 'reply', '[
  {"key":"court_name","label_ar":"المحكمة","type":"text","required":true},
  {"key":"case_number","label_ar":"رقم الدعوى","type":"text","required":true},
  {"key":"claimant","label_ar":"المدعي","type":"text","required":true},
  {"key":"defendant","label_ar":"المدعى عليه","type":"text","required":true},
  {"key":"opponent_memo","label_ar":"خلاصة مذكرة الخصم","type":"textarea","required":true},
  {"key":"rebuttals","label_ar":"الردود","type":"textarea","required":true},
  {"key":"requests","label_ar":"الطلبات الختامية","type":"textarea","required":true}
]'),
('appeal_memo_qa', 'مذكرة استئناف', 'مذكرة استئناف حكم: أسباب الاستئناف وسنده القانوني والطلبات.', 'appeal', '[
  {"key":"court_name","label_ar":"محكمة الاستئناف","type":"text","required":true},
  {"key":"case_number","label_ar":"رقم الدعوى","type":"text","required":true},
  {"key":"appellant","label_ar":"المستأنف","type":"text","required":true},
  {"key":"respondent","label_ar":"المستأنف ضده","type":"text","required":true},
  {"key":"judgment_summary","label_ar":"خلاصة الحكم المستأنف","type":"textarea","required":true},
  {"key":"grounds","label_ar":"أسباب الاستئناف","type":"textarea","required":true},
  {"key":"requests","label_ar":"الطلبات","type":"textarea","required":true}
]');

insert into public.memo_template_sections (template_id, code, title_ar, body_template, section_order, is_optional) values
((select id from public.memo_templates where code='defense_memo_qa'), 'header', 'الترويسة', 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمدعي: {{claimant}}\nالمدعى عليه: {{defendant}}', 10, false),
((select id from public.memo_templates where code='defense_memo_qa'), 'prelude', 'التمهيد', 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من المدعى عليه {{defendant}} بصفته في الدعوى رقم {{case_number}}.', 20, false),
((select id from public.memo_templates where code='defense_memo_qa'), 'facts', 'الوقائع', 'الوقائع:\n{{facts}}', 30, false),
((select id from public.memo_templates where code='defense_memo_qa'), 'defenses', 'الدفوع', 'الدفوع:\n{{defenses}}', 40, false),
((select id from public.memo_templates where code='defense_memo_qa'), 'requests', 'الطلبات الختامية', 'بناءً عليه، يلتمس المدعى عليه من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل المدعى عليه\n______', 50, false),
((select id from public.memo_templates where code='reply_memo_qa'), 'header', 'الترويسة', 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمدعي: {{claimant}}\nالمدعى عليه: {{defendant}}', 10, false),
((select id from public.memo_templates where code='reply_memo_qa'), 'prelude', 'التمهيد', 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من {{defendant}} رداً على مذكرة {{claimant}} في الدعوى رقم {{case_number}}.', 20, false),
((select id from public.memo_templates where code='reply_memo_qa'), 'opponent', 'خلاصة مذكرة الخصم', 'أودع الخصم مذكرة خلاصتها:\n{{opponent_memo}}', 30, false),
((select id from public.memo_templates where code='reply_memo_qa'), 'rebuttals', 'الردود', 'الرد على ما ورد فيها:\n{{rebuttals}}', 40, false),
((select id from public.memo_templates where code='reply_memo_qa'), 'requests', 'الطلبات الختامية', 'بناءً عليه، يلتمس {{defendant}} من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل {{defendant}}\n______', 50, false),
((select id from public.memo_templates where code='appeal_memo_qa'), 'header', 'الترويسة', 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمستأنف: {{appellant}}\nالمستأنف ضده: {{respondent}}', 10, false),
((select id from public.memo_templates where code='appeal_memo_qa'), 'prelude', 'التمهيد', 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من المستأنف {{appellant}} بصفته في الدعوى رقم {{case_number}} استئنافاً للحكم الصادر فيها.', 20, false),
((select id from public.memo_templates where code='appeal_memo_qa'), 'judgment', 'الحكم المستأنف', 'صدر الحكم المستأنف بخلاصة:\n{{judgment_summary}}', 30, false),
((select id from public.memo_templates where code='appeal_memo_qa'), 'grounds', 'أسباب الاستئناف', 'أسباب الاستئناف:\n{{grounds}}', 40, false),
((select id from public.memo_templates where code='appeal_memo_qa'), 'requests', 'الطلبات', 'بناءً عليه، يلتمس المستأنف من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل المستأنف\n______', 50, false);

commit;
