import type { Request, Response } from 'express';
import { sdk } from './_core/sdk';

export async function runRecurringBilling() {
  const baseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) throw new Error('Recurring billing service credentials are not configured.');
  const response = await fetch(`${baseUrl}/rest/v1/rpc/generate_due_recurring_invoices`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' }, body: JSON.stringify({}) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Recurring billing RPC failed: ${JSON.stringify(payload)}`);
  return payload as { created: number; executed_at: string };
}

export async function recurringBillingHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: 'cron-only' });
    const result = await runRecurringBilling();
    return res.json({ ok: true, taskUid: user.taskUid, ...result });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString(), context: { url: req.originalUrl } });
  }
}
