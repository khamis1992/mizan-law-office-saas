import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * تصدير المذكرات والعقود إلى Word (.docx) وPDF.
 * - Word: ملف HTML بامتداد .doc يفتحه Word مباشرة (يدعم العربية RTL).
 * - PDF: عبر html2canvas + jsPDF (نفس نمط تصدير الفواتير).
 */

const escapeHtml = (value: string) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));

/** تحويل نص عادي (بأسطر وفقرات) إلى فقرات HTML مع الحفاظ على الترويسات ###. */
export function markdownToHtml(text: string) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const paragraphs: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) { paragraphs.push(`<p>${buffer.map(escapeHtml).join('<br/>')}</p>`); buffer = []; }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      flush();
      paragraphs.push(`<h3>${escapeHtml(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      flush();
      paragraphs.push(`<h2>${escapeHtml(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith('# ')) {
      flush();
      paragraphs.push(`<h1>${escapeHtml(trimmed.slice(2))}</h1>`);
    } else if (trimmed === '') {
      flush();
    } else {
      buffer.push(trimmed);
    }
  }
  flush();
  return paragraphs.join('\n');
}

export function buildDocumentHtml(title: string, content: string) {
  return `<section dir="rtl" lang="ar" style="width:760px;background:white;color:#153a36;font-family:Arial,'Noto Sans Arabic',sans-serif;line-height:1.9;padding:38px;box-sizing:border-box">
    <div style="border-bottom:3px solid #0d3b36;padding-bottom:14px;margin-bottom:20px">
      <h1 style="margin:0;font-size:22px;color:#0d3b36">${escapeHtml(title)}</h1>
    </div>
    <div style="font-size:14px;white-space:pre-wrap">${markdownToHtml(content)}</div>
  </section>`;
}

/** تنزيل Word: مستند HTML بامتداد .doc — يفتحه Microsoft Word مع دعم RTL كامل. */
export function downloadWord(title: string, content: string) {
  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,'Noto Sans Arabic',sans-serif;line-height:1.9;color:#153a36">${markdownToHtml(content)}</body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '-')}.doc`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** تنزيل PDF عبر html2canvas + jsPDF (نفس نمط الفواتير). */
export async function downloadPdf(title: string, content: string) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff;z-index:-1;';
  container.innerHTML = buildDocumentHtml(title, content);
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
    pdf.save(`${title.replace(/[\\/:*?"<>|]/g, '-')}.pdf`);
  } finally { container.remove(); }
}
