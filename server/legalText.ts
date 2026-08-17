/**
 * أدوات معالجة النص القانوني العربي المشتركة بين بوابة التحقق والاسترجاع.
 * التطبيع يزيل الاختلافات الشكلية (تشكيل، همزات، تطويل، ترقيم) دون تغيير المعنى،
 * ويستخدم فقط للمطابقة الآلية، ولا يُخزن نصاً نهائياً للمستخدم.
 */

const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
const HAMZA_FORMS = /[\u0623\u0625\u0627\u0671]/g;
const ALEF_MAQSURA = /\u0649/g;
const TAA_MARBUTA = /\u0629/g;
const NON_WORD = /[^\p{L}\p{N}\s]/gu;
const WHITESPACE = /\s+/g;

const ARABIC_INDIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

export function toLatinDigits(text: string) {
  return text.replace(ARABIC_INDIC_DIGITS, digit => {
    const code = digit.charCodeAt(0);
    const base = code >= 0x06F0 ? 0x06F0 : 0x0660;
    return String(code - base);
  });
}

/** تطبيع نص عربي للمطابقة: بلا تشكيل/تطويل/همزات موحدة/ترقيم، بمسافات مفردة. */
export function normalizeArabic(text: string) {
  return text
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(HAMZA_FORMS, 'ا')
    .replace(ALEF_MAQSURA, 'ي')
    .replace(TAA_MARBUTA, 'ه')
    .replace(NON_WORD, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
}

/** أقل طول (بالأحرف المطبعة) لاقتباس يخضع لبوابة التحقق؛ الأقصر عبارات عامة لا تثبت شيئاً. */
export const MIN_VERIFIABLE_QUOTE_LENGTH = 12;

/** سوابق تعريف ووصل شائعة تُزال قبل مطابقة المصطلح لرفع الاستدعاء. */
const ARABIC_PREFIXES = ['وال', 'فال', 'بال', 'كال', 'ال', 'لل'];

export function stripArabicPrefix(term: string) {
  for (const prefix of ARABIC_PREFIXES) {
    if (term.startsWith(prefix) && term.length - prefix.length >= 3) return term.slice(prefix.length);
  }
  return term;
}

/** يستخرج المقتبسات الحرفية بين «…» أو "…" أو "…" لخضوعها للتحقق. */
export function extractQuotedSpans(text: string, minLength = MIN_VERIFIABLE_QUOTE_LENGTH) {
  const spans: string[] = [];
  const patterns = [/«([^»]{8,600})»/g, /"([^"]{8,600})"/g, /“([^”]{8,600})”/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const inner = match[1].trim();
      if (normalizeArabic(inner).length >= minLength) spans.push(inner);
    }
  }
  return spans;
}

/** يستخرج أرقام المواد المذكورة في النص (المادة 123 / المادة رقم (45) / مادة 7). */
export function extractArticleNumbers(text: string) {
  const numbers = new Set<string>();
  const pattern = /(?:المادة|مادة)\s*(?:رقم\s*)?\(?\s*([\u0660-\u0669\u06F0-\u06F90-9]+)\s*\)?/g;
  for (const match of text.matchAll(pattern)) {
    const normalized = toLatinDigits(match[1]);
    const asNumber = Number(normalized);
    if (Number.isFinite(asNumber) && asNumber > 0 && asNumber <= 2000) numbers.add(String(asNumber));
  }
  return Array.from(numbers);
}

/** حدود الكلمات الدلالية للاسترجاع: كلمات عربية أو لاتينية معتبرة بعد حذف stopwords. */
export const ARABIC_STOPWORDS = new Set([
  'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'الذين',
  'هل', 'ما', 'كيف', 'حول', 'بعد', 'قبل', 'لدى', 'بين', 'عند', 'ثم', 'أو', 'و', 'يكون',
  'تكون', 'عليه', 'عليها', 'له', 'لها', 'قد', 'لا', 'لم', 'لن', 'ماذا', 'لماذا', 'اين',
  'حيث', 'كل', 'بعض', 'غير', 'سوى', 'ذات', 'ذو', 'امر', 'حكم', 'احكام',
]);

export function extractSearchTerms(request: string, maxTerms = 6) {
  const raw = request
    .replace(/[^\u0621-\u06FFa-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of raw) {
    const normalized = normalizeArabic(term);
    const bare = stripArabicPrefix(normalized);
    if (bare.length < 3) continue;
    if (ARABIC_STOPWORDS.has(term) || ARABIC_STOPWORDS.has(normalized) || ARABIC_STOPWORDS.has(bare)) continue;
    if (seen.has(bare)) continue;
    seen.add(bare);
    terms.push(bare);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}
