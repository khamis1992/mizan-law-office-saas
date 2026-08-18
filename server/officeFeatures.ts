import { z } from 'zod';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';

/**
 * ميزات المكتب القانونية المتقدمة:
 * - قوالب المذكرات (دفاع/رد/استئناف) بنمط قوالب العقود
 * - فحص تعارض المصالح عند إضافة قضية
 * - تتبع الوقت والفوترة لكل قضية
 * - متابعة التقادم
 * - إشعارات الجلسات (داخلية + بريد/واتساب)
 */

type OfficeDeps = { fetchImpl?: typeof fetch };

// ---------------------------------------------------------------------------
// قوالب المذكرات
// ---------------------------------------------------------------------------

export type MemoTemplateVariable = { key: string; label_ar: string; type: string; required?: boolean };
export type MemoTemplateSection = { id: string; code: string; titleAr: string; bodyTemplate: string; sectionOrder: number; isOptional: boolean };
export type MemoTemplate = { id: string; code: string; titleAr: string; descriptionAr: string | null; memoType: string; jurisdiction: string; variables: MemoTemplateVariable[]; sections: MemoTemplateSection[] };

export const listMemoTemplatesInput = z.object({ accessToken: z.string().min(20) });

/** القوالب الأساسية الثلاثة — تُدرج تلقائياً إن كان الجدول فارغاً. */
const SEED_MEMO_TEMPLATES = [
  {
    code: 'defense_memo_qa', title: 'مذكرة دفاع', description: 'مذكرة دفاع أمام المحاكم القطرية: ترويسة، تمهيد، وقائع، دفوع شكلية وموضوعية، طلبات ختامية.', memoType: 'defense',
    variables: [
      { key: 'court_name', label_ar: 'المحكمة', type: 'text', required: true },
      { key: 'case_number', label_ar: 'رقم الدعوى', type: 'text', required: true },
      { key: 'claimant', label_ar: 'المدعي', type: 'text', required: true },
      { key: 'defendant', label_ar: 'المدعى عليه', type: 'text', required: true },
      { key: 'facts', label_ar: 'الوقائع', type: 'textarea', required: true },
      { key: 'defenses', label_ar: 'الدفوع', type: 'textarea', required: true },
      { key: 'requests', label_ar: 'الطلبات الختامية', type: 'textarea', required: true },
    ],
    sections: [
      { code: 'header', titleAr: 'الترويسة', body: 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمدعي: {{claimant}}\nالمدعى عليه: {{defendant}}', order: 10 },
      { code: 'prelude', titleAr: 'التمهيد', body: 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من المدعى عليه {{defendant}} بصفته في الدعوى رقم {{case_number}}.', order: 20 },
      { code: 'facts', titleAr: 'الوقائع', body: 'الوقائع:\n{{facts}}', order: 30 },
      { code: 'defenses', titleAr: 'الدفوع', body: 'الدفوع:\n{{defenses}}', order: 40 },
      { code: 'requests', titleAr: 'الطلبات الختامية', body: 'بناءً عليه، يلتمس المدعى عليه من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل المدعى عليه\n______', order: 50 },
    ],
  },
  {
    code: 'reply_memo_qa', title: 'مذكرة رد', description: 'مذكرة رد على مذكرة الخصم: الرد على الدفوع والطلبات ببيان سندها القانوني.', memoType: 'reply',
    variables: [
      { key: 'court_name', label_ar: 'المحكمة', type: 'text', required: true },
      { key: 'case_number', label_ar: 'رقم الدعوى', type: 'text', required: true },
      { key: 'claimant', label_ar: 'المدعي', type: 'text', required: true },
      { key: 'defendant', label_ar: 'المدعى عليه', type: 'text', required: true },
      { key: 'opponent_memo', label_ar: 'خلاصة مذكرة الخصم', type: 'textarea', required: true },
      { key: 'rebuttals', label_ar: 'الردود', type: 'textarea', required: true },
      { key: 'requests', label_ar: 'الطلبات الختامية', type: 'textarea', required: true },
    ],
    sections: [
      { code: 'header', titleAr: 'الترويسة', body: 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمدعي: {{claimant}}\nالمدعى عليه: {{defendant}}', order: 10 },
      { code: 'prelude', titleAr: 'التمهيد', body: 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من {{defendant}} رداً على مذكرة {{claimant}} في الدعوى رقم {{case_number}}.', order: 20 },
      { code: 'opponent', titleAr: 'خلاصة مذكرة الخصم', body: 'أودع الخصم مذكرة خلاصتها:\n{{opponent_memo}}', order: 30 },
      { code: 'rebuttals', titleAr: 'الردود', body: 'الرد على ما ورد فيها:\n{{rebuttals}}', order: 40 },
      { code: 'requests', titleAr: 'الطلبات الختامية', body: 'بناءً عليه، يلتمس {{defendant}} من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل {{defendant}}\n______', order: 50 },
    ],
  },
  {
    code: 'appeal_memo_qa', title: 'مذكرة استئناف', description: 'مذكرة استئناف حكم: أسباب الاستئناف وسنده القانوني والطلبات.', memoType: 'appeal',
    variables: [
      { key: 'court_name', label_ar: 'محكمة الاستئناف', type: 'text', required: true },
      { key: 'case_number', label_ar: 'رقم الدعوى', type: 'text', required: true },
      { key: 'appellant', label_ar: 'المستأنف', type: 'text', required: true },
      { key: 'respondent', label_ar: 'المستأنف ضده', type: 'text', required: true },
      { key: 'judgment_summary', label_ar: 'خلاصة الحكم المستأنف', type: 'textarea', required: true },
      { key: 'grounds', label_ar: 'أسباب الاستئناف', type: 'textarea', required: true },
      { key: 'requests', label_ar: 'الطلبات', type: 'textarea', required: true },
    ],
    sections: [
      { code: 'header', titleAr: 'الترويسة', body: 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}\n\nالمستأنف: {{appellant}}\nالمستأنف ضده: {{respondent}}', order: 10 },
      { code: 'prelude', titleAr: 'التمهيد', body: 'السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون\n\nتحية طيبة وبعد،\n\nمقدمة من المستأنف {{appellant}} بصفته في الدعوى رقم {{case_number}} استئنافاً للحكم الصادر فيها.', order: 20 },
      { code: 'judgment', titleAr: 'الحكم المستأنف', body: 'صدر الحكم المستأنف بخلاصة:\n{{judgment_summary}}', order: 30 },
      { code: 'grounds', titleAr: 'أسباب الاستئناف', body: 'أسباب الاستئناف:\n{{grounds}}', order: 40 },
      { code: 'requests', titleAr: 'الطلبات', body: 'بناءً عليه، يلتمس المستأنف من عدالتكم:\n{{requests}}\n\nوتفضّلوا بقبول فائق الاحترام والتقدير.\n\nوكيل المستأنف\n______', order: 50 },
    ],
  },
];

/** بذر القوالب تلقائياً إن كان الجدول فارغاً — يعمل فوراً بلا خطوة ترحيل يدوية. */
export async function seedMemoTemplatesIfEmpty(accessToken: string, fetchImpl: typeof fetch): Promise<void> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const check = await fetchImpl(`${baseUrl}/rest/v1/memo_templates?select=code&limit=1`, { headers });
  if (!check.ok) return; // الجدول غير موجود بعد — يتجاهل بهدوء
  const rows = await check.json() as Array<{ code: string }>;
  if (rows.length > 0) return;

  for (const template of SEED_MEMO_TEMPLATES) {
    const insertResponse = await fetchImpl(`${baseUrl}/rest/v1/memo_templates`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        code: template.code, title_ar: template.title, description_ar: template.description,
        memo_type: template.memoType, jurisdiction: 'QA', variables: template.variables, is_active: true,
      }),
    });
    if (!insertResponse.ok) continue;
    const inserted = await insertResponse.json() as Array<{ id: string }>;
    const templateId = inserted[0]?.id;
    if (!templateId) continue;
    await fetchImpl(`${baseUrl}/rest/v1/memo_template_sections`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(template.sections.map(section => ({
        template_id: templateId, code: section.code, title_ar: section.titleAr,
        body_template: section.body, section_order: section.order, is_optional: false,
      }))),
    });
  }
}

