import { z } from 'zod';
import { createHash } from 'crypto';
import { callChatCompletion } from './aiClient';
import { assertAiQuota } from './aiQuota';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';

/**
 * طبقة الذكاء العميق — «النظام التشغيلي القانوني»:
 * خريطة الأدلة، محرك مدّد الطعون، ليلة ما قبل الجلسة، تقرير الموكل التنفيذي،
 * محلل تقارير الخبراء، حاسبة التسوية، تعلّم تفضيلات المحامي، مدقق الاتساق،
 * طمس البيانات الحساسة، اتجاهات الدوائر، رادار الجريدة، تتبع أدلة عهدة المستندات.
 */

type DeepDeps = { fetchImpl?: typeof fetch };

const jsonSchema = (name: string, schema: Record<string, unknown>) => ({ name, strict: true, schema: { type: 'object', additionalProperties: false, ...schema } });

/** تحميل سياق القضية الكامل (مشترك بين الميزات). */
async function loadCaseContext(accessToken: string, caseId: string, fetchImpl: typeof fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const [caseRows, hearings, docs, drafts, intake] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,office_id,case_number,title,type,status,court_name,description,opponent_name,limitation_date,opening_date&id=eq.${caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/hearings?select=hearing_at,court_name,status,outcome&case_id=eq.${caseId}&order=hearing_at.desc&limit=10`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/documents?select=file_name,category,created_at,ocr_text&case_id=eq.${caseId}&order=created_at.desc&limit=15`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=title,content,status&case_id=eq.${caseId}&order=updated_at.desc&limit=5`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?select=result&case_id=eq.${caseId}&limit=1`, { headers }).then(r => r.ok ? r.json() : []),
  ]);
  const legalCase = (caseRows as Array<{ id: string; office_id: string; case_number: string; title: string; type: string; status: string; court_name: string | null; description: string | null; opponent_name: string | null; limitation_date: string | null; opening_date: string | null }>)[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  return { legalCase, hearings: hearings as Array<{ hearing_at: string; court_name: string | null; status: string; outcome: string | null }>, docs: docs as Array<{ file_name: string; category: string; created_at: string; ocr_text: string | null }>, drafts: drafts as Array<{ title: string; content: string; status: string }>, intake: intake as Array<{ result: { claimsSummary?: string; defenses?: Array<{ heading: string; argument: string }>; gaps?: Array<{ gap: string }>; legalIssues?: string[] } }> };
}

async function assertCaseOffice(accessToken: string, profile: Profile, caseId: string, fetchImpl: typeof fetch, context?: { office_id: string }) {
  if (context && context.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');
}

// ---------------------------------------------------------------------------
// 1) خريطة عبء الإثبات وشجرة الأدلة
// ---------------------------------------------------------------------------

export const buildEvidenceMapInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function buildEvidenceMap(input: z.infer<typeof buildEvidenceMapInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'خريطة الإثبات متاحة لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const { legalCase, docs } = await loadCaseContext(input.accessToken, input.caseId, fetchImpl);
  await assertCaseOffice(input.accessToken, profile, input.caseId, fetchImpl, legalCase);

  const claims = legalCase.description ?? 'دعوى غير موصوفة';
  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: jsonSchema('evidence_map_output', {
      properties: {
        elements: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { requirement: { type: 'string' }, elementType: { type: 'string', enum: ['element', 'defense', 'counter'] }, proofStatus: { type: 'string', enum: ['proven', 'partial', 'unproven', 'n_a'] }, suggestedEvidence: { type: 'string' }, note: { type: 'string' } }, required: ['requirement', 'elementType', 'proofStatus', 'suggestedEvidence'] } },
      },
      required: ['elements'],
    }) },
    messages: [
      { role: 'system', content: `أنت خبير إثبات في المرافعات القطرية. من ملخص الدعوى وطلباتها، فكك المطلوب إلى أركان يجب إثباتها (خطأ/ضرر/سببية/التزام…). القواعد:
1) لكل ركن حدد وضعه الافتراضي: proven (مثبت بالمستندات المذكورة)، partial (مثبت جزئياً)، unproven (غير مثبت)، n_a (لا يلزم).
2) اقترح ما يلزم إثباته (نوع المستند/الوسيلة).
3) لا تخترع وقائع — ابنِ على الوصف المقدم فقط.` },
      { role: 'user', content: `الدعوى: ${legalCase.case_number} — ${legalCase.title} (${legalCase.type})\nالوصف: ${claims.slice(0, 2500)}\n\nالمستندات المتاحة: ${docs.map(d => `${d.file_name} (${d.category})${d.ocr_text ? ' [مقروء OCR]' : ''}`).join('، ').slice(0, 1200)}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر بناء خريطة الإثبات.');

  const parsed = JSON.parse(content) as { elements: Array<{ requirement: string; elementType: string; proofStatus: string; suggestedEvidence: string; note?: string }> };

  const existing = await fetchImpl(`${baseUrl}/rest/v1/evidence_map_nodes?case_id=eq.${input.caseId}&select=id`, { headers }).then(r => r.ok ? r.json() : []);
  if ((existing as unknown[]).length) {
    await fetchImpl(`${baseUrl}/rest/v1/evidence_map_nodes?case_id=eq.${input.caseId}`, { method: 'DELETE', headers, body: '{}' });
  }
  await fetchImpl(`${baseUrl}/rest/v1/evidence_map_nodes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(parsed.elements.map(el => ({ office_id: profile.office_id, case_id: input.caseId, requirement: el.requirement, element_type: el.elementType, proof_status: el.proofStatus, note: `${el.suggestedEvidence}${el.note ? ` — ${el.note}` : ''}` }))),
  });

  return { elements: parsed.elements };
}

