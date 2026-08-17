import { z } from 'zod';
import { assertAiQuota } from './aiQuota';
import { verifyCitations, type CitationVerification } from './citationGate';
import { aiModelName, aiProviderName, callChatCompletion } from './aiClient';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { buildExcerpt } from './textExcerpts';
import { assessEvidence, buildCandidateFilter, embedText, expandLegalSearchTerms, extractSearchTerms, hybridSearchSections, isSourceCompatibleWithDisputeType, rankSections, suggestFollowUps, type DisputeType, type EvidenceQuality, type RankableSection, type RankedSection, CANDIDATE_LIMIT } from './retrieval';

/**
 * مركز البحث القانوني الموثق — المنتج الأول في خارطة التحول.
 * المسار: سؤال → استرجاع مصفى بالصلة → إعلان فجوة عند غياب الدليل (بلا نداء نموذج)
 *        → توليد منظّم مقيد بالمصادر → بوابة تحقق الاستشهاد → عرض + حفظ بموافقة.
 */

export const legalResearchInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid().optional(),
  question: z.string().min(10).max(4000),
  disputeType: z.enum(['civil', 'commercial', 'criminal', 'labor', 'family', 'administrative', 'other']).optional(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ResearchCitation = RankedSection & { excerpt: string };

export type ResearchAnswer = {
  summary: string;
  rule: string;
  exceptions: string[];
  application: string[];
  uncertainties: string[];
  gapDeclaration: string | null;
};

export type ResearchPrecedent = {
  id: string;
  courtName: string;
  referenceNumber: string | null;
  decidedOn: string | null;
  title: string;
  summary: string;
  url: string;
  relevanceScore: number;
};

export type ResearchResult = {
  gap: boolean;
  evidenceQuality: EvidenceQuality;
  suggestedFollowUps: string[];
  answer: ResearchAnswer | null;
  citations: ResearchCitation[];
  precedentCitations: ResearchPrecedent[];
  verification: CitationVerification;
  limitations: string;
};

function buildResearchUserMessage(question: string, disputeType?: string) {
  if (!disputeType) return `السؤال القانوني:
${question}`;
  return `السؤال القانوني:
${question}

نوع النزاع: ${disputeType}`;
}

export const answerSchema = z.object({
  summary: z.string(),
  rule: z.string(),
  exceptions: z.array(z.string()),
  application: z.array(z.string()),
  uncertainties: z.array(z.string()),
  gapDeclaration: z.string().nullable().transform(value => (value == null || value.trim() === '' ? null : value)),
  citedSourceIds: z.array(z.string()),
  citedPrecedentIds: z.array(z.string()),
});

type ResearchDeps = { fetchImpl?: typeof fetch };

async function fetchSections(accessToken: string, question: string, disputeType: DisputeType | undefined, fetchImpl: typeof fetch) {
  const terms = expandLegalSearchTerms(extractSearchTerms(question));
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  type Row = { id: string; source_id: string; article_number: string | null; heading: string | null; body: string; title: string; source_url: string; official_number: string | null; effective_on: string | null; is_current: boolean | null; rank: number };
  const toCandidates = (rows: Row[]): Array<RankableSection & { effectiveOn: string | null; isCurrent: boolean | null }> => rows.map(row => ({
    id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url, officialNumber: row.official_number,
    articleNumber: row.article_number, heading: row.heading, body: row.body, effectiveOn: row.effective_on, isCurrent: row.is_current,
  }));
  // الاسترجاع الأساسي: محرك search_vector بترتيب ts_rank (مواد كاملة)
  if (terms.length) {
    // البحث الهجين: pgvector (تشابه دلالي) + ts_rank — يقع تلقائياً على النصي عند غياب المتجهات
    const embedding = await embedText(question).catch(() => null);
    const hybridRows = await hybridSearchSections(accessToken, terms.join(' '), embedding, fetchImpl, CANDIDATE_LIMIT);
    if (hybridRows.length) {
      const compatible = hybridRows.filter(section => isSourceCompatibleWithDisputeType(section.title, disputeType));
      if (compatible.length) {
        const ranked = rankSections(compatible, terms);
        if (ranked.length) return { terms, ranked };
      }
    }
    const rpc = await fetchImpl(`${baseUrl}/rest/v1/rpc/search_legal_sections`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_query: terms.join(' '), p_limit: CANDIDATE_LIMIT }),
    });
    if (rpc.ok) {
      const rows = await rpc.json() as Row[];
      if (rows.length) {
        const compatible = toCandidates(rows).filter(section => isSourceCompatibleWithDisputeType(section.title, disputeType));
        if (compatible.length) {
          const ranked = rankSections(compatible, terms);
          if (ranked.length) return { terms, ranked };
        }
      }
    }
  }
  // الاحتياط: تصفية نصية بأي مصطلح
  const query = new URLSearchParams({
    select: 'id,source_id,article_number,heading,body,legal_sources(title,source_url,official_number,effective_on,is_current)',
    limit: String(CANDIDATE_LIMIT),
  });
  const filter = buildCandidateFilter(terms);
  if (filter) query.set('or', filter);
  const response = await fetchImpl(`${baseUrl}/rest/v1/legal_source_sections?${query.toString()}`, { headers });
  const rows = await readResponse<Array<{
    id: string; source_id: string; article_number: string | null; heading: string | null; body: string;
    legal_sources: { title: string; source_url: string; official_number: string | null; effective_on: string | null; is_current: boolean | null } | null;
  }>>(response);
  const candidates = rows.filter(row => row.legal_sources).map(row => ({
    id: row.id, sourceId: row.source_id, title: row.legal_sources!.title, url: row.legal_sources!.source_url,
    officialNumber: row.legal_sources!.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body,
    effectiveOn: row.legal_sources!.effective_on, isCurrent: row.legal_sources!.is_current,
  }));
  return { terms, ranked: rankSections(candidates.filter(section => isSourceCompatibleWithDisputeType(section.title, disputeType)), terms) };
}

