import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260814_016_recurring_billing.sql', import.meta.url), 'utf8');
const manualMigration = readFileSync(new URL('../supabase/migrations/20260814_017_manual_recurring_billing.sql', import.meta.url), 'utf8');

describe('recurring billing contracts', () => {
  it('creates a draft invoice once per subscription billing period and advances the next run date', () => {
    expect(migration).toContain('unique(subscription_id, period_starts_at)');
    expect(migration).toContain("s.status = 'active'");
    expect(migration).toContain('recurring_invoice_drafted');
    expect(migration).toContain('next_billing_at = v_end');
  });

  it('requires an active Super Admin before allowing the manual recurring-billing RPC', () => {
    expect(manualMigration).toContain('if not public.is_platform_admin() then');
    expect(manualMigration).toContain("raise exception 'تتطلب هذه العملية صلاحية Super Admin'");
    expect(manualMigration).toContain('grant execute on function public.run_recurring_billing_manual() to authenticated');
  });
});
