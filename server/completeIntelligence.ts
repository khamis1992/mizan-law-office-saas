import { z } from 'zod';
import { callChatCompletion } from './aiClient';
import { assertAiQuota } from './aiQuota';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { linkCaseToCourt, linkDocumentToCase, linkDraftToSource, linkPartyToAffiliate } from './knowledgeGraph';

/**
 * استكمال طبقة الذكاء العميق:
 * الرسم البياني للمعرفة، آلة الحالة الإجرائية، التوأم الرقمي، المحاكاة الخصمية المتعددة،
 * الاستدلال الزمني، رادار الفرص التعاقدية، مسار ما بعد الحكم، ذكاء الربحية،
 * حلقة التقييم، عقيدة المكتب، عروض الأتعاب، بوابة الشفافية المالية.
 */

type DeepDeps = { fetchImpl?: typeof fetch };

const jsonSchema = (name: string, schema: Record<string, unknown>) => ({ name, strict: true, schema: { type: 'object', additionalProperties: false, ...schema } });

async function loadContext(accessToken: string, caseId: string, fetchImpl: typeof fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const [caseRows, hearings, docs, drafts, timeEntries, invoices, intake] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,office_id,case_number,title,type,status,court_name,description,opponent_name,limitation_date,opening_date,client_id&id=eq.${caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=hearing_at,court_name,status,outcome&case_id=eq.${caseId}&order=hearing_at.desc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/documents?select=file_name,category,created_at,ocr_text&case_id=eq.${caseId}&order=created_at.desc&limit=15`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status&case_id=eq.${caseId}&order=updated_at.desc&limit=5`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_time_entries?select=minutes,hourly_rate,billable,description&case_id=eq.${caseId}&limit=200`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_invoices?select=total,paid_amount,status&case_id=eq.${caseId}&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?select=result&case_id=eq.${caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
  ]);
  const legalCase = (caseRows as Array<{ id: string; office_id: string; case_number: string; title: string; type: string; status: string; court_name: string | null; description: string | null; opponent_name: string | null; limitation_date: string | null; opening_date: string | null; client_id: string | null }>)[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  return {
    legalCase,
    hearings: hearings as Array<{ hearing_at: string; court_name: string | null; status: string; outcome: string | null }>,
    docs: docs as Array<{ file_name: string; category: string; created_at: string; ocr_text: string | null }>,
    drafts: drafts as Array<{ title: string; content: string; status: string }>,
    timeEntries: timeEntries as Array<{ minutes: number; hourly_rate: number; billable: boolean; description: string | null }>,
    invoices: invoices as Array<{ total: number; paid_amount: number; status: string }>,
    intake: intake as Array<{ result: { claimsSummary?: string; defenses?: Array<{ heading: string }>; gaps?: Array<{ gap: string }> } }>,
  };
}

async function assertOffice(profile: Profile, officeId: string | null) {
  if (officeId && officeId !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');
}

// ---------------------------------------------------------------------------
// 1) الرسم البياني للمعرفة: كتابة حواف واستعلامات
// ---------------------------------------------------------------------------

export const writeKnowledgeEdgeInput = z.object({
  accessToken: z.string().min(20),
  sourceType: z.string().max(40),
  sourceId: z.string().uuid(),
  targetType: z.string().max(40),
  targetId: z.string().uuid(),
  relation: z.string().max(80),
  strength: z.number().min(0).max(1).default(1),
});

export async function writeKnowledgeEdge(input: z.infer<typeof writeKnowledgeEdgeInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const response = await fetchImpl(`${baseUrl}/rest/v1/knowledge_graph_edges`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, source_type: input.sourceType, source_id: input.sourceId,
      target_type: input.targetType, target_id: input.targetId, relation: input.relation, strength: input.strength,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (!detail.includes('duplicate')) throw new Error(`تعذر تسجيل الحافة: ${detail.slice(0, 150)}`);
  }
  return { recorded: true };
}

/** استعلام الرسم البياني: كل ما يتصل بكيان معين (خصوم، مواد، دفوع، دوائر). */
export const queryKnowledgeGraphInput = z.object({ accessToken: z.string().min(20), entityType: z.string().max(40), entityId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20) });

export async function queryKnowledgeGraph(input: z.infer<typeof queryKnowledgeGraphInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const outgoing = await fetchImpl(`${baseUrl}/rest/v1/knowledge_graph_edges?select=source_type,target_type,target_id,relation,strength,created_at&source_type=eq.${input.entityType}&source_id=eq.${input.entityId}&order=strength.desc&limit=${input.limit}`, { headers })
    .then(r => r.ok ? r.json() : []);
  const incoming = await fetchImpl(`${baseUrl}/rest/v1/knowledge_graph_edges?select=source_type,source_id,relation,strength,created_at&target_type=eq.${input.entityType}&target_id=eq.${input.entityId}&order=strength.desc&limit=${input.limit}`, { headers })
    .then(r => r.ok ? r.json() : []);
  return { outgoing: outgoing as unknown[], incoming: incoming as unknown[] };
}

/** فحص تعارض المصالح الموسع عبر الرسم البياني (شركاء/شركات تابعة). */
export const graphConflictCheckInput = z.object({ accessToken: z.string().min(20), partyName: z.string().min(2).max(300) });

export async function graphConflictCheck(input: z.infer<typeof graphConflictCheckInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const normalize = (value: string) => value.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/[\u0623\u0625\u0627\u0671]/g, 'ا').replace(/\u0649/g, 'ي').replace(/\u0629/g, 'ه').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar');

  const clientsResponse = await fetchImpl(`${baseUrl}/rest/v1/clients?select=id,full_name,commercial_registration&office_id=eq.${profile.office_id}&limit=300`, { headers });
  const clients = await readResponse<Array<{ id: string; full_name: string; commercial_registration: string | null }>>(clientsResponse).catch(() => []);
  const target = normalize(input.partyName);
  const matches: Array<{ type: string; name: string; relation: string }> = [];
  for (const client of clients) {
    if (normalize(client.full_name) === target) matches.push({ type: 'client', name: client.full_name, relation: 'نفس الاسم' });
  }
  // حواف الرسم البياني: من شركة إلى شركات تابعة/ممثلين
  const edges = await fetchImpl(`${baseUrl}/rest/v1/knowledge_graph_edges?select=source_type,source_id,target_type,target_id,relation&office_id=eq.${profile.office_id}&relation=in.(affiliate,representative,partner)&limit=300`, { headers })
    .then(r => r.ok ? r.json() : []);
  const clientIds = new Set(clients.map(c => c.id));
  for (const edge of edges as Array<{ source_type: string; source_id: string; target_type: string; target_id: string; relation: string }>) {
    const related = edge.target_type === 'client' && clientIds.has(edge.target_id)
      ? clients.find(c => c.id === edge.target_id)
      : edge.source_type === 'client' && clientIds.has(edge.source_id)
        ? clients.find(c => c.id === edge.source_id)
        : null;
    if (related && normalize(related.full_name) === target) matches.push({ type: 'related', name: related.full_name, relation: edge.relation });
  }
  return { verdict: matches.length ? 'conflict' : 'clear', matches };
}

// ---------------------------------------------------------------------------
// 2) آلة الحالة الإجرائية
// ---------------------------------------------------------------------------

export const CASE_STATES = ['new_filing', 'pending_review', 'expert_appointment', 'hearings', 'judgment_reserved', 'judgment_issued', 'appeal', 'execution', 'closed'] as const;

export const STATE_TASKS: Record<string, Array<{ task: string; dueInDays: number }>> = {
  new_filing: [{ task: 'مراجعة صحيفة الدعوى ومرفقاتها', dueInDays: 3 }, { task: 'تحضير دفاع أولي', dueInDays: 7 }],
  pending_review: [{ task: 'إكمال المستندات الناقصة', dueInDays: 5 }],
  expert_appointment: [{ task: 'متابعة قرار ندب الخبير', dueInDays: 7 }, { task: 'تحضير أسئلة للخبير', dueInDays: 3 }],
  hearings: [{ task: 'تحضير حزمة الجلسة القادمة', dueInDays: 1 }],
  judgment_reserved: [{ task: 'تحضير ملاحظات بعد حجز الحكم', dueInDays: 3 }],
  judgment_issued: [{ task: 'مراجعة الحكم وتحديد مسار الطعن', dueInDays: 5 }],
  appeal: [{ task: 'إعداد مذكرة الاستئناف', dueInDays: 10 }],
  execution: [{ task: 'إجراءات التنفيذ أو الحجز', dueInDays: 7 }],
  closed: [],
};

export const getProceduralStateInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function getProceduralState(input: z.infer<typeof getProceduralStateInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const existing = await fetchImpl(`${baseUrl}/rest/v1/case_procedural_states?select=id,current_state,transitions,auto_tasks&case_id=eq.${input.caseId}&limit=1`, { headers })
    .then(r => r.ok ? r.json() : []);
  const row = (existing as Array<{ id: string; current_state: string; transitions: unknown; auto_tasks: unknown }>)[0];
  if (!row) {
    // تهيئة أولية
    const createResponse = await fetchImpl(`${baseUrl}/rest/v1/case_procedural_states`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, current_state: 'new_filing', transitions: [], auto_tasks: STATE_TASKS.new_filing }),
    });
    const created = await readResponse<Array<{ id: string; current_state: string }>>(createResponse);
    const initial = created[0];
    return { stateId: initial.id, currentState: 'new_filing', transitions: [], autoTasks: STATE_TASKS.new_filing, allowedTransitions: ['pending_review', 'closed'] };
  }
  const allowedTransitions = ALLOWED_STATE_TRANSITIONS[row.current_state as string] ?? [];
  return { stateId: row.id, currentState: row.current_state, transitions: row.transitions, autoTasks: row.auto_tasks, allowedTransitions };
}

export const ALLOWED_STATE_TRANSITIONS: Record<string, string[]> = {
  new_filing: ['pending_review', 'hearings', 'closed'],
  pending_review: ['expert_appointment', 'hearings', 'judgment_reserved'],
  expert_appointment: ['hearings', 'judgment_reserved'],
  hearings: ['expert_appointment', 'judgment_reserved', 'closed'],
  judgment_reserved: ['judgment_issued', 'closed'],
  judgment_issued: ['appeal', 'execution', 'closed'],
  appeal: ['hearings', 'execution', 'closed'],
  execution: ['closed'],
  closed: [],
};

export const transitionProceduralStateInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid(), to: z.enum(CASE_STATES) });

export async function transitionProceduralState(input: z.infer<typeof transitionProceduralStateInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تحديث الحالة الإجرائية متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const state = await getProceduralState({ accessToken: input.accessToken, caseId: input.caseId }, deps);
  if (!state.allowedTransitions.includes(input.to)) throw new Error(`انتقال غير مسموح من «${state.currentState}» إلى «${input.to}».`);

  const transitions = [...(state.transitions as Array<Record<string, unknown>>), { from: state.currentState, to: input.to, at: new Date().toISOString(), by: profile.id }];
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_procedural_states?id=eq.${state.stateId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ current_state: input.to, transitions, auto_tasks: STATE_TASKS[input.to] ?? [], updated_by: profile.id, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('تعذر تحديث الحالة الإجرائية.');

  // إنشاء مهام تلقائية عند الدخول للحالة
  for (const autoTask of STATE_TASKS[input.to] ?? []) {
    const due = new Date(Date.now() + autoTask.dueInDays * 86400000).toISOString();
    await fetchImpl(`${baseUrl}/rest/v1/tasks`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, title: autoTask.task, priority: 'medium', status: 'not_started', due_at: due, created_by: profile.id }),
    });
  }

  return { currentState: input.to, createdTasks: (STATE_TASKS[input.to] ?? []).length };
}

// ---------------------------------------------------------------------------
// 3) التوأم الرقمي للقضية
// ---------------------------------------------------------------------------

export const caseTwinInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function caseTwin(input: z.infer<typeof caseTwinInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'التوأم الرقمي متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadContext(input.accessToken, input.caseId, fetchImpl);
  const totalMinutes = context.timeEntries.reduce((sum, e) => sum + e.minutes, 0);
  const billedValue = context.timeEntries.filter(e => e.billable).reduce((sum, e) => sum + e.minutes * (e.hourly_rate / 60), 0);
  const invoiced = context.invoices.reduce((sum, i) => sum + i.total, 0);
  const state = await getProceduralState({ accessToken: input.accessToken, caseId: input.caseId }, deps);

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('case_twin_output', {
      properties: {
        healthScore: { type: 'number', minimum: 0, maximum: 100 },
        risks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { risk: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, mitigation: { type: 'string' } }, required: ['risk', 'severity', 'mitigation'] } },
        scenarios: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { scenario: { type: 'string' }, probability: { type: 'number', minimum: 0, maximum: 1 }, nextStep: { type: 'string' } }, required: ['scenario', 'probability', 'nextStep'] } },
        recommendedNextAction: { type: 'string' },
      },
      required: ['healthScore', 'risks', 'scenarios', 'recommendedNextAction'],
    }) },
    messages: [
      { role: 'system', content: `أنت «التوأم الرقمي» للقضية — نموذج حيّ يقيمها باستمرار. أعد:
1) healthScore: مؤشر صحة القضية 0-100 (قوة الأدلة، التقدم، التكاليف، مخاطر السقوط).
2) risks: أهم 3-5 مخاطر مع خطورتها وتخفيفها.
3) scenarios: سيناريوهات محتملة (صلح/ندب خبير/حكم/طعن) مع احتماليتها وخطوتها التالية.
4) recommendedNextAction: الإجراء التالي الموصى به.
لا تخترع وقائع.` },
      { role: 'user', content: `القضية: ${context.legalCase.case_number} — ${context.legalCase.title} (${context.legalCase.type}) [${context.legalCase.status}]\nالمحكمة: ${context.legalCase.court_name ?? 'غير محددة'} · الخصم: ${context.legalCase.opponent_name ?? 'غير محدد'}${context.legalCase.limitation_date ? ` · التقادم: ${context.legalCase.limitation_date}` : ''}\nالحالة الإجرائية: ${state.currentState}\nالوصف: ${(context.legalCase.description ?? '').slice(0, 1500)}\nالجلسات: ${JSON.stringify(context.hearings).slice(0, 800)}\nساعات العمل: ${Math.floor(totalMinutes / 60)} ساعة · قيمة الساعات القابلة للفوترة: ${Math.round(billedValue)} · المفوتر: ${Math.round(invoiced)}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر بناء التوأم الرقمي.');

  const parsed = JSON.parse(content) as { healthScore: number; risks: Array<{ risk: string; severity: string; mitigation: string }>; scenarios: Array<{ scenario: string; probability: number; nextStep: string }>; recommendedNextAction: string };
  return { ...parsed, state: state.currentState, hours: Math.floor(totalMinutes / 60), billedValue, invoiced };
}

