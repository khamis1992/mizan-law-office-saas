import { describe, expect, it } from 'vitest';
import { calculateSaasAnalytics, filterPlatformAudits, type OpsAudit, type OpsEvent, type OpsInvoice, type OpsPlan, type OpsSubscription } from './PlatformOperations';

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

describe('calculateSaasAnalytics', () => {
  it('calculates revenue, conversion, churn, and plan breakdown from known records', () => {
    const plans: OpsPlan[] = [
      { id:'plan-a', code:'a', name_ar:'الخطة أ', description_ar:null, monthly_price_qar:100, annual_price_qar:1000, max_users:3, max_cases:30, ai_monthly_requests:20, features:[], is_active:true, sort_order:1 },
      { id:'plan-b', code:'b', name_ar:'الخطة ب', description_ar:null, monthly_price_qar:200, annual_price_qar:2000, max_users:8, max_cases:80, ai_monthly_requests:60, features:[], is_active:true, sort_order:2 },
    ];
    const subscriptions: OpsSubscription[] = [{office_id:'office-a',plan_id:'plan-a',status:'active'},{office_id:'office-b',plan_id:'plan-b',status:'active'},{office_id:'office-c',plan_id:'plan-b',status:'trialing'}];
    const invoices: OpsInvoice[] = [{id:'i1',office_id:'office-a',total_amount:100,status:'paid',created_at:'2026-08-10T00:00:00Z'},{id:'i2',office_id:'office-b',total_amount:200,status:'issued',created_at:'2026-08-12T00:00:00Z'},{id:'i3',office_id:'office-b',total_amount:999,status:'void',created_at:'2026-08-13T00:00:00Z'},{id:'i4',office_id:'office-a',total_amount:500,status:'paid',created_at:'2026-06-01T00:00:00Z'}];
    const events: OpsEvent[] = [{id:1,office_id:'office-a',event_type:'renewed',created_at:'2026-08-01T00:00:00Z'},{id:2,office_id:'office-b',event_type:'renewed',created_at:'2026-08-02T00:00:00Z'},{id:3,office_id:'office-c',event_type:'cancelled',created_at:'2026-08-03T00:00:00Z'}];
    expect(calculateSaasAnalytics({officeCount:4,subscriptions,invoices,events,plans,now:Date.parse('2026-08-14T12:00:00Z')})).toEqual({mrr:300,arr:3600,conversion:50,churn:33,revenueByPlan:[{name:'الخطة أ',total:100},{name:'الخطة ب',total:200}]});
  });
});
