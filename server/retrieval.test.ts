import { describe, expect, it } from 'vitest';
import { assessEvidence, buildCandidateFilter, expandLegalSearchTerms, extractSearchTerms, isSourceCompatibleWithDisputeType, rankSections, suggestFollowUps, type RankableSection } from './retrieval';

const sections: RankableSection[] = [
  {
    id: 'irrelevant-1', sourceId: 's1', title: 'قانون العقوبات', url: 'https://example.com/1', officialNumber: '11/2004',
    articleNumber: null, heading: 'فصل تمهيدي',
    body: 'الأصل في المتهم البراءة ولا يجوز الإضرار به بسبب الشك في قيام الأدلة.',
  },
  {
    id: 'relevant-1', sourceId: 's2', title: 'قانون المرافعات المدنية والتجارية', url: 'https://example.com/2', officialNumber: '13/1990',
    articleNumber: '146', heading: 'مواعيد الطعن بالنقض',
    body: 'ميعاد الطعن بالنقض ستون يوماً ولا يقبل الطعن بالنقض بعد فوات الميعاد المقرر قانوناً.',
  },
  {
    id: 'relevant-2', sourceId: 's2', title: 'قانون المرافعات المدنية والتجارية', url: 'https://example.com/2', officialNumber: '13/1990',
    articleNumber: '147', heading: 'أثر الطعن',
    body: 'رفع الطعن بالنقض لا يوقف تنفيذ الحكم المطعون فيه إلا إذا قضت المحكمة بوقف التنفيذ.',
  },
];

describe('relevance-filtered retrieval', () => {
  it('builds a PostgREST or-filter from question terms with prefixes stripped', () => {
    const terms = extractSearchTerms('ما هو ميعاد الطعن بالنقض؟');
    const filter = buildCandidateFilter(terms);
    expect(filter).toContain('body.ilike.*طعن*');
    expect(filter).toContain('heading.ilike.*نقض*');
    expect(filter?.startsWith('(')).toBe(true);
  });

  it('returns null filter when no meaningful terms exist', () => {
    expect(buildCandidateFilter(['في', 'من', 'على'])).toBeNull();
  });

  it('ranks sections matching the question terms above non-matching ones', () => {
    const terms = extractSearchTerms('ما هو ميعاد الطعن بالنقض في الأحكام المدنية؟');
    const ranked = rankSections(sections, terms);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.map(section => section.id)).not.toContain('irrelevant-1');
    expect(['relevant-1', 'relevant-2']).toContain(ranked[0].id);
    expect(ranked[0].matchedTerms.length).toBeGreaterThan(0);
  });

  it('keeps relevance scores within [0, 1]', () => {
    const ranked = rankSections(sections, extractSearchTerms('الطعن بالنقض ميعاد'));
    for (const section of ranked) {
      expect(section.relevanceScore).toBeLessThanOrEqual(1);
      expect(section.relevanceScore).toBeGreaterThan(0);
    }
  });

  it('rejects criminal sources for civil research while keeping shared civil-commercial sources', () => {
    expect(isSourceCompatibleWithDisputeType('قانون رقم (23) لسنة 2004 بإصدار قانون الإجراءات الجنائية', 'civil')).toBe(false);
    expect(isSourceCompatibleWithDisputeType('قانون المرافعات المدنية والتجارية', 'civil')).toBe(true);
    expect(isSourceCompatibleWithDisputeType('قانون المرافعات المدنية والتجارية', 'commercial')).toBe(true);
    expect(isSourceCompatibleWithDisputeType('دستور دولة قطر', 'civil')).toBe(true);
  });

  it('uses the source title when ranking domain-specific questions', () => {
    const ranked = rankSections(sections, extractSearchTerms('ميعاد الطعن في الأحكام المدنية'));
    expect(ranked[0].id).toBe('relevant-1');
    expect(ranked[0].matchedTerms).toContain('مدنيه');
  });

  it('maps cassation wording to Qatari Court of Cassation terminology', () => {
    expect(expandLegalSearchTerms(['ميعاد', 'طعن', 'نقض'])).toContain('تمييز');
  });

  it('does not answer a cassation question with an appeal deadline', () => {
    const appeal: RankableSection = {
      id: 'appeal', sourceId: 's2', title: 'قانون المرافعات المدنية والتجارية', url: 'https://example.com/2', officialNumber: '13/1990',
      articleNumber: '164', heading: 'ميعاد الاستئناف', body: 'ميعاد الاستئناف ثلاثون يوماً ما لم ينص القانون على غير ذلك.',
    };
    const cassation: RankableSection = {
      id: 'cassation', sourceId: 's2', title: 'قانون المرافعات المدنية والتجارية', url: 'https://example.com/2', officialNumber: '13/1990',
      articleNumber: '178', heading: 'ميعاد الطعن بالتمييز', body: 'ميعاد الطعن بالتمييز ستون يوماً.',
    };
    const ranked = rankSections([appeal, cassation], expandLegalSearchTerms(extractSearchTerms('ما ميعاد الطعن بالنقض؟')));
    expect(ranked.map(section => section.id)).toEqual(['cassation']);
  });

  it('rejects generic appeal-timing sections when cassation is requested', () => {
    const suspension: RankableSection = {
      id: 'suspension', sourceId: 's2', title: 'قانون المرافعات المدنية والتجارية', url: 'https://example.com/2', officialNumber: '13/1990',
      articleNumber: '160', heading: null, body: 'يقف ميعاد الطعن بموت المحكوم عليه أو بفقد أهليته للتقاضي.',
    };
    const terms = expandLegalSearchTerms(extractSearchTerms('ما ميعاد الطعن بالنقض في الأحكام المدنية؟'));
    expect(rankSections([suspension], terms)).toEqual([]);
  });

  it('assesses evidence quality: none without two strong term matches, adequate on multi-term evidence', () => {
    // سؤال مفردات قانونية عامة لا تكفي وحدها دليلاً
    expect(assessEvidence(rankSections(sections, extractSearchTerms('رسوم التوثيق العقاري الأمريكي')))).toBe('none');
    // سؤال غريب كلياً عن القاعدة
    expect(assessEvidence(rankSections(sections, extractSearchTerms('ما سرعة القطار ومسار رحلاته؟')))).toBe('none');
    // سؤال قانوني بمصطلحات قوية متعددة يستوفي الدليل
    const ranked = rankSections(sections, extractSearchTerms('ميعاد الطعن بالنقض ستون يوماً وفق المرافعات'));
    expect(ranked.length).toBeGreaterThan(0);
    expect(assessEvidence(ranked)).toBe('adequate');
  });

  it('suggests concrete follow-up queries when a research gap is declared', () => {
    const followUps = suggestFollowUps('ما حكم المصالحة في مسائل المواريث؟', extractSearchTerms('ما حكم المصالحة في مسائل المواريث'));
    expect(followUps.length).toBeGreaterThan(0);
    expect(followUps.every(item => item.length > 10)).toBe(true);
  });
});
