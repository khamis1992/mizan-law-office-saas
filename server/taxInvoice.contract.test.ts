import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../supabase/migrations/20260814_010_tax_invoices.sql', import.meta.url), 'utf8');
const protection = readFileSync(new URL('../supabase/migrations/20260814_011_prevent_invoice_overpayment.sql', import.meta.url), 'utf8');
const paymentStatusGuard = readFileSync(new URL('../supabase/migrations/20260814_012_guard_invoice_payment_status.sql', import.meta.url), 'utf8');
const itemLock = readFileSync(new URL('../supabase/migrations/20260814_013_lock_issued_invoice_items.sql', import.meta.url), 'utf8');
const invoiceFieldLock = readFileSync(new URL('../supabase/migrations/20260814_015_lock_issued_invoice_fields.sql', import.meta.url), 'utf8');

describe('tax invoice contracts', () => {
  it('keeps invoice totals, tax, and balance derived from item and payment records', () => {
    expect(schema).toContain('new.subtotal_amount = round(new.quantity * new.unit_price, 2)');
    expect(schema).toContain('new.tax_amount = round(new.subtotal_amount * new.tax_rate / 100, 2)');
    expect(schema).toContain('balance_amount = greatest(v_total - v_paid, 0)');
    expect(schema).toContain('sync_saas_invoice_payment');
  });

  it('restricts invoice creation and changes to Super Admin while offices can only read their own invoices', () => {
    expect(schema).toContain("if not public.is_platform_admin() then raise exception 'تتطلب هذه العملية صلاحية Super Admin'");
    expect(schema).toContain("office_id = (select public.current_office_id())");
    expect(schema).toContain('invoice_items_platform_write');
    expect(schema).toContain('invoice_payments_platform_write');
  });

  it('uses cash-only collection and rejects payments above the remaining balance', () => {
    expect(schema).toContain("create type public.saas_payment_method as enum ('cash')");
    expect(protection).toContain('if new.amount > v_balance then');
    expect(protection).toContain('لا يمكن أن يتجاوز التحصيل الرصيد المتبقي في الفاتورة');
    expect(paymentStatusGuard).toContain("v_status not in ('issued'::public.saas_invoice_status, 'partially_paid'::public.saas_invoice_status, 'overdue'::public.saas_invoice_status)");
    expect(paymentStatusGuard).toContain('لا يمكن تسجيل تحصيل قبل اعتماد الفاتورة وإصدارها');
    expect(itemLock).toContain("if v_status <> 'draft'::public.saas_invoice_status then");
    expect(itemLock).toContain('لا يمكن تعديل بنود فاتورة بعد اعتمادها أو إصدارها');
    expect(invoiceFieldLock).toContain("if old.status <> 'draft'::public.saas_invoice_status then");
    expect(invoiceFieldLock).toContain('لا يمكن تعديل الحقول الأساسية لفاتورة بعد اعتمادها أو إصدارها');
  });
});
