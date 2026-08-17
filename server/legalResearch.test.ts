import { describe, expect, it } from 'vitest';
import { answerSchema, buildGapResult, buildResearchResult } from './legalResearch';

describe('verified legal research assembly', () => {
  it('declares a research gap without any model output when no evidence matches', () => {
    const gap = buildGapResult('ما أحكام الضرائب على الشركات الأمريكية؟', 'none', ['الضرائب', 'الشركات']);
    expect(gap.gap).toBe(true);
    expect(gap.answer).toBeNull();
    expect(gap.citations).toEqual([]);
    expect(gap.suggestedFollowUps.length).toBeGreaterThan(0);
    expect(gap.limitations).toContain('فجوة');
  });

  it('drops invented citation ids and keeps only verified context ids', () => {
    const citations = [
      { id: 'sec-1', sourceId: 's-1', title: 'قانون المرافعات', url: 'https://example.com', officialNumber: '13/1990', articleNumber: '146', heading: 'مواعيد', body: 'ميعاد الطعن بالنقض ستون يوماً.', relevanceScore: 0.9, matchedTerms: ['الطعن'], excerpt: '…' },
      { id: 'sec-2', sourceId: 's-2', title: 'قانون العقوبات', url: 'https://example.com/2', officialNumber: '11/2004', articleNumber: '40', heading: 'مادة', body: 'مادة (40): كل من أفشى سراً...يعاقب.', relevanceScore: 0.7, matchedTerms: ['إفشاء'], excerpt: '…' },
    ];
    const parsed = answerSchema.parse({
      summary: 'ملخص',
      rule: '«ميعاد الطعن بالنقض ستون يوماً» وفق المادة 146.',
      exceptions: [],
      application: [],
      uncertainties: [],
      gapDeclaration: null,
      citedSourceIds: ['sec-1', 'invented-id'],
      citedPrecedentIds: [],
    });
    const result = buildResearchResult(parsed, citations, []);
    expect(result.citations.map(citation => citation.id)).toEqual(['sec-1']);
    expect(result.gap).toBe(false);
  });

  it('runs the citation gate over generated analysis and flags fabricated quotes', () => {
    const citations = [
      { id: 'sec-1', sourceId: 's-1', title: 'قانون العقوبات', url: 'https://example.com', officialNumber: '11/2004', articleNumber: '40', heading: 'مادة', body: 'مادة (40): يعاقب بالحبس كل من أفشى سراً من أسرار العمل.', relevanceScore: 0.9, matchedTerms: ['إفشاء'], excerpt: '…' },
    ];
    const parsed = answerSchema.parse({
      summary: 'تحليل',
      rule: '«يعاقب بالحبس كل من أفشى سراً من أسرار العمل» وتقضي المادة 777 بذات المعنى.',
      exceptions: [],
      application: [],
      uncertainties: [],
      gapDeclaration: null,
      citedSourceIds: ['sec-1'],
      citedPrecedentIds: [],
    });
    const result = buildResearchResult(parsed, citations, []);
    expect(result.verification.verifiedQuotes).toHaveLength(1);
    expect(result.verification.unverifiedArticles).toEqual(['777']);
    expect(result.verification.passed).toBe(false);
  });
});