export const listEvidenceMapInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listEvidenceMap(input: z.infer<typeof listEvidenceMapInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/evidence_map_nodes?select=id,requirement,element_type,proof_status,note&case_id=eq.${input.caseId}&order=created_at.asc&limit=50`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; requirement: string; element_type: string; proof_status: string; note: string | null }>>(response);
}

// ---------------------------------------------------------------------------
// 2) محرك مدّد الطعون ومواعيد السقوط الإجرائية
// ---------------------------------------------------------------------------

export const computeDeadlinesInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  eventType: z.enum(['judgment', 'notice', 'hearing_postponement', 'other']),
  judgmentKind: z.enum(['civil', 'commercial', 'urgent', 'criminal', 'labor', 'administrative', 'other']).default('civil'),
});

/** مدد الطعون القطرية: الأيام التقويمية + إيقاف أثناء العطل الرسمية. */
export function computeQatarAppealDeadlines(eventDate: Date, judgmentKind: string, holidays: Array<{ holiday_date: string }>) {
  const addDays = (date: Date, days: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };
  const nextBusiness = (date: Date) => {
    let d = new Date(date);
    const holidaySet = new Set(holidays.map(h => h.holiday_date));
    while (holidaySet.has(d.toISOString().slice(0, 10))) d = addDays(d, 1);
    return d;
  };

  const rules: Array<{ type: string; label: string; days: number }> = [];
  if (judgmentKind === 'criminal') rules.push({ type: 'appeal', label: 'ميعاد الاستئناف (جنائي)', days: 15 });
  else if (judgmentKind === 'urgent') rules.push({ type: 'appeal', label: 'ميعاد الاستئناف (أمور مستعجلة)', days: 15 });
  else rules.push({ type: 'appeal', label: `ميعاد الاستئناف (${judgmentKind})`, days: 30 });
  rules.push({ type: 'cassation', label: 'ميعاد التمييز', days: 60 });
  rules.push({ type: 'reconsideration', label: 'ميعاد المعارضة', days: 10 });

  return rules.map(rule => {
    const rawDue = addDays(eventDate, rule.days);
    const dueDate = nextBusiness(rawDue);
    return { ...rule, dueDate, rawDue };
  });
}

export async function computeDeadlines(input: z.infer<typeof computeDeadlinesInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'محرك مدد الطعون متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const holidaysResponse = await fetchImpl(`${baseUrl}/rest/v1/court_holidays?select=holiday_date&order=holiday_date.asc&limit=100`, { headers });
  const holidays = await readResponse<Array<{ holiday_date: string }>>(holidaysResponse).catch(() => []);

  const deadlines = computeQatarAppealDeadlines(new Date(input.eventDate), input.judgmentKind, holidays);

  await fetchImpl(`${baseUrl}/rest/v1/procedural_deadlines?case_id=eq.${input.caseId}`, { method: 'DELETE', headers, body: '{}' });
  await fetchImpl(`${baseUrl}/rest/v1/procedural_deadlines`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(deadlines.map(d => ({
      office_id: profile.office_id, case_id: input.caseId, deadline_type: d.type, label: d.label,
      base_date: input.eventDate, due_date: d.dueDate.toISOString().slice(0, 10), status: 'open',
      computed_rule: `${d.days} يوماً + إيقاف عند العطل الرسمية`,
    }))),
  });

  return { deadlines, eventDate: input.eventDate, judgmentKind: input.judgmentKind };
}

// ---------------------------------------------------------------------------
// 3) ليلة ما قبل الجلسة (Hearing Prep Pack)
// ---------------------------------------------------------------------------

export const hearingPrepInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function hearingPrep(input: z.infer<typeof hearingPrepInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'حزمة ليلة الجلسة متاحة لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadCaseContext(input.accessToken, input.caseId, fetchImpl);
  const nextHearing = (context.hearings as Array<{ hearing_at: string; court_name: string | null; status: string }>).find(h => h.status === 'scheduled' && new Date(h.hearing_at).getTime() > Date.now());
  if (!nextHearing) throw new Error('لا توجد جلسة قادمة مجدولة لهذه القضية.');

  const intakeResult = context.intake[0]?.result;
  const contextBlock = [
    `القضية: ${context.legalCase.case_number} — ${context.legalCase.title} (${context.legalCase.type})`,
    `الجلسة القادمة: ${new Date(nextHearing.hearing_at).toLocaleString('ar-QA')}${nextHearing.court_name ? ` في ${nextHearing.court_name}` : ''}`,
    context.legalCase.description ? `الوصف: ${context.legalCase.description.slice(0, 1200)}` : '',
    `التحليل الافتتاحي: دفوع=${JSON.stringify(intakeResult?.defenses ?? []).slice(0, 800)} ثغرات=${JSON.stringify(intakeResult?.gaps ?? []).slice(0, 600)}`,
    `المستندات: ${context.docs.map(d => `${d.file_name} (${d.category})`).join('، ').slice(0, 800)}`,
    `المذكرات: ${context.drafts.map(d => `${d.title} [${d.status}]`).join('، ')}`,
  ].filter(Boolean).join('\n');

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('hearing_prep_output', {
      properties: {
        onePageSummary: { type: 'string' },
        expectedQuestions: { type: 'array', items: { type: 'string' } },
        missingDocuments: { type: 'array', items: { type: 'string' } },
        topDefenses: { type: 'array', items: { type: 'string' } },
        weakPoints: { type: 'array', items: { type: 'string' } },
        oralPoints: { type: 'array', items: { type: 'string' } },
      },
      required: ['onePageSummary', 'expectedQuestions', 'missingDocuments', 'topDefenses', 'weakPoints', 'oralPoints'],
    }) },
    messages: [
      { role: 'system', content: `أنت محامٍ قطري خبير يجهّز «حزمة ليلة الجلسة» لمحامٍ. أعد:
1) onePageSummary: ملخص صفحة واحدة للمراجعة السريعة قبل الجلسة.
2) expectedQuestions: الأسئلة المتوقعة من المحكمة.
3) missingDocuments: المستندات الناقصة التي قد يطلبها القاضي.
4) topDefenses: أقوى 3 دفوع جاهزة.
5) weakPoints: أضعف 3 نقاط في الموقف — يجب التحوط لها.
6) oralPoints: نقاط مرافعة شفهية مختصرة (3-5 جمل).
لا تخترع وقائع أو مواد — ابنِ على السياق.` },
      { role: 'user', content: contextBlock },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تجهيز حزمة الجلسة.');

  const parsed = JSON.parse(content) as { onePageSummary: string; expectedQuestions: string[]; missingDocuments: string[]; topDefenses: string[]; weakPoints: string[]; oralPoints: string[] };
  return { hearingAt: nextHearing.hearing_at, ...parsed };
}

// ---------------------------------------------------------------------------
// 4) تقرير الموكل التنفيذي
// ---------------------------------------------------------------------------

export const clientBriefInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid(), language: z.enum(['ar', 'en']).default('ar') });

export async function clientBrief(input: z.infer<typeof clientBriefInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تقرير الموكل متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadCaseContext(input.accessToken, input.caseId, fetchImpl);
  const lastHearing = context.hearings[0];
  const nextHearing = context.hearings.find(h => h.status === 'scheduled' && new Date(h.hearing_at).getTime() > Date.now());
  const intakeResult = context.intake[0]?.result;

  const content = await callChatCompletion({
    temperature: 0.3,
    response_format: { type: 'json_schema', json_schema: jsonSchema('client_brief_output', {
      properties: { content: { type: 'string' } },
      required: ['content'],
    }) },
    messages: [
      { role: 'system', content: `أنت كاتب تقارير إدارية للموكلين في مكتب محاماة قطري. اكتب تقرير موقف قضائي باللغة ${input.language === 'ar' ? 'العربية' : 'الإنجليزية'}:
