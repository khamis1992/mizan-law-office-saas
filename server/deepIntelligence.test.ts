import { describe, expect, it } from 'vitest';
import { computeQatarAppealDeadlines } from './deepIntelligence';

describe('computeQatarAppealDeadlines', () => {
  const holidays = [
    { holiday_date: '2026-02-18' },
    { holiday_date: '2026-12-18' },
    { holiday_date: '2026-03-20' },
  ];

  it('يحسب 30 يوماً للاستئناف في القضايا المدنية', () => {
    const deadlines = computeQatarAppealDeadlines(new Date('2026-01-01'), 'civil', holidays);
    const appeal = deadlines.find(d => d.type === 'appeal');
    expect(appeal?.days).toBe(30);
    expect(appeal?.dueDate.getFullYear()).toBe(2026);
    expect(appeal?.dueDate.getMonth()).toBe(0); // January
  });

  it('يحسب 15 يوماً للاستئناف في الجنائي', () => {
    const deadlines = computeQatarAppealDeadlines(new Date('2026-01-01'), 'criminal', holidays);
    const appeal = deadlines.find(d => d.type === 'appeal');
    expect(appeal?.days).toBe(15);
  });

  it('يوقف سريان الميعاد عند العطل الرسمية', () => {
    // حكم في 2026-12-01، مدته 10 أيام (معارضة) → ينتهي 12-11 لكن 12-18 عطلة
    const deadlines = computeQatarAppealDeadlines(new Date('2026-12-01'), 'civil', holidays);
    const reconsideration = deadlines.find(d => d.type === 'reconsideration');
    expect(reconsideration?.dueDate.toISOString().slice(0, 10)).toBe('2026-12-11');
  });

  it('يبقى الميعاد على يوم العمل التالي عند العطلة', () => {
    // حكم في 2026-02-10، 10 أيام → 02-20 وهو ليس عطلة (18/2 عطلة لكنها قبل)
    const deadlines = computeQatarAppealDeadlines(new Date('2026-02-10'), 'civil', holidays);
    const reconsideration = deadlines.find(d => d.type === 'reconsideration');
    expect(reconsideration?.dueDate.toISOString().slice(0, 10)).toBe('2026-02-20');
  });

  it('يحسب 60 يوماً للتمييز دائماً', () => {
    const deadlines = computeQatarAppealDeadlines(new Date('2026-01-01'), 'urgent', holidays);
    const cassation = deadlines.find(d => d.type === 'cassation');
    expect(cassation?.days).toBe(60);
  });
});
