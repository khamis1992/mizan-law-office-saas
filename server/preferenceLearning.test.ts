import { describe, expect, it } from 'vitest';
import { applyPreferenceBoost } from './retrieval';

describe('applyPreferenceBoost', () => {
  const sections = [
    { id: 'a', title: 'قانون المرافعات', heading: 'المادة 1', body: 'نص المادة عن الاختصاص', relevanceScore: 0.5 },
    { id: 'b', title: 'قانون التجارة', heading: 'المادة 5', body: 'نص المادة عن الشركات', relevanceScore: 0.5 },
  ];

  it('يرفع ترتيب المصادر المقبولة سابقاً', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([
      { value: 'قانون المرافعات', decision: 'accepted' },
    ]))) as unknown as typeof fetch;
    const boosted = await applyPreferenceBoost('token', sections, fetchImpl, 'citation');
    expect(boosted[0].id).toBe('a');
    expect(boosted[0].relevanceScore).toBeGreaterThan(0.5);
  });

  it('يخفض ترتيب المصادر المرفوضة سابقاً', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([
      { value: 'قانون المرافعات', decision: 'rejected' },
    ]))) as unknown as typeof fetch;
    const boosted = await applyPreferenceBoost('token', sections, fetchImpl, 'citation');
    expect(boosted[0].id).toBe('b');
    expect(boosted[1].relevanceScore).toBeLessThan(0.5);
  });

  it('يعيد القائمة كما هي عند غياب الإشارات', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify([]))) as unknown as typeof fetch;
    const boosted = await applyPreferenceBoost('token', sections, fetchImpl, 'citation');
    expect(boosted).toHaveLength(2);
    expect(boosted[0].id).toBe('a');
  });

  it('يتعامل مع فشل الاستعلام بأمان', async () => {
    const fetchImpl = (async () => new Response('error', { status: 500 })) as unknown as typeof fetch;
    const boosted = await applyPreferenceBoost('token', sections, fetchImpl, 'citation');
    expect(boosted).toHaveLength(2);
  });
});