- بلغة إدارية واضحة ومبسطة خالية من التعقيد القانوني (موجه لغير المحامين).
- أقسام: ما تم في الجلسة الأخيرة · الموقف الحالي · الخطوة القادمة · التاريخ القادم.
- ${input.language === 'ar' ? 'بالعربية الفصحى الميسرة' : 'in clear plain English'}.
لا تخترع وقائع — اعتمد على السياق.` },
      { role: 'user', content: `القضية: ${context.legalCase.case_number} — ${context.legalCase.title}\nآخر جلسة: ${lastHearing ? `${new Date(lastHearing.hearing_at).toLocaleString('ar-QA')} [${lastHearing.status}]${lastHearing.outcome ? `: ${lastHearing.outcome}` : ''}` : 'لا جلسات بعد'}\nالجلسة القادمة: ${nextHearing ? new Date(nextHearing.hearing_at).toLocaleString('ar-QA') : 'غير مجدولة'}\nالموقف: ${intakeResult?.claimsSummary ?? context.legalCase.description?.slice(0, 800) ?? 'لا وصف'}\nالدعوى من نوع: ${context.legalCase.type} في ${context.legalCase.court_name ?? 'محكمة غير محددة'} ضد ${context.legalCase.opponent_name ?? 'خصم'}` },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر توليد تقرير الموكل.');

  const parsed = JSON.parse(content) as { content: string };
  await fetchImpl(`${baseUrl}/rest/v1/client_briefs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, language: input.language, content: parsed.content, created_by: profile.id }),
  });

  return { content: parsed.content, language: input.language };
}