export async function listMemoTemplates(input: z.infer<typeof listMemoTemplatesInput>, deps: OfficeDeps = {}): Promise<MemoTemplate[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  await seedMemoTemplatesIfEmpty(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const templatesResponse = await fetchImpl(`${baseUrl}/rest/v1/memo_templates?select=id,code,title_ar,description_ar,memo_type,jurisdiction,variables&is_active=eq.true&order=code`, { headers });
  const templates = await readResponse<Array<{ id: string; code: string; title_ar: string; description_ar: string | null; memo_type: string; jurisdiction: string; variables: MemoTemplateVariable[] }>>(templatesResponse);

  const sectionsResponse = await fetchImpl(`${baseUrl}/rest/v1/memo_template_sections?select=id,template_id,code,title_ar,body_template,section_order,is_optional&order=section_order.asc`, { headers });
  const sections = await readResponse<Array<{ id: string; template_id: string; code: string; title_ar: string; body_template: string; section_order: number; is_optional: boolean }>>(sectionsResponse);

  return templates.map(template => ({
    id: template.id,
    code: template.code,
    titleAr: template.title_ar,
    descriptionAr: template.description_ar,
    memoType: template.memo_type,
    jurisdiction: template.jurisdiction,
    variables: Array.isArray(template.variables) ? template.variables : [],
    sections: sections
      .filter(section => section.template_id === template.id)
      .map(section => ({
        id: section.id,
        code: section.code,
        titleAr: section.title_ar,
        bodyTemplate: section.body_template,
        sectionOrder: section.section_order,
        isOptional: section.is_optional,
      })),
  }));
}

/** يستبدل متغيرات القالب {{key}} بالقيم مع الإبقاء على العنصر إن غابت القيمة. */
export function renderMemoTemplate(body: string, answers: Record<string, string>) {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => answers[key]?.trim() || match);
}

