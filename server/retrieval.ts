import { ARABIC_STOPWORDS, extractSearchTerms, normalizeArabic, stripArabicPrefix } from './legalText';

/**
 * استرجاع مصفى بالصلة: يرشّح مقاطع المصادر بمطابقة مصطلحات السؤال ثم يرتبها بدرجة صلة.
 * يستبدل الاستعلام القديم (آخر المقاطع بلا تصفية) الذي كان يجعل جودة الاستشهاد مرهونة بالحظ.
 */

export type RankableSection = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  officialNumber: string | null;
  articleNumber: string | null;
  heading: string | null;
  body: string;
  effectiveOn?: string | null;
  isCurrent?: boolean | null;
};

export type RankedSection = RankableSection & { relevanceScore: number; matchedTerms: string[]; strongMatches: number };

export type DisputeType = 'civil' | 'commercial' | 'criminal' | 'labor' | 'family' | 'administrative' | 'other';

const SOURCE_DOMAIN_MARKERS: Record<Exclude<DisputeType, 'other'>, string[]> = {
  civil: ['مدني', 'مدنيه', 'مرافعات'],
  commercial: ['تجاري', 'تجاريه', 'تجاره', 'شركات'],
  criminal: ['جنائي', 'جنائيه', 'عقوبات', 'جزائي', 'جزائيه', 'جرائم'],
  labor: ['عمل', 'عمال', 'عمالي', 'عماليه'],
  family: ['اسره', 'احوال شخصيه'],
  administrative: ['اداري', 'اداريه', 'مجلس الدوله'],
};

const PROCEDURAL_CONCEPTS = [
  ['نقض', 'تمييز', 'التمييز'],
  ['استئناف'],
  ['معارضه'],
] as const;

/** يضيف المرادف القطري الشائع لطريق الطعن دون تحويله إلى طريق طعن مختلف. */
export function expandLegalSearchTerms(terms: string[]) {
  const expanded = [...terms];
  for (const aliases of PROCEDURAL_CONCEPTS) {
    if (aliases.some(alias => terms.includes(alias))) {
      for (const alias of aliases) if (!expanded.includes(alias)) expanded.push(alias);
    }
  }
  return expanded;
}

/**
 * إذا سمّى السؤال طريق طعن محدداً، لا تكفي مطابقة كلمات عامة مثل «ميعاد»
 * أو عنوان القانون؛ يجب أن يذكر المقطع الطريق نفسه أو مرادفه القطري.
 */
export function sectionMatchesProceduralConcept(section: RankableSection, terms: string[]) {
  const haystack = normalizeArabic(`${section.heading ?? ''} ${section.body}`);
  for (const aliases of PROCEDURAL_CONCEPTS) {
    if (aliases.some(alias => terms.includes(alias)) && !aliases.some(alias => haystack.includes(alias))) return false;
  }
  return true;
}

/**
 * يمنع تمرير مصدر مصنف بوضوح في فرع قانوني مخالف لنوع النزاع.
 * المصادر العامة (الدستور مثلاً) تبقى متاحة، والمصدر المدني/التجاري المشترك
 * يصلح لكلا النوعين.
 */
export function isSourceCompatibleWithDisputeType(title: string, disputeType?: DisputeType) {
  if (!disputeType || disputeType === 'other') return true;
  const normalizedTitle = normalizeArabic(title);
  const detected = (Object.entries(SOURCE_DOMAIN_MARKERS) as Array<[Exclude<DisputeType, 'other'>, string[]]>)
    .filter(([, markers]) => markers.some(marker => normalizedTitle.includes(marker)))
    .map(([domain]) => domain);
  if (!detected.length) return true;
  if (disputeType === 'civil' || disputeType === 'commercial') {
    return detected.includes(disputeType) || (detected.includes('civil') && detected.includes('commercial'));
  }
  return detected.includes(disputeType);
}

export const RETRIEVAL_LIMIT = 8;
export const CANDIDATE_LIMIT = 40;
/** طول المصطلح المميز: المطابقات الأقصر (حق، نقض، قانون) شائعة في أي نص قانوني ولا تكفي وحدها دليلاً. */
export const STRONG_TERM_MIN_LENGTH = 4;

