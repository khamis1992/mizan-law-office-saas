import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { aiModelName, aiProviderName, callChatCompletion, callVisionCompletion } from './aiClient';
import { assertAiQuota } from './aiQuota';
import { verifyCitations, type CitationVerification } from './citationGate';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { extractSearchTerms, applyPreferenceBoost, rankSections } from './retrieval';

/**
 * التحليل الافتتاحي الذكي للقضية — قلب «النظام الذكي لا الأرشيفي»:
 * 1) قراءة أوراق الدعوى المصورة بالرؤية (أو وصف الوقائع النصي)
 * 2) استخراج الدعاوى والوقائع والأطراف والمسائل القانونية
 * 3) استرجاع القوانين من قاعدة المصادر الموثقة (ts_rank) والسوابق الموثقة
 * 4) بناء القوانين المنطبقة والدفوع والثغرات ومسودة المذكرة — كل اقتباس يمر ببوابة التحقق
 * 5) حفظ النتيجة في case_intake_analyses وتسجيل الاستهلاك في assistant_runs
 */

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;
const MAX_DOC_TEXT = 60000;

export const caseIntakeInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  extraNotes: z.string().max(6000).optional(),
});

export type IntakeLaw = { title: string; articleNumber: string | null; url: string; why: string; body: string };
export type IntakePrecedent = { title: string; referenceNumber: string | null; url: string; why: string };
export type IntakeDefense = { heading: string; argument: string; strength: 'مرتفع' | 'متوسط' | 'منخفض' };
export type IntakeGap = { gap: string; severity: 'مرتفع' | 'متوسط' | 'منخفض'; mitigation: string };

export type IntakeResult = {
  hasImages: boolean;
  analyzedFiles: number;
  claimsSummary: string;
  parties: string[];
  keyFacts: string[];
  legalIssues: string[];
  relevantLaws: IntakeLaw[];
  similarPrecedents: IntakePrecedent[];
  defenses: IntakeDefense[];
  gaps: IntakeGap[];
  memoDraft: string;
  followUps: string[];
  verification: CitationVerification;
  limitations: string;
};

const readingSchema = z.object({
  claimsSummary: z.string(),
  parties: z.array(z.string()),
  keyFacts: z.array(z.string()),
  legalIssues: z.array(z.string()),
});

const strategySchema = z.object({
  relevantLaws: z.array(z.object({
    title: z.string(),
    articleNumber: z.string().nullable(),
    why: z.string(),
  })),
  similarPrecedents: z.array(z.object({
    title: z.string(),
    referenceNumber: z.string().nullable(),
    why: z.string(),
  })),
  defenses: z.array(z.object({
    heading: z.string(),
    argument: z.string(),
    strength: z.enum(['مرتفع', 'متوسط', 'منخفض']),
  })),
  gaps: z.array(z.object({
    gap: z.string(),
    severity: z.enum(['مرتفع', 'متوسط', 'منخفض']),
    mitigation: z.string(),
  })),
  memoDraft: z.string(),
  followUps: z.array(z.string()),
});

function readingSystemPrompt() {
  return `أنت محلل قضائي قطري خبير تقرأ أوراق الدعوى (صور صحيفة الدعوى ومرفقاتها) أو وصف الوقائع، وتستخرج بدقة:
- claimsSummary: ملخص الدعاوى وطلبات الخصوم بلغة قانونية محايدة
- parties: الأطراف وأوصافهم الإجرائية (مدعٍ، مدعى عليه، نيابة…)
- keyFacts: الوقائع الجوهرية المرتبة زمنياً
- legalIssues: المسائل القانونية المطروحة (بدون استناد لمواد محددة هنا)
اقرأ الأوراق كما هي ولاخترع ما لا يوجد فيها؛ ما لا يمكن قراءته اذكره ضمن keyFacts كنقطة يلزم استكمالها.`;
}