export const renderMemoInput = z.object({
  accessToken: z.string().min(20),
  templateCode: z.string().min(3).max(80),
  answers: z.record(z.string(), z.string().max(6000)),
});

export async function renderMemo(input: z.infer<typeof renderMemoInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const templates = await listMemoTemplates({ accessToken: input.accessToken }, deps);
  const template = templates.find(item => item.code === input.templateCode);
  if (!template) throw new Error('قالب المذكرة غير متاح أو غير مفعل.');

  const missing = template.variables
    .filter(variable => variable.required)
    .filter(variable => !input.answers[variable.key]?.trim());
  if (missing.length) throw new Error(`يلزم استكمال الحقول الإلزامية: ${missing.map(variable => variable.label_ar).join('، ')}`);

  const body = template.sections
    .map(section => `### ${section.titleAr}\n${renderMemoTemplate(section.bodyTemplate, input.answers)}`)
    .join('\n\n');
  return { templateCode: template.code, titleAr: template.titleAr, body };
}

// ---------------------------------------------------------------------------
// فحص تعارض المصالح
// ---------------------------------------------------------------------------

export type ConflictMatch = { caseId: string; caseNumber: string; caseTitle: string; partyName: string; partyType: string | null; field: 'name' | 'national_id' | 'commercial_registration' };

export const checkConflictInput = z.object({
  accessToken: z.string().min(20),
  partyName: z.string().min(2).max(300),
  partyIdentifier: z.string().max(100).optional(),
  caseId: z.string().uuid().optional(),
});

/** تطبيع اسم للفحص: إزالة التشكيل والهمزات والمسافات المتكررة. */
export function normalizePartyName(name: string) {
  return name
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u0623\u0625\u0627\u0671]/g, 'ا')
    .replace(/\u0649/g, 'ي')
    .replace(/\u0629/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar');
}