// ---------------------------------------------------------------------------
// 5) محلل تقارير الخبراء والاعتراضات الفنية
// ---------------------------------------------------------------------------

export const analyzeExpertReportInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid(), reportText: z.string().min(50).max(40000) });

export async function analyzeExpertReport(input: z.infer<typeof analyzeExpertReportInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'محلل تقارير الخبراء متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: jsonSchema('expert_report_output', {
      properties: {
        findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { finding: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, basis: { type: 'string' }, suggestedObjection: { type: 'string' } }, required: ['finding', 'severity', 'basis', 'suggestedObjection'] } },
        objectionsDraft: { type: 'string' },
      },
      required: ['findings', 'objectionsDraft'],
    }) },
    messages: [
      { role: 'system', content: `أنت خبير مراجعة تقارير خبراء قضائيين في قطر. من نص تقرير الخبير المرفوع، اكتشف:
1) تجاوز الخبير لمأمورية المحكمة (أجاب عن أسئلة لم تُطرح عليه، أو تجاوز نطاق الندب).
2) أخطاء حسابية أو منطقية في الاستنتاج.
3) اعتماد على عناصر غير مذكورة في الأوراق.
لكل اكتشاف: severity وbasis (الدليل من النص) وsuggestedObjection (صياغة الاعتراض الجاهزة).
ثم objectionsDraft: مسودة كاملة لمذكرة اعتراض على تقرير الخبير.` },
      { role: 'user', content: input.reportText.slice(0, 30000) },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر تحليل تقرير الخبير.');

  const parsed = JSON.parse(content) as { findings: Array<{ finding: string; severity: string; basis: string; suggestedObjection: string }>; objectionsDraft: string };
  await fetchImpl(`${baseUrl}/rest/v1/expert_report_analyses`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, case_id: input.caseId, report_text: input.reportText, findings: parsed.findings, objections_draft: parsed.objectionsDraft, created_by: profile.id }),
  });

  return parsed;
}

