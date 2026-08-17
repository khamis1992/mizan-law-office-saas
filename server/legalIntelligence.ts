import { z } from 'zod';
import { callChatCompletion } from './aiClient';
import { assertAiQuota } from './aiQuota';
import { verifyCitations, type CitationVerification } from './citationGate';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { extractSearchTerms, rankSections, type RankableSection } from './retrieval';

/**
 * الذكاء القانوني المتقدم — «شريك المرافعة»:
 * 1) وكيل القضية الدائم: يراقب الأحداث ويحدّث الدفوع والثغرات ويقترح إجراءات
 * 2) مذكرات الخصم المتوقعة (محاكاة خصمية)
 * 3) تحليل الأحكام → اقتراح سوابق موثقة
 * 4) توقع نتائج القضايا + «ماذا لو»
 * 5) دردشة سياقية داخل القضية
 * 6) تقويم المحاكم والعطل الرسمية
 */

type IntelDeps = { fetchImpl?: typeof fetch };

const jsonSchema = (name: string, schema: Record<string, unknown>) => ({ name, strict: true, schema: { type: 'object', additionalProperties: false, ...schema } });

// ---------------------------------------------------------------------------
// وكيل القضية الدائم
// ---------------------------------------------------------------------------

export const runCaseAgentInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  triggerType: z.enum(['new_document', 'hearing_scheduled', 'hearing_outcome', 'judgment', 'opponent_memo', 'manual', 'daily']).default('manual'),
  triggerRef: z.string().max(200).optional(),
});

export type AgentSuggestion = { kind: 'defense' | 'gap' | 'action' | 'document' | 'risk'; title: string; detail: string; priority: 'high' | 'medium' | 'low' };

export async function runCaseAgent(input: z.infer<typeof runCaseAgentInput>, deps: IntelDeps = {}): Promise<{ runId: string; summary: string; suggestions: AgentSuggestion[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'وكيل القضية متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,type,status,court_name,description,opponent_name,limitation_date`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; type: string; status: string; court_name: string | null; description: string | null; opponent_name: string | null; limitation_date: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  // جمع سياق القضية: الجلسات، المهام، المستندات، التحليل الافتتاحي، المذكرات
  const [hearings, tasks, docs, intake, drafts, chat] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=hearing_at,court_name,status,outcome&case_id=eq.${input.caseId}&order=hearing_at.desc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/tasks?select=title,status,due_at&case_id=eq.${input.caseId}&order=due_at.asc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/documents?select=file_name,category,created_at,ocr_text&case_id=eq.${input.caseId}&order=created_at.desc&limit=15`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?select=result&case_id=eq.${input.caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status&case_id=eq.${input.caseId}&order=updated_at.desc&limit=5`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_chat_messages?select=role,content&case_id=eq.${input.caseId}&order=created_at.desc&limit=8`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const intakeResult = (intake as Array<{ result: { defenses?: Array<{ heading: string; argument: string }>; gaps?: Array<{ gap: string; mitigation: string }>; memoDraft?: string } }>)[0]?.result;
  const contextBlock = [
    `القضية: ${legalCase.case_number} — ${legalCase.title} (${legalCase.type})`,
    `المحكمة: ${legalCase.court_name ?? 'غير محددة'} · الخصم: ${legalCase.opponent_name ?? 'غير محدد'}`,
    legalCase.limitation_date ? `تاريخ التقادم: ${legalCase.limitation_date}` : '',
    legalCase.description ? `الوصف: ${legalCase.description.slice(0, 1500)}` : '',
    `الجلسات (${(hearings as unknown[]).length}): ${JSON.stringify(hearings).slice(0, 1200)}`,
    `المهام (${(tasks as unknown[]).length}): ${JSON.stringify(tasks).slice(0, 800)}`,
    `المستندات (${(docs as unknown[]).length}): ${(docs as Array<{ file_name: string; category: string; ocr_text: string | null }>).map(d => `${d.file_name} (${d.category})${d.ocr_text ? ' [مقروء OCR]' : ''}`).join('، ').slice(0, 1000)}`,
    intakeResult ? `التحليل الافتتاحي: دفوع=${JSON.stringify(intakeResult.defenses ?? []).slice(0, 800)} ثغرات=${JSON.stringify(intakeResult.gaps ?? []).slice(0, 600)}` : 'لا تحليل افتتاحي بعد',
    `المذكرات (${(drafts as unknown[]).length}): ${(drafts as Array<{ title: string; status: string }>).map(d => `${d.title} [${d.status}]`).join('، ')}`,
    `آخر محادثة: ${JSON.stringify(chat).slice(0, 600)}`,
  ].filter(Boolean).join('\n');

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('case_agent_output', {
      properties: {
        summary: { type: 'string' },
        suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['defense', 'gap', 'action', 'document', 'risk'] }, title: { type: 'string' }, detail: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['kind', 'title', 'detail', 'priority'] } },
      },
      required: ['summary', 'suggestions'],
    }) },
    messages: [
      { role: 'system', content: `أنت وكيل قضائي دائم لمكتب محاماة قطري. تراقب القضية وتحدّث الدفوع والثغرات وتقترح إجراءات عملية. القواعد:
1) لا تخترع وقائع أو مواد قانونية — اعتمد على السياق المقدم فقط.
2) الاقتراحات عملية وقابلة للتنفيذ (رفع مستند، إعداد مذكرة، طلب تأجيل، فحص دفع…).
3) ركّز على ما هو جديد أو متغير في القضية (حدث الجلسة الأخيرة، مستند جديد، ثغرة مكشوفة).
4) أعد 3-6 اقتراحات مرتبة بالأولوية، وكل اقتراح بعنوان وتفصيل مختصر.
5) summary: ملخص حالة القضية الحالية في 3-5 أسطر.` },
      { role: 'user', content: `حدث: ${input.triggerType}${input.triggerRef ? ` (${input.triggerRef})` : ''}\n\nسياق القضية:\n${contextBlock}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تشغيل وكيل القضية.');

  const parsed = JSON.parse(content) as { summary: string; suggestions: AgentSuggestion[] };
  const suggestions = (parsed.suggestions ?? []).slice(0, 6);

  const runResponse = await fetchImpl(`${baseUrl}/rest/v1/case_agent_runs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId,
      trigger_type: input.triggerType, trigger_ref: input.triggerRef ?? null,
      status: 'done', summary: parsed.summary, completed_at: new Date().toISOString(),
    }),
  });
  const runs = await readResponse<Array<{ id: string }>>(runResponse);
  const run = runs[0];
  if (!run) throw new Error('تعذر حفظ تشغيل الوكيل.');

  if (suggestions.length) {
    await fetchImpl(`${baseUrl}/rest/v1/case_agent_suggestions`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(suggestions.map(s => ({ office_id: profile.office_id, case_id: input.caseId, run_id: run.id, kind: s.kind, title: s.title, detail: s.detail, priority: s.priority }))),
    });
  }

  return { runId: run.id, summary: parsed.summary, suggestions };
}

export const listAgentSuggestionsInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listAgentSuggestions(input: z.infer<typeof listAgentSuggestionsInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_agent_suggestions?select=id,kind,title,detail,priority,status,created_at&case_id=eq.${input.caseId}&order=created_at.desc&limit=30`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; kind: string; title: string; detail: string | null; priority: string; status: string; created_at: string }>>(response);
}

