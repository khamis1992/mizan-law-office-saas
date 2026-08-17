import { assessEvidence, extractSearchTerms, rankSections, type RankableSection, type RankedSection } from '../retrieval';
import { readResponse, requiredEnv, supabaseHeaders } from '../supabaseAccess';
import { CANDIDATE_LIMIT } from '../retrieval';

/**
 * مجموعة التقييم المرجعية (المرحلة 0 في خارطة التحول).
 * أسئلة ذهبية مقابل المصادر المستوردة فعلاً في سجل المصادر،
 * مع حالات فجوة مقصودة يجب أن يعلنها النظام بدل توليد إجابة بلا دليل.
 * التوسيع إلى 30–50 سؤالاً يتم بإقرار محامين للإجابات المرجعية، والبنية جاهزة لذلك.
 */

export type EvalItem = {
  id: string;
  question: string;
  /** يعد السؤال مستوفى إذا استُرجع مقطع يحتوي عنوان مصدره إحدى الكلمات المفتاحية */
  expectedSourceKeywords: string[];
  expectGap: boolean;
};

export const LEGAL_EVAL_SET: EvalItem[] = [
  { id: 'civil-appeal-cassation', question: 'ما هو ميعاد الطعن بالنقض في الأحكام المدنية وفق قانون المرافعات القطري؟', expectedSourceKeywords: ['المرافعات'], expectGap: false },
  { id: 'civil-decisive-oath', question: 'ما حكم اليمين الحاسمة في الإثبات ومن يجوز توجيهها إليه؟', expectedSourceKeywords: ['المرافعات'], expectGap: false },
  { id: 'criminal-limitation', question: 'متى تسقط الدعوى الجزائية بمضي المدة في القانون القطري؟', expectedSourceKeywords: ['الإجراءات الجنائية'], expectGap: false },
  { id: 'criminal-search', question: 'ما الضوابط النظامية للتفتيش والقبض على المتهم؟', expectedSourceKeywords: ['الإجراءات الجنائية'], expectGap: false },
  { id: 'penal-secrets', question: 'ما عقوبة إفشاء أسرار العمل من قبل الموظف؟', expectedSourceKeywords: ['العقوبات'], expectGap: false },
  { id: 'penal-forgery', question: 'كيف يعرف قانون العقوبات جريمة التزوير وعقوبتها؟', expectedSourceKeywords: ['العقوبات'], expectGap: false },
  { id: 'constitution-litigation', question: 'ما نص الدستور القطري على الحق في التقاضي وكفالة الدفاع؟', expectedSourceKeywords: ['الدستور'], expectGap: false },
  { id: 'constitution-equality', question: 'ما مبدأ المساواة أمام القانون في الدستور الدائم لقطر؟', expectedSourceKeywords: ['الدستور'], expectGap: false },
  { id: 'civil-jurisdiction', question: 'كيف يحدد قانون المرافعات اختصاص المحاكم الجزئية والكلية؟', expectedSourceKeywords: ['المرافعات'], expectGap: false },
  { id: 'criminal-bail', question: 'ما أحكام الإفراج بكفالة عن المتهم المحبوس احتياطياً؟', expectedSourceKeywords: ['الإجراءات الجنائية'], expectGap: false },
  { id: 'penal-liability', question: 'ما شروط المسؤولية الجزائية عن الجرائم في قانون العقوبات القطري؟', expectedSourceKeywords: ['العقوبات'], expectGap: false },
  // أسئلة فجوة معايرة تجريبياً على قاعدة المصادر الحقيقية: كل مصطلح مميز فيها
  // إما غائب كلياً أو لا يتجاوز مطابقة واحدة دون عتبة الدليل (مصطلحان قويان).
  { id: 'gap-transport', question: 'ما سرعة القطار ومسار رحلاته بين الدوحة والمنامة؟', expectedSourceKeywords: [], expectGap: true },
  { id: 'gap-herbal', question: 'ما فوائد الزنجبيل الأخضر المعتمدة لضغط الدم المرتفع؟', expectedSourceKeywords: [], expectGap: true },
  { id: 'gap-education', question: 'ما عدد خريجي الهندسة الكهربائية في أوروبا؟', expectedSourceKeywords: [], expectGap: true },
  { id: 'gap-river', question: 'ما مسار نهر النيل وحمولة السفن الملاحية فيه؟', expectedSourceKeywords: [], expectGap: true },
];

