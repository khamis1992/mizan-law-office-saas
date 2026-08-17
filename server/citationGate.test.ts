import { describe, expect, it } from 'vitest';
import { verifyCitations, type GateSource } from './citationGate';

const sources: GateSource[] = [
  {
    id: 'section-1',
    title: 'قانون الإجراءات الجنائية',
    body: 'مادة (10): تسقط الدعوى الجزائية بمضي المدة إلا كما هو محدد في هذا القانون.',
    articleNumber: '10',
    heading: 'مادة (10)',
  },
  {
    id: 'section-2',
    title: 'قانون المرافعات المدنية والتجارية',
    body: 'يجب أن يُرفع الطعن بالنقض خلال ستين يوماً من تاريخ صدور الحكم المطعون فيه.',
    articleNumber: null,
    heading: 'مواعيد الطعون',
  },
];

describe('citation verification gate', () => {
  it('accepts a verbatim quote that exists in a retrieved source', () => {
    const verification = verifyCitations(['نص القانون: «تسقط الدعوى الجزائية بمضي المدة» وهو ما يطبق هنا.'], sources);
    expect(verification.verifiedQuotes).toHaveLength(1);
    expect(verification.unverifiedQuotes).toHaveLength(0);
    expect(verification.passed).toBe(true);
  });

  it('flags an invented quote as unverified even when it sounds legal', () => {
    const verification = verifyCitations(['تقضي المادة بأن «الطعن بالنقش يوقف تنفيذ الحكم المنشود» حسب الأصول.'], sources);
    expect(verification.unverifiedQuotes).toHaveLength(1);
    expect(verification.passed).toBe(false);
  });

  it('matches quotes despite diacritics and hamza orthographic differences', () => {
    const verification = verifyCitations(['«تَسقُط الدَّعوى الجزائيَّة بمُضيِّ المُدَّة» مبدأ مستقر.'], sources);
    expect(verification.verifiedQuotes).toHaveLength(1);
  });

  it('flags article numbers that are absent from the retrieved context', () => {
    const verification = verifyCitations(['تقضي المادة رقم 999 بهذا الخصوص.'], sources);
    expect(verification.unverifiedArticles).toEqual(['999']);
    expect(verification.passed).toBe(false);
  });

  it('accepts article numbers present in the sources', () => {
    const verification = verifyCitations(['وفق المادة 10 من قانون الإجراءات الجنائية.'], sources);
    expect(verification.unverifiedArticles).toEqual([]);
    expect(verification.passed).toBe(true);
  });
});