/** قيمة معامل or في PostgREST لمطابقة أي مصطلح في المتن أو العنوان، أو null إن لم تتوفر مصطلحات صالحة. */
export function buildCandidateFilter(terms: string[]) {
  if (!terms.length) return null;
  const safe = terms
    .map(term => stripArabicPrefix(term.replace(/[^\u0621-\u06FFa-zA-Z0-9\s]/g, '').trim()))
    .filter(term => term.length >= 3 && !ARABIC_STOPWORDS.has(term))
    .slice(0, 6);
  if (!safe.length) return null;
  const conditions = safe.flatMap(term => [`body.ilike.*${term}*`, `heading.ilike.*${term}*`]);
  return `(${conditions.join(',')})`;
}

export function scoreSection(section: RankableSection, terms: string[]) {
  const haystack = normalizeArabic(`${section.title} ${section.heading ?? ''} ${section.body}`);
  const matchedTerms: string[] = [];
  let strongMatches = 0;
  let score = 0;
  for (const term of terms) {
    const normalizedTerm = stripArabicPrefix(normalizeArabic(term));
    if (normalizedTerm.length < 3) continue;
    const occurrences = haystack.split(normalizedTerm).length - 1;
    if (occurrences > 0) {
      matchedTerms.push(term);
      score += 1 + Math.min(occurrences - 1, 3) * 0.25 + normalizedTerm.length / 40;
      if (normalizedTerm.length >= STRONG_TERM_MIN_LENGTH) strongMatches += 1;
      if (normalizeArabic(`${section.title} ${section.heading ?? ''}`).includes(normalizedTerm)) score += 0.5;
    }
  }
  return { score, matchedTerms, strongMatches };
}

export function rankSections<T extends RankableSection>(sections: T[], terms: string[], limit = RETRIEVAL_LIMIT): RankedSection[] {
  return sections
    .filter(section => sectionMatchesProceduralConcept(section, terms))
    .map(section => {
      const { score, matchedTerms, strongMatches } = scoreSection(section, terms);
      return { ...section, relevanceScore: Math.min(score / Math.max(terms.length, 1), 1), matchedTerms, strongMatches };
    })
    .filter(section => section.matchedTerms.length > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, limit);
}

export type EvidenceQuality = 'none' | 'weak' | 'adequate';

/**
 * عتبات الأدلة: لا دليل (فجوة صلبة تُعلن دون نداء نموذج) إلا إذا وُجد مقطع
 * يطابق مصطلحين مميزين (4+ أحرف) على الأقل — مطابقة مصطلح عام واحد
 * (رسوم، توثيق، قانون) لا تُعتبر دليلاً كافياً.
 */
export function assessEvidence(ranked: RankedSection[]): EvidenceQuality {
  const best = ranked.reduce((max, section) => Math.max(max, section.strongMatches), 0);
  if (best < 2) return 'none';
  if (best < 3) return 'weak';
  return 'adequate';
}

/** اقتراحات استعلام تالٍ عند إعلان فجوة البحث، مشتقة من مصطلحات السؤال نفسه. */
export function suggestFollowUps(question: string, terms: string[]) {
  const primary = terms[0] ?? question.split(/\s+/)[0] ?? '';
  const secondary = terms[1] ?? '';
  const suggestions = [
    secondary ? `نصوص المادة المتعلقة بـ«${primary}» و«${secondary}» في التشريعات القطرية` : `نص المادة المنظمة لـ«${primary}» في التشريعات القطرية`,
    `مبادئ محكمة التمييز القطرية بشأن «${primary}»`,
    secondary ? `السوابق القضائية على «${primary}» و«${secondary}»` : `التعريف النظامي لـ«${primary}» وحدوده`,
  ];
  return Array.from(new Set(suggestions)).slice(0, 3);
}

export { extractSearchTerms };

