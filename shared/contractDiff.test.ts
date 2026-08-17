import { describe, expect, it } from 'vitest';
import { diffLines, summarizeDiff } from '@shared/contractDiff';

describe('contract version diff', () => {
  it('detects added and removed lines between versions', () => {
    const diff = diffLines(
      'البند الأول: التمهيد\nالبند الثاني: الأتعاب\nالبند الثالث: السرية',
      'البند الأول: التمهيد\nالبند الثاني: الأتعاب السنوية\nالبند الثالث: السرية\nالبند الرابع: القانون الواجب التطبيق',
    );
    const summary = summarizeDiff(diff);
    expect(summary.changed).toBe(true);
    expect(summary.added).toBeGreaterThanOrEqual(2);
    expect(summary.removed).toBeGreaterThanOrEqual(1);
    expect(diff.some(line => line.kind === 'same' && line.text.includes('التمهيد'))).toBe(true);
    expect(diff.some(line => line.kind === 'added' && line.text.includes('القانون الواجب التطبيق'))).toBe(true);
  });

  it('reports no changes for identical versions', () => {
    const text = 'البند الأول: التمهيد';
    const summary = summarizeDiff(diffLines(text, text));
    expect(summary.changed).toBe(false);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
  });
});
