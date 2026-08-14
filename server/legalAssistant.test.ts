import { describe, expect, it } from 'vitest';
import { buildLegalSystemPrompt, sanitizeAssistantOutput } from './legalAssistant';

const sources = [{
  id: 'source-section-1',
  sourceId: 'source-1',
  title: 'قانون الإجراءات الجنائية',
  url: 'https://www.almeezan.qa/LawPage.aspx?id=3971&language=ar',
  officialNumber: '23/2004',
  articleNumber: 'النص الكامل',
  excerpt: 'مصدر رسمي مختصر للاختبار.',
}];

describe('legal assistant safeguards', () => {
  it('makes the source-bound citation rule explicit in the model instructions', () => {
    const prompt = buildLegalSystemPrompt(sources);
    expect(prompt).toContain('لا تنسب نصاً أو حكماً أو مادة قانونية إلى مصدر غير موجود');
    expect(prompt).toContain('source-section-1');
  });

  it('drops any AI citation that is not in the verified source context', () => {
    const output = sanitizeAssistantOutput({
      summary: 'ملخص',
      legalIssues: [],
      proposedDefences: [],
      clarificationQuestions: [],
      draft: 'مسودة للمراجعة المهنية.',
      citedSourceIds: ['source-section-1', 'invented-source'],
      citedPrecedentIds: ['invented-precedent'],
      limitations: 'يتطلب تحقق المحامي.',
    }, sources);

    expect(output.citedSourceIds).toEqual(['source-section-1']);
    expect(output.citations).toHaveLength(1);
  });

  it('returns matching verified precedents as search results without trusting invented precedent ids', () => {
    const precedents = [{
      id: 'precedent-1', courtName: 'محكمة التمييز', referenceNumber: '116/2008', decidedOn: '2009-01-27',
      classification: 'تجاري', title: 'سابقة موثقة', summary: 'ملخص الحكم', principleText: null, url: 'https://www.almeezan.qa/RulingPage.aspx?id=449&language=ar', relevanceScore: 1,
    }];
    const output = sanitizeAssistantOutput({
      summary: 'ملخص', legalIssues: [], proposedDefences: [], clarificationQuestions: [], draft: 'مسودة',
      citedSourceIds: [], citedPrecedentIds: ['invented-precedent'], limitations: 'مراجعة مطلوبة.',
    }, sources, precedents);

    expect(output.citedPrecedentIds).toEqual([]);
    expect(output.similarPrecedents).toHaveLength(1);
  });
});
