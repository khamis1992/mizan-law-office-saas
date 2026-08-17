import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { readResponse, requiredEnv, supabaseHeaders } from './supabaseAccess';

/**
 * OCR للمستندات الممسوحة ضوئياً:
 * - PDF الممسوح (بلا طبقة نصية) → تحويل الصفحات لصور → قراءة بصرية بـ Tesseract (عربي)
 * - الصور (PNG/JPG) → قراءة مباشرة
 * النص الناتج يُخزن في documents.ocr_text ويُستخدم كوقائع إضافية في التحليل الافتتاحي.
 */

const MAX_PAGES = 8;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

let workerPromise: Promise<ReturnType<typeof createWorker> extends Promise<infer W> ? W : never> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(['ara', 'eng'], 1, {
      langPath: process.env.TESSERACT_LANG_PATH ?? 'https://tessdata.projectnaptha.com/4.0.0',
      gzip: true,
      logger: () => undefined,
    }).then(worker => worker);
  }
  return workerPromise;
}

/** تحويل صفحات PDF إلى صور (data URLs) عبر pdfjs-dist + @napi-rs/canvas. */
async function pdfPagesToImages(buffer: Buffer): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const images: string[] = [];
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    images.push(canvas.toDataURL('image/png'));
  }
  return images;
}

/** قراءة نص من صورة (Buffer) — عربي + إنجليزي. */
async function ocrImage(image: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return (data.text ?? '').trim();
}

export type OcrOutcome = { text: string; pages: number; method: 'image' | 'pdf' };

/** OCR لمستند واحد (PDF أو صورة) — يعيد النص المستخرج أو نصاً فارغاً عند الفشل. */
export async function ocrDocument(buffer: Buffer, mimeType: string | null, fileName: string): Promise<OcrOutcome> {
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  const isImage = (mimeType ?? '').startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/i.test(fileName);
  if (!isPdf && !isImage) return { text: '', pages: 0, method: 'image' };

  try {
    if (isPdf) {
      const images = await pdfPagesToImages(buffer);
      const parts: string[] = [];
      for (const image of images) {
        const text = await ocrImage(Buffer.from(image.split(',')[1] ?? '', 'base64'));
        if (text) parts.push(text);
      }
      return { text: parts.join('\n\n'), pages: images.length, method: 'pdf' };
    }
    const text = await ocrImage(buffer);
    return { text, pages: 1, method: 'image' };
  } catch (error) {
    console.warn('[OCR] فشل قراءة المستند:', error instanceof Error ? error.message : String(error));
    return { text: '', pages: 0, method: 'image' };
  }
}

/** OCR لكل مستندات القضية الممسوحة (بلا نص مستخرج) وتخزين النص في documents.ocr_text. */
export async function ocrCaseDocuments(accessToken: string, caseId: string, fetchImpl: typeof fetch = fetch): Promise<{ processed: number; totalChars: number }> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(accessToken);
  const response = await fetchImpl(`${baseUrl}/rest/v1/documents?case_id=eq.${caseId}&select=id,file_name,storage_path,mime_type,ocr_status&order=created_at.asc`, { headers });
  const rows = await readResponse<Array<{ id: string; file_name: string; storage_path: string; mime_type: string | null; ocr_status: string | null }>>(response);

  let processed = 0;
  let totalChars = 0;
  for (const row of rows) {
    if (row.ocr_status === 'done' || row.ocr_status === 'pending') continue;
    const mime = row.mime_type ?? '';
    const isPdf = mime === 'application/pdf' || row.file_name.toLowerCase().endsWith('.pdf');
    const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|tiff?)$/i.test(row.file_name);
    if (!isPdf && !isImage) continue;

    const objectUrl = `${baseUrl}/storage/v1/object/legal-documents/${row.storage_path}`;
    const objectResponse = await fetchImpl(objectUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!objectResponse.ok) continue;
    const buffer = Buffer.from(await objectResponse.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_BYTES) continue;

    await fetchImpl(`${baseUrl}/rest/v1/documents?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ ocr_status: 'pending' }),
    });

    const outcome = await ocrDocument(buffer, mime, row.file_name);
    const cleaned = outcome.text.replace(/\s+/g, ' ').trim();
    await fetchImpl(`${baseUrl}/rest/v1/documents?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ ocr_text: cleaned || null, ocr_status: cleaned ? 'done' : 'failed' }),
    });
    if (cleaned) { processed++; totalChars += cleaned.length; }
  }
  return { processed, totalChars };
}