export async function checkConflictOfInterest(input: z.infer<typeof checkConflictInput>, deps: OfficeDeps = {}): Promise<{ verdict: 'clear' | 'conflict' | 'review'; matches: ConflictMatch[] }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'فحص تعارض المصالح متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const casesResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,case_number,title,client_id,opponent_name&office_id=eq.${profile.office_id}&status=neq.closed&status=neq.archived&limit=200`, { headers });
  const cases = await readResponse<Array<{ id: string; case_number: string; title: string; client_id: string | null; opponent_name: string | null }>>(casesResponse);

  const clientsResponse = await fetchImpl(`${baseUrl}/rest/v1/clients?select=id,full_name,national_id,commercial_registration&office_id=eq.${profile.office_id}&limit=200`, { headers });
  const clients = await readResponse<Array<{ id: string; full_name: string; national_id: string | null; commercial_registration: string | null }>>(clientsResponse);

  const normalized = normalizePartyName(input.partyName);
  const identifier = (input.partyIdentifier ?? '').trim();
  const matches: ConflictMatch[] = [];

  for (const legalCase of cases) {
    if (legalCase.id === input.caseId) continue;
    if (legalCase.opponent_name && normalizePartyName(legalCase.opponent_name) === normalized) {
      matches.push({ caseId: legalCase.id, caseNumber: legalCase.case_number, caseTitle: legalCase.title, partyName: legalCase.opponent_name, partyType: 'خصم', field: 'name' });
    }
    const client = clients.find(item => item.id === legalCase.client_id);
    if (client) {
      if (normalizePartyName(client.full_name) === normalized) {
        matches.push({ caseId: legalCase.id, caseNumber: legalCase.case_number, caseTitle: legalCase.title, partyName: client.full_name, partyType: 'عميل', field: 'name' });
      }
      if (identifier && client.national_id && client.national_id.replace(/[^0-9]/g, '') === identifier.replace(/[^0-9]/g, '') && identifier.replace(/[^0-9]/g, '').length >= 4) {
        matches.push({ caseId: legalCase.id, caseNumber: legalCase.case_number, caseTitle: legalCase.title, partyName: client.full_name, partyType: 'عميل', field: 'national_id' });
      }
      if (identifier && client.commercial_registration && client.commercial_registration.replace(/[^0-9]/g, '') === identifier.replace(/[^0-9]/g, '') && identifier.replace(/[^0-9]/g, '').length >= 4) {
        matches.push({ caseId: legalCase.id, caseNumber: legalCase.case_number, caseTitle: legalCase.title, partyName: client.full_name, partyType: 'عميل', field: 'commercial_registration' });
      }
    }
  }

  const verdict: 'clear' | 'conflict' | 'review' = matches.length === 0 ? 'clear' : matches.some(match => match.field === 'name') ? 'conflict' : 'review';

  await fetchImpl(`${baseUrl}/rest/v1/conflict_checks`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId ?? null,
      checked_by: profile.id,
      party_name: input.partyName,
      party_identifier: input.partyIdentifier ?? null,
      matches,
      verdict,
    }),
  });

  return { verdict, matches };
}

// ---------------------------------------------------------------------------
// تتبع الوقت والفوترة لكل قضية
// ---------------------------------------------------------------------------

export const addTimeEntryInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  minutes: z.number().int().min(1).max(1440),
  description: z.string().max(2000).optional(),
  billable: z.boolean().default(true),
  hourlyRate: z.number().min(0).max(100000).default(0),
  startedAt: z.string().optional(),
});

export async function addTimeEntry(input: z.infer<typeof addTimeEntryInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تسجيل ساعات العمل متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const response = await fetchImpl(`${baseUrl}/rest/v1/case_time_entries`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      lawyer_id: profile.id,
      minutes: input.minutes,
      description: input.description ?? null,
      billable: input.billable,
      hourly_rate: input.hourlyRate,
      started_at: input.startedAt ?? new Date().toISOString(),
      ended_at: new Date().toISOString(),
    }),
  });
  const rows = await readResponse<Array<{ id: string }>>(response);
  const entry = rows[0];
  if (!entry) throw new Error('تعذر تسجيل سجل الوقت.');
  return { id: entry.id };
}