// ---------------------------------------------------------------------------
// 4) المحاكاة الخصمية المتعددة الوكلاء (Deliberative Moot)
// ---------------------------------------------------------------------------

export const deliberativeMootInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid(), memoDraft: z.string().min(100).max(40000) });

export async function deliberativeMoot(input: z.infer<typeof deliberativeMootInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'المحاكاة الخصمية متاحة لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadContext(input.accessToken, input.caseId, fetchImpl);
  const content = await callChatCompletion({
    temperature: 0.5,
    response_format: { type: 'json_schema', json_schema: jsonSchema('moot_output', {
      properties: {
        defensePosition: { type: 'string' },
        opponentPosition: { type: 'string' },
        courtAssessment: { type: 'string' },
        courtProbability: { type: 'number', minimum: 0, maximum: 1 },
        pointsToClose: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { point: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, action: { type: 'string' } }, required: ['point', 'severity', 'action'] } },
        disagreementSummary: { type: 'string' },
      },
      required: ['defensePosition', 'opponentPosition', 'courtAssessment', 'courtProbability', 'pointsToClose', 'disagreementSummary'],
    }) },
    messages: [
      { role: 'system', content: `أنت رئيس محكمة تحكيم مصغرة (محيط): أمامك مذكرة الدفاع. شغّل ثلاثة أدوار:
1) defensePosition: موقف وكيل الدفاع — أقوى حجج المذكرة.
2) opponentPosition: موقف وكيل الخصم — أشرس الاعتراضات المتوقعة.
3) courtAssessment: تقييم محكمة متحفظة — نقاط القوة والضعف وcourtProbability (احتمالية نجاح الدفاع 0-1).
4) pointsToClose: نقاط يجب إغلاقها قبل الإيداع (بخطورتها وإجراء كل منها).
5) disagreementSummary: خلاصة الخلاف الداخلي بين الأدوار الثلاثة.
لا تخترع مواد قانونية — عوّل على المنطق والوقائع في المذكرة وسياق القضية.` },
      { role: 'user', content: `القضية: ${context.legalCase.case_number} — ${context.legalCase.title} ضد ${context.legalCase.opponent_name ?? 'الخصم'}\nالمذكرة المراد محاكاتها:\n\n${input.memoDraft.slice(0, 30000)}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تشغيل المحاكاة.');

  return JSON.parse(content) as { defensePosition: string; opponentPosition: string; courtAssessment: string; courtProbability: number; pointsToClose: Array<{ point: string; severity: string; action: string }>; disagreementSummary: string };
}

// ---------------------------------------------------------------------------
// 5) الاستدلال الزمني على القانون الساري
// ---------------------------------------------------------------------------

export const temporalSourcesInput = z.object({ accessToken: z.string().min(20), question: z.string().min(10).max(4000), referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function temporalSources(input: z.infer<typeof temporalSourcesInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'الاستدلال الزمني متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const { extractSearchTerms, hybridSearchSections, rankSections } = await import('./retrieval');
  const terms = extractSearchTerms(input.question);
  const sections = await hybridSearchSections(input.accessToken, terms.join(' '), null, fetchImpl, 20);

  // جلب النسخ التاريخية إن وجدت
  const versions = await fetchImpl(`${baseUrl}/rest/v1/legal_source_versions?select=source_id,version_label,effective_from,effective_to,is_current&limit=200`, { headers })
    .then(r => r.ok ? r.json() : []);
  const versionMap = new Map<string, Array<{ version_label: string; effective_from: string | null; effective_to: string | null; is_current: boolean }>>();
  for (const v of versions as Array<{ source_id: string; version_label: string; effective_from: string | null; effective_to: string | null; is_current: boolean }>) {
    const list = versionMap.get(v.source_id) ?? [];
    list.push(v);
    versionMap.set(v.source_id, list);
  }

  return sections.map(section => {
    const applicable = (versionMap.get(section.id) ?? []).filter(v => {
      if (v.effective_from && v.effective_from > input.referenceDate) return false;
      if (v.effective_to && v.effective_to < input.referenceDate) return false;
      return true;
    });
    const currentVersion = (versionMap.get(section.id) ?? []).find(v => v.is_current);
    return {
      id: section.id,
      title: section.title,
      articleNumber: section.articleNumber,
      body: section.body,
      url: section.url,
      effectiveAt: input.referenceDate,
      versionStatus: applicable.length ? `ساري: ${applicable.map(v => v.version_label).join('، ')}` : 'لا توجد نسخة محددّة لهذا التاريخ — قد لا يكون النص سارياً آنذاك',
      isCurrent: Boolean(currentVersion && currentVersion.effective_from && currentVersion.effective_from <= input.referenceDate && (!currentVersion.effective_to || currentVersion.effective_to >= input.referenceDate)),
    };
  });
}

// ---------------------------------------------------------------------------
// 6) رادار الفرص التعاقدية (استباق النزاعات)
// ---------------------------------------------------------------------------

export const contractOpportunityRadarInput = z.object({ accessToken: z.string().min(20), daysAhead: z.number().int().min(7).max(365).default(90) });

export async function contractOpportunityRadar(input: z.infer<typeof contractOpportunityRadarInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  // مسح عقود المكتب المرتبطة بقضايا أو عملاء
  const contracts = await fetchImpl(`${baseUrl}/rest/v1/contract_documents?select=id,title,case_id,client_id,created_at&office_id=eq.${profile.office_id}&limit=100`, { headers })
    .then(r => r.ok ? r.json() : []);
  const drafts = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=id,title,case_id,status&office_id=eq.${profile.office_id}&document_type=eq.contract&limit=100`, { headers })
    .then(r => r.ok ? r.json() : []);

  const alerts: Array<{ contractTitle: string; alertType: string; detail: string; dueDate: string | null }> = [];
  const cutoff = new Date(Date.now() + input.daysAhead * 86400000);
  for (const contract of [...(contracts as Array<{ id: string; title: string; created_at: string }>), ...(drafts as Array<{ id: string; title: string; created_at: string }>)]) {
    // تنبيه انتهاء افتراضي: عقود أُنشئت قبل 11 شهراً
    const created = new Date(contract.created_at);
    const monthsSince = (Date.now() - created.getTime()) / (30 * 86400000);
    if (monthsSince >= 11) {
      alerts.push({ contractTitle: contract.title, alertType: 'expiry', detail: 'عقد بلغ شهره الحادي عشر — مراجعة مدة النفاذ وتجديده أو إنهاؤه.', dueDate: new Date(created.getTime() + 365 * 86400000).toISOString().slice(0, 10) });
    }
  }
  const uniqueAlerts = alerts.filter(a => a.dueDate && new Date(a.dueDate) <= cutoff).slice(0, 20);

  // حذف التنبيهات القديمة غير المفعّلة وإدراج الجديدة
  await fetchImpl(`${baseUrl}/rest/v1/contract_opportunity_alerts?status=eq.open&office_id=eq.${profile.office_id}`, { method: 'DELETE', headers, body: '{}' });
  if (uniqueAlerts.length) {
    await fetchImpl(`${baseUrl}/rest/v1/contract_opportunity_alerts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(uniqueAlerts.map(a => ({ office_id: profile.office_id, contract_title: a.contractTitle, alert_type: a.alertType, detail: a.detail, due_date: a.dueDate, status: 'open' }))),
    });
  }
  return { alerts: uniqueAlerts };
}

// ---------------------------------------------------------------------------
// 7) مسار ما بعد الحكم
// ---------------------------------------------------------------------------

export const postJudgmentInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid(), judgmentText: z.string().min(30).max(20000) });

export async function postJudgment(input: z.infer<typeof postJudgmentInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'مسار ما بعد الحكم متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadContext(input.accessToken, input.caseId, fetchImpl);
  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('post_judgment_output', {
      properties: {
        actions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { actionType: { type: 'string', enum: ['execution', 'seizure', 'appeal', 'settlement', 'collection', 'other'] }, title: { type: 'string' }, dueInDays: { type: 'number' }, note: { type: 'string' } }, required: ['actionType', 'title', 'dueInDays'] } },
      },
      required: ['actions'],
    }) },
    messages: [
      { role: 'system', content: `أنت محامٍ تنفيذي قطري خبير. من نص الحكم، حدد مسار ما بعد الحكم: تنفيذ، حجز، طعن، تسوية، تحصيل. أعد 2-5 إجراءات أولوية لكل منها مدة تنفيذ مقترحة (أيام).` },
      { role: 'user', content: `القضية: ${context.legalCase.case_number} — ${context.legalCase.title} ضد ${context.legalCase.opponent_name ?? 'الخصم'}\nنص الحكم:\n${input.judgmentText.slice(0, 15000)}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تحليل مسار ما بعد الحكم.');

  const parsed = JSON.parse(content) as { actions: Array<{ actionType: string; title: string; dueInDays: number; note?: string }> };
  const actions = (parsed.actions ?? []).slice(0, 5);
  await fetchImpl(`${baseUrl}/rest/v1/post_judgment_actions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(actions.map(a => ({
      office_id: profile.office_id, case_id: input.caseId, action_type: a.actionType, title: a.title,
      due_date: new Date(Date.now() + (a.dueInDays ?? 7) * 86400000).toISOString().slice(0, 10),
      status: 'pending', note: a.note ?? null, created_by: profile.id,
    }))),
  });
  return { actions };
}

export const listPostJudgmentInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listPostJudgment(input: z.infer<typeof listPostJudgmentInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/post_judgment_actions?select=id,action_type,title,due_date,status,note&case_id=eq.${input.caseId}&order=created_at.desc&limit=30`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; action_type: string; title: string; due_date: string | null; status: string; note: string | null }>>(response);
}

// ---------------------------------------------------------------------------
// 8) ذكاء الربحية (Matter Economics)
// ---------------------------------------------------------------------------

export const matterEconomicsInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function matterEconomics(input: z.infer<typeof matterEconomicsInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadContext(input.accessToken, input.caseId, fetchImpl);
  const actualHours = context.timeEntries.reduce((sum, e) => sum + e.minutes / 60, 0);
  const billedValue = context.timeEntries.filter(e => e.billable).reduce((sum, e) => sum + e.minutes * (e.hourly_rate / 60), 0);
  const invoiced = context.invoices.filter(i => i.status !== 'cancelled').reduce((sum, i) => sum + i.total, 0);
  const paid = context.invoices.filter(i => i.status !== 'cancelled').reduce((sum, i) => sum + i.paid_amount, 0);
  const margin = invoiced - billedValue;
  const health = margin > 0 ? 'healthy' : actualHours > 0 && margin < 0 ? 'loss' : 'unknown';

  await fetchImpl(`${baseUrl}/rest/v1/matter_economics`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId,
      billed_hours: actualHours, billed_amount: invoiced, actual_hours: actualHours, actual_cost: billedValue,
      margin, health, computed_at: new Date().toISOString(),
    }),
  });

  return { actualHours, billedValue, invoiced, paid, margin, health, utilizationRate: actualHours ? Math.round((invoiced / Math.max(billedValue, 1)) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// 9) حلقة التقييم الأسبوعية (Eval Loop)
// ---------------------------------------------------------------------------

export const runEvaluationInput = z.object({ accessToken: z.string().min(20) });

export async function runEvaluation(input: z.infer<typeof runEvaluationInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'حلقة التقييم متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  // إحصاءات مخرجات المكتب: اقتباسات غير موثقة، فجوات أُعلنت، تحليلات مكتملة
  const [assistantRuns, intakeAnalyses, researchRuns] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/assistant_runs?select=cited_sources,created_at&office_id=eq.${profile.office_id}&created_at=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&limit=200`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?select=status,result&office_id=eq.${profile.office_id}&created_at=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_researches?select=id&office_id=eq.${profile.office_id}&created_at=gte.${new Date(Date.now() - 7 * 86400000).toISOString()}&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const runs = assistantRuns as Array<{ cited_sources: Array<{ id: string }> }>;
  const citationsCount = runs.reduce((sum, r) => sum + (r.cited_sources?.length ?? 0), 0);
  const intakeRows = intakeAnalyses as Array<{ status: string; result: { verification?: { passed?: boolean; unverifiedQuotes?: string[] } } | null }>;
  const completedIntake = intakeRows.filter(r => r.status === 'done').length;
  const failedVerification = intakeRows.filter(r => r.result?.verification && r.result.verification.passed === false).length;
  const researchCount = (researchRuns as unknown[]).length;

  const totalChecks = Math.max(citationsCount + completedIntake + researchCount, 1);
  const failed = failedVerification;
  const passed = totalChecks - failed;

  const report = {
    week: new Date().toISOString().slice(0, 10),
    runsCount: runs.length,
    citationsCount,
    completedIntake,
    failedVerification,
    researchCount,
    health: failed / totalChecks < 0.1 ? 'excellent' : failed / totalChecks < 0.3 ? 'acceptable' : 'needs_attention',
  };

  await fetchImpl(`${baseUrl}/rest/v1/eval_runs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, run_type: 'manual', total_checks: totalChecks, passed, failed, report }),
  });

  return report;
}