// ---------------------------------------------------------------------------
// 6) حاسبة الجدوى والتسوية الودية
// ---------------------------------------------------------------------------

export const settlementValuationInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  claimAmount: z.number().min(0).max(1e12),
  successProbability: z.number().min(0).max(1).optional(),
  settlementOffer: z.number().min(0).max(1e12).optional(),
  estimatedCosts: z.number().min(0).max(1e12).default(0),
});

export async function settlementValuation(input: z.infer<typeof settlementValuationInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'حاسبة التسوية متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const context = await loadCaseContext(input.accessToken, input.caseId, fetchImpl);
  const probability = input.successProbability ?? 0.5;
  const expectedValue = input.claimAmount * probability - input.estimatedCosts;
  let recommendation: 'accept' | 'reject' | 'negotiate' | 'neutral' = 'neutral';
  if (input.settlementOffer !== undefined) {
    if (input.settlementOffer >= expectedValue * 0.95) recommendation = 'accept';
    else if (input.settlementOffer >= expectedValue * 0.7) recommendation = 'negotiate';
    else recommendation = 'reject';
  }

  await fetchImpl(`${baseUrl}/rest/v1/case_settlement_valuations`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, case_id: input.caseId, claim_amount: input.claimAmount,
      success_probability: probability, expected_value: Math.max(expectedValue, 0), costs: input.estimatedCosts,
      settlement_offer: input.settlementOffer ?? null, recommendation,
      analysis: { context: `${context.legalCase.case_number} — ${context.legalCase.title}`, estimatedCosts: input.estimatedCosts },
      created_by: profile.id,
    }),
  });

  return { expectedValue, recommendation, breakdown: { claimAmount: input.claimAmount, probability, estimatedCosts: input.estimatedCosts, settlementOffer: input.settlementOffer ?? null } };
}

// ---------------------------------------------------------------------------
// 7) تعلّم تفضيلات المحامي
// ---------------------------------------------------------------------------

export const recordPreferenceInput = z.object({
  accessToken: z.string().min(20),
  kind: z.enum(['citation', 'defense', 'wording', 'template', 'precedent']),
  value: z.string().min(2).max(2000),
  decision: z.enum(['accepted', 'rejected']),
  caseId: z.string().uuid().optional(),
});

export async function recordPreference(input: z.infer<typeof recordPreferenceInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const response = await fetchImpl(`${baseUrl}/rest/v1/ai_preference_signals`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, lawyer_id: profile.id, kind: input.kind, value: input.value, decision: input.decision, case_id: input.caseId ?? null }),
  });
  if (!response.ok) throw new Error('تعذر تسجيل إشارة التفضيل.');
  return { recorded: true };
}

export const preferenceInsightsInput = z.object({ accessToken: z.string().min(20) });