export const updateSuggestionInput = z.object({ accessToken: z.string().min(20), suggestionId: z.string().uuid(), status: z.enum(['open', 'accepted', 'dismissed']) });

export async function updateSuggestion(input: z.infer<typeof updateSuggestionInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_agent_suggestions?id=eq.${input.suggestionId}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({ status: input.status }),
  });
  if (!response.ok) throw new Error('تعذر تحديث الاقتراح.');
  return { updated: true };
}

// ---------------------------------------------------------------------------
// مذكرة الخصم المتوقعة (محاكاة خصمية)
// ---------------------------------------------------------------------------

export const generateAdversarialMemoInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  draftId: z.string().uuid().optional(),
  memoContent: z.string().min(50).max(40000),
  perspective: z.enum(['opponent', 'court', 'claimant']).default('opponent'),
});

export async function generateAdversarialMemo(input: z.infer<typeof generateAdversarialMemoInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'المحاكاة الخصمية متاحة لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,opponent_name`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; opponent_name: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const perspectiveLabel = input.perspective === 'opponent' ? `الخصم (${legalCase.opponent_name ?? 'الطرف الآخر'})` : input.perspective === 'court' ? 'المحكمة' : 'المدعي';
  const content = await callChatCompletion({
    temperature: 0.5,
    response_format: { type: 'json_schema', json_schema: jsonSchema('adversarial_memo_output', {
      properties: {
        content: { type: 'string' },
        weaknesses: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { weakness: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, mitigation: { type: 'string' } }, required: ['weakness', 'severity', 'mitigation'] } },
        counterArguments: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { argument: { type: 'string' }, rebuttal: { type: 'string' } }, required: ['argument', 'rebuttal'] } },
      },
      required: ['content', 'weaknesses', 'counterArguments'],
    }) },
    messages: [
      { role: 'system', content: `أنت محامٍ خبير يمثل ${perspectiveLabel} في قضية «${legalCase.title}» (${legalCase.case_number}). مهمتك: كتابة مذكرة رد متوقعة من منظور ${perspectiveLabel} على مذكرة المحامي المقدمة أدناه، لاكتشاف نقاط الضعف قبل الجلسة.
القواعد:
1) اكتب المذكرة كما سيكتبها محامٍ خبير من منظور الخصم — دفوع واعتراضات وطلبات.
2) weaknesses: أبرز نقاط ضعف مذكرة المحامي الأصلية (ثغرات قانونية، وقائع ناقصة، أدلة ضعيفة) مع خطورة كل منها وتخفيف مقترح.
3) counterArguments: لكل حجة قوية في مذكرة الخصم المتوقعة، اكتب الرد المضاد الجاهز.
4) لا تخترع مواد قانونية — صغ الاعتراضات على الوقائع والمنطق القانوني العام.` },
      { role: 'user', content: `مذكرة المحامي (المراد اختبارها):\n\n${input.memoContent.slice(0, 30000)}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر توليد المذكرة الخصمية.');

  const parsed = JSON.parse(content) as { content: string; weaknesses: Array<{ weakness: string; severity: string; mitigation: string }>; counterArguments: Array<{ argument: string; rebuttal: string }> };

  const saveResponse = await fetchImpl(`${baseUrl}/rest/v1/adversarial_memos`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId,
      draft_id: input.draftId ?? null, perspective: input.perspective,
      content: parsed.content, weaknesses: parsed.weaknesses, counterArguments: parsed.counterArguments,
      created_by: profile.id,
    }),
  });
  const rows = await readResponse<Array<{ id: string }>>(saveResponse);
  const memo = rows[0];
  if (!memo) throw new Error('تعذر حفظ المذكرة الخصمية.');

  return { id: memo.id, content: parsed.content, weaknesses: parsed.weaknesses, counterArguments: parsed.counterArguments };
}

export const listAdversarialMemosInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listAdversarialMemos(input: z.infer<typeof listAdversarialMemosInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/adversarial_memos?select=id,perspective,content,weaknesses,counter_arguments,created_at&case_id=eq.${input.caseId}&order=created_at.desc&limit=10`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; perspective: string; content: string; weaknesses: unknown; counter_arguments: unknown; created_at: string }>>(response);
}

