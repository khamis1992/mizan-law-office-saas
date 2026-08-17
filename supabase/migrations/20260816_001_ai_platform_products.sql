-- AI platform products: contract studio, restricted legal agents, AI usage quota & analytics.
begin;

create type public.contract_document_status as enum ('draft', 'in_review', 'approved', 'ready_for_export');
create type public.agent_type as enum ('research', 'contract', 'case_file');
create type public.agent_run_status as enum ('completed', 'awaiting_approval', 'executed', 'rejected', 'failed');

-- ---------------------------------------------------------------------------
-- Contract studio: templates & clause library
-- ---------------------------------------------------------------------------
create table public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  office_id uuid references public.offices(id) on delete cascade,
  code text not null,
  title_ar text not null,
  description_ar text,
  document_type text not null default 'contract',
  jurisdiction text not null default 'QA',
  variables jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);

create table public.contract_clauses (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.contract_templates(id) on delete cascade,
  code text not null,
  title_ar text not null,
  body_template text not null,
  clause_order integer not null default 0,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  legal_basis_note text,
  is_optional boolean not null default false,
  created_at timestamptz not null default now(),
  unique (template_id, code)
);

create index contract_clauses_template_idx on public.contract_clauses(template_id, clause_order);

-- ---------------------------------------------------------------------------
-- Contract documents: versions + approval workflow (مسودة → مراجعة → معتمد → جاهز للتصدير)
-- ---------------------------------------------------------------------------
create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  template_id uuid references public.contract_templates(id) on delete set null,
  title text not null,
  status public.contract_document_status not null default 'draft',
  current_version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contract_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.contract_documents(id) on delete cascade,
  version_number integer not null,
  content text not null,
  clause_registry jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  clarification_questions jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create table public.contract_approval_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.contract_documents(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  from_status public.contract_document_status not null,
  to_status public.contract_document_status not null,
  note text,
  created_at timestamptz not null default now()
);

create index contract_documents_office_idx on public.contract_documents(office_id, status);
create index contract_approval_events_doc_idx on public.contract_approval_events(document_id, created_at);

-- ---------------------------------------------------------------------------
-- Restricted legal agents: runs with plan/steps + explicit approval events
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  case_id uuid references public.legal_cases(id) on delete set null,
  agent_type public.agent_type not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.agent_run_status not null default 'awaiting_approval',
  objective text not null,
  plan jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  output jsonb not null default '{}'::jsonb,
  pending_action jsonb,
  approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.agent_approval_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);

create index agent_runs_office_idx on public.agent_runs(office_id, created_at desc);
create index agent_approvals_run_idx on public.agent_approval_events(run_id, created_at);

-- ---------------------------------------------------------------------------
-- Seed: three initial contract templates with clause libraries
-- ---------------------------------------------------------------------------
insert into public.contract_templates (code, title_ar, description_ar, document_type, variables) values
('services_agreement_qa', 'اتفاقية تقديم خدمات', 'قالب اتفاقية خدمات مهنية/استشارية وفق القانون القطري، بصياغة قابلة للتحرير ومراجعة محامٍ قبل الاعتماد.', 'services_agreement', '[
  {"key":"provider_name","label_ar":"مقدم الخدمة","type":"text","required":true},
  {"key":"client_name","label_ar":"العميل","type":"text","required":true},
  {"key":"service_description","label_ar":"وصف الخدمات","type":"textarea","required":true},
  {"key":"start_date","label_ar":"تاريخ البدء","type":"date","required":true},
  {"key":"end_date","label_ar":"تاريخ الانتهاء","type":"date","required":false},
  {"key":"fee_amount","label_ar":"الأتعاب (ر.ق)","type":"text","required":true},
  {"key":"payment_terms","label_ar":"شروط السداد","type":"textarea","required":true},
  {"key":"notice_period_days","label_ar":"مهلة الإنهاء بالإشعار (أيام)","type":"number","required":false}
]'),
('nda_qa', 'اتفاقية عدم إفشاء معلومات', 'قالب اتفاقية سرية ثنائية لحماية المعلومات المتبادلة، مع استثناءات السرية المعتمدة ومدة الالتزام.', 'nda', '[
  {"key":"first_party","label_ar":"الطرف الأول (المفصح)","type":"text","required":true},
  {"key":"second_party","label_ar":"الطرف الثاني (المتلقي)","type":"text","required":true},
  {"key":"purpose","label_ar":"الغرض من تبادل المعلومات","type":"textarea","required":true},
  {"key":"effective_date","label_ar":"تاريخ السريان","type":"date","required":true},
  {"key":"confidentiality_years","label_ar":"مدة الالتزام بعد الإفصاح (سنوات)","type":"number","required":true}
]'),
('commercial_agency_qa', 'اتفاقية وكالة تجارية', 'قالب وكالة تجارية داخل قطر يغطي التعيين والإقليم والعمولة والإنهاء، ويستوجب التحقق من تشريع الوكالات التجاري الساري قبل الاعتماد.', 'commercial_agency', '[
  {"key":"principal_name","label_ar":"الموكل","type":"text","required":true},
  {"key":"agent_name","label_ar":"الوكيل","type":"text","required":true},
  {"key":"territory","label_ar":"الإقليم","type":"text","required":true},
  {"key":"products","label_ar":"المنتجات/الخدمات","type":"textarea","required":true},
  {"key":"commission_rate","label_ar":"نسبة العمولة","type":"text","required":true},
  {"key":"term_months","label_ar":"مدة الاتفاقية (شهور)","type":"number","required":true}
]');

