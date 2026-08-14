import { describe, expect, it } from 'vitest';

describe('recurring billing service credentials', () => {
  it('authenticates the server-only Supabase service key against the billing settings endpoint', async () => {
    const baseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(baseUrl).toBeTruthy();
    expect(serviceKey).toBeTruthy();
    const response = await fetch(`${baseUrl}/rest/v1/billing_settings?select=id&limit=1`, { headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey!}` } });
    expect(response.ok).toBe(true);
  });
});
