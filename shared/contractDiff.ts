/**
 * مقارنة نسختي مستند سطراً بسطر (LCS) لعرض التغييرات بين نسختي العقد.
 * دوال نقية تستخدم في واجهة استديو العقود وقابلة للاختبار مباشرة.
 */

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = rows - 2; i >= 0; i--) {
    for (let j = cols - 2; j >= 0; j--) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'removed', text: left[i] });
      i++;
    } else {
      result.push({ kind: 'added', text: right[j] });
      j++;
    }
  }
  while (i < left.length) result.push({ kind: 'removed', text: left[i++] });
  while (j < right.length) result.push({ kind: 'added', text: right[j++] });
  return result;
}

export function summarizeDiff(diff: DiffLine[]) {
  const added = diff.filter(line => line.kind === 'added').length;
  const removed = diff.filter(line => line.kind === 'removed').length;
  return { added, removed, unchanged: diff.length - added - removed, changed: added + removed > 0 };
}