async function fetchPrecedents(accessToken: string, question: string, fetchImpl: typeof fetch): Promise<ResearchPrecedent[]> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const terms = extractSearchTerms(question);
  const response = await fetchImpl(`${baseUrl}/rest/v1/legal_precedents?select=id,court_name,reference_number,decided_on,title,summary,source_url&is_verified=eq.true&limit=20`, { headers: supabaseHeaders(accessToken) });
  const rows = await readResponse<Array<{
    id: string; court_name: string; reference_number: string | null; decided_on: string | null;
    title: string; summary: string; source_url: string;
  }>>(response);
  const lowerTerms = terms.map(term => term.toLocaleLowerCase('ar'));
  return rows
    .map(row => {
      const haystack = `${row.title} ${row.summary}`.toLocaleLowerCase('ar');
      const matched = lowerTerms.filter(term => haystack.includes(term)).length;
      return { id: row.id, courtName: row.court_name, referenceNumber: row.reference_number, decidedOn: row.decided_on, title: row.title, summary: row.summary, url: row.source_url, relevanceScore: lowerTerms.length ? matched / lowerTerms.length : 0 };
    })
    .filter(precedent => precedent.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 5);
}

function researchSystemPrompt(citations: ResearchCitation[], precedents: ResearchPrecedent[], referenceDate?: string) {
  const sourceBlock = citations.map(source => [
    `المعرّف: ${source.id}`,
    `العنوان: ${source.title}${source.articleNumber ? ` — ${source.articleNumber}` : ''}`,
    `تاريخ النفاذ: ${source.effectiveOn ?? 'غير محدد'} · الحالة: ${source.isCurrent === false ? 'غير ساري (نص تاريخي — نبّه عند الاستناد إليه)' : 'ساري'}`,
    `الرابط الرسمي: ${source.url}`,
    `النص (مقتطف ذو صلة): ${source.excerpt}`,
  ].join('\n')).join('\n\n---\n\n');

  const precedentBlock = precedents.map(precedent => [
    `المعرّف: ${precedent.id}`,
    `المحكمة: ${precedent.courtName} · المرجع: ${precedent.referenceNumber ?? 'غير منشور'} · التاريخ: ${precedent.decidedOn ?? '—'}`,
    `الملخص: ${precedent.summary}`,
    `الرابط الرسمي: ${precedent.url}`,
  ].join('\n')).join('\n\n---\n\n');

  return `أنت باحث قانوني قطري محترف تعد مذكرة بحث لمحامٍ مراجع. تجيب حصراً من المصادر الموثقة أدناه.

القواعد الملزمة:
1) رتّب الإجابة: القاعدة، الاستثناءات، عناصر الانطباق على الوقائع، نقاط عدم اليقين.
2) كل اقتباس حرفي يوضع بين «…» بنص المصدر دون أي تغيير في ألفاظه؛ ما عدا ذلك صياغة خاصة بك.
3) لا تذكر رقم مادة أو تشريع أو حكماً غير موجود في المصادر أدناه، ولا تخترع روابط.
4) إذا كانت المصادر لا تكفي للجزم، اكتب في gapDeclaration فجوة البحث بوضوح: ما المفقود وما يلزم الاستعلام عنه؛ وإن لم توجد فجوة فاترك الحقل نصاً فارغاً.
5) citedSourceIds وcitedPrecedentIds تقتصر على المعرفات أدناه.
${referenceDate ? `6) التاريخ المرجعي المطلوب للتحقق الزمني: ${referenceDate}; إذا كان نص مصدر لاحقاً لهذا التاريخ فاعتبره غير قابل للاستناد واذكر ذلك في uncertainties.` : ''}

المصادر التشريعية الموثقة:
${sourceBlock}

السوابق الموثقة:
${precedentBlock || 'لا توجد سوابق موثقة مطابقة؛ لا تدّعِ وجود حكم مماثل.'}`;
}

