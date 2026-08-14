import { z } from 'zod';

const AI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const MODEL = 'grok-4.6';

export const legalAssistantInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid().optional(),
  request: z.string().min(20).max(12000),
  objective: z.enum(['research', 'outline', 'draft']).default('draft'),
});

const aiResultSchema = z.object({
  summary: z.string(),
  legalIssues: z.array(z.object({ issue: z.string(), analysis: z.string() })),
  proposedDefences: z.array(z.object({ heading: z.string(), argument: z.string(), strength: z.enum(['مرتفع', 'متوسط', 'منخفض']) })),
  clarificationQuestions: z.array(z.string()),
  draft: z.string(),
  citedSourceIds: z.array(z.string()),
  citedPrecedentIds: z.array(z.string()),
  limitations: z.string(),
});

export type LegalAssistantOutput = z.infer<typeof aiResultSchema> & {
  citations: SourceExcerpt[];
  similarPrecedents: PrecedentExcerpt[];
};

type SupabaseUser = { id: string; email?: string | null };
type Profile = { id: string; office_id: string | null; role: 'manager' | 'lawyer' | 'employee'; display_name: string };
export type SourceExcerpt = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  officialNumber: string | null;
  articleNumber: string | null;
  excerpt: string;
};

export type PrecedentExcerpt = {
  id: string;
  courtName: string;
  referenceNumber: string | null;
  decidedOn: string | null;
  classification: string | null;
  title: string;
  summary: string;
  principleText: string | null;
  url: string;
  relevanceScore: number;
};

function requiredEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY' | 'XAI_API_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`الإعداد ${name} غير متوفر على الخادم.`);
  return value;
}

function supabaseHeaders(accessToken: string) {
  return {
    apikey: requiredEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`تعذر تنفيذ الطلب الآمن (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

async function getVerifiedUser(accessToken: string): Promise<SupabaseUser> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetch(`${baseUrl}/auth/v1/user`, { headers: supabaseHeaders(accessToken) });
  return readResponse<SupabaseUser>(response);
}

async function getProfile(accessToken: string, userId: string): Promise<Profile> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const query = new URLSearchParams({ select: 'id,office_id,role,display_name', id: `eq.${userId}`, limit: '1' });
  const response = await fetch(`${baseUrl}/rest/v1/profiles?${query.toString()}`, { headers: supabaseHeaders(accessToken) });
  const profiles = await readResponse<Profile[]>(response);
  if (!profiles[0]?.office_id) throw new Error('يرجى إنشاء مكتب أو قبول دعوة الانضمام قبل استخدام المساعد القانوني.');
  return profiles[0];
}

function searchTerms(request: string) {
  const ignored = new Set(['في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي', 'هل', 'ما', 'كيف', 'حول', 'بعد', 'قبل', 'لدى']);
  return request
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !ignored.has(term))
    .slice(0, 5);
}

function buildExcerpt(body: string, terms: string[]) {
  const lowerBody = body.toLocaleLowerCase('ar');
  const hit = terms.map(term => lowerBody.indexOf(term.toLocaleLowerCase('ar'))).find(index => index >= 0) ?? 0;
  const from = Math.max(0, hit - 450);
  const to = Math.min(body.length, hit + 1350);
  return `${from > 0 ? '…' : ''}${body.slice(from, to).trim()}${to < body.length ? '…' : ''}`;
}

async function findSourceExcerpts(accessToken: string, request: string): Promise<SourceExcerpt[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const terms = searchTerms(request);
  const query = new URLSearchParams({
    select: 'id,source_id,article_number,heading,body,legal_sources(title,source_url,official_number)',
    limit: '8',
    order: 'created_at.desc',
  });
  const response = await fetch(`${baseUrl}/rest/v1/legal_source_sections?${query.toString()}`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{
    id: string; source_id: string; article_number: string | null; heading: string | null; body: string;
    legal_sources: { title: string; source_url: string; official_number: string | null } | null;
  }>>(response);

  return rows
    .filter(row => row.legal_sources)
    .map(row => ({
      id: row.id,
      sourceId: row.source_id,
      title: row.legal_sources!.title,
      url: row.legal_sources!.source_url,
      officialNumber: row.legal_sources!.official_number,
      articleNumber: row.article_number,
      excerpt: buildExcerpt(row.body, terms),
    }));
}

async function findSimilarPrecedents(accessToken: string, request: string): Promise<PrecedentExcerpt[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetch(`${baseUrl}/rest/v1/legal_precedents?select=id,court_name,reference_number,decided_on,classification,title,summary,principle_text,source_url&is_verified=eq.true&limit=8`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{
    id: string; court_name: string; reference_number: string | null; decided_on: string | null; classification: string | null;
    title: string; summary: string; principle_text: string | null; source_url: string;
  }>>(response);
  const terms = searchTerms(request).map(term => term.toLocaleLowerCase('ar'));
  return rows
    .map(row => {
      const haystack = `${row.title} ${row.summary} ${row.principle_text ?? ''}`.toLocaleLowerCase('ar');
      const matchedTerms = terms.filter(term => haystack.includes(term)).length;
      return { id: row.id, courtName: row.court_name, referenceNumber: row.reference_number, decidedOn: row.decided_on, classification: row.classification, title: row.title, summary: row.summary, principleText: row.principle_text, url: row.source_url, relevanceScore: terms.length ? matchedTerms / terms.length : 0 };
    })
    .filter(precedent => terms.length === 0 || precedent.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
}

export function buildLegalSystemPrompt(context: SourceExcerpt[], precedents: PrecedentExcerpt[] = []) {
  const sourceBlock = context.map(source => [
    `المعرّف: ${source.id}`,
    `العنوان: ${source.title}`,
    `الرابط الرسمي: ${source.url}`,
    `المقتطف: ${source.excerpt}`,
  ].join('\n')).join('\n\n---\n\n');

  const precedentBlock = precedents.map(precedent => [
    `المعرّف: ${precedent.id}`,
    `المحكمة: ${precedent.courtName}`,
    `المرجع: ${precedent.referenceNumber ?? 'غير منشور'}`,
    `الملخص: ${precedent.summary}`,
    `الرابط الرسمي: ${precedent.url}`,
  ].join('\n')).join('\n\n---\n\n');

  return `أنت مساعد بحث وصياغة قانونية عربي متخصص في القانون القطري، وتعمل حصراً لدعم محامٍ مؤهل داخل مكتب محاماة.

القواعد الملزمة:
1) اكتب العربية الفصحى القانونية بصياغة دقيقة قابلة للتحرير.
2) لا تدّعِ أنك محامٍ مرخّص ولا تمنح ضماناً لنتيجة قضائية.
3) لا تنسب نصاً أو حكماً أو مادة قانونية إلى مصدر غير موجود أدناه. إذا لم يكف السياق، صرّح بالحاجة إلى تحقق إضافي.
4) لا تذكر في citedSourceIds أو citedPrecedentIds إلا معرفات المصادر المتاحة أدناه، ولا تضع روابط مخترعة.
5) أعطِ أسئلة واقعية لسد النقص في الوقائع قبل الجزم بدفع أو مسار دفاعي.
6) اجعل المسودة مخصصة للمراجعة المهنية قبل الإيداع، وضع التحفظات بوضوح.