export async function preferenceInsights(input: z.infer<typeof preferenceInsightsInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/ai_preference_signals?select=kind,value,decision&office_id=eq.${profile.office_id}&order=created_at.desc&limit=200`, { headers: supabaseHeaders(input.accessToken) });
  const signals = await readResponse<Array<{ kind: string; value: string; decision: string }>>(response);

  const byKind = new Map<string, { accepted: number; rejected: number }>();
  for (const signal of signals) {
    const entry = byKind.get(signal.kind) ?? { accepted: 0, rejected: 0 };
    if (signal.decision === 'accepted') entry.accepted++;
    else entry.rejected++;
    byKind.set(signal.kind, entry);
  }
  const acceptedValues = signals.filter(s => s.decision === 'accepted').slice(0, 10).map(s => s.value.slice(0, 100));
  return { totalSignals: signals.length, byKind: Object.fromEntries(byKind), recentAccepted: acceptedValues };
}

// ---------------------------------------------------------------------------
// 8) مدقق الاتساق في المذكرات
// ---------------------------------------------------------------------------

export const consistencyCheckInput = z.object({ accessToken: z.string().min(20), memoText: z.string().min(100).max(50000) });

export async function consistencyCheck(input: z.infer<typeof consistencyCheckInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'مدقق الاتساق متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const content = await callChatCompletion({
    temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: jsonSchema('consistency_check_output', {
      properties: {
        issues: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { issue: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, location: { type: 'string' }, suggestion: { type: 'string' } }, required: ['issue', 'severity', 'location', 'suggestion'] } },
        requestsMatch: { type: 'boolean' },
      },
      required: ['issues', 'requestsMatch'],
    }) },
    messages: [
      { role: 'system', content: `أنت مدقق صياغة قضائية قطري. افحص المذكرة قبل الاعتماد:
1) هل الطلبات الختامية تتطابق مع الدفوع المشروحة في المتن؟
2) هل هناك تناقض في تواريخ الوقائع أو أرقام المواد؟
3) هل الترويسة (الأطراف/رقم الدعوى) متسقة؟
أعد issues مفصلة وrequestsMatch (هل الطلبات مطابقة للمتن).` },
      { role: 'user', content: input.memoText },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر فحص الاتساق.');

  const parsed = JSON.parse(content) as { issues: Array<{ issue: string; severity: string; location: string; suggestion: string }>; requestsMatch: boolean };
  return parsed;
}

// ---------------------------------------------------------------------------
// 9) طمس البيانات الحساسة (Redaction)
// ---------------------------------------------------------------------------

export const redactTextInput = z.object({ accessToken: z.string().min(20), text: z.string().min(10).max(50000) });

export async function redactText(input: z.infer<typeof redactTextInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const content = await callChatCompletion({
    temperature: 0.1,
    response_format: { type: 'json_schema', json_schema: jsonSchema('redaction_output', {
      properties: { redactedText: { type: 'string' }, redactions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { type: { type: 'string' }, original: { type: 'string' }, replacedWith: { type: 'string' } }, required: ['type', 'original', 'replacedWith'] } } },
      required: ['redactedText', 'redactions'],
    }) },
    messages: [
      { role: 'system', content: `أنت أداة طمس بيانات قانونية. استبدل البيانات الحساسة في النص بمكانها: أرقام الهوية القطرية، أرقام الحسابات البنكية، أرقام الهواتف، أرقام البطاقات، البيانات الطبية، الأسماء الشخصية في سياقات سرية. القواعد:
1) redactedText: النص بعد الطمس (استبدل كل قيمة بـ [XXXX] أو [اسم] حسب النوع).
2) redactions: قائمة بكل ما طُمس ونوعه.
3) لا تحذف نصوصاً قانونية أو وقائع عامة — طمس الهوية فقط.
أعد كل النص مع الطمس، لا تلخصه.` },
      { role: 'user', content: input.text },
    ],
  }, fetchImpl);
  if (!content) throw new Error('تعذر طمس النص.');

  const parsed = JSON.parse(content) as { redactedText: string; redactions: Array<{ type: string; original: string; replacedWith: string }> };
  return parsed;
}

// ---------------------------------------------------------------------------
// 10) اتجاهات الدوائر القضائية
// ---------------------------------------------------------------------------

export const circuitInsightsInput = z.object({ accessToken: z.string().min(20) });

export async function circuitInsights(input: z.infer<typeof circuitInsightsInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const [closedCases, precedents, expertReports] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=court_name,type,status,outcome&office_id=eq.${profile.office_id}&status=eq.closed&limit=200`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/legal_precedents?select=court_name,classification,title&is_verified=eq.true&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
    fetchImpl(`${baseUrl}/rest/v1/expert_report_analyses?select=case_id&office_id=eq.${profile.office_id}&limit=100`, { headers }).then(r => r.ok ? r.json() : []),
  ]);

  const byCircuit = new Map<string, { cases: number; won: number; expertDeferrals: number }>();
  const tally = (court: string | null, isWon: boolean, hadExpert: boolean) => {
    const key = court ?? 'غير محددة';
    const entry = byCircuit.get(key) ?? { cases: 0, won: 0, expertDeferrals: 0 };
    entry.cases++;
    if (isWon) entry.won++;
    if (hadExpert) entry.expertDeferrals++;
    byCircuit.set(key, entry);
  };
  for (const item of (closedCases as Array<{ court_name: string | null; outcome: string | null }>)) {
    const outcome = (item.outcome ?? '').toLowerCase();
    const isWon = outcome.includes('لصالح') || outcome.includes('رفض الدعوى') === false;
    const hasExpert = (expertReports as unknown[]).length > 0;
    tally(item.court_name, isWon, hasExpert);
  }
  for (const item of (precedents as Array<{ court_name: string; classification: string }>)) tally(item.court_name, true, false);

  return {
    circuits: Array.from(byCircuit.entries()).map(([court, stats]) => ({
      court,
      cases: stats.cases,
      winRate: stats.cases ? Math.round((stats.won / stats.cases) * 100) : 0,
      expertDeferrals: stats.expertDeferrals,
    })).sort((a, b) => b.cases - a.cases).slice(0, 10),
    note: 'اتجاهات مستمدة من بيانات مكتبك فقط — أداة مساندة وليست حقيقة عامة.',
  };
}