/**
 * البحث الهجين (pgvector + ts_rank): يستدعي search_legal_sections_hybrid مع
 * متجه اختياري. عند غياب المتجه (لم يُولَّد بعد) يقع تلقائياً على البحث النصي.
 */
export async function hybridSearchSections(
  accessToken: string,
  query: string,
  embedding: number[] | null,
  fetchImpl: typeof fetch,
  limit = CANDIDATE_LIMIT,
): Promise<Array<RankableSection & { rank: number; similarity: number }>> {
  const { requiredEnv, supabaseHeaders } = await import('./supabaseAccess');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const body: Record<string, unknown> = { p_query: query, p_limit: limit };
  if (embedding) body.p_embedding = embedding;
  const rpc = await fetchImpl(`${baseUrl}/rest/v1/rpc/search_legal_sections_hybrid`, {
    method: 'POST', headers,
    body: JSON.stringify(body),
  });
  if (!rpc.ok) return [];
  const rows = await rpc.json() as Array<{
    id: string; source_id: string; article_number: string | null; heading: string | null; snippet: string;
    title: string; source_url: string; official_number: string | null; rank: number; similarity: number;
  }>;
  return rows.map(row => ({
    id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url,
    officialNumber: row.official_number, articleNumber: row.article_number, heading: row.heading,
    body: row.snippet, rank: row.rank, similarity: row.similarity,
  }));
}

/** توليد متجه نصي عبر مزود الذكاء الاصطناعي (OpenAI embeddings) — يُخزن في قاعدة المعرفة. */
export async function embedText(text: string, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  const apiKey = process.env.MZ_OPENAI_API_KEY?.trim() || (process.env.OPENAI_API_KEY?.trim().startsWith('sk-') ? process.env.OPENAI_API_KEY.trim() : undefined);
  if (!apiKey) return null;
  try {
    const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * فهرسة المتجهات لقاعدة المعرفة: يولّد embedding لكل مقطع تشريعي وسابقة
 * بلا متجه، ويخزنه في العمود. يُستدعى من مهمة دورية أو يدوياً من لوحة المصادر.
 */
export async function indexKnowledgeBaseEmbeddings(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
  limit = 50,
): Promise<{ sections: number; precedents: number }> {
  const { requiredEnv, supabaseHeaders } = await import('./supabaseAccess');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);

  const sectionsResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_source_sections?select=id,article_number,heading,body&embedding=is.null&limit=${limit}`, { headers });
  if (!sectionsResponse.ok) return { sections: 0, precedents: 0 };
  const sections = await sectionsResponse.json() as Array<{ id: string; article_number: string | null; heading: string | null; body: string }>;

  let sectionsIndexed = 0;
  for (const section of sections) {
    const text = `${section.article_number ?? ''} ${section.heading ?? ''} ${section.body}`.trim();
    if (text.length < 20) continue;
    const embedding = await embedText(text, fetchImpl);
    if (!embedding) break;
    const patch = await fetchImpl(`${baseUrl}/rest/v1/legal_source_sections?id=eq.${section.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ embedding: `[${embedding.join(',')}]` }),
    });
    if (patch.ok) sectionsIndexed++;
  }

  const precedentsResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_precedents?select=id,title,summary,principle_text&embedding=is.null&limit=${limit}`, { headers });
  if (!precedentsResponse.ok) return { sections: sectionsIndexed, precedents: 0 };
  const precedents = await precedentsResponse.json() as Array<{ id: string; title: string; summary: string; principle_text: string | null }>;

  let precedentsIndexed = 0;
  for (const precedent of precedents) {
    const text = `${precedent.title} ${precedent.summary} ${precedent.principle_text ?? ''}`.trim();
    if (text.length < 20) continue;
    const embedding = await embedText(text, fetchImpl);
    if (!embedding) break;
    const patch = await fetchImpl(`${baseUrl}/rest/v1/legal_precedents?id=eq.${precedent.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ embedding: `[${embedding.join(',')}]` }),
    });
    if (patch.ok) precedentsIndexed++;
  }

  return { sections: sectionsIndexed, precedents: precedentsIndexed };
}
