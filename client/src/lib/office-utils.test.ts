import { describe, expect, it } from 'vitest';
import { caseStatusLabel, isOverdue, isReminderDue, isWithinDays, roleLabel } from './office-utils';

describe('office interface helpers', () => {
  it('renders Arabic labels for protected roles and case states', () => {
    expect(roleLabel('lawyer')).toBe('محامٍ');
    expect(caseStatusLabel('appeal')).toBe('استئناف');
  });

  it('only treats unfinished tasks whose deadline passed as overdue', () => {
    expect(isOverdue('2020-01-01T00:00:00.000Z', 'in_progress')).toBe(true);
    expect(isOverdue('2020-01-01T00:00:00.000Z', 'completed')).toBe(false);
  });

  it('flags only scheduled hearings whose reminder has become due', () => {
    const now = Date.parse('2026-08-14T10:00:00.000Z');
    expect(isReminderDue('2026-08-14T09:00:00.000Z', 'scheduled', now)).toBe(true);
    expect(isReminderDue('2026-08-14T11:00:00.000Z', 'scheduled', now)).toBe(false);
    expect(isReminderDue('2026-08-14T09:00:00.000Z', 'held', now)).toBe(false);
  });

  it('filters timestamps to the selected reporting window', () => {
    const now = Date.parse('2026-08-14T10:00:00.000Z');
    expect(isWithinDays('2026-08-01T10:00:00.000Z', 30, now)).toBe(true);
    expect(isWithinDays('2026-06-01T10:00:00.000Z', 30, now)).toBe(false);
  });
});
