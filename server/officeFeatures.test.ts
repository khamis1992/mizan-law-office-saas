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
