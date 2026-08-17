import { z } from 'zod';
import { assertAiQuota } from './aiQuota';
import { callChatCompletion } from './aiClient';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders } from './supabaseAccess';
import { extractQuotedSpans, normalizeArabic } from './legalText';
import { buildCandidateFilter, extractSearchTerms, rankSections, CANDIDATE_LIMIT, type RankableSection, type RankedSection } from './retrieval';

/**
 * استديو العقود والمذكرات — المنتج الثاني في خارطة التحول.
 * المسار: قالب معتمد → مقابلة صياغة → توليد مسودة مع سجل بنود ومخاطر وأسباب
 *        → تحقق اقتباسات التشريع → نسخ وحالات اعتماد (مسودة → مراجعة → معتمد → جاهز للتصدير).
 */

export const CONTRACT_STATUSES = ['draft', 'in_review', 'approved', 'ready_for_export'] as const;
export type ContractStatus = typeof CONTRACT_STATUSES[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'مسودة',
  in_review: 'مراجعة محامٍ',
  approved: 'معتمد داخلياً',
  ready_for_export: 'جاهز للتصدير',
};

/** انتقالات مسموحة فقط للأمام، مع مسار إعادة للمراجعة عند الحاجة. */
export const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['in_review'],
  in_review: ['approved', 'draft'],
  approved: ['ready_for_export'],
  ready_for_export: [],
};

export function canTransition(from: ContractStatus, to: ContractStatus) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type TemplateVariable = { key: string; label_ar: string; type: string; required?: boolean };

export type ContractClause = {
  id: string;
  code: string;
  titleAr: string;
  bodyTemplate: string;
  clauseOrder: number;
  riskLevel: 'low' | 'medium' | 'high';
  legalBasisNote: string | null;
  isOptional: boolean;
};

export type ContractTemplate = {
  id: string;
  code: string;
  titleAr: string;
  descriptionAr: string | null;
  documentType: string;
  jurisdiction: string;
  variables: TemplateVariable[];
  clauses: ContractClause[];
};

export type ClauseDecision = { code: string; title: string; included: boolean; reason: string; edits: string };
export type ContractRisk = { title: string; severity: 'مرتفع' | 'متوسط' | 'منخفض'; mitigation: string; legalBasis: string };
export type StatuteCitation = { label: string; verifiedAgainstRegister: boolean; note: string };

export type GeneratedContract = {
  documentId: string;
  version: number;
  draft: string;
  clauseDecisions: ClauseDecision[];
  risks: ContractRisk[];
  clarificationQuestions: string[];
  statuteCitations: StatuteCitation[];
  verification: { unverifiedQuotes: string[]; passed: boolean };
};

type StudioDeps = { fetchImpl?: typeof fetch };

export const listTemplatesInput = z.object({ accessToken: z.string().min(20) });

export async function listContractTemplates(input: z.infer<typeof listTemplatesInput>, deps: StudioDeps = {}): Promise<ContractTemplate[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const templatesResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_templates?select=id,code,title_ar,description_ar,document_type,jurisdiction,variables&is_active=eq.true&order=code`, { headers });
  const templates = await readResponse<Array<{
    id: string; code: string; title_ar: string; description_ar: string | null; document_type: string; jurisdiction: string; variables: TemplateVariable[];
  }>>(templatesResponse);

  const clausesResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_clauses?select=id,template_id,code,title_ar,body_template,clause_order,risk_level,legal_basis_note,is_optional&order=clause_order.asc`, { headers });
  const clauses = await readResponse<Array<{
    id: string; template_id: string; code: string; title_ar: string; body_template: string; clause_order: number; risk_level: 'low' | 'medium' | 'high'; legal_basis_note: string | null; is_optional: boolean;
  }>>(clausesResponse);

  return templates.map(template => ({
    id: template.id,
    code: template.code,
    titleAr: template.title_ar,
    descriptionAr: template.description_ar,
    documentType: template.document_type,
    jurisdiction: template.jurisdiction,
    variables: Array.isArray(template.variables) ? template.variables : [],
    clauses: clauses
      .filter(clause => clause.template_id === template.id)
      .map(clause => ({
        id: clause.id,
        code: clause.code,
        titleAr: clause.title_ar,
        bodyTemplate: clause.body_template,
        clauseOrder: clause.clause_order,
        riskLevel: clause.risk_level,
        legalBasisNote: clause.legal_basis_note,
        isOptional: clause.is_optional,
      })),
  }));
}

/** يستبدل متغيرات القالب {{key}} بالقيم مع الإبقاء على العنصر إن غابت القيمة. */
export function renderTemplate(body: string, answers: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => answers[key]?.trim() || match);
}