function researchResponseSchema() {
  return {
    name: 'qatar_legal_research_output',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        rule: { type: 'string' },
        exceptions: { type: 'array', items: { type: 'string' } },
        application: { type: 'array', items: { type: 'string' } },
        uncertainties: { type: 'array', items: { type: 'string' } },
        gapDeclaration: { type: 'string' },
        citedSourceIds: { type: 'array', items: { type: 'string' } },
        citedPrecedentIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'rule', 'exceptions', 'application', 'uncertainties', 'gapDeclaration', 'citedSourceIds', 'citedPrecedentIds'],
    },
  };
}

/** يبني نتيجة الفجوة دون أي نداء للنموذج: لا دليل → لا توليد. */
export function buildGapResult(question: string, quality: EvidenceQuality, terms: string[]): ResearchResult {
  return {
    gap: true,
    evidenceQuality: quality,
    suggestedFollowUps: suggestFollowUps(question, terms),
    answer: null,
    citations: [],
    precedentCitations: [],
    verification: { verifiedQuotes: [], unverifiedQuotes: [], unverifiedArticles: [], passed: true },
    limitations: 'فجوة بحث: لا توجد نصوص موثقة كافية في قاعدة المعرفة لهذا السؤال؛ لم يُولَّد أي تحليل منعاً للاختلاق. استخدم الاقتراحات أدناه أو استكمل البحث من بوابة الميزان الرسمية ثم أضف المصدر للقاعدة.',
  };
}

export function buildResearchResult(
  parsed: z.infer<typeof answerSchema>,
  citations: ResearchCitation[],
  precedents: ResearchPrecedent[],
): ResearchResult {
  const allowed = new Set(citations.map(citation => citation.id));
  const citedIds = Array.from(new Set(parsed.citedSourceIds.filter(id => allowed.has(id))));
  const usedCitations = citations.filter(citation => citedIds.includes(citation.id));
  const allowedPrecedents = new Set(precedents.map(precedent => precedent.id));
  const citedPrecedentIds = Array.from(new Set(parsed.citedPrecedentIds.filter(id => allowedPrecedents.has(id))));
  const usedPrecedents = precedents.filter(precedent => citedPrecedentIds.includes(precedent.id));

  const gateTexts = [parsed.summary, parsed.rule, ...parsed.exceptions, ...parsed.application, ...parsed.uncertainties, parsed.gapDeclaration ?? ''];
  const verification = verifyCitations(gateTexts.filter(Boolean), usedCitations.length ? usedCitations : citations);

  return {
    gap: false,
    evidenceQuality: 'adequate',
    suggestedFollowUps: [],
    answer: {
      summary: parsed.summary,
      rule: parsed.rule,
      exceptions: parsed.exceptions,
      application: parsed.application,
      uncertainties: parsed.uncertainties,
      gapDeclaration: parsed.gapDeclaration,
    },
    citations: usedCitations,
    precedentCitations: usedPrecedents,
    verification,
    limitations: 'المخرج مذكرة بحث أولية للمحامي المراجع وليست رأياً قانونياً نهائياً؛ تحقق من النصوص السارية قبل الاستناد أو الإيداع.',
  };
}