insert into public.contract_clauses (template_id, code, title_ar, body_template, clause_order, risk_level, legal_basis_note, is_optional) values
((select id from public.contract_templates where code='services_agreement_qa'), 'definitions', 'التعريفات', 'في هذه الاتفاقية، يقصد بالعبارات التالية المعاني الموضحة أمام كل منها ما لم يقتضِ سياق النص خلاف ذلك: «مقدم الخدمة»: {{provider_name}}. «العميل»: {{client_name}}. «الخدمات»: الخدمات المبينة في البند الثاني. «الاتفاقية»: هذا العقد وملحقاته المعتمدة.', 10, 'low', 'أحكام التفسير العامة للعقود في القانون المدني القطري (قانون رقم 22 لسنة 2004).', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'scope', 'نطاق الخدمات', 'يلتزم مقدم الخدمة بتقديم الخدمات التالية للعميل وفق أحكام هذه الاتفاقية: {{service_description}}. وأي خدمات إضافية خارج النطاق تستوجب ملحقاً كتابياً موقعاً من الطرفين.', 20, 'low', 'مبدأ سلطان الإرادة وتحديد نطاق الالتزام التعاقدي.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'fees', 'الأتعاب وشروط السداد', 'يلتزم العميل بسداد أتعاب مقدارها {{fee_amount}} ريال قطري وفق شروط السداد التالية: {{payment_terms}}. ولا تُعد المصاريف النثرية والرسوم الرسمية مشمولة بالأتعاب ما لم يُتفق كتابياً على خلاف ذلك.', 30, 'medium', 'أحكام الالتزامات التعاقدية والوفاء في القانون المدني القطري؛ يراجع بند السداد قبل الاعتماد.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'provider_obligations', 'التزامات مقدم الخدمة', 'يؤدي مقدم الخدمة الخدمات بعناية المهني المعتاد ووفقاً للأصول المهنية المقررة، ويخطر العميل كتابياً بأي معوقات تؤثر على الجدول الزمني خلال مدة معقولة من علمه بها.', 40, 'low', 'الالتزام ببذل عناية المهني المعتاد في العقود.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'client_obligations', 'التزامات العميل', 'يوفر العميل المعلومات والبيانات اللازمة لأداء الخدمات في مواعيد ملائمة، ويتحمل نتائج تأخيره في توفيرها أو عدم دقتها.', 50, 'low', 'عقد المقاولة وأعمال الخدمات في القانون المدني القطري.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'confidentiality', 'السرية', 'يلتزم كل طرف بالمحافظة على سرية المعلومات غير العلنية التي اطلع عليها بمناسبة تنفيذ هذه الاتفاقية، وعدم إفشائها للغير إلا بموافقة كتابية من الطرف الآخر أو بأمر قضائي.', 60, 'medium', 'أحكام حماية الأسرار في قانون العقوبات القطري (قانون رقم 11 لسنة 2004) والمسؤولية العقدية.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'liability_cap', 'حدود المسؤولية', 'لا يسأل مقدم الخدمة عن أي أضرار غير مباشرة أو فقد ربح، ويقتصر التعويض في جميع الأحوال بمبلغ لا يتجاوز الأتعاب الفعلية المسددة. لا يشمل هذا الحد الغش الجسيم أو الإخلال الجوهري بالتزام السرية.', 70, 'high', 'حدود المسؤولية العقدية يجري تقييدها وفق أحكام القانون المدني القطري؛ يراجعها محامٍ قبل الاعتماد لأن تقييد المسؤولية قد يخضع لضوابط قضائية.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'termination', 'المدة والإنهاء', 'تسري هذه الاتفاقية اعتباراً من {{start_date}} وحتى {{end_date}} أو تاريخ إنجاز الخدمات أيهما أسبق. ويجوز لأي طرف إنهاؤها بإشعار كتابي مسبق مدته {{notice_period_days}} ثلاثون يوماً ما لم يُتفق على خلاف ذلك، مع تسوية المستحقات حتى تاريخ الإنهاء.', 80, 'medium', 'انتهاء العقد بالإرادة المنفردة له ضوابط في القانون المدني؛ يجب النص على مهلة إشعار واضحة.', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'dispute_resolution', 'تسوية النزاعات والقانون الواجب التطبيق', 'تخضع هذه الاتفاقية للقوانين النافذة في دولة قطر، وتختص محاكم دولة قطر بأي نزاع ينشأ عنها أو يتصل بها ما لم يتفق الطرفان كتابياً على التحكيم وفق مراكز التحكيم المعتمدة في قطر.', 90, 'medium', 'الاختصاص القضائي وتنازع القوانين في قانون المرافعات المدنية والتجارية (قانون رقم 13 لسنة 1990).', false),
((select id from public.contract_templates where code='services_agreement_qa'), 'general_provisions', 'الأحكام العامة', 'تعد هذه الاتفاقية كامل الاتفاق بين الطرفين في موضوعها، ولا يعدل أي بند منها إلا بملحق كتابي موقع من الطرفين، وإذا بطل بند بقي باقي البنود نافذاً بقدر الإمكان.', 100, 'low', 'أحكام العقد وشروطه العامة.', false),
((select id from public.contract_templates where code='nda_qa'), 'definitions', 'تعريف المعلومات السرية', 'يقصد بـ«المعلومات السرية» كل معلومات غير علنية، فنية أو تجارية أو مالية أو قانونية، يفصح عنها الطرف الأول ({{first_party}}) إلى الطرف الثاني ({{second_party}}) لأغراض: {{purpose}}، سواء وردت كتابةً أو شفاهةً أو بشكل إلكتروني.', 10, 'low', 'تعريف واسع ومحايد يخدم حماية السرية العقدية.', false),
((select id from public.contract_templates where code='nda_qa'), 'non_disclosure', 'التزام عدم الإفشاء', 'يلتزم الطرف الثاني بعدم إفشاء المعلومات السرية لأي طرف آخر، وبعدم استخدامها إلا للغرض المحدد في هذه الاتفاقية، وباتخاذ تدابير حماية لا تقل عما يتخذه لحماية معلوماته المماثلة.', 20, 'high', 'التزام السرية العقدي تسنده أحكام إفشاء الأسرار في قانون العقوبات القطري (قانون رقم 11 لسنة 2004) إضافة إلى المسؤولية العقدية.', false),
((select id from public.contract_templates where code='nda_qa'), 'exceptions', 'استثناءات الالتزام', 'لا يشمل الالتزام المعلومات التي: (أ) كانت معروفة للعموم قبل الإفصاح دون إخلال من المتلقي، أو (ب) أصبحت علنية لاحقاً دون إخلال منه، أو (ج) طورها المتلقي بشكل مستقل، أو (د) وجب الإفصاح عنها بموجب أمر قضائي أو متطلب نظامي مع إخطار المفصح مسبقاً حيثما أمكن.', 30, 'medium', 'الاستثناءات المعيارية لالتزامات السرية؛ يراجع نطاقها قبل الاعتماد.', false),
((select id from public.contract_templates where code='nda_qa'), 'duration', 'مدة السريان والالتزام', 'تسري هذه الاتفاقية اعتباراً من {{effective_date}}، ويستمر التزام عدم الإفشاء مدة {{confidentiality_years}} ثلاث سنوات من تاريخ آخر إفصاح، ويبقى نافذاً بعد انتهاء الغرض أو إنهاء الاتفاقية.', 40, 'medium', 'استمرار الالتزام بعد انتهاء العقد مسألة تفسيرية يستحسن النص عليها صراحة.', false),
((select id from public.contract_templates where code='nda_qa'), 'breach', 'الإخلال والتعويض', 'يحق للمفصح طلب إنهاء الاتفاقية عند الإخلال الجوهري، بالإضافة إلى التعويض عن الأضرار المباشرة واتخاذ الإجراءات التحفظية المناسبة بما في ذلك طلب المنع القضائي.', 50, 'high', 'المسؤولية العقدية والدعاوى التحفظية وفق قانون المرافعات المدنية والتجارية القطري (قانون رقم 13 لسنة 1990).', false),
((select id from public.contract_templates where code='nda_qa'), 'general_provisions', 'أحكام عامة', 'تخضع هذه الاتفاقية لقوانين دولة قطر وتختص محاكمها بأي نزاع ينشأ عنها، ولا تنشئ هذه الاتفاقية أي علاقة توكيل أو شراكة بين الطرفين.', 60, 'low', 'أحكام عامة معيارية.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'appointment', 'التعيين ونطاق الوكالة', 'يعين الموكل ({{principal_name}}) بموجب هذه الاتفاقية الوكيلَ ({{agent_name}}) وكيلاً عنه داخل {{territory}} لترويج وبيع: {{products}}، وذلك بحدود الصلاحيات المبينة في هذه الاتفاقية.', 10, 'medium', 'تخضع الوكالات التجارية لتشريع قطري خاص؛ يجب التحقق من أحدث نص ساري لقانون الوكالات التجارية ومتطلبات تسجيل الوكيل قبل الاعتماد.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'commission', 'العمولة والتحاسب', 'يستحق الوكيل عمولة بنسبة {{commission_rate}} من صافي قيمة المبيعات المحققة ضمن الإقليم، وتسوى دورياً وفق كشوف حساب معتمدة من الطرفين.', 20, 'medium', 'أحكام الوكالة بالعمولة في القانون المدني القطري مع التحقق من قواعد تحاسب الوكالات التجارية السارية.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'obligations', 'التزامات الطرفين', 'يلتزم الوكيل ببذل عناية الرجل الحصيف في الترويج، وبعدم تمثيل منتجات منافسة داخل الإقليم دون موافقة كتابية، ويلتزم الموكل بتوريد المنتجات وتقديم الدعم الفني والتسويقي المعقول.', 30, 'medium', 'التزامات الوكيل والموكل وفق أحكام الوكالة في القانون المدني القطري.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'term_renewal', 'المدة والتجديد', 'تسري هذه الاتفاقية مدة {{term_months}} شهراً من تاريخ توقيعها، وتتجدد تلقائياً مدداً مماثلة ما لم يخطر أحد الطرفين الآخر كتابياً برغبته في عدم التجديد قبل نهاية المدة الجارية بستين يوماً على الأقل.', 40, 'medium', 'قواعد التجديد الإذني؛ يراجع مهلة عدم التجديد في ضوء تشريع الوكالات الساري.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'termination', 'إنهاء الاتفاقية', 'لا يجوز إنهاء هذه الاتفاقية دون مسوغ مشروع إلا وفق الشروط والمهل المقررة في التشريع الساري، ومع مراعاة حقوق الوكيل المقررة نظاماً بما في ذلك التعويض المستحق عند الإنهاء غير المشروع.', 50, 'high', 'إنهاء اتفاقيات الوكالة التجارية مقيد بتشريع خاص وحقوق تعويض للوكيل؛ يجب مراجعة محامٍ قبل تفعيل هذا البند.', false),
((select id from public.contract_templates where code='commercial_agency_qa'), 'governing_law', 'القانون الواجب التطبيق', 'تخضع هذه الاتفاقية لقوانين دولة قطر، وتختص محاكم دولة قطر بأي نزاع ينشأ عنها ما لم يُتفق كتابياً على خلاف ذلك.', 60, 'low', 'أحكام الاختصاص القضائي في قانون المرافعات المدنية والتجارية القطري.', false);

-- ---------------------------------------------------------------------------
-- AI usage quota (per office, per calendar month, from plan ai_monthly_requests)
-- ---------------------------------------------------------------------------
create or replace function public.check_ai_request_quota(p_office_id uuid)
returns table (allowed boolean, used integer, cap integer)
language plpgsql security definer set search_path = public as $$
declare
  v_cap integer;
  v_used integer;
  v_subscription_status text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and office_id = p_office_id and is_active) then
    raise exception 'طلب غير مصرح به بالنسبة لهذا المكتب';
  end if;

  select s.status into v_subscription_status
  from public.office_subscriptions s where s.office_id = p_office_id;

  if v_subscription_status is null then
    select min(p.ai_monthly_requests) into v_cap
    from public.saas_plans p where p.is_active and p.code = 'trial';
    cap := coalesce(v_cap, 50);
    used := 0;
    allowed := true;
    return next;
    return;
  end if;

  select p.ai_monthly_requests into v_cap
  from public.office_subscriptions s
  join public.saas_plans p on p.id = s.plan_id
  where s.office_id = p_office_id;

  select
    (select count(*) from public.assistant_runs ar where ar.office_id = p_office_id and ar.created_at >= date_trunc('month', now()))
    + (select count(*) from public.agent_runs gr where gr.office_id = p_office_id and gr.created_at >= date_trunc('month', now()))
  into v_used;

  cap := v_cap;
  used := v_used;
  allowed := (v_cap is null) or (v_used < v_cap);
  return next;