function strategySystemPrompt() {
  return `أنت محامٍ مدافع قطري خبير في صياغة مذكرات الدفاع أمام المحاكم القطرية، تعدّ مسودة مذكرة دفاع احترافية كاملة البنية وفق الأعراف القضائية المتبعة (والتي تأثرت بالمدرسة المصرية العريقة في فن المرافعات).

البنية الإلزامية للمذكرة (memoDraft) — لا تخرج عنها:
1) الترويسة: اسم المحكمة والدائرة إن وردت، رقم الدعوى، ثم أطراف الدعوى بصفاتهم الإجرائية (مدعٍ، مدعى عليه، متهم، نيابة عامة…).
2) التمهيد: «السيد رئيس المحكمة الموقر / السادة أعضاء المحكمة الموقرون» ثم «تحية طيبة وبعد» ثم جملة «مقدمة من … بصفته … في الدعوى رقم …».
3) الوقائع: سرد موجز منظم لوقائع الدعوى كما وردت في الأوراق، مرتباً زمنياً، بلغة محايدة دون تعليق، مع الإشارة إلى صحيفة الدعوى ومرفقاتها.
4) الدفوع: مرتبة ومقسمة بوضوح:
   - الدفوع الشكلية أولاً إن وُجد مبرر لها (عدم اختصاص، عدم قبول، انعدام الصفة، سقوط الخصومة…).
   - ثم الدفوع الموضوعية، كل دفع بعنوان مرقم (أولاً، ثانياً، ثالثاً…) مع بيان سنده القانوني من المواد المقدمة بين «…» بنصها دون تغيير، والربط بين الوقائع والنص القانوني، ثم التعليق على أدلة الخصم.
5) الطلبات الختامية: «بناءً عليه، يلتمس المدعى عليه من عدالتكم:» ثم طلبات مرقمة ومحددة وقابلة للتنفيذ، وتُختم بطلب إلزام الخصم بالمصروفات ومقابل أتعاب المحاماة.
6) الخاتمة: «وتفضلوا بقبول فائق الاحترام والتقدير» ثم سطر «وكيل المدعى عليه» واسم المحامي يُترك فارغاً (______) والتاريخ يُترك فارغاً.

القواعد الملزمة الأخرى:
1) relevantLaws: اختر من المصادر المقدمة أدناه فقط؛ انقل عنوانها ورقم مادتها كما هو، واذكر why باختصار. لا تخترع مادة أو رقمًا.
2) similarPrecedents: من السوابق الموثقة المقدمة فقط، أو اتركه فارغاً.
3) defenses: الدفوع نفسها التي ستظهر في المذكرة، كل دفع بصياغة قانونية كاملة مع سنده، وتقييم قوة أولي من منظور مدعى عليه/وكيل موكله حسب السياق.
4) gaps: أهم الثغرات ونواقص الملف (وقائع ناقصة، مستندات مفقودة، مسائل تحتاج تحقيقاً) مع تخفيف مقترح لكل ثغرة.
5) followUps: أسئلة أو إجراءات مقترحة للخطوة التالية.
6) لا ترسل أو تعتمد أي إجراء — هذه مسودة داخلية للمحامي المراجع.`;
}

function jsonSchemaWrapper(name: string, schema: Record<string, unknown>) {
  return { name, strict: true, schema: { type: 'object', additionalProperties: false, ...schema } };
}

type SectionRow = { id: string; source_id: string; article_number: string | null; heading: string | null; body: string; title: string; source_url: string; official_number: string | null; rank: number };