export type EvalOutcome = {
  itemId: string;
  retrievedTitles: string[];
  matchedExpectedSource: boolean;
  declaredGap: boolean;
  correct: boolean;
};

export type EvalScore = {
  totalItems: number;
  citationEligibilityRate: number;
  gapAccuracyRate: number;
  overallCorrectRate: number;
  failures: Array<{ itemId: string; reason: string }>;
};

function normalize(text: string) {
  return text.replace(/[\u064B-\u065F\u0670]/g, '').replace(/[\u0623\u0625\u0627\u0671]/g, 'ا').replace(/\s+/g, ' ').trim();
}

/** تقييم نقية: تقارن عناوين المسترجع بتوقعات السؤال دون أي اتصال شبكي. */
export function evaluateItem(item: EvalItem, retrievedTitles: string[], evidenceNone = retrievedTitles.length === 0): EvalOutcome {
  const normalizedTitles = retrievedTitles.map(normalize);
  const matchedExpectedSource = item.expectedSourceKeywords.some(keyword =>
    normalizedTitles.some(title => title.includes(normalize(keyword))),
  );
  const declaredGap = evidenceNone;
  const correct = item.expectGap ? declaredGap : matchedExpectedSource && !declaredGap;
  return { itemId: item.id, retrievedTitles, matchedExpectedSource, declaredGap, correct };
}

export function scoreEvaluation(outcomes: EvalOutcome[]): EvalScore {
  const substantive = outcomes.filter(outcome => !LEGAL_EVAL_SET.find(item => item.id === outcome.itemId)?.expectGap);
  const gaps = outcomes.filter(outcome => LEGAL_EVAL_SET.find(item => item.id === outcome.itemId)?.expectGap);
  const rate = (list: EvalOutcome[]) => (list.length ? list.filter(outcome => outcome.correct).length / list.length : 1);
  return {
    totalItems: outcomes.length,
    citationEligibilityRate: rate(substantive),
    gapAccuracyRate: rate(gaps),
    overallCorrectRate: outcomes.length ? outcomes.filter(outcome => outcome.correct).length / outcomes.length : 0,
    failures: outcomes
      .filter(outcome => !outcome.correct)
      .map(outcome => ({
        itemId: outcome.itemId,
        reason: outcome.declaredGap && !LEGAL_EVAL_SET.find(item => item.id === outcome.itemId)?.expectGap
          ? 'أعلن فجوة رغم وجود مصدر متوقع في السجل'
          : 'لم يسترجع مصدراً مطابقاً أو لم يعلن الفجوة المتوقعة',
      })),
  };
}

/** تشغيل تقييم الاسترجاع على قاعدة المصادر الحقيقية — يتطلب رمز وصول صالحاً. */
export async function runRetrievalEvaluation(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<EvalScore> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  type Row = { id: string; source_id: string; article_number: string | null; heading: string | null; body: string; title: string; source_url: string; official_number: string | null };
  const outcomes: EvalOutcome[] = [];
  for (const item of LEGAL_EVAL_SET) {
    const terms = extractSearchTerms(item.question);
    const ranked = await (async () => {
      if (!terms.length) return [] as RankedSection[];
      const rpc = await fetchImpl(`${baseUrl}/rest/v1/rpc/search_legal_sections`, {
        method: 'POST', headers,
        body: JSON.stringify({ p_query: terms.join(' '), p_limit: CANDIDATE_LIMIT }),
      });
      if (!rpc.ok) return [] as RankedSection[];
      const rows = await rpc.json() as Row[];
      return rankSections(rows.map(row => ({ id: row.id, sourceId: row.source_id, title: row.title, url: row.source_url, officialNumber: row.official_number, articleNumber: row.article_number, heading: row.heading, body: row.body })), terms);
    })();
    const evidenceNone = assessEvidence(ranked) === 'none';
    const titles = evidenceNone ? [] : ranked.map(section => section.title);
    outcomes.push(evaluateItem(item, titles, evidenceNone));
  }

  return scoreEvaluation(outcomes);
}