// ---------------------------------------------------------------------------
// 10) عقيدة المكتب المستخلصة
// ---------------------------------------------------------------------------

export const distillDoctrineInput = z.object({ accessToken: z.string().min(20) });

export async function distillDoctrine(input: z.infer<typeof distillDoctrineInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'استخلاص عقيدة المكتب متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const drafts = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status&office_id=eq.${profile.office_id}&status=eq.approved&limit=30`, { headers })
    .then(r => r.ok ? r.json() : []);
  if (!(drafts as unknown[]).length) return { doctrines: [], note: 'لا مسودات معتمدة بعد — تنمو العقيدة مع الاعتمادات.' };

  const corpus = (drafts as Array<{ title: string; content: string }>).map(d => `${d.title}\n${d.content.slice(0, 6000)}`).join('\n\n---\n\n').slice(0, 30000);
  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: jsonSchema('doctrine_output', {
      properties: {
        doctrines: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { topic: { type: 'string' }, principle: { type: 'string' } }, required: ['topic', 'principle'] } },
      },
      required: ['doctrines'],
    }) },
    messages: [
      { role: 'system', content: `أنت محلل صياغة قانوني. من المذكرات المعتمدة للمكتب، استخرج 3-8 مبادئ متكررة (عقيدة المكتب) في موضوعات متكررة مثل القوة القاهرة، الشرط الجزائي، المسؤولية العقدية. لكل موضوع: مبدأ عام يمثل أسلوب المكتب.` },
      { role: 'user', content: `مذكرات المكتب المعتمدة:\n\n${corpus}` },
    ],
  }, fetchImpl);
  if (!content) return { doctrines: [], note: 'تعذر الاستخلاص.' };

  const parsed = JSON.parse(content) as { doctrines: Array<{ topic: string; principle: string }> };
  await fetchImpl(`${baseUrl}/rest/v1/office_doctrines?office_id=eq.${profile.office_id}`, { method: 'DELETE', headers, body: '{}' });
  if (parsed.doctrines.length) {
    await fetchImpl(`${baseUrl}/rest/v1/office_doctrines`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(parsed.doctrines.map(d => ({ office_id: profile.office_id, topic: d.topic, principle: d.principle, source_drafts: (drafts as Array<{ title: string }>).map(dd => dd.title) }))),
    });
  }
  return { doctrines: parsed.doctrines, note: 'عقيدة مستخلصة من المذكرات المعتمدة — مرجع داخلي فقط.' };
}

