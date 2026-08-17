import { z } from 'zod';
import { aiModelName, aiProviderName, callChatCompletion } from './aiClient';
import { assertAiQuota } from './aiQuota';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { buildExcerpt, searchTerms } from './textExcerpts';
import { CANDIDATE_LIMIT, buildCandidateFilter, extractSearchTerms, rankSections, type RankableSection } from './retrieval';

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

async function fetchCandidateSections(accessToken: string, request: string): Promise<SourceExcerpt[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const terms = extractSearchTerms(request);
  type Row = { id: string; source_id: string; article_number: string | null; heading: string | null; body: string; title: string; source_url: string; official_number: string | null };
  const mapBack = (ranked: ReturnType<typeof rankSections>): SourceExcerpt[] => ranked.map(section => ({
    id: section.id, sourceId: section.sourceId, title: section.title, url: section.url,
    officialNumber: section.officialNumber, articleNumber: section.articleNumber,
    excerpt: buildExcerpt(section.body, terms),
  }));
  // الأساسي: محرك search_vector بترتيب ts_rank
  if (terms.length) {
    const rpc = await fetch(`${baseUrl}/rest/v1/rpc/search_legal_sections`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_query: terms.join(' '), p_limit: CANDIDATE_LIMIT }),
    });
    if (rpc.ok) {
      const rows = await rpc.json() as Row[];
      if (rows.length) return mapBack(rankSections(rows.map(row => ({ id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url, officialNumber: row.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body })), terms));
    }
  }
  // الاحتياط: تصفية نصية بأي مصطلح
  const query = new URLSearchParams({ select: 'id,source_id,article_number,heading,body,legal_sources(title,source_url,official_number)', limit: String(CANDIDATE_LIMIT) });
  const filter = buildCandidateFilter(terms);
  if (filter) query.set('or', filter);
  const response = await fetch(`${baseUrl}/rest/v1/legal_source_sections?${query.toString()}`, { headers });
  const rows = await readResponse<Array<{ id: string; source_id: string; article_number: string | null; heading: string | null; body: string; legal_sources: { title: string; source_url: string; official_number: string | null } | null }>>(response);
  const candidates = rows.filter(row => row.legal_sources).map(row => ({ id: row.id, sourceId: row.source_id, title: row.legal_sources!.title, url: row.legal_sources!.source_url, officialNumber: row.legal_sources!.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body }));
  return mapBack(rankSections(candidates, terms));
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

export { searchTerms };

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
7) عند الاقتباس الحرفي من المصادر ضع الاقتباس بين علامتي «…» دون أي تغيير في ألفاظه.

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
      provider: aiProviderName(),
      model: aiModelName(),
      instruction: input.request,
      response_markdown: output.draft,
      cited_sources: output.citations.map(source => ({ id: source.id, title: source.title, url: source.url, articleNumber: source.articleNumber })),
      review_status: 'requires_lawyer_review',
    }),
  });
}

const USER_TASK_TEMPLATE = `نوع المهمة: {objective}

وقائع أو طلب المحامي:
{request}`;

export async function runLegalAssistant(input: z.infer<typeof legalAssistantInput>): Promise<LegalAssistantOutput> {
  const user = await getVerifiedUser(input.accessToken);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id), 'المساعد القانوني متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile);

  const [sources, precedents] = await Promise.all([fetchCandidateSections(input.accessToken, input.request), findSimilarPrecedents(input.accessToken, input.request)]);
  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: responseSchema() },
    messages: [
      { role: 'system', content: buildLegalSystemPrompt(sources, precedents) },
      { role: 'user', content: USER_TASK_TEMPLATE.replace('{objective}', input.objective).replace('{request}', input.request) },
    ],
  });
  if (!content) throw new Error('لم تُرجع خدمة الذكاء الاصطناعي محتوى صالحاً للمراجعة.');

  const output = sanitizeAssistantOutput(JSON.parse(content), sources, precedents);
  await saveAssistantRun(input.accessToken, profile, input, output);
  return output;
}
