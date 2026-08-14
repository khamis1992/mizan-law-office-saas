import { describe, expect, it } from 'vitest';
import { filterPlatformAudits, type OpsAudit } from './PlatformOperations';

const now = Date.parse('2026-08-14T12:00:00Z');
const audits: OpsAudit[] = [
  { id: 1, action: 'office_suspended', office_id: 'office-a', actor_id: 'admin', metadata: { reason: 'billing' }, created_at: '2026-08-12T12:00:00Z' },
  { id: 2, action: 'profile_updated_by_platform', office_id: 'office-b', actor_id: 'admin', metadata: { role: 'lawyer' }, created_at: '2026-07-01T12:00:00Z' },
];
const officeName = (id:string|null) => id === 'office-a' ? 'مكتب ألف' : id === 'office-b' ? 'مكتب باء' : 'المنصة';

describe('filterPlatformAudits', () => {
  it('filters by office and action', () => {
    const result = filterPlatformAudits(audits, { query: '', officeId: 'office-a', action: 'office_suspended', periodDays: 'all' }, officeName, now);
    expect(result.map(x=>x.id)).toEqual([1]);
  });
  it('filters by period and searchable metadata', () => {
    expect(filterPlatformAudits(audits, { query: 'billing', officeId: 'all', action: 'all', periodDays: '7' }, officeName, now).map(x=>x.id)).toEqual([1]);
    expect(filterPlatformAudits(audits, { query: 'lawyer', officeId: 'all', action: 'all', periodDays: 'all' }, officeName, now).map(x=>x.id)).toEqual([2]);
  });
});