const generationSchema = z.object({
  draft: z.string(),
  clauseDecisions: z.array(z.object({
    code: z.string(),
    included: z.boolean(),
    reason: z.string(),
    edits: z.string(),
  })),
  risks: z.array(z.object({
    title: z.string(),
    severity: z.enum(['مرتفع', 'متوسط', 'منخفض']),
    mitigation: z.string(),
    legalBasis: z.string(),
  })),
  clarificationQuestions: z.array(z.string()),
  statuteCitations: z.array(z.object({
    label: z.string(),
    note: z.string(),
  })),
});

/**
 * تحقق اقتباسات التشريع في مسودة العقد مقابل سجل المصادر المستورد:
 * كل اقتباس حرفي داخل «…» يجب أن يطابق نص مقطع مسترجع، وإلا يُعلَّم «غير موثق».
 */
export async function verifyStatuteQuotes(text: string, accessToken: string, fetchImpl: typeof fetch): Promise<{ unverifiedQuotes: string[]; citations: StatuteCitation[] }> {
  const quotes = extractQuotedSpans(text);
  if (!quotes.length) return { unverifiedQuotes: [], citations: [] };
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const allTerms = extractSearchTerms(quotes.join(' '), 6);
  const headers = supabaseHeaders(accessToken);
  type Row = { id: string; source_id: string; article_number: string | null; heading: string | null; body: string; title: string; source_url: string; official_number: string | null };
  let ranked: ReturnType<typeof rankSections> = [];
  if (allTerms.length) {
    const rpc = await fetchImpl(`${baseUrl}/rest/v1/rpc/search_legal_sections`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_query: allTerms.join(' '), p_limit: CANDIDATE_LIMIT }),
    });
    if (rpc.ok) {
      const rows = await rpc.json() as Row[];
      ranked = rankSections(rows.map(row => ({ id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url, officialNumber: row.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body })), allTerms);
    }
  }
  if (!ranked.length) {
    const query = new URLSearchParams({ select: 'id,source_id,article_number,heading,body,legal_sources(title,source_url,official_number)', limit: String(CANDIDATE_LIMIT) });
    const filter = buildCandidateFilter(allTerms);
    if (filter) query.set('or', filter);
    const response = await fetchImpl(`${baseUrl}/rest/v1/legal_source_sections?${query.toString()}`, { headers });
    const rows = await readResponse<Array<{ id: string; source_id: string; article_number: string | null; heading: string | null; body: string; legal_sources: { title: string; source_url: string; official_number: string | null } | null }>>(response);
    ranked = rankSections(rows.filter(row => row.legal_sources).map(row => ({ id: row.id, sourceId: row.source_id, title: row.legal_sources!.title, url: row.legal_sources!.source_url, officialNumber: row.legal_sources!.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body })), allTerms);
  }
  const normalizedBodies = ranked.map(section => normalizeArabic(section.body));
  const unverifiedQuotes: string[] = [];
  const citations: StatuteCitation[] = [];
  for (const quote of quotes) {
    const normalized = normalizeArabic(quote);
    const matchIndex = normalizedBodies.findIndex(body => body.includes(normalized));
    if (matchIndex >= 0) {
      const source = ranked[matchIndex];
      citations.push({ label: `${source.title}${source.articleNumber ? ` — ${source.articleNumber}` : ''}`, verifiedAgainstRegister: true, note: 'مطابق لنص مسجل في قاعدة المصادر الموثقة.' });
    } else {
      unverifiedQuotes.push(quote);
      citations.push({ label: quote.slice(0, 60), verifiedAgainstRegister: false, note: 'لم يطابق نصاً مسجلاً؛ يلزم التحقق اليدوي من المصدر الرسمي قبل الاعتماد.' });
    }
  }
  return { unverifiedQuotes, citations };
}

function studioSystemPrompt(template: ContractTemplate, renderedClauses: string, answers: Record<string, string>) {
  const answersBlock = Object.entries(answers).map(([key, value]) => `${key}: ${value}`).join('\n');
  return `أنت محامٍ صياغة عقود قطري خبير تعد مسودة عقد من قالب معتمد لمكتب محاماة. المخرج مسودة قابلة للتحرير لا وثيقة موقعة.

القواعد الملزمة:
1) ابنِ المسودة على بنود القالب المعتمد أدناه بالترتيب، واملأ متغيراتها بقيم المقابلة، وعدّل الصياغة ليستقيم النحو دون إخلال بالمضمون.
2) لكل بند اذكر في clauseDecisions سبب إدراجه أو استبعاده وكل تعديل أجريته (edits).
3) لكل مخاطر اذكر severity وmitigation وlegalBasis (سبب قانوني أو تجاري صريح).
4) أي إشارة لتشريع أو مادة تُصاغ بين «…» حصراً إذا كانت نصاً حرفياً، وإلا تكتب بصياغتك مع بيانها في statuteCitations مع ملاحظة إن كانت خارج المصادر المسجلة.
5) لا تخترع أرقام مواد أو مراجع أحكام؛ عند الشك اكتب في note أن التحقق من المصدر الرسمي مطلوب.
6) إن نقصت معلومات جوهرية اسأل عنها في clarificationQuestions بدلاً من افتراضها.

القالب: ${template.titleAr} (${template.code}) — الاختصاص: ${template.jurisdiction}
ملاحظات الأساس القانوني لكل بند واردة بين بنود القالب.

متغيرات المقابلة:
${answersBlock || 'لا توجد'}

بنود القالب بعد تعبئة المتغيرات:
${renderedClauses}`;
}