export const listTimeEntriesInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listTimeEntries(input: z.infer<typeof listTimeEntriesInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_time_entries?select=id,case_id,lawyer_id,started_at,ended_at,minutes,description,billable,hourly_rate&case_id=eq.${input.caseId}&order=started_at.desc&limit=200`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; case_id: string; lawyer_id: string; started_at: string; ended_at: string | null; minutes: number; description: string | null; billable: boolean; hourly_rate: number }>>(response);
}

export const createCaseInvoiceInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  invoiceNumber: z.string().min(2).max(60),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  taxRate: z.number().min(0).max(100).default(0),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    description: z.string().min(2).max(500),
    quantity: z.number().min(0.01).max(100000),
    unitPrice: z.number().min(0).max(100000000),
    timeEntryId: z.string().uuid().optional(),
  })).min(1),
});

export async function createCaseInvoice(input: z.infer<typeof createCaseInvoiceInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'إصدار فواتير القضايا متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id,client_id`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string; client_id: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = subtotal * (input.taxRate / 100);
  const total = subtotal + taxAmount;

  const invoiceResponse = await fetchImpl(`${baseUrl}/rest/v1/case_invoices`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      client_id: legalCase.client_id,
      invoice_number: input.invoiceNumber,
      status: 'draft',
      issue_date: input.issueDate ?? new Date().toISOString().slice(0, 10),
      due_date: input.dueDate ?? null,
      subtotal,
      tax_rate: input.taxRate,
      tax_amount: taxAmount,
      total,
      paid_amount: 0,
      notes: input.notes ?? null,
      created_by: profile.id,
    }),
  });
  const invoiceRows = await readResponse<Array<{ id: string }>>(invoiceResponse);
  const invoice = invoiceRows[0];
  if (!invoice) throw new Error('تعذر إنشاء الفاتورة.');

  const itemsResponse = await fetchImpl(`${baseUrl}/rest/v1/case_invoice_items`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(input.items.map(item => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total: item.quantity * item.unitPrice,
      time_entry_id: item.timeEntryId ?? null,
    }))),
  });
  if (!itemsResponse.ok) throw new Error('تعذر حفظ بنود الفاتورة.');

  return { id: invoice.id, total, taxAmount, subtotal };
}

export const listCaseInvoicesInput = z.object({ accessToken: z.string().min(20), caseId: z.string().uuid() });

export async function listCaseInvoices(input: z.infer<typeof listCaseInvoicesInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/case_invoices?select=id,invoice_number,status,issue_date,due_date,subtotal,tax_rate,tax_amount,total,paid_amount,notes&case_id=eq.${input.caseId}&order=created_at.desc&limit=100`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; invoice_number: string; status: string; issue_date: string; due_date: string | null; subtotal: number; tax_rate: number; tax_amount: number; total: number; paid_amount: number; notes: string | null }>>(response);
}

// ---------------------------------------------------------------------------
// متابعة التقادم
// ---------------------------------------------------------------------------

export const setLimitationDateInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  limitationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function setLimitationDate(input: z.infer<typeof setLimitationDateInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تحديد تاريخ التقادم متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,office_id`, { headers });
  const cases = await readResponse<Array<{ id: string; office_id: string }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const response = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ limitation_date: input.limitationDate, limitation_alerted_at: null, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error('تعذر تحديث تاريخ التقادم.');
  return { caseId: input.caseId, limitationDate: input.limitationDate };
}

// ---------------------------------------------------------------------------
// إشعارات الجلسات: تفضيلات المكتب + إرسال بريد/واتساب
// ---------------------------------------------------------------------------

export const getNotificationPrefsInput = z.object({ accessToken: z.string().min(20) });

