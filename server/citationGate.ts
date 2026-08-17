import { extractArticleNumbers, extractQuotedSpans, normalizeArabic } from './legalText';

/**
 * بوابة تحقق الاستشهاد: فحص آلي بعد التوليد وقبل العرض للمستخدم.
 * كل اقتباس حرفي داخل «…» يجب أن يوجد فعلاً في نص أحد المصادر المسترجعة،
 * وكل رقم مادة مذكور يجب أن يكون موجوداً في سياق المصادر، وإلا يُعلَّم «غير موثق».
 */

export type GateSource = {
  id: string;
  title: string;
  body: string;
  articleNumber?: string | null;
  heading?: string | null;
};

export type CitationVerification = {
  verifiedQuotes: string[];
  unverifiedQuotes: string[];
  unverifiedArticles: string[];
  passed: boolean;
};

function availableArticleNumbers(sources: GateSource[]) {
  const numbers = new Set<string>();
  for (const source of sources) {
    const explicit = source.articleNumber ? String(source.articleNumber).trim() : '';
    if (explicit && /^\d+$/.test(explicit)) numbers.add(String(Number(explicit)));
    const body = normalizeArabic(source.body);
    for (const match of body.matchAll(/(?:الماده|ماده)\s*\(?\s*(\d{1,4})\s*\)?/g)) {
      numbers.add(String(Number(match[1])));
    }
    const heading = normalizeArabic(source.heading ?? '');
    for (const match of heading.matchAll(/\((\d{1,4})\)/g)) {
      numbers.add(String(Number(match[1])));
    }
  }
  return numbers;
}

export function verifyCitations(texts: string[], sources: GateSource[]): CitationVerification {
  const normalizedBodies = sources.map(source => normalizeArabic(source.body));
  const availableArticles = availableArticleNumbers(sources);

  const verifiedQuotes: string[] = [];
  const unverifiedQuotes: string[] = [];
  const seenQuotes = new Set<string>();

  for (const text of texts) {
    for (const quote of extractQuotedSpans(text)) {
      const normalized = normalizeArabic(quote);
      const key = normalized.slice(0, 80);
      if (seenQuotes.has(key)) continue;
      seenQuotes.add(key);
      const found = normalizedBodies.some(body => body.includes(normalized));
      if (found) verifiedQuotes.push(quote);
      else unverifiedQuotes.push(quote);
    }
  }

  const unverifiedArticles: string[] = [];
  const seenArticles = new Set<string>();
  for (const text of texts) {
    for (const article of extractArticleNumbers(text)) {
      if (seenArticles.has(article)) continue;
      seenArticles.add(article);
      if (!availableArticles.has(article)) unverifiedArticles.push(article);
    }
  }

  return {
    verifiedQuotes,
    unverifiedQuotes,
    unverifiedArticles,
    passed: unverifiedQuotes.length === 0 && unverifiedArticles.length === 0,
  };
}