end;
$$;

create or replace function public.platform_ai_usage_summary()
returns table (office_id uuid, office_name text, plan_name text, ai_used integer, ai_cap integer)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'platform admin required'; end if;
  return query
  select o.id,
         o.name,
         coalesce(p.name_ar, 'دون خطة'),
         coalesce(u.used_count, 0) + coalesce(g.run_count, 0),
         p.ai_monthly_requests
  from public.offices o
  left join public.office_subscriptions s on s.office_id = o.id
  left join public.saas_plans p on p.id = s.plan_id
  left join (
    select ar.office_id, count(*) as used_count
    from public.assistant_runs ar
    where ar.created_at >= now() - interval '30 days'
    group by ar.office_id
  ) u on u.office_id = o.id
  left join (
    select gr.office_id, count(*) as run_count
    from public.agent_runs gr
    where gr.created_at >= now() - interval '30 days'
    group by gr.office_id
  ) g on g.office_id = o.id
  order by (coalesce(u.used_count, 0) + coalesce(g.run_count, 0)) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.contract_templates enable row level security;
alter table public.contract_clauses enable row level security;
alter table public.contract_documents enable row level security;
alter table public.contract_document_versions enable row level security;
alter table public.contract_approval_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_approval_events enable row level security;

create policy contract_templates_read on public.contract_templates for select to authenticated using (office_id is null or office_id = (select public.current_office_id()));
create policy contract_templates_manager_write on public.contract_templates for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_manager()));

