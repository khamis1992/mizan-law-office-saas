import { describe, expect, it, vi } from 'vitest';

vi.mock('./_core/sdk', () => ({ sdk: { authenticateRequest: vi.fn() } }));
import { recurringBillingHandler, runRecurringBilling } from './recurringBilling';
import { sdk } from './_core/sdk';

describe('recurring billing runner', () => {
  it('calls the protected recurring-invoice and alert-sync RPCs with the service credential', async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ created: 2, executed_at: '2026-08-14T00:00:00Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(3), { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    await expect(runRecurringBilling()).resolves.toMatchObject({ created: 2, alerts_created: 3 });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/rest/v1/rpc/generate_due_recurring_invoices');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/rest/v1/rpc/sync_platform_notifications');
    global.fetch = originalFetch;
  });

  it('rejects non-cron requests at the scheduled endpoint', async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValueOnce({ isCron: false } as never);
    const status = vi.fn(() => ({ json })); const json = vi.fn();
    await recurringBillingHandler({ originalUrl: '/api/scheduled/recurring-billing' } as never, { status, json } as never);
    expect(status).toHaveBeenCalledWith(403);
  });
});
