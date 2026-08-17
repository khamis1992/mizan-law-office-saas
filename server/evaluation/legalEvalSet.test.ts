import { describe, expect, it } from 'vitest';
import { LEGAL_EVAL_SET, evaluateItem, scoreEvaluation } from './legalEvalSet';

describe('golden evaluation set', () => {
  it('contains substantive questions bound to imported sources and deliberate gap cases', () => {
    const substantive = LEGAL_EVAL_SET.filter(item => !item.expectGap);
    const gaps = LEGAL_EVAL_SET.filter(item => item.expectGap);
    expect(substantive.length).toBeGreaterThanOrEqual(10);
    expect(gaps.length).toBeGreaterThanOrEqual(4);
    for (const item of substantive) {
      expect(item.expectedSourceKeywords.length).toBeGreaterThan(0);
      expect(item.question.length).toBeGreaterThan(15);
    }
  });

  it('counts an item correct when the expected source is retrieved', () => {
    const outcome = evaluateItem(
      LEGAL_EVAL_SET.find(item => item.id === 'civil-appeal-cassation')!,
      ['قانون رقم (13) لسنة 1990 بإصدار قانون المرافعات المدنية والتجارية'],
    );
    expect(outcome.correct).toBe(true);
    expect(outcome.matchedExpectedSource).toBe(true);
  });

  it('counts a gap item correct only when the system declares the gap', () => {
    const gapItem = LEGAL_EVAL_SET.find(item => item.id === 'gap-education')!;
    expect(evaluateItem(gapItem, [], true).correct).toBe(true);
    expect(evaluateItem(gapItem, ['قانون العقوبات']).correct).toBe(false);
  });

  it('flags a substantive question as failed when it wrongly declares a gap', () => {
    const outcome = evaluateItem(LEGAL_EVAL_SET.find(item => item.id === 'penal-secrets')!, []);
    expect(outcome.correct).toBe(false);
    const score = scoreEvaluation([outcome]);
    expect(score.failures).toHaveLength(1);
    expect(score.failures[0].reason).toContain('رغم وجود مصدر متوقع');
  });

  it('produces rates over the full set', () => {
    const outcomes = LEGAL_EVAL_SET.map(item =>
      item.expectGap ? evaluateItem(item, []) : evaluateItem(item, ['مصدر غير متوقع']),
    );
    const score = scoreEvaluation(outcomes);
    expect(score.totalItems).toBe(LEGAL_EVAL_SET.length);
    expect(score.gapAccuracyRate).toBe(1);
    expect(score.citationEligibilityRate).toBe(0);
    expect(score.overallCorrectRate).toBeGreaterThan(0);
  });
});