async function fetchCase(accessToken: string, caseId: string, fetchImpl: typeof fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${caseId}&select=id,office_id,case_number,title,type,description,client_id,court_name`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{ id: string; office_id: string; case_number: string; title: string; type: string; description: string | null; client_id: string; court_name: string | null }>>(response);
  return rows[0] ?? null;
}

async function fetchCaseImages(accessToken: string, caseId: string, fetchImpl: typeof fetch): Promise<string[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/documents?case_id=eq.${caseId}&select=id,file_name,storage_path,mime_type&order=created_at.asc`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{ id: string; file_name: string; storage_path: string; mime_type: string | null }>>(response);
  const images: string[] = [];
  for (const row of rows) {
    if (!row.mime_type?.startsWith('image/') || images.length >= MAX_IMAGES) continue;
    const objectUrl = `${baseUrl}/storage/v1/object/legal-documents/${row.storage_path}`;
    const objectResponse = await fetchImpl(objectUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!objectResponse.ok) continue;
    const buffer = Buffer.from(await objectResponse.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) continue;
    images.push(`data:${row.mime_type};base64,${buffer.toString('base64')}`);
  }
  return images;
}

/** استخراج نص من مستندات PDF/Word المرفوعة — تُقرأ كوقائع إضافية مع الصور. */
async function fetchCaseDocumentTexts(accessToken: string, caseId: string, fetchImpl: typeof fetch): Promise<string[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/documents?case_id=eq.${caseId}&select=id,file_name,storage_path,mime_type,ocr_text&order=created_at.asc`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{ id: string; file_name: string; storage_path: string; mime_type: string | null; ocr_text: string | null }>>(response);
  const texts: string[] = [];
  for (const row of rows) {
    const mime = row.mime_type ?? '';
    const isPdf = mime === 'application/pdf' || row.file_name.toLowerCase().endsWith('.pdf');
    const isWord = mime.includes('wordprocessingml') || mime === 'application/msword' || /\.docx?$/i.test(row.file_name);
    // المستندات الممسوحة التي خضعت لـ OCR تُقرأ من نصها البصري مباشرة
    if (row.ocr_text && row.ocr_text.trim().length >= 30) {
      texts.push(`[مستند (قراءة بصرية): ${row.file_name}]\n${row.ocr_text.slice(0, MAX_DOC_TEXT)}`);
      continue;
    }
    if (!isPdf && !isWord) continue;
    const objectUrl = `${baseUrl}/storage/v1/object/legal-documents/${row.storage_path}`;
    const objectResponse = await fetchImpl(objectUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!objectResponse.ok) continue;
    const buffer = Buffer.from(await objectResponse.arrayBuffer());
    if (buffer.byteLength > MAX_DOC_BYTES) continue;
    try {
      let text = '';
      if (isPdf) {
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          text = result.text ?? '';
        } finally {
          await parser.destroy().catch(() => undefined);
        }
      } else {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value ?? '';
      }
      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 30) texts.push(`[مستند: ${row.file_name}]\n${cleaned.slice(0, MAX_DOC_TEXT)}`);
    } catch {
      // مستند غير قابل للقراءة — نتجاوزه ونكمل ببقية الملف
    }
  }
  return texts;
}

async function retrieveSources(accessToken: string, query: string, fetchImpl: typeof fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const terms = extractSearchTerms(query);
  let ranked: Array<{ id: string; sourceId: string; title: string; url: string; officialNumber: string | null; articleNumber: string | null; heading: string | null; body: string }> = [];
  if (terms.length) {
    const rpc = await fetchImpl(`${baseUrl}/rest/v1/rpc/search_legal_sections`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_query: terms.join(' '), p_limit: 8 }),
    });
    if (rpc.ok) {
      const rows = await rpc.json() as SectionRow[];
      ranked = rankSections(rows.map(row => ({ id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url, officialNumber: row.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body })), terms).map(section => ({ ...section }));
    }
  }
  const precedentResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_precedents?select=id,court_name,reference_number,title,summary,principle_text,source_url&is_verified=eq.true&limit=20`, { headers });
  const precedentRows = await readResponse<Array<{ id: string; court_name: string; reference_number: string | null; title: string; summary: string; principle_text: string | null; source_url: string }>>(precedentResponse);
  const lowerTerms = terms.map(term => term.toLocaleLowerCase('ar'));
  const precedents = precedentRows
    .map(row => ({ ...row, relevanceScore: lowerTerms.length ? lowerTerms.filter(term => `${row.title} ${row.summary} ${row.principle_text ?? ''}`.toLocaleLowerCase('ar').includes(term)).length / lowerTerms.length : 0 }))
    .filter(row => lowerTerms.length === 0 || row.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 4);
  return { ranked, precedents };
}

