import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './document-export';

describe('markdownToHtml', () => {
  it('يحوّل الترويسات إلى عناوين', () => {
    const html = markdownToHtml('### الدفوع\nنص الدفع');
    expect(html).toContain('<h3>الدفوع</h3>');
    expect(html).toContain('<p>نص الدفع</p>');
  });
  it('يحوّل الأسطر المتتالية إلى فقرات بفواصل أسطر', () => {
    const html = markdownToHtml('سطر أول\nسطر ثانٍ');
    expect(html).toContain('سطر أول<br/>سطر ثانٍ');
  });
  it('يهرب أحرف HTML', () => {
    const html = markdownToHtml('نص <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
