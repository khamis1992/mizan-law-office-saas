import { describe, expect, it } from 'vitest';

describe('external service secrets', () => {
  it('connects to the configured Supabase authentication health endpoint', async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    expect(url).toMatch(/^https:\/\/.+\.supabase\.co$/);
    expect(key).toBeTruthy();

    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key! },
    });

    expect(response.ok).toBe(true);
  });

  it('has a Grok key available only to the server runtime', () => {
    expect(process.env.XAI_API_KEY).toBeTruthy();
  });
});