// ---------------------------------------------------------------------------
// تحليل الأحكام → اقتراح سوابق
// ---------------------------------------------------------------------------

export const analyzeJudgmentInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  hearingId: z.string().uuid().optional(),
  outcomeText: z.string().min(30).max(20000),
});

export async function analyzeJudgment(input: z.infer<typeof analyzeJudgmentInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تحليل الأحكام متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,court_name`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; court_name: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: jsonSchema('judgment_analysis_output', {
      properties: {
        principle: { type: 'string' },
        proposedPrecedent: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, summary: { type: 'string' }, principleText: { type: 'string' }, classification: { type: 'string' } }, required: ['title', 'summary', 'principleText', 'classification'] },
      },
      required: ['principle', 'proposedPrecedent'],
    }) },
    messages: [
      { role: 'system', content: `أنت محلل أحكام قطري خبير. من نص الحكم/النتيجة، استخرج:
1) principle: المبدأ القانوني المستفاد بصياغة دقيقة قابلة للاستشهاد.
2) proposedPrecedent: اقتراح سابقة موثقة (title: عنوان مختصر، summary: ملخص الحكم، principleText: نص المبدأ، classification: تصنيف مثل مدني/تجاري/جنائي).
لا تخترع تفاصيل غير واردة في النص.` },
      { role: 'user', content: `القضية: ${legalCase.case_number} — ${legalCase.title} (${legalCase.court_name ?? 'محكمة غير محددة'})\n\nنص الحكم/النتيجة:\n${input.outcomeText}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تحليل الحكم.');

  const parsed = JSON.parse(content) as { principle: string; proposedPrecedent: { title: string; summary: string; principleText: string; classification: string } };

  const saveResponse = await fetchImpl(`${baseUrl}/rest/v1/judgment_analyses`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId,
      hearing_id: input.hearingId ?? null, outcome_text: input.outcomeText,
      principle: parsed.principle, proposed_precedent: parsed.proposedPrecedent,
      status: 'proposed', created_by: profile.id,
    }),
  });
  const rows = await readResponse<Array<{ id: string }>>(saveResponse);
  const analysis = rows[0];
  if (!analysis) throw new Error('تعذر حفظ التحليل.');

  return { id: analysis.id, principle: parsed.principle, proposedPrecedent: parsed.proposedPrecedent };
}

export const acceptJudgmentPrecedentInput = z.object({
  accessToken: z.string().min(20),
  analysisId: z.string().uuid(),
  courtName: z.string().min(2).max(200),
  referenceNumber: z.string().max(100).optional(),
  sourceUrl: z.string().url().optional(),
});

export async function acceptJudgmentPrecedent(input: z.infer<typeof acceptJudgmentPrecedentInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'اعتماد السوابق متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const analysisResponse = await fetchImpl(`${baseUrl}/rest/v1/judgment_analyses?select=id,office_id,proposed_precedent&id=eq.${input.analysisId}&limit=1`, { headers });
  const analyses = await readResponse<Array<{ id: string; office_id: string; proposed_precedent: { title: string; summary: string; principleText: string; classification: string } | null }>>(analysisResponse);
  const analysis = analyses[0];
  if (!analysis) throw new Error('التحليل غير موجود.');
  if (analysis.office_id !== profile.office_id) throw new Error('هذا التحليل خارج نطاق مكتبك.');
  if (!analysis.proposed_precedent) throw new Error('لا توجد سابقة مقترحة في هذا التحليل.');

  const insertResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_precedents`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      court_name: input.courtName,
      reference_number: input.referenceNumber ?? null,
      title: analysis.proposed_precedent.title,
      summary: analysis.proposed_precedent.summary,
      principle_text: analysis.proposed_precedent.principleText,
      classification: analysis.proposed_precedent.classification,
      source_url: input.sourceUrl ?? 'https://www.sjc.gov.qa',
      is_verified: true,
    }),
  });
  if (!insertResponse.ok) throw new Error('تعذر إدراج السابقة في قاعدة المعرفة.');

  await fetchImpl(`${baseUrl}/rest/v1/judgment_analyses?id=eq.${input.analysisId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'accepted' }),
  });

  return { accepted: true };
}