export async function runCaseIntake(input: z.infer<typeof caseIntakeInput>, deps: { fetchImpl?: typeof fetch } = {}): Promise<IntakeResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile: Profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'التحليل الافتتاحي متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);

  const legalCase = await fetchCase(input.accessToken, input.caseId, fetchImpl);
  if (!legalCase) throw new Error('القضية غير موجودة.');
  if (legalCase.office_id !== profile.office_id) throw new Error('هذه القضية خارج نطاق مكتبك.');

  const images = await fetchCaseImages(input.accessToken, input.caseId, fetchImpl);
  // المستندات الممسوحة (PDF بلا طبقة نصية / صور) تُقرأ بصرياً قبل التحليل
  try {
    const { ocrCaseDocuments } = await import('./ocr');
    await ocrCaseDocuments(input.accessToken, input.caseId, fetchImpl);
  } catch (error) {
    console.warn('[CaseIntake] OCR غير متاح:', error instanceof Error ? error.message : String(error));
  }
  const docTexts = await fetchCaseDocumentTexts(input.accessToken, input.caseId, fetchImpl);
  const notes = [legalCase.description, input.extraNotes].filter(Boolean).join('\n\n');
  if (!images.length && !docTexts.length && notes.trim().length < 30) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'لا توجد أوراق مصورة في الملف ولا وصف كافٍ للوقائع — ارفع صور صحيفة الدعوى أو أضف وصفاً لا يقل عن 30 حرفاً ثم أعد المحاولة.' });
  }

  // المرحلة 1: قراءة الأوراق (رؤية أو نص)
  const readingText = `رقم القضية: ${legalCase.case_number}\nالعنوان: ${legalCase.title}\nالنوع: ${legalCase.type}\n${notes ? `\nملاحظات المحامي:\n${notes}` : ''}\n\n${docTexts.length ? `\nنصوص المستندات المرفوعة (PDF/Word):\n${docTexts.join('\n\n---\n\n')}` : ''}${images.length && aiProviderName() === 'openai' ? `\n\nأرفقت (${images.length}) من أوراق الدعوى المصورة — استخرج منها بصرياً.` : ''}${images.length && aiProviderName() !== 'openai' ? `\n\n(يوجد ${images.length} صورة مرفقة لا يمكن قراءتها نصياً — لا تعتمد عليها واعتمد على النصوص والمستندات المقدمة فقط)` : ''}${!images.length && !docTexts.length ? '\n\nلا صور ولا مستندات — اعتمد على الوصف النصي أعلاه فقط.' : ''}`;
  const readingFormat = { type: 'json_schema' as const, json_schema: jsonSchemaWrapper('case_reading_output', {
    properties: {
      claimsSummary: { type: 'string' },
      parties: { type: 'array', items: { type: 'string' } },
      keyFacts: { type: 'array', items: { type: 'string' } },
      legalIssues: { type: 'array', items: { type: 'string' } },
    },
    required: ['claimsSummary', 'parties', 'keyFacts', 'legalIssues'],
  }) };
  // Grok لا يدعم الصور — نستخدم القراءة النصية فقط معه؛ الصور مرئية لـ OpenAI فقط
  const useVision = images.length > 0 && aiProviderName() === 'openai';
  const readingContent = useVision
    ? await callVisionCompletion({ system: readingSystemPrompt(), text: readingText, images, temperature: 0.1, response_format: readingFormat }, fetchImpl)
    : await callChatCompletion({ temperature: 0.1, response_format: readingFormat, messages: [{ role: 'system', content: readingSystemPrompt() }, { role: 'user', content: readingText }] }, fetchImpl);
  if (!readingContent) throw new Error('تعذرت قراءة أوراق الدعوى — أعد المحاولة أو أرفق وصفاً نصياً.');
  const reading = readingSchema.parse(JSON.parse(readingContent));

  // المرحلة 2: استرجاع المصادر الموثقة من مستخرجات القراءة
  const retrievalQuery = [reading.claimsSummary, ...reading.legalIssues, ...reading.keyFacts.slice(0, 5)].join(' ');
  const { ranked, precedents } = await retrieveSources(input.accessToken, retrievalQuery, fetchImpl);
  // محرك التعلّم: إعادة ترتيب المصادر حسب تفضيلات المكتب
  const boostedRanked = await applyPreferenceBoost(input.accessToken, ranked, fetchImpl, 'citation');

  const sourceBlock = boostedRanked.map(section => [
    `المعرّف: ${section.id}`,
    `العنوان: ${section.title}${section.articleNumber ? ` — ${section.articleNumber}` : ''}`,
    `النص: ${section.body}`,
    `الرابط: ${section.url}`,
  ].join('\n')).join('\n\n---\n\n') || 'لا توجد مواد موثقة مطابقة في قاعدة المصادر الحالية.';
  const precedentBlock = precedents.map(precedent => [
    `العنوان: ${precedent.title}`,
    `المحكمة: ${precedent.court_name} · المرجع: ${precedent.reference_number ?? 'غير منشور'}`,
    `الملخص: ${precedent.summary}`,
    `الرابط: ${precedent.source_url}`,
  ].join('\n')).join('\n\n---\n\n') || 'لا توجد سوابق موثقة مطابقة.';

  // المرحلة 3: الاستراتيجية (قوانين/سوابق/دفوع/ثغرات/مذكرة)
  const strategyFormat = { type: 'json_schema' as const, json_schema: jsonSchemaWrapper('case_strategy_output', {
    properties: {
      relevantLaws: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, articleNumber: { type: ['string', 'null'] }, why: { type: 'string' } }, required: ['title', 'articleNumber', 'why'] } },
      similarPrecedents: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, referenceNumber: { type: ['string', 'null'] }, why: { type: 'string' } }, required: ['title', 'referenceNumber', 'why'] } },
      defenses: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { heading: { type: 'string' }, argument: { type: 'string' }, strength: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] } }, required: ['heading', 'argument', 'strength'] } },
      gaps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { gap: { type: 'string' }, severity: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] }, mitigation: { type: 'string' } }, required: ['gap', 'severity', 'mitigation'] } },
      memoDraft: { type: 'string' },
      followUps: { type: 'array', items: { type: 'string' } },
    },
    required: ['relevantLaws', 'similarPrecedents', 'defenses', 'gaps', 'memoDraft', 'followUps'],
  }) };
  const strategyContent = await callChatCompletion({
    temperature: 0.2,
    response_format: strategyFormat,
    messages: [
      { role: 'system', content: strategySystemPrompt() },
      { role: 'user', content: `بيانات الدعوى (استخدمها في ترويسة المذكرة حرفياً):\n${JSON.stringify({ courtName: legalCase.court_name ?? 'محكمة غير محددة', caseNumber: legalCase.case_number, caseType: legalCase.type, caseTitle: legalCase.title }, null, 2)}\n\nمستخرج قراءة الأوراق:\n${JSON.stringify({ claimsSummary: reading.claimsSummary, parties: reading.parties, keyFacts: reading.keyFacts, legalIssues: reading.legalIssues }, null, 2)}\n\nالمصادر التشريعية الموثقة:\n${sourceBlock}\n\nالسوابق الموثقة:\n${precedentBlock}` },
    ],
  }, fetchImpl);
  if (!strategyContent) throw new Error('تعذر بناء استراتيجية الدفاع — أعد المحاولة.');
  const strategy = strategySchema.parse(JSON.parse(strategyContent));

  // بعض النماذج تُرجع أسطراً جديدة مشفرة (\\n حرفية) داخل نص المذكرة — نطبعها أسطراً فعلية
  const normalizeBreaks = (value: string) => value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, '    ');
  strategy.memoDraft = normalizeBreaks(strategy.memoDraft);
  strategy.defenses = strategy.defenses.map(defense => ({ ...defense, argument: normalizeBreaks(defense.argument) }));

  // بوابة التحقق على اقتباسات المذكرة
  const verification = verifyCitations([strategy.memoDraft, ...strategy.defenses.map(defense => defense.argument)], boostedRanked);

  // تنظيف القوانين والسوابق: الاحتفاظ بما يطابق المصادر المسترجعة فعلاً
  const digitsOf = (value: string | null | undefined) => (value ?? '').replace(/[^0-9]/g, '');
  const relevantLaws: IntakeLaw[] = strategy.relevantLaws
    .map(law => {
      const match = boostedRanked.find(section => {
        const sameArticle = digitsOf(section.articleNumber) !== '' && digitsOf(section.articleNumber) === digitsOf(law.articleNumber);
        const titleClose = section.title === law.title || law.title.includes(section.title.slice(0, 18)) || section.title.includes(law.title.slice(0, 18));
        return sameArticle && titleClose;
      }) ?? boostedRanked.find(section => digitsOf(section.articleNumber) !== '' && digitsOf(section.articleNumber) === digitsOf(law.articleNumber));
      return match ? { title: match.title, articleNumber: match.articleNumber, url: match.url, why: law.why, body: match.body } : null;
    })
    .filter((law): law is IntakeLaw => law !== null)
    .slice(0, 6);
  const allowedPrecedents = new Set(precedents.map(precedent => precedent.title));
  const similarPrecedents: IntakePrecedent[] = strategy.similarPrecedents
    .filter(item => allowedPrecedents.has(item.title))
    .slice(0, 4)
    .map(item => {
      const match = precedents.find(precedent => precedent.title === item.title);
      return { title: item.title, referenceNumber: match?.reference_number ?? item.referenceNumber, url: match?.source_url ?? '', why: item.why };
    });

  const result: IntakeResult = {
    hasImages: useVision,
    analyzedFiles: images.length + docTexts.length,
    claimsSummary: reading.claimsSummary,
    parties: reading.parties,
    keyFacts: reading.keyFacts.slice(0, 10),
    legalIssues: reading.legalIssues.slice(0, 8),
    relevantLaws,
    similarPrecedents,
    defenses: strategy.defenses.slice(0, 6),
    gaps: strategy.gaps.slice(0, 6),
    memoDraft: strategy.memoDraft,
    followUps: strategy.followUps.slice(0, 5),
    verification,
    limitations: 'تحليل افتتاحي آلي لمسودة أوراق الدعوى — مساندة للمحامي المراجع وليس رأياً قانونياً نهائياً، ولا يصح الاعتماد عليه قبل التحقق من النصوص السارية والوقائع الكاملة.',
  };

  // الحفظ والاستهلاك (استبدال أي تحليل سابق للقضية نفسها)
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  await fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses?case_id=eq.${input.caseId}`, { method: 'DELETE', headers: supabaseHeaders(input.accessToken) });
  await fetchImpl(`${baseUrl}/rest/v1/case_intake_analyses`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      requested_by: profile.id,
      provider: aiProviderName(),
      model: aiModelName(),
      status: 'done',
      result: { ...result, verification: undefined },
      updated_at: new Date().toISOString(),
    }),
  });
  await fetchImpl(`${baseUrl}/rest/v1/assistant_runs`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      requested_by: profile.id,
      provider: aiProviderName(),
      model: aiModelName(),
      instruction: `تحليل افتتاحي: ${legalCase.case_number}`,
      response_markdown: result.claimsSummary,
      cited_sources: result.relevantLaws.map(law => ({ id: '', title: law.title, url: law.url, articleNumber: law.articleNumber })),
      review_status: 'requires_lawyer_review',
    }),
  });

  return result;
}