function studioResponseSchema() {
  return {
    name: 'qatar_contract_studio_output',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        draft: { type: 'string' },
        clauseDecisions: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { code: { type: 'string' }, included: { type: 'boolean' }, reason: { type: 'string' }, edits: { type: 'string' } },
            required: ['code', 'included', 'reason', 'edits'],
          },
        },
        risks: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { title: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, mitigation: { type: 'string' }, legalBasis: { type: 'string' } },
            required: ['title', 'severity', 'mitigation', 'legalBasis'],
          },
        },
        clarificationQuestions: { type: 'array', items: { type: 'string' } },
        statuteCitations: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { label: { type: 'string' }, note: { type: 'string' } },
            required: ['label', 'note'],
          },
        },
      },
      required: ['draft', 'clauseDecisions', 'risks', 'clarificationQuestions', 'statuteCitations'],
    },
  };
}

function buildStudioUserMessage(instructions?: string) {
  if (!instructions) return 'أعد مسودة العقد الآن.';
  return `أعد مسودة العقد الآن.

تعليمات إضافية من المحامي:
${instructions}`;
}

export const generateContractInput = z.object({
  accessToken: z.string().min(20),
  templateCode: z.string().min(3).max(80),
  title: z.string().min(3).max(160),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  answers: z.record(z.string(), z.string().max(2000)),
  instructions: z.string().max(3000).optional(),
  includedOptionalClauses: z.array(z.string()).default([]),
});

export async function generateContractDraft(input: z.infer<typeof generateContractInput>, deps: StudioDeps = {}): Promise<GeneratedContract> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'استديو العقود متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);

  const templates = await listContractTemplates({ accessToken: input.accessToken }, deps);
  const template = templates.find(item => item.code === input.templateCode);
  if (!template) throw new Error('القالب المطلوب غير متاح أو غير مفعل.');

  const missing = template.variables
    .filter(variable => variable.required)
    .filter(variable => !input.answers[variable.key]?.trim());
  if (missing.length) throw new Error(`يلزم استكمال المتغيرات الإلزامية: ${missing.map(variable => variable.label_ar).join('، ')}`);

  const activeClauses = template.clauses.filter(clause => !clause.isOptional || input.includedOptionalClauses.includes(clause.code));
  const renderedClauses = activeClauses
    .map(clause => `### بند ${clause.titleAr} (code: ${clause.code}, risk: ${clause.riskLevel})\n${renderTemplate(clause.bodyTemplate, input.answers)}\n[الأساس القانوني: ${clause.legalBasisNote ?? 'غير محدد'}]`)
    .join('\n\n');

  const content = await callChatCompletion({
    temperature: 0.25,
    response_format: { type: 'json_schema', json_schema: studioResponseSchema() },
    messages: [
      { role: 'system', content: studioSystemPrompt(template, renderedClauses, input.answers) },
      { role: 'user', content: buildStudioUserMessage(input.instructions) },
    ],
  }, fetchImpl);
  if (!content) throw new Error('لم تُرجع خدمة الذكاء الاصطناعي مسودة صالحة.');

  const parsed = generationSchema.parse(JSON.parse(content));
  const verification = await verifyStatuteQuotes(parsed.draft, input.accessToken, fetchImpl);

  const citations: StatuteCitation[] = [
    ...parsed.statuteCitations.map(citation => ({ label: citation.label, verifiedAgainstRegister: false, note: citation.note })),
    ...verification.citations.filter(citation => citation.verifiedAgainstRegister),
  ];

  const clauseDecisions: ClauseDecision[] = parsed.clauseDecisions
    .filter(decision => activeClauses.some(clause => clause.code === decision.code))
    .map(decision => ({
      code: decision.code,
      title: activeClauses.find(clause => clause.code === decision.code)?.titleAr ?? decision.code,
      included: decision.included,
      reason: decision.reason,
      edits: decision.edits,
    }));

  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const documentResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_documents`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId ?? null,
      client_id: input.clientId ?? null,
      template_id: template.id,
      title: input.title,
      status: 'draft',
      current_version: 1,
      created_by: profile.id,
    }),
  });
  const documents = await readResponse<Array<{ id: string }>>(documentResponse);
  const document = documents[0];
  if (!document) throw new Error('تعذر إنشاء سجل مستند العقد.');

  const versionResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_document_versions`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      document_id: document.id,
      version_number: 1,
      content: parsed.draft,
      clause_registry: clauseDecisions,
      risks: parsed.risks,
      citations,
      clarification_questions: parsed.clarificationQuestions,
      created_by: profile.id,
    }),
  });
  if (!versionResponse.ok) throw new Error('تعذر حفظ النسخة الأولى من مسودة العقد.');

  return {
    documentId: document.id,
    version: 1,
    draft: parsed.draft,
    clauseDecisions,
    risks: parsed.risks,
    clarificationQuestions: parsed.clarificationQuestions,
    statuteCitations: citations,
    verification: { unverifiedQuotes: verification.unverifiedQuotes, passed: verification.unverifiedQuotes.length === 0 },
  };
}