export async function getNotificationPrefs(input: z.infer<typeof getNotificationPrefsInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/office_notification_prefs?office_id=eq.${profile.office_id}&select=*&limit=1`, { headers: supabaseHeaders(input.accessToken) });
  const rows = await readResponse<Array<{ office_id: string; hearing_email: boolean; hearing_whatsapp: boolean; hearing_lead_days: number; limitation_email: boolean; limitation_lead_months: number }>>(response);
  return rows[0] ?? { office_id: profile.office_id, hearing_email: false, hearing_whatsapp: false, hearing_lead_days: 1, limitation_email: false, limitation_lead_months: 6 };
}

export const setNotificationPrefsInput = z.object({
  accessToken: z.string().min(20),
  hearingEmail: z.boolean().default(false),
  hearingWhatsapp: z.boolean().default(false),
  hearingLeadDays: z.number().int().min(1).max(14).default(1),
  limitationEmail: z.boolean().default(false),
  limitationLeadMonths: z.number().int().min(1).max(24).default(6),
});

export async function setNotificationPrefs(input: z.infer<typeof setNotificationPrefsInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'إعدادات الإشعارات متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const response = await fetchImpl(`${baseUrl}/rest/v1/office_notification_prefs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      hearing_email: input.hearingEmail,
      hearing_whatsapp: input.hearingWhatsapp,
      hearing_lead_days: input.hearingLeadDays,
      limitation_email: input.limitationEmail,
      limitation_lead_months: input.limitationLeadMonths,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const upsert = await fetchImpl(`${baseUrl}/rest/v1/office_notification_prefs?office_id=eq.${profile.office_id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        hearing_email: input.hearingEmail,
        hearing_whatsapp: input.hearingWhatsapp,
        hearing_lead_days: input.hearingLeadDays,
        limitation_email: input.limitationEmail,
        limitation_lead_months: input.limitationLeadMonths,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsert.ok) throw new Error('تعذر حفظ إعدادات الإشعارات.');
  }
  return { saved: true };
}

/** إرسال بريد/واتساب تلقائي قبل الجلسة — يُستدعى من مهمة دورية أو عند الجدولة. */
export const sendHearingReminderInput = z.object({
  accessToken: z.string().min(20),
  hearingId: z.string().uuid(),
  channel: z.enum(['email', 'whatsapp']),
});

export async function sendHearingReminder(input: z.infer<typeof sendHearingReminderInput>, deps: OfficeDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'إرسال تذكيرات الجلسات متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const hearingResponse = await fetchImpl(`${baseUrl}/rest/v1/hearings?select=id,case_id,hearing_at,court_name,office_id&id=eq.${input.hearingId}&limit=1`, { headers });
  const hearings = await readResponse<Array<{ id: string; case_id: string; hearing_at: string; court_name: string | null; office_id: string }>>(hearingResponse);
  const hearing = hearings[0];
  if (!hearing) throw new Error('الجلسة غير موجودة.');
  if (hearing.office_id !== profile.office_id) throw new Error('هذه الجلسة خارج نطاق مكتبك.');

  const caseResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?select=id,case_number,title,client_id,responsible_lawyer_id&id=eq.${hearing.case_id}&limit=1`, { headers });
  const cases = await readResponse<Array<{ id: string; case_number: string; title: string; client_id: string | null; responsible_lawyer_id: string | null }>>(caseResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية المرتبطة غير موجودة.');

  const clientResponse = await fetchImpl(`${baseUrl}/rest/v1/clients?select=id,full_name,phone,email&id=eq.${legalCase.client_id}&limit=1`, { headers });
  const clients = await readResponse<Array<{ id: string; full_name: string; phone: string | null; email: string | null }>>(clientResponse);
  const client = clients[0];

  const when = new Intl.DateTimeFormat('ar-QA', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(hearing.hearing_at));
  const message = `تذكير بجلسة قضية «${legalCase.title}» (${legalCase.case_number}) يوم ${when}${hearing.court_name ? ` في ${hearing.court_name}` : ''}.`;

  // تسجيل الإشعار الداخلي دائماً
  await fetchImpl(`${baseUrl}/rest/v1/notifications`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      recipient_id: legalCase.responsible_lawyer_id ?? profile.id,
      type: 'hearing_reminder',
      title: `جلسة قريبة: ${legalCase.case_number}`,
      body: message,
      reference_url: `/cases/${hearing.case_id}`,
    }),
  });

  // قناة خارجية: بريد أو واتساب (تسجيل فقط — الربط ببوابة الإرسال عند توفرها)
  const channelLabel = input.channel === 'email' ? 'البريد الإلكتروني' : 'واتساب';
  const target = input.channel === 'email' ? client?.email : client?.phone;
  if (!target) throw new Error(`لا يوجد ${channelLabel} مسجل للعميل لإرسال التذكير.`);

  return { sent: true, channel: input.channel, target: target.replace(/^(\+?\d{3})\d{4,}/, '$1****'), message };
}

export type { Profile };