// ---------------------------------------------------------------------------
// 11) رادار الجريدة الرسمية
// ---------------------------------------------------------------------------

export const addGazetteQueryInput = z.object({ accessToken: z.string().min(20), query: z.string().min(3).max(300) });

export async function addGazetteQuery(input: z.infer<typeof addGazetteQueryInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'رادار الجريدة متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const response = await fetchImpl(`${baseUrl}/rest/v1/gazette_radar_queries`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, query: input.query, created_by: profile.id }),
  });
  if (!response.ok) throw new Error('تعذر إضافة مصطلح المراقبة.');
  return { added: true };
}

export const gazetteCheckInput = z.object({ accessToken: z.string().min(20) });

export async function gazetteCheck(input: z.infer<typeof gazetteCheckInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const queriesResponse = await fetchImpl(`${baseUrl}/rest/v1/gazette_radar_queries?select=id,query,last_checked_at&office_id=eq.${profile.office_id}&limit=50`, { headers });
  const queries = await readResponse<Array<{ id: string; query: string; last_checked_at: string }>>(queriesResponse).catch(() => []);

  const results = [];
  for (const item of queries) {
    try {
      const search = await fetchImpl(`https://www.sjc.gov.qa/en/Pages/Default.aspx?k=${encodeURIComponent(item.query)}`, {
        method: 'GET',
        headers: { 'User-Agent': 'Mizan-Law-Office/1.0' },
        signal: AbortSignal.timeout(6000),
      });
      const html = await search.text().catch(() => '');
      const found = html.toLowerCase().includes(item.query.toLowerCase()) || html.length > 100;
      await fetchImpl(`${baseUrl}/rest/v1/gazette_radar_queries?id=eq.${item.id}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ last_checked_at: new Date().toISOString() }),
      });
      results.push({ id: item.id, query: item.query, found, checkedAt: new Date().toISOString() });
    } catch (error) {
      results.push({ id: item.id, query: item.query, found: false, error: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() });
    }
  }
  return { checked: results.length, results };
}

// ---------------------------------------------------------------------------
// 12) سلسلة عهدة الأدلة (Evidence Chain of Custody)
// ---------------------------------------------------------------------------

export const documentChainInput = z.object({ accessToken: z.string().min(20), documentId: z.string().uuid() });

export async function documentChain(input: z.infer<typeof documentChainInput>, deps: DeepDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const docResponse = await fetchImpl(`${baseUrl}/rest/v1/documents?select=id,file_name,created_at,uploaded_by,office_id&id=eq.${input.documentId}&limit=1`, { headers });
  const docs = await readResponse<Array<{ id: string; file_name: string; created_at: string; uploaded_by: string | null; office_id: string }>>(docResponse);
  const doc = docs[0];
  if (!doc) throw new Error('المستند غير موجود.');
  if (doc.office_id !== profile.office_id) throw new Error('هذا المستند خارج نطاق مكتبك.');

  const auditResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_audit_logs?select=actor_id,action,created_at&entity_type=eq.documents&entity_id=eq.${input.documentId}&order=created_at.asc&limit=50`, { headers });
  const audit = await readResponse<Array<{ actor_id: string | null; action: string; created_at: string }>>(auditResponse).catch(() => []);

  const chain = [
    { event: 'رفع المستند', actor: doc.uploaded_by, at: doc.created_at },
    ...audit.map(entry => ({ event: entry.action, actor: entry.actor_id, at: entry.created_at })),
  ];
  const hash = createHash('sha256').update(doc.file_name + doc.created_at).digest('hex').slice(0, 16);

  return { fileName: doc.file_name, fingerprint: hash, chain };
}

export type { Profile };
