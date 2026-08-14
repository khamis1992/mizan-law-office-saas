import { describe, expect, it, vi } from 'vitest';

vi.mock('./_core/sdk', () => ({ sdk: { authenticateRequest: vi.fn() } }));
import { recurringBillingHandler, runRecurringBilling } from './recurringBilling';
import { sdk } from './_core/sdk';

describe('recurring billing runner', () => {
  it('calls the protected Supabase recurring-invoice RPC with the service credential', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ created: 2, executed_at: '2026-08-14T00:00:00Z' }), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    await expect(runRecurringBilling()).resolves.toMatchObject({ created: 2 });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/rest/v1/rpc/generate_due_recurring_invoices');
    global.fetch = originalFetch;
  });

  it('rejects non-cron requests at the scheduled endpoint', async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValueOnce({ isCron: false } as never);
    const status = vi.fn(() => ({ json })); const json = vi.fn();
    await recurringBillingHandler({ originalUrl: '/api/scheduled/recurring-billing' } as never, { status, json } as never);
    expect(status).toHaveBeenCalledWith(403);
  });
});