export const saveVersionInput = z.object({
  accessToken: z.string().min(20),
  documentId: z.string().uuid(),
  content: z.string().min(20).max(80000),
  clauseRegistry: z.array(z.object({ code: z.string(), title: z.string(), included: z.boolean(), reason: z.string(), edits: z.string() })).default([]),
  risks: z.array(z.object({ title: z.string(), severity: z.enum(['مرتفع', 'متوسط', 'منخفض']), mitigation: z.string(), legalBasis: z.string() })).default([]),
});

export async function saveContractVersion(input: z.infer<typeof saveVersionInput>, deps: StudioDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl));
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const docsResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_documents?id=eq.${input.documentId}&select=id,status,office_id,current_version`, { headers });
  const docs = await readResponse<Array<{ id: string; status: ContractStatus; office_id: string; current_version: number }>>(docsResponse);
  const doc = docs[0];
  if (!doc) throw new Error('مستند العقد غير موجود.');
  if (doc.office_id !== profile.office_id) throw new Error('هذا المستند خارج نطاق مكتبك.');
  if (doc.status === 'approved' || doc.status === 'ready_for_export') {
    throw new Error('المستند معتمد أو جاهز للتصدير ولا يقبل تحرير نسخ جديدة؛ أعده إلى المراجعة أولاً بموافقة مدير المكتب.');
  }

  const nextVersion = doc.current_version + 1;
  const insertResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_document_versions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      document_id: input.documentId,
      version_number: nextVersion,
      content: input.content,
      clause_registry: input.clauseRegistry,
      risks: input.risks,
      created_by: profile.id,
    }),
  });
  if (!insertResponse.ok) {
    const detail = await insertResponse.text();
    throw new Error(`تعذر حفظ النسخة الجديدة: ${detail.slice(0, 200)}`);
  }
  const updateResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_documents?id=eq.${input.documentId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ current_version: nextVersion, updated_at: new Date().toISOString() }),
  });
  if (!updateResponse.ok) throw new Error('تعذر تحديث رقم النسخة الحالية.');

  return { documentId: input.documentId, version: nextVersion };
}

export const transitionInput = z.object({
  accessToken: z.string().min(20),
  documentId: z.string().uuid(),
  to: z.enum(CONTRACT_STATUSES),
  note: z.string().max(600).optional(),
});

export async function transitionContract(input: z.infer<typeof transitionInput>, deps: StudioDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'اعتماد المستندات متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const docsResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_documents?id=eq.${input.documentId}&select=id,status,office_id`, { headers });
  const docs = await readResponse<Array<{ id: string; status: ContractStatus; office_id: string }>>(docsResponse);
  const doc = docs[0];
  if (!doc) throw new Error('مستند العقد غير موجود.');
  if (doc.office_id !== profile.office_id) throw new Error('هذا المستند خارج نطاق مكتبك.');
  if (!canTransition(doc.status, input.to)) {
    throw new Error(`انتقال غير مسموح من «${CONTRACT_STATUS_LABELS[doc.status]}» إلى «${CONTRACT_STATUS_LABELS[input.to]}».`);
  }

  const patchResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_documents?id=eq.${input.documentId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: input.to, updated_at: new Date().toISOString() }),
  });
  if (!patchResponse.ok) throw new Error('تعذر تحديث حالة المستند.');

  const eventResponse = await fetchImpl(`${baseUrl}/rest/v1/contract_approval_events`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      document_id: input.documentId,
      actor_id: profile.id,
      from_status: doc.status,
      to_status: input.to,
      note: input.note ?? null,
    }),
  });
  if (!eventResponse.ok) throw new Error('تعذر تسجيل حدث الاعتماد.');

  return { documentId: input.documentId, status: input.to };
}