export const listDoctrinesInput = z.object({ accessToken: z.string().min(20) });

export async function listDoctrines(input: z.infer<typeof listDoctrinesInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/office_doctrines?select=topic,principle,usage_count&order=usage_count.desc&limit=20`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ topic: string; principle: string; usage_count: number }>>(response);
}

// ---------------------------------------------------------------------------
// 11) عروض الأتعاب الذكية
// ---------------------------------------------------------------------------

export const feeProposalInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  title: z.string().min(3).max(200),
  feeType: z.enum(['lump_sum', 'hourly', 'contingency', 'hybrid']),
  estimatedHours: z.number().min(0).max(10000).optional(),
  hourlyRate: z.number().min(0).max(100000).optional(),
  contingencyPercent: z.number().min(0).max(100).optional(),
  claimAmount: z.number().min(0).max(1e12).optional(),
  scope: z.string().max(3000).optional(),
});

export async function feeProposal(input: z.infer<typeof feeProposalInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'عروض الأتعاب متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  let amount = 0;
  const breakdown: string[] = [];
  if (input.feeType === 'hourly' && input.estimatedHours && input.hourlyRate) {
    amount = input.estimatedHours * input.hourlyRate;
    breakdown.push(`${input.estimatedHours} ساعة × ${input.hourlyRate} ريال/ساعة`);
  } else if (input.feeType === 'contingency' && input.claimAmount && input.contingencyPercent) {
    amount = input.claimAmount * (input.contingencyPercent / 100);
    breakdown.push(`${input.contingencyPercent}% من ${input.claimAmount} ريال`);
  } else if (input.feeType === 'hybrid') {
    amount = (input.estimatedHours ?? 0) * (input.hourlyRate ?? 0) + (input.claimAmount ?? 0) * ((input.contingencyPercent ?? 0) / 100);
    breakdown.push(`ساعات: ${(input.estimatedHours ?? 0)} × ${input.hourlyRate ?? 0} + نسبة ${input.contingencyPercent ?? 0}%`);
  }

  const response = await fetchImpl(`${baseUrl}/rest/v1/fee_proposals`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId ?? null, client_id: input.clientId ?? null,
      title: input.title, fee_type: input.feeType, amount, scope: input.scope ?? (breakdown.join(' · ') || null),
      status: 'draft', created_by: profile.id,
    }),
  });
  const rows = await readResponse<Array<{ id: string; amount: number }>>(response);
  const proposal = rows[0];
  if (!proposal) throw new Error('تعذر إنشاء عرض الأتعاب.');

  const content = `عرض أتعاب\n==========\n${input.title}\n\nالنوع: ${input.feeType}\nالمبلغ: ${Math.round(proposal.amount)} ريال\n${breakdown.length ? `\nتفاصيل الحساب:\n${breakdown.join('\n')}` : ''}\n${input.scope ? `\nنطاق العمل:\n${input.scope}` : ''}\n\nأُعد بواسطة نظام ميزان للمراجعة قبل الإرسال.`;

  return { id: proposal.id, amount: proposal.amount, content, breakdown };
}

// ---------------------------------------------------------------------------
// 12) بوابة الشفافية المالية للموكل
// ---------------------------------------------------------------------------

export const generateFinancialPortalInput = z.object({ accessToken: z.string().min(20), clientId: z.string().uuid() });

export async function generateFinancialPortal(input: z.infer<typeof generateFinancialPortalInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'بوابة الشفافية المالية متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const existing = await fetchImpl(`${baseUrl}/rest/v1/client_financial_views?select=token,enabled,expires_at&client_id=eq.${input.clientId}&office_id=eq.${profile.office_id}&limit=1`, { headers })
    .then(r => r.ok ? r.json() : []);
  const current = (existing as Array<{ token: string; enabled: boolean; expires_at: string | null }>)[0];
  if (current) return { token: current.token, link: `${process.env.VITE_APP_URL ?? ''}/#/client-financial/${current.token}`, alreadyExists: true };

  const response = await fetchImpl(`${baseUrl}/rest/v1/client_financial_views`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ office_id: profile.office_id, client_id: input.clientId, enabled: true, expires_at: null }),
  });
  const rows = await readResponse<Array<{ token: string }>>(response);
  const view = rows[0];
  if (!view) throw new Error('تعذر إنشاء البوابة.');
  return { token: view.token, link: `${process.env.VITE_APP_URL ?? ''}/#/client-financial/${view.token}`, alreadyExists: false };
}

