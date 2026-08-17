import { describe, expect, it } from 'vitest';
import { isCourtHoliday } from './legalIntelligence';

describe('isCourtHoliday', () => {
  it('يكتشف العطل الرسمية', () => {
    const holidays = [{ holiday_date: '2026-12-18' }, { holiday_date: '2026-02-18' }];
    expect(isCourtHoliday(new Date('2026-12-18T10:00:00Z'), holidays)).toBe(true);
    expect(isCourtHoliday(new Date('2026-12-18'), holidays)).toBe(true);
  });
  it('يعيد false للأيام العادية', () => {
    const holidays = [{ holiday_date: '2026-12-18' }];
    expect(isCourtHoliday(new Date('2026-12-17'), holidays)).toBe(false);
    expect(isCourtHoliday(new Date('2026-01-01'), holidays)).toBe(false);
  });
  it('يتعامل مع قائمة فارغة', () => {
    expect(isCourtHoliday(new Date('2026-12-18'), [])).toBe(false);
  });
});