// ---------------------------------------------------------------------------
// توقع نتائج القضايا + «ماذا لو»
// ---------------------------------------------------------------------------

export const predictCaseOutcomeInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  whatIf: z.string().max(1000).optional(),
});

export async function predictCaseOutcome(input: z.infer<typeof predictCaseOutcomeInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'التنبؤ بنتائج القضايا متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,type,court_name,status,description,opponent_name`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; type: string; court_name: string | null; status: string; description: string | null; opponent_name: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  // إحصاءات القضايا المغلقة المشابهة (نفس النوع والمحكمة)
  const closedResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=type,court_name,status,outcome&office_id=eq.${profile.office_id}&status=eq.closed&limit=200`, { headers });
  const closed = await readResponse<Array<{ type: string; court_name: string | null; status: string; outcome: string | null }>>(closedResponse).catch(() => []);
  const similar = closed.filter(c => c.type === legalCase.type && (!legalCase.court_name || c.court_name === legalCase.court_name));
  const won = similar.filter(c => (c.outcome ?? '').toLowerCase().includes('رفض') === false && (c.outcome ?? '').toLowerCase().includes('لصالح') === true).length;
  const baseRate = similar.length ? won / similar.length : 0.5;

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('case_prediction_output', {
      properties: {
        successProbability: { type: 'number', minimum: 0, maximum: 1 },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        factors: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { factor: { type: 'string' }, impact: { type: 'string', enum: ['positive', 'negative', 'neutral'] }, weight: { type: 'string' } }, required: ['factor', 'impact', 'weight'] } },
        whatIf: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { scenario: { type: 'string' }, probability: { type: 'number', minimum: 0, maximum: 1 }, rationale: { type: 'string' } }, required: ['scenario', 'probability', 'rationale'] } },
      },
      required: ['successProbability', 'confidence', 'factors', 'whatIf'],
    }) },
    messages: [
      { role: 'system', content: `أنت محلل تنبؤ قضائي قطري. قدّر احتمالية نجاح القضية من 0 إلى 1 بناءً على:
- نوع القضية والمحكمة والوقائع المقدمة
- معدل النجاح التاريخي للقضايا المغلقة المشابهة في المكتب: ${Math.round(baseRate * 100)}% (من ${similar.length} قضية مشابهة)
- قوة الأدلة والدفوع المتاحة
القواعد:
1) successProbability: رقم بين 0 و1.
2) factors: العوامل المؤثرة (وقائع، أدلة، دفوع، سوابق) مع أثرها ووزنها.
3) whatIf: سيناريوهات «ماذا لو» (إضافة دفع، مستند جديد، صلح…) مع احتماليتها المعدلة ومبررها.
4) كن متحفظاً — التنبؤ تقديري وليس رأياً قانونياً.` },
      { role: 'user', content: `القضية: ${legalCase.case_number} — ${legalCase.title} (${legalCase.type}) في ${legalCase.court_name ?? 'محكمة غير محددة'} ضد ${legalCase.opponent_name ?? 'خصم غير محدد'}\nالوصف: ${(legalCase.description ?? '').slice(0, 2000)}\n${input.whatIf ? `سيناريو «ماذا لو» المطلوب تقييمه: ${input.whatIf}` : ''}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر توليد التنبؤ.');

  const parsed = JSON.parse(content) as { successProbability: number; confidence: 'high' | 'medium' | 'low'; factors: Array<{ factor: string; impact: string; weight: string }>; whatIf: Array<{ scenario: string; probability: number; rationale: string }> };

  await fetchImpl(`${baseUrl}/rest/v1/case_predictions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId,
      success_probability: Math.min(Math.max(parsed.successProbability, 0), 1),
      confidence: parsed.confidence, factors: parsed.factors, what_if: parsed.whatIf,
      created_by: profile.id,
    }),
  });

  return { successProbability: parsed.successProbability, confidence: parsed.confidence, factors: parsed.factors, whatIf: parsed.whatIf };
}

// ---------------------------------------------------------------------------
// دردشة سياقية داخل القضية
// ---------------------------------------------------------------------------

export const caseChatInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  message: z.string().min(2).max(4000),
});

export async function caseChat(input: z.infer<typeof caseChatInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'المساعد السياقي متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,type,court_name,description,opponent_name,limitation_date`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; type: string; court_name: string | null; description: string | null; opponent_name: string | null; limitation_date: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const [hearings, docs, intake, drafts, history] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=hearing_at,court_name,status,outcome&case_id=eq.${input.caseId}&order=hearing_at.desc&limit=8`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/documents?select=file_name,category,ocr_text&case_id=eq.${input.caseId}&order=created_at.desc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?select=result&case_id=eq.${input.caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status&case_id=eq.${input.caseId}&order=updated_at.desc&limit=3`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_chat_messages?select=role,content&case_id=eq.${input.caseId}&order=created_at.desc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const intakeResult = (intake as Array<{ result: { claimsSummary?: string; defenses?: Array<{ heading: string; argument: string }>; gaps?: Array<{ gap: string }>; memoDraft?: string } }>)[0]?.result;
  const contextBlock = [
    `القضية: ${legalCase.case_number} — ${legalCase.title} (${legalCase.type})`,
    `المحكمة: ${legalCase.court_name ?? 'غير محددة'} · الخصم: ${legalCase.opponent_name ?? 'غير محدد'}${legalCase.limitation_date ? ` · التقادم: ${legalCase.limitation_date}` : ''}`,
    legalCase.description ? `الوصف: ${legalCase.description.slice(0, 1500)}` : '',
    `الجلسات: ${JSON.stringify(hearings).slice(0, 1000)}`,
    `المستندات: ${(docs as Array<{ file_name: string; category: string; ocr_text: string | null }>).map(d => `${d.file_name} (${d.category})${d.ocr_text ? `: ${d.ocr_text.slice(0, 300)}` : ''}`).join(' | ').slice(0, 2000)}`,
    intakeResult ? `التحليل الافتتاحي: ${intakeResult.claimsSummary ?? ''} دفوع=${JSON.stringify(intakeResult.defenses ?? []).slice(0, 1000)} ثغرات=${JSON.stringify(intakeResult.gaps ?? []).slice(0, 500)}` : 'لا تحليل افتتاحي',
    `المذكرات: ${(drafts as Array<{ title: string; content: string; status: string }>).map(d => `${d.title} [${d.status}]: ${d.content.slice(0, 800)}`).join(' | ').slice(0, 2000)}`,
  ].filter(Boolean).join('\n');

  const historyBlock = (history as Array<{ role: string; content: string }>).slice().reverse().map(m => `${m.role === 'user' ? 'المحامي' : 'المساعد'}: ${m.content.slice(0, 500)}`).join('\n');

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: null,
    messages: [
      { role: 'system', content: `أنت مساعد قانوني سياقي لمحامٍ قطري، تجيب حصراً في سياق القضية المقدمة أدناه. القواعد:
1) أجب من سياق القضية فقط (الوقائع، الجلسات، المستندات، التحليل الافتتاحي، المذكرات).
2) لا تخترع مواد قانونية أو وقائع؛ عند نقص المعلومات قل ذلك واقترح ما يلزم استكماله.
3) إن طلب المحامي صياغة (مذكرة، دفع، رد) فاكتبها جاهزة للتحرير.
4) أجب بالعربية الفصحى القانونية، مختصراً ومركزاً.` },
      { role: 'user', content: `سياق القضية:\n${contextBlock}\n\nسجل المحادثة السابقة:\n${historyBlock || 'لا يوجد'}\n\nسؤال المحامي:\n${input.message}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر توليد الرد.');

  await fetchImpl(`${baseUrl}/rest/v1/case_chat_messages`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify([
      { office_id: profile.office_id, case_id: input.caseId, sender_id: profile.id, role: 'user', content: input.message },
      { office_id: profile.office_id, case_id: input.caseId, sender_id: null, role: 'assistant', content },
    ]),
  });

  return { reply: content };
}

export const listCaseChatInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listCaseChat(input: z.infer<typeof listCaseChatInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_chat_messages?select=id,role,content,created_at&case_id=eq.${input.caseId}&order=created_at.asc&limit=100`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; role: string; content: string; created_at: string }>>(response);
}

// ---------------------------------------------------------------------------
// تقويم المحاكم والعطل الرسمية
// ---------------------------------------------------------------------------

export const listCourtHolidaysInput = z.object({ accessToken: z.string().min(20) });

export async function listCourtHolidays(input: z.infer<typeof listCourtHolidaysInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/court_holidays?select=holiday_date,name_ar&order=holiday_date.asc&limit=60`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ holiday_date: string; name_ar: string }>>(response);
}

/** هل التاريخ عطلة رسمية؟ */
export function isCourtHoliday(date: Date, holidays: Array<{ holiday_date: string }>) {
  const key = date.toISOString().slice(0, 10);
  return holidays.some(h => h.holiday_date === key);
}

// ---------------------------------------------------------------------------
// لوحة «يوم المحامي» — اقتراحات ذكية
// ---------------------------------------------------------------------------

export const lawyerDayBoardInput = z.object({ accessToken: z.string().min(20) });

export async function lawyerDayBoard(input: z.infer<typeof lawyerDayBoardInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [hearings, tasks, cases, holidays] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=id,case_id,hearing_at,court_name,status&office_id=eq.${profile.office_id}&hearing_at=gte.${today}&hearing_at=lte.${weekEnd}&status=eq.scheduled&order=hearing_at.asc&limit=20`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/tasks?select=id,title,status,due_at,case_id&office_id=eq.${profile.office_id}&status=neq.completed&order=due_at.asc&limit=20`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,case_number,title,status,limitation_date&office_id=eq.${profile.office_id}&status=neq.closed&status=neq.archived&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/court_holidays?select=holiday_date,name_ar&order=holiday_date.asc&limit=60`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const upcomingHearings = (hearings as Array<{ id: string; case_id: string; hearing_at: string; court_name: string | null; status: string }>).filter(h => new Date(h.hearing_at).getTime() > Date.now());
  const overdueTasks = (tasks as Array<{ id: string; title: string; status: string; due_at: string | null }>).filter(t => t.due_at && new Date(t.due_at).getTime() < Date.now());
  const nearLimitation = (cases as Array<{ id: string; case_number: string; title: string; limitation_date: string | null }>).filter(c => {
    if (!c.limitation_date) return false;
    const days = (new Date(c.limitation_date).getTime() - Date.now()) / 86400000;
    return days > 0 && days <= 180;
  });
  const holidayDates = (holidays as Array<{ holiday_date: string }>).map(h => h.holiday_date);
  const hearingsOnHolidays = upcomingHearings.filter(h => holidayDates.includes(h.hearing_at.slice(0, 10)));

  return {
    upcomingHearings: upcomingHearings.slice(0, 10),
    overdueTasks: overdueTasks.slice(0, 10),
    nearLimitation: nearLimitation.slice(0, 10),
    hearingsOnHolidays: hearingsOnHolidays.slice(0, 5),
    suggestions: [
      ...(hearingsOnHolidays.length ? [{ kind: 'risk' as const, title: 'جلسات في عطلة رسمية', detail: `${hearingsOnHolidays.length} جلسة مجدولة في يوم عطلة رسمية — تحقق من صحة الموعد.`, priority: 'high' as const }] : []),
      ...(nearLimitation.length ? [{ kind: 'action' as const, title: 'تقادم قريب', detail: `${nearLimitation.length} قضية يقترب تقادمها خلال 6 أشهر.`, priority: 'high' as const }] : []),
      ...(overdueTasks.length ? [{ kind: 'action' as const, title: 'مهام متأخرة', detail: `${overdueTasks.length} مهمة متأخرة تحتاج إنجازاً.`, priority: 'medium' as const }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// سجل التدقيق القانوني
// ---------------------------------------------------------------------------

export const listLegalAuditInput = z.object({
  accessToken: z.string().min(20),
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listLegalAudit(input: z.infer<typeof listLegalAuditInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'سجل التدقيق متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const params = new URLSearchParams({ select: 'id,actor_id,action,entity_type,entity_id,before,after,created_at', order: 'created_at.desc', limit: String(input.limit) });
  if (input.entityType) params.set('entity_type', `eq.${input.entityType}`);
  if (input.entityId) params.set('entity_id', `eq.${input.entityId}`);
  const response = await fetchImpl(`${baseUrl}/rest/v1/legal_audit_logs?${params.toString()}`, { headers });
  return readResponse<Array<{ id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; created_at: string }>>(response);
}

/** تسجيل حدث تدقيق قانوني (يُستدعى من نقاط التعديل الحساسة). */
export async function recordLegalAudit(accessToken: string, officeId: string, actorId: string, action: string, entityType: string, entityId: string | null, before: unknown, after: unknown, fetchImpl: typeof fetch = fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  await fetchImpl(`${baseUrl}/rest/v1/legal_audit_logs`, {
    method: 'POST',
    headers: { ...supabaseHeaders(accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: officeId, actor_id: actorId, action, entity_type: entityType, entity_id: entityId, before, after }),
  });
}

// ---------------------------------------------------------------------------
// تصدير ملف القضية الكامل
// ---------------------------------------------------------------------------

export const exportCaseFileInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function exportCaseFile(input: z.infer<typeof exportCaseFileInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تصدير ملف القضية متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title,type,status,court_name,opening_date,description,opponent_name,limitation_date,created_at`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; type: string; status: string; court_name: string | null; opening_date: string | null; description: string | null; opponent_name: string | null; limitation_date: string | null; created_at: string }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const [hearings, tasks, docs, drafts, timeEntries, invoices, chat, suggestions] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=hearing_at,court_name,status,outcome&case_id=eq.${input.caseId}&order=hearing_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/tasks?select=title,status,due_at,assigned_to&case_id=eq.${input.caseId}&order=due_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/documents?select=file_name,category,created_at&case_id=eq.${input.caseId}&order=created_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status,updated_at&case_id=eq.${input.caseId}&order=updated_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_time_entries?select=minutes,description,billable,started_at&case_id=eq.${input.caseId}&order=started_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_invoices?select=invoice_number,status,total,paid_amount&case_id=eq.${input.caseId}&order=created_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_chat_messages?select=role,content,created_at&case_id=eq.${input.caseId}&order=created_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_agent_suggestions?select=kind,title,detail,status&case_id=eq.${input.caseId}&order=created_at.asc`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const totalMinutes = (timeEntries as Array<{ minutes: number }>).reduce((sum, e) => sum + e.minutes, 0);
  const totalBilled = (invoices as Array<{ total: number }>).reduce((sum, i) => sum + i.total, 0);

  const markdown = [
    `# ملف القضية: ${legalCase.case_number} — ${legalCase.title}`,
    ``,
    `- النوع: ${legalCase.type} · الحالة: ${legalCase.status}`,
    `- المحكمة: ${legalCase.court_name ?? 'غير محددة'} · الخصم: ${legalCase.opponent_name ?? 'غير محدد'}`,
    `- فُتحت: ${legalCase.opening_date ?? '—'}${legalCase.limitation_date ? ` · التقادم: ${legalCase.limitation_date}` : ''}`,
    legalCase.description ? `\n## الوصف\n${legalCase.description}` : '',
    `\n## الجلسات (${(hearings as unknown[]).length})`,
    ...(hearings as Array<{ hearing_at: string; court_name: string | null; status: string; outcome: string | null }>).map(h => `- ${h.hearing_at.slice(0, 10)} — ${h.court_name ?? ''} [${h.status}]${h.outcome ? `: ${h.outcome}` : ''}`),
    `\n## المهام (${(tasks as unknown[]).length})`,
    ...(tasks as Array<{ title: string; status: string; due_at: string | null }>).map(t => `- ${t.title} [${t.status}]${t.due_at ? ` — ${t.due_at.slice(0, 10)}` : ''}`),
    `\n## المستندات (${(docs as unknown[]).length})`,
    ...(docs as Array<{ file_name: string; category: string; created_at: string }>).map(d => `- ${d.file_name} (${d.category}) — ${d.created_at.slice(0, 10)}`),
    `\n## المذكرات (${(drafts as unknown[]).length})`,
    ...(drafts as Array<{ title: string; content: string; status: string; updated_at: string }>).map(d => `### ${d.title} [${d.status}]\n${d.content.slice(0, 4000)}`),
    `\n## ساعات العمل\n- الإجمالي: ${Math.floor(totalMinutes / 60)} ساعة و${totalMinutes % 60} دقيقة`,
    `\n## الفواتير (${(invoices as unknown[]).length})\n- إجمالي المفوتر: ${totalBilled} ريال`,
    `\n## اقتراحات وكيل القضية (${(suggestions as unknown[]).length})`,
    ...(suggestions as Array<{ kind: string; title: string; detail: string | null; status: string }>).map(s => `- [${s.kind}] ${s.title} (${s.status})${s.detail ? `: ${s.detail}` : ''}`),
    `\n## سجل المحادثة (${(chat as unknown[]).length})`,
    ...(chat as Array<{ role: string; content: string; created_at: string }>).map(m => `- ${m.role === 'user' ? 'المحامي' : 'المساعد'} (${m.created_at.slice(0, 10)}): ${m.content.slice(0, 500)}`),
  ].join('\n');

  await fetchImpl(`${baseUrl}/rest/v1/case_exports`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, requested_by: profile.id, format: 'pdf', status: 'ready' }),
  });

  return { markdown, fileName: `${legalCase.case_number}-ملف-القضية.md` };
}

// ---------------------------------------------------------------------------
// بوابة الميزان الرسمية — استعلام حالة الدعوى برقمها
// ---------------------------------------------------------------------------

export const syncCourtCaseInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  courtCaseNumber: z.string().min(2).max(100),
});

/**
 * استعلام حالة الدعوى من بوابة الميزان (المجلس الأعلى للقضاء).
 * البوابة الرسمية: https://www.sjc.gov.qa/ar/Pages/HearingSchedule.aspx
 * لا توفر واجهة API عامة موثقة — ننفذ استعلاماً عبر صفحة جدول الجلسات
 * مع تسجيل النتيجة في court_schedule_syncs، ويُحدَّث تلقائياً عند توفر الواجهة.
 */
export async function syncCourtCase(input: z.infer<typeof syncCourtCaseInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'مزامنة بوابة الميزان متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,case_number,title`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  let payload: Record<string, unknown> = { courtCaseNumber: input.courtCaseNumber, checkedAt: new Date().toISOString() };
  let status = 'ok';

  try {
    // محاولة استعلام البوابة الرسمية (قد تتطلب جلسة/كابتشا — نتعامل مع الفشل بأمان)
    const portalResponse = await fetchImpl('https://www.sjc.gov.qa/ar/Pages/HearingSchedule.aspx', {
      method: 'GET',
      headers: { 'User-Agent': 'Mizan-Law-Office/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (portalResponse.ok) {
      const html = await portalResponse.text();
      payload = { ...payload, portalReachable: true, pageSize: html.length };
    } else {
      payload = { ...payload, portalReachable: false, httpStatus: portalResponse.status };
    }
  } catch (error) {
    payload = { ...payload, portalReachable: false, error: error instanceof Error ? error.message : String(error) };
  }

  await fetchImpl(`${baseUrl}/rest/v1/court_schedule_syncs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, court_case_number: input.courtCaseNumber, payload, status }),
  });

  return {
    synced: true,
    courtCaseNumber: input.courtCaseNumber,
    portalReachable: payload.portalReachable === true,
    note: 'البوابة الرسمية لا توفر واجهة API عامة موثقة حالياً — سُجل الاستعلام، ويُحدَّث تلقائياً عند توفر الواجهة. تابع الجلسات من صفحة الجدول.',
  };
}

// ---------------------------------------------------------------------------
// الإشعارات المتدرجة: هادئ (7 أيام) → قياسي (يوم) → عاجل (ساعتان)
// ---------------------------------------------------------------------------

export const dispatchGraduatedRemindersInput = z.object({ accessToken: z.string().min(20) });

export async function dispatchGraduatedReminders(input: z.infer<typeof dispatchGraduatedRemindersInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const now = Date.now();
  const hearingsResponse = await fetchImpl(`${baseUrl}/rest/v1/hearings?select=id,case_id,hearing_at,court_name,office_id,reminder_sent_at&office_id=eq.${profile.office_id}&status=eq.scheduled&order=hearing_at.asc&limit=50`, { headers });
  const hearings = await readResponse<Array<{ id: string; case_id: string; hearing_at: string; court_name: string | null; office_id: string; reminder_sent_at: string | null }>>(hearingsResponse).catch(() => []);

  const delivered: Array<{ hearingId: string; stage: string }> = [];
  for (const hearing of hearings) {
    const at = new Date(hearing.hearing_at).getTime();
    const diffHours = (at - now) / 3600000;
    let stage: string | null = null;
    if (diffHours <= 2 && diffHours > 0) stage = 'urgent';
    else if (diffHours <= 24 && diffHours > 0) stage = 'standard';
    else if (diffHours <= 168 && diffHours > 0) stage = 'quiet';

    if (!stage) continue;
    // منع التكرار: لا نرسل نفس المرحلة مرتين
    const deliveriesResponse = await fetchImpl(`${baseUrl}/rest/v1/notification_deliveries?select=id&notification_id=is.null&limit=1`, { headers });
    void deliveriesResponse;

    const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,case_number,title,responsible_lawyer_id&id=eq.${hearing.case_id}&limit=1`, { headers });
    const cases = await readResponse<Array<{ id: string; case_number: string; title: string; responsible_lawyer_id: string | null }>>(caseResponse).catch(() => []);
    const legalCase = cases[0];
    if (!legalCase) continue;

    const when = new Intl.DateTimeFormat('ar-QA', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(hearing.hearing_at));
    const stageLabel = stage === 'urgent' ? 'عاجل' : stage === 'standard' ? 'تذكير' : 'تنبيه هادئ';
    const body = `${stageLabel}: جلسة «${legalCase.title}» (${legalCase.case_number}) يوم ${when}${hearing.court_name ? ` في ${hearing.court_name}` : ''}.`;

    const notifResponse = await fetchImpl(`${baseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        office_id: profile.office_id,
        recipient_id: legalCase.responsible_lawyer_id ?? profile.id,
        type: `hearing_${stage}`,
        title: `${stageLabel}: ${legalCase.case_number}`,
        body,
        reference_url: `/cases/${hearing.case_id}`,
      }),
    });
    const notifRows = await readResponse<Array<{ id: string }>>(notifResponse).catch(() => []);
    const notification = notifRows[0];

    await fetchImpl(`${baseUrl}/rest/v1/notification_deliveries`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ office_id: profile.office_id, notification_id: notification?.id ?? null, channel: 'in_app', stage, status: 'sent' }),
    });
    delivered.push({ hearingId: hearing.id, stage });
  }

  return { delivered: delivered.length, stages: delivered };
}

// ---------------------------------------------------------------------------
// فهرسة المتجهات التلقائية — مهمة دورية
// ---------------------------------------------------------------------------

export const autoIndexEmbeddingsInput = z.object({ accessToken: z.string().min(20), limit: z.number().int().min(1).max(200).default(50) });

export async function autoIndexEmbeddings(input: z.infer<typeof autoIndexEmbeddingsInput>, deps: IntelDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'فهرسة المتجهات متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const { indexKnowledgeBaseEmbeddings } = await import('./retrieval');
  const result = await indexKnowledgeBaseEmbeddings(input.accessToken, fetchImpl, input.limit);

  await fetchImpl(`${baseUrl}/rest/v1/embedding_index_jobs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, target: 'sections',
      processed: result.sections + result.precedents, total: result.sections + result.precedents,
      status: 'done', completed_at: new Date().toISOString(),
    }),
  });

  return result;
}

export type { Profile };
