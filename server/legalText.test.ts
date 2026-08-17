import { describe, expect, it } from 'vitest';
import { extractArticleNumbers, extractQuotedSpans, extractSearchTerms, normalizeArabic, toLatinDigits } from './legalText';

describe('arabic text normalization', () => {
  it('unifies hamza forms, diacritics, and tatweel so quotes match despite orthographic variance', () => {
    const source = 'أنْ تُقدَّم المسؤولية عن الأشياء';
    const variant = 'ان تقدم المسؤوليه عن الاشياء';
    expect(normalizeArabic(source)).toBe(normalizeArabic(variant));
  });

  it('strips punctuation and collapses whitespace without changing letters', () => {
    expect(normalizeArabic('المادة (25): يُحكم… بالحبس!')).toBe('الماده 25 يحكم بالحبس');
  });

  it('converts arabic-indic digits to latin digits', () => {
    expect(toLatinDigits('المادة ١٢٣ و٤٥')).toBe('المادة 123 و45');
  });
});

describe('quoted span extraction', () => {
  it('extracts guillemet and double-quoted spans of verifiable length', () => {
    const text = 'نصت المادة على أن «تسقط الدعوى الجزائية بمضي المدة» ثم أضاف "المدة عشر سنوات" لغير ذلك.';
    const spans = extractQuotedSpans(text);
    expect(spans).toContain('تسقط الدعوى الجزائية بمضي المدة');
    expect(spans).toContain('المدة عشر سنوات');
  });

  it('ignores short phrases that cannot establish a citation', () => {
    expect(extractQuotedSpans('وردت «النيابة» في النص')).toEqual([]);
  });
});

describe('article number extraction', () => {
  it('extracts digits from different article reference styles', () => {
    const numbers = extractArticleNumbers('استناداً إلى المادة 25 والمادة رقم (140) ومادة ٩ من القانون');
    expect(numbers.sort((a, b) => Number(a) - Number(b))).toEqual(['9', '25', '140']);
  });
});

describe('search term extraction', () => {
  it('drops stopwords, strips prefixes, and keeps distinct meaningful terms', () => {
    const terms = extractSearchTerms('ما هي مدة الطعن بالنقض في الأحكام الجزائية من تاريخ صدور الحكم؟');
    expect(terms).toContain('طعن');
    expect(terms).toContain('نقض');
    expect(terms).toContain('جزائيه');
    expect(terms).not.toContain('في');
    expect(terms).not.toContain('ما');
    expect(new Set(terms).size).toBe(terms.length);
  });
});
