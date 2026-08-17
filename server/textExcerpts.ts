/**
 * أدوات مقتطفات النص القانوني — محفوظة بنفس سلوك المساعد الأصلي
 * (مصطلحات بحث أولية وبناء مقتطف حول أول إصابة).
 */

const IGNORED_TERMS = new Set(['في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'التي', 'الذي', 'هل', 'ما', 'كيف', 'حول', 'بعد', 'قبل', 'لدى']);

export function searchTerms(request: string) {
  return request
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length >= 3 && !IGNORED_TERMS.has(term))
    .slice(0, 5);
}

export function buildExcerpt(body: string, terms: string[]) {
  const lowerBody = body.toLocaleLowerCase('ar');
  const hit = terms.map(term => lowerBody.indexOf(term.toLocaleLowerCase('ar'))).find(index => index >= 0) ?? 0;
  const from = Math.max(0, hit - 450);
  const to = Math.min(body.length, hit + 1350);
  return `${from > 0 ? '…' : ''}${body.slice(from, to).trim()}${to < body.length ? '…' : ''}`;
}
