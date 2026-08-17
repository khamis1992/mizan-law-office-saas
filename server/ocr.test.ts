import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { ocrDocument } from './ocr';

describe('ocrDocument', () => {
  it('يقرأ صورة PNG نصية عبر Tesseract', async () => {
    const canvas = createCanvas(300, 80);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 300, 80);
    ctx.fillStyle = '#000000';
    ctx.font = '28px Arial';
    ctx.fillText('Qatar 2026', 20, 50);
    const png = canvas.toBuffer('image/png');
    const outcome = await ocrDocument(png, 'image/png', 'scan.png');
    expect(outcome.method).toBe('image');
    expect(outcome.text).toContain('Qatar');
  }, 120_000);

  it('يرفض المستندات غير المدعومة', async () => {
    const outcome = await ocrDocument(Buffer.from('hello'), 'text/plain', 'notes.txt');
    expect(outcome.text).toBe('');
    expect(outcome.pages).toBe(0);
  });
});