create policy contract_clauses_read on public.contract_clauses for select to authenticated using (exists (select 1 from public.contract_templates t where t.id = template_id and (t.office_id is null or t.office_id = (select public.current_office_id()))));
create policy contract_clauses_manager_write on public.contract_clauses for all to authenticated using (exists (select 1 from public.contract_templates t where t.id = template_id and t.office_id = (select public.current_office_id())) and (select public.is_manager())) with check (exists (select 1 from public.contract_templates t where t.id = template_id and t.office_id = (select public.current_office_id())) and (select public.is_manager()));

create policy contract_documents_read on public.contract_documents for select to authenticated using (office_id = (select public.current_office_id()));
create policy contract_documents_write on public.contract_documents for all to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy contract_versions_read on public.contract_document_versions for select to authenticated using (exists (select 1 from public.contract_documents d where d.id = document_id and d.office_id = (select public.current_office_id())));
create policy contract_versions_write on public.contract_document_versions for all to authenticated using (exists (select 1 from public.contract_documents d where d.id = document_id and d.office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()))) with check (exists (select 1 from public.contract_documents d where d.id = document_id and d.office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())));

create policy contract_approval_events_read on public.contract_approval_events for select to authenticated using (exists (select 1 from public.contract_documents d where d.id = document_id and d.office_id = (select public.current_office_id())));
create policy contract_approval_events_write on public.contract_approval_events for insert to authenticated with check (exists (select 1 from public.contract_documents d where d.id = document_id and d.office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) and actor_id = auth.uid());

create policy agent_runs_read on public.agent_runs for select to authenticated using (office_id = (select public.current_office_id()));
create policy agent_runs_insert on public.agent_runs for insert to authenticated with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()) and requested_by = auth.uid());
create policy agent_runs_update on public.agent_runs for update to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) with check (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));
create policy agent_runs_delete on public.agent_runs for delete to authenticated using (office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager()));

create policy agent_approval_events_read on public.agent_approval_events for select to authenticated using (exists (select 1 from public.agent_runs r where r.id = run_id and r.office_id = (select public.current_office_id())));
create policy agent_approval_events_write on public.agent_approval_events for insert to authenticated with check (exists (select 1 from public.agent_runs r where r.id = run_id and r.office_id = (select public.current_office_id()) and (select public.is_lawyer_or_manager())) and actor_id = auth.uid());

grant select, insert, update, delete on public.contract_templates, public.contract_clauses, public.contract_documents, public.contract_document_versions, public.contract_approval_events, public.agent_runs, public.agent_approval_events to authenticated, service_role;
grant execute on function public.check_ai_request_quota(uuid) to authenticated, service_role;
grant execute on function public.platform_ai_usage_summary() to authenticated, service_role;

commit;