/** نواة البحث بافتراض اكتمال المصادقة وسقف الاستخدام — تستخدمها نقطة tRPC ووكيل البحث معاً. */
export async function executeResearch(
  input: Omit<z.infer<typeof legalResearchInput>, 'accessToken'> & { accessToken: string },
  profile: Profile,
  deps: ResearchDeps = {},
): Promise<ResearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { terms, ranked } = await fetchSections(input.accessToken, input.question, input.disputeType, fetchImpl);
  const citations: ResearchCitation[] = ranked.map(section => ({ ...section, excerpt: buildExcerpt(section.body, terms) }));
  const evidenceQuality = assessEvidence(ranked);

  if (evidenceQuality === 'none') return buildGapResult(input.question, evidenceQuality, terms);

  const precedents = await fetchPrecedents(input.accessToken, input.question, fetchImpl);
  const content = await callChatCompletion({
    temperature: 0.2,
    response_format: { type: 'json_schema', json_schema: researchResponseSchema() },
    messages: [
      { role: 'system', content: researchSystemPrompt(citations, precedents, input.referenceDate) },
      { role: 'user', content: buildResearchUserMessage(input.question, input.disputeType) },
    ],
  }, fetchImpl);
  if (!content) throw new Error('لم تُرجع خدمة الذكاء الاصطناعي محتوى صالحاً للمراجعة.');

  const result = buildResearchResult(answerSchema.parse(JSON.parse(content)), citations, precedents);

  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  await fetchImpl(`${baseUrl}/rest/v1/assistant_runs`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId ?? null,
      requested_by: profile.id,
      provider: aiProviderName(),
      model: aiModelName(),
      instruction: input.question,
      response_markdown: result.answer ? `${result.answer.summary}\n\nالقاعدة:\n${result.answer.rule}` : 'فجوة بحث: لا مصادر كافية.',
      cited_sources: result.citations.map(citation => ({ id: citation.id, title: citation.title, url: citation.url, articleNumber: citation.articleNumber })),
      review_status: 'requires_lawyer_review',
    }),
  });

  return result;
}

export async function runLegalResearch(input: z.infer<typeof legalResearchInput>, deps: ResearchDeps = {}): Promise<ResearchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'مركز البحث متاح لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);
  return executeResearch(input, profile, deps);
}

/** حفظ مذكرة البحث بملف القضية — إجراء مؤثر لا يتم إلا بموافقة صريحة من الواجهة. */
export const saveResearchMemoInput = z.object({
  accessToken: z.string().min(20),
  caseId: z.string().uuid(),
  question: z.string().min(10).max(4000),
  memoMarkdown: z.string().min(20).max(40000),
  citations: z.array(z.object({
    sectionId: z.string().uuid(),
    excerpt: z.string().max(2200),
    relevanceScore: z.number().min(0).max(1),
    rationale: z.string().max(600).optional(),
  })).min(1),
  precedentIds: z.array(z.string().uuid()).default([]),
});

export async function saveResearchMemo(input: z.infer<typeof saveResearchMemoInput>, deps: ResearchDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'حفظ مذكرات البحث متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');

  const researchResponse = await fetchImpl(`${baseUrl}/rest/v1/case_researches`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      research_query: input.question,
      created_by: profile.id,
    }),
  });
  const researches = await readResponse<Array<{ id: string }>>(researchResponse);
  const research = researches[0];
  if (!research) throw new Error('تعذر إنشاء سجل البحث للقضية.');

  type ResultRow = {
    research_id: string;
    source_section_id: string | null;
    precedent_id?: string;
    relevance_score: number | null;
    rationale: string | null;
    cited_excerpt: string | null;
  };
  const resultRows: ResultRow[] = input.citations.map(citation => ({
    research_id: research.id,
    source_section_id: citation.sectionId,
    relevance_score: citation.relevanceScore,
    rationale: citation.rationale ?? null,
    cited_excerpt: citation.excerpt,
  }));
  for (const precedentId of input.precedentIds) {
    resultRows.push({ research_id: research.id, source_section_id: null, precedent_id: precedentId, relevance_score: null, rationale: null, cited_excerpt: null });
  }
  const resultsResponse = await fetchImpl(`${baseUrl}/rest/v1/research_results`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify(resultRows),
  });
  if (!resultsResponse.ok) {
    const detail = await resultsResponse.text();
    throw new Error(`تعذر حفظ نتائج البحث: ${detail.slice(0, 200)}`);
  }

  const draftResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: input.caseId,
      title: `مذكرة بحث: ${input.question.slice(0, 80)}`,
      document_type: 'legal_memo',
      content: input.memoMarkdown,
      status: 'draft',
      created_by: profile.id,
    }),
  });
  if (!draftResponse.ok) {
    const detail = await draftResponse.text();
    throw new Error(`تعذر حفظ مسودة المذكرة: ${detail.slice(0, 200)}`);
  }

  return { researchId: research.id, savedCitations: input.citations.length, savedPrecedents: input.precedentIds.length };
}

export type { Profile };
