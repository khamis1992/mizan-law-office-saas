import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSITIONS, canTransition, CONTRACT_STATUSES, renderTemplate } from './contractStudio';

describe('contract approval workflow', () => {
  it('follows the mandated lifecycle: draft → in_review → approved → ready_for_export', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('in_review', 'approved')).toBe(true);
    expect(canTransition('approved', 'ready_for_export')).toBe(true);
  });

  it('blocks skipping stages and any backward slide after approval', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('draft', 'ready_for_export')).toBe(false);
    expect(canTransition('approved', 'draft')).toBe(false);
    expect(canTransition('ready_for_export', 'draft')).toBe(false);
    expect(ALLOWED_TRANSITIONS.ready_for_export).toEqual([]);
  });

  it('allows returning a reviewed document to draft (rejection path) but not after approval', () => {
    expect(canTransition('in_review', 'draft')).toBe(true);
  });

  it('defines exactly the four lifecycle statuses', () => {
    expect(CONTRACT_STATUSES).toEqual(['draft', 'in_review', 'approved', 'ready_for_export']);
  });
});

describe('template variable rendering', () => {
  it('substitutes answers into {{key}} placeholders', () => {
    const rendered = renderTemplate('يلتزم {{client_name}} بسداد {{fee_amount}} ريال قطري.', { client_name: 'شركة الخليج', fee_amount: '5000' });
    expect(rendered).toBe('يلتزم شركة الخليج بسداد 5000 ريال قطري.');
  });

  it('keeps the placeholder visible when a value is missing instead of inventing one', () => {
    const rendered = renderTemplate('العميل: {{client_name}}', {});
    expect(rendered).toBe('العميل: {{client_name}}');
  });
});
