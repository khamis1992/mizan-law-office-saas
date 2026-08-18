import { describe, expect, it } from 'vitest';
import { normalizePartyName, renderMemoTemplate } from './officeFeatures';

describe('normalizePartyName', () => {
  it('يوحّد الهمزات والتشكيل والتاء المربوطة', () => {
    expect(normalizePartyName('شركةُ الخليجِ للتّجارة')).toBe('شركه الخليج للتجاره');
  });
  it('يزيل المسافات المتكررة ويوحّد الحالة', () => {
    expect(normalizePartyName('  شركة   الخليج  ')).toBe('شركه الخليج');
  });
  it('يطابق الأسماء المتشابهة شكلياً', () => {
    expect(normalizePartyName('أحمد محمد')).toBe(normalizePartyName('احمد محمد'));
  });
});

describe('renderMemoTemplate', () => {
  it('يستبدل المتغيرات بالقيم', () => {
    const body = 'محكمة {{court_name}}\nالدعوى رقم: {{case_number}}';
    expect(renderMemoTemplate(body, { court_name: 'محكمة الدوحة الابتدائية', case_number: '2026/1234' }))
      .toBe('محكمة محكمة الدوحة الابتدائية\nالدعوى رقم: 2026/1234');
  });
  it('يبقي المتغير غير المعبأ كما هو', () => {
    expect(renderMemoTemplate('المدعي: {{claimant}}', {})).toBe('المدعي: {{claimant}}');
  });
});

describe('seedMemoTemplatesIfEmpty', () => {
  it('???? ??????? ??????? ??? ???? ????', async () => {
    const { seedMemoTemplatesIfEmpty } = await import('./officeFeatures');
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url: String(url), body: init?.body });
      if (String(url).includes('memo_templates?select=code')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (String(url).includes('/memo_templates') && init?.method === 'POST' && !String(url).includes('sections')) {
        return new Response(JSON.stringify([{ id: 'template-1' }]), { status: 201 });
      }
      return new Response(JSON.stringify([{ id: 'section-1' }]), { status: 201 });
    }) as unknown as typeof fetch;
    await seedMemoTemplatesIfEmpty('token', fetchImpl);
    const inserts = calls.filter(c => c.body && c.body.includes('defense_memo_qa') || c.body && c.body.includes('reply_memo_qa') || c.body && c.body.includes('appeal_memo_qa'));
    expect(inserts.length).toBeGreaterThanOrEqual(3);
  });
});