// ---------------------------------------------------------------------------
// 13) تسجيل الأحداث وتغذية الرسم البياني تلقائياً
// ---------------------------------------------------------------------------

export const recordEventInput = z.object({
  accessToken: z.string().min(20),
  eventType: z.enum(['document_uploaded', 'draft_approved', 'hearing_outcome', 'conflict_found', 'case_created']),
  caseId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  draftId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  courtName: z.string().max(200).optional(),
  partyName: z.string().max(300).optional(),
  affiliateName: z.string().max(300).optional(),
});

/**
 * نقطة تسجيل الأحداث: كل حدث يكتب حواف الرسم البياني تلقائياً.
 * - رفع مستند → document→case
 * - اعتماد مذكرة → draft→source
 * - نتيجة جلسة → case→court
 * - تعارض مصالح → party→affiliate
 */
export async function recordEvent(input: z.infer<typeof recordEventInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  if (!profile.office_id) throw new Error('يرجى إنشاء مكتب قبل تسجيل الأحداث.');

  const edgesWritten: string[] = [];

  if (input.eventType === 'document_uploaded' && input.documentId && input.caseId) {
    await linkDocumentToCase(input.accessToken, profile.office_id, input.documentId, input.caseId, fetchImpl);
    edgesWritten.push('document→case');
  }

  if (input.eventType === 'draft_approved' && input.draftId && input.sourceId) {
    await linkDraftToSource(input.accessToken, profile.office_id, input.draftId, input.sourceId, fetchImpl);
    edgesWritten.push('draft→source');
  }

  if (input.eventType === 'hearing_outcome' && input.caseId && input.courtName) {
    await linkCaseToCourt(input.accessToken, profile.office_id, input.caseId, input.courtName, fetchImpl);
    edgesWritten.push('case→court');
  }

  if (input.eventType === 'conflict_found' && input.partyName && input.affiliateName) {
    const partyId = `party:${input.partyName}`;
    const affiliateId = `party:${input.affiliateName}`;
    await linkPartyToAffiliate(input.accessToken, profile.office_id, partyId, affiliateId, 'affiliate', fetchImpl);
    edgesWritten.push('party→affiliate');
  }

  if (input.eventType === 'case_created' && input.caseId && input.courtName) {
    await linkCaseToCourt(input.accessToken, profile.office_id, input.caseId, input.courtName, fetchImpl);
    edgesWritten.push('case→court');
  }

  return { recorded: true, edgesWritten };
}

export type { Profile };