المصادر المتاحة والموثقة:
${sourceBlock || 'لا توجد مصادر متاحة في هذا الطلب؛ يجب طلب استكمال البحث الرسمي.'}

السوابق أو الأحكام المماثلة الموثقة:
${precedentBlock || 'لا توجد سوابق موثقة مطابقة في قاعدة المعرفة الحالية؛ لا تدّعِ وجود حكم مماثل.'}`;
}

function responseSchema() {
  return {
    name: 'qatar_legal_assistant_output',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        legalIssues: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { issue: { type: 'string' }, analysis: { type: 'string' } },
            required: ['issue', 'analysis'],
          },
        },
        proposedDefences: {
          type: 'array', items: {
            type: 'object', additionalProperties: false,
            properties: { heading: { type: 'string' }, argument: { type: 'string' }, strength: { type: 'string', enum: ['مرتفع', 'متوسط', 'منخفض'] } },
            required: ['heading', 'argument', 'strength'],
          },
        },
        clarificationQuestions: { type: 'array', items: { type: 'string' } },
        draft: { type: 'string' },
        citedSourceIds: { type: 'array', items: { type: 'string' } },
        citedPrecedentIds: { type: 'array', items: { type: 'string' } },
        limitations: { type: 'string' },
      },
      required: ['summary', 'legalIssues', 'proposedDefences', 'clarificationQuestions', 'draft', 'citedSourceIds', 'citedPrecedentIds', 'limitations'],
    },
  };
}

export function sanitizeAssistantOutput(raw: unknown, sources: SourceExcerpt[], precedents: PrecedentExcerpt[] = []): LegalAssistantOutput {
  const parsed = aiResultSchema.parse(raw);
  const allowed = new Set(sources.map(source => source.id));
  const citedIds = Array.from(new Set(parsed.citedSourceIds.filter(id => allowed.has(id))));
  const citations = sources.filter(source => citedIds.includes(source.id));
  const allowedPrecedents = new Set(precedents.map(precedent => precedent.id));
  const citedPrecedentIds = Array.from(new Set(parsed.citedPrecedentIds.filter(id => allowedPrecedents.has(id))));
  const similarPrecedents = precedents;
  return { ...parsed, citedSourceIds: citedIds, citedPrecedentIds, citations, similarPrecedents };
}

async function saveAssistantRun(accessToken: string, profile: Profile, input: z.infer<typeof legalAssistantInput>, output: LegalAssistantOutput) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  await fetch(`${baseUrl}/rest/v1/assistant_runs`, {
    method: 'POST',
    headers: { ...supabaseHeaders(accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId ?? null,
      requested_by: profile.id,
      provider: 'grok',
      model: MODEL,
      instruction: input.request,
      response_markdown: output.draft,
      cited_sources: output.citations.map(source => ({ id: source.id, title: source.title, url: source.url, articleNumber: source.articleNumber })),
      review_status: 'requires_lawyer_review',
    }),
  });
}

export async function runLegalAssistant(input: z.infer<typeof legalAssistantInput>): Promise<LegalAssistantOutput> {
  const user = await getVerifiedUser(input.accessToken);
  const profile = await getProfile(input.accessToken, user.id);
  if (!['manager', 'lawyer'].includes(profile.role)) {
    throw new Error('المساعد القانوني متاح لمدير المكتب والمحامي فقط.');
  }

  const [sources, precedents] = await Promise.all([findSourceExcerpts(input.accessToken, input.request), findSimilarPrecedents(input.accessToken, input.request)]);
  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('XAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: responseSchema() },
      messages: [
        { role: 'system', content: buildLegalSystemPrompt(sources, precedents) },
        { role: 'user', content: `نوع المهمة: ${input.objective}\n\nوقائع أو طلب المحامي:\n${input.request}` },
      ],
    }),
  });
  const completion = await readResponse<{ choices?: Array<{ message?: { content?: string } }> }>(response);
  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error('لم تُرجع خدمة الذكاء الاصطناعي محتوى صالحاً للمراجعة.');

  const output = sanitizeAssistantOutput(JSON.parse(content), sources, precedents);
  await saveAssistantRun(input.accessToken, profile, input, output);
  return output;
}
