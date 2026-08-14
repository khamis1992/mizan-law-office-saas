import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export type PdfInvoice = { invoiceNumber: string; status: string; issuedAt: string | null; dueAt: string | null; currency: string; customerName: string; customerAddress: string | null; subtotal: number; tax: number; total: number; paid: number; balance: number; notes: string | null; paymentReference?: string | null };
export type PdfItem = { description: string; quantity: number; unitPrice: number; taxRate: number; total: number };
export type PdfIssuer = { name: string; address: string | null; email: string | null; phone: string | null; taxNumber: string | null };

const escapeHtml = (value: string | number | null | undefined) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
const money = (value: number, currency: string) => new Intl.NumberFormat('ar-QA', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
const date = (value: string | null) => value ? new Intl.DateTimeFormat('ar-QA', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '—';

export function buildInvoiceDocumentHtml(invoice: PdfInvoice, items: PdfItem[], issuer: PdfIssuer) {
  const rows = items.map(item => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(money(item.unitPrice, invoice.currency))}</td><td>${escapeHtml(item.taxRate)}%</td><td>${escapeHtml(money(item.total, invoice.currency))}</td></tr>`).join('');
  return `<section dir="rtl" lang="ar" style="width:760px;background:white;color:#153a36;font-family:Arial,'Noto Sans Arabic',sans-serif;line-height:1.7;padding:38px;box-sizing:border-box"><div style="display:flex;justify-content:space-between;border-bottom:3px solid #0d3b36;padding-bottom:18px"><div><p style="margin:0;color:#a57214;font-size:13px;font-weight:700">فاتورة ضريبية</p><h1 style="margin:6px 0;font-size:26px">${escapeHtml(issuer.name)}</h1><p style="margin:0;color:#58716b;font-size:12px">${escapeHtml(issuer.address)}<br>${escapeHtml(issuer.email)} ${escapeHtml(issuer.phone)}</p>${issuer.taxNumber ? `<p style="margin:6px 0 0;font-size:12px">الرقم الضريبي: ${escapeHtml(issuer.taxNumber)}</p>` : ''}</div><div style="text-align:left"><h2 style="margin:0;font-size:23px">${escapeHtml(invoice.invoiceNumber)}</h2><p style="margin:8px 0 0;color:#58716b;font-size:12px">الإصدار: ${escapeHtml(date(invoice.issuedAt))}<br>الاستحقاق: ${escapeHtml(date(invoice.dueAt))}<br>الحالة: ${escapeHtml(invoice.status)}</p></div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:22px"><div style="background:#f4f7f5;padding:13px;border-radius:8px"><b>إلى</b><br>${escapeHtml(invoice.customerName)}<br>${escapeHtml(invoice.customerAddress)}</div><div style="background:#f4f7f5;padding:13px;border-radius:8px"><b>بيانات التحصيل</b><br>المدفوع: ${escapeHtml(money(invoice.paid, invoice.currency))}<br>المتبقي: ${escapeHtml(money(invoice.balance, invoice.currency))}${invoice.paymentReference ? `<br>المرجع: ${escapeHtml(invoice.paymentReference)}` : ''}</div></div><table style="width:100%;border-collapse:collapse;margin-top:22px;font-size:12px"><thead><tr style="background:#0d3b36;color:white"><th style="padding:9px;border:1px solid #dce7e3;text-align:right">البند</th><th style="padding:9px;border:1px solid #dce7e3;text-align:right">الكمية</th><th style="padding:9px;border:1px solid #dce7e3;text-align:right">سعر الوحدة</th><th style="padding:9px;border:1px solid #dce7e3;text-align:right">الضريبة</th><th style="padding:9px;border:1px solid #dce7e3;text-align:right">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table><table style="width:310px;margin-right:auto;margin-top:20px;border-collapse:collapse;font-size:12px"><tbody><tr><td style="padding:9px;border:1px solid #dce7e3">قبل الضريبة</td><td style="padding:9px;border:1px solid #dce7e3">${escapeHtml(money(invoice.subtotal, invoice.currency))}</td></tr><tr><td style="padding:9px;border:1px solid #dce7e3">الضريبة</td><td style="padding:9px;border:1px solid #dce7e3">${escapeHtml(money(invoice.tax, invoice.currency))}</td></tr><tr style="background:#edf4f1;font-weight:700"><td style="padding:9px;border:1px solid #dce7e3">الإجمالي</td><td style="padding:9px;border:1px solid #dce7e3">${escapeHtml(money(invoice.total, invoice.currency))}</td></tr></tbody></table>${invoice.notes ? `<p style="margin-top:20px;font-size:12px;color:#58716b">ملاحظات: ${escapeHtml(invoice.notes)}</p>` : ''}<p style="margin-top:24px;padding-top:12px;border-top:1px solid #dce7e3;font-size:10px;color:#58716b">وثيقة صادرة من نظام ميزان المكتب. راجع البيانات الضريبية قبل الاعتماد أو التقديم الرسمي.</p></section>`;
}

export async function downloadInvoicePdf(invoice: PdfInvoice, items: PdfItem[], issuer: PdfIssuer) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;z-index:-1;';
  container.innerHTML = buildInvoiceDocumentHtml(invoice, items, issuer);
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const width = 190; const height = canvas.height * width / canvas.width; const pageHeight = 277;
    const image = canvas.toDataURL('image/png');
    let y = 10; let remaining = height;
    pdf.addImage(image, 'PNG', 10, y, width, height);
    remaining -= pageHeight;
    while (remaining > 0) { pdf.addPage(); y -= pageHeight; pdf.addImage(image, 'PNG', 10, y, width, height); remaining -= pageHeight; }
    pdf.save(`${invoice.invoiceNumber}.pdf`);
  } finally { container.remove(); }
}
