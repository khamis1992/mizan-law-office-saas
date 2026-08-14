import { describe, expect, it, vi } from 'vitest';
const save = vi.fn();
const addImage = vi.fn();
vi.mock('html2canvas', () => ({ default: vi.fn(async () => ({ width: 500, height: 700, toDataURL: () => 'data:image/png;base64,abc' })) }));
vi.mock('jspdf', () => ({ jsPDF: vi.fn(() => ({ addImage, addPage: vi.fn(), save })) }));
import { buildInvoiceDocumentHtml, downloadInvoicePdf } from './invoice-pdf';

describe('invoice PDF document', () => {
  it('includes the invoice number, status, payment reference, and totals in printable HTML', () => {
    const html = buildInvoiceDocumentHtml({ invoiceNumber: 'INV-000101', status: 'مدفوعة جزئياً', issuedAt: '2026-08-14T00:00:00.000Z', dueAt: null, currency: 'QAR', customerName: 'مكتب الدوحة', customerAddress: 'الدوحة', subtotal: 100, tax: 5, total: 105, paid: 25, balance: 80, notes: null, paymentReference: 'TRX-99' }, [{ description: 'اشتراك', quantity: 1, unitPrice: 100, taxRate: 5, total: 105 }], { name: 'ميزان المكتب', address: null, email: null, phone: null, taxNumber: 'QA-1' });
    expect(html).toContain('INV-000101');
    expect(html).toContain('مدفوعة جزئياً');
    expect(html).toContain('TRX-99');
    expect(html).toContain('١٠٥٫٠٠');
  });

  it('creates a downloadable PDF named with the invoice number', async () => {
    const element = { style: {}, innerHTML: '', firstElementChild: {}, remove: vi.fn() } as unknown as HTMLDivElement;
    vi.stubGlobal('document', { createElement: vi.fn(() => element), body: { appendChild: vi.fn() } });
    await downloadInvoicePdf({ invoiceNumber: 'INV-000101', status: 'مدفوعة', issuedAt: null, dueAt: null, currency: 'QAR', customerName: 'مكتب الدوحة', customerAddress: null, subtotal: 100, tax: 5, total: 105, paid: 105, balance: 0, notes: null }, [{ description: 'اشتراك', quantity: 1, unitPrice: 100, taxRate: 5, total: 105 }], { name: 'ميزان المكتب', address: null, email: null, phone: null, taxNumber: null });
    expect(addImage).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('INV-000101.pdf');
    vi.unstubAllGlobals();
  });
});
