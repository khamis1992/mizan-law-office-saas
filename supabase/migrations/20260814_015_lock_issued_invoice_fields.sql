begin;

create or replace function public.recalculate_saas_invoice_totals(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_subtotal numeric(14,2); v_tax numeric(14,2); v_total numeric(14,2); v_paid numeric(14,2); v_status public.saas_invoice_status;
begin
  select coalesce(sum(subtotal_amount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(total_amount), 0) into v_subtotal, v_tax, v_total from public.saas_invoice_items where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from public.saas_invoice_payments where invoice_id = p_invoice_id;
  select status into v_status from public.saas_invoices where id = p_invoice_id for update;
  perform set_config('app.allow_invoice_recalculation', 'true', true);
  update public.saas_invoices set subtotal_amount = v_subtotal, tax_amount = v_tax, total_amount = v_total, paid_amount = v_paid, balance_amount = greatest(v_total - v_paid, 0), status = case when v_status = 'void' then 'void' when v_paid >= v_total and v_total > 0 then 'paid' when v_paid > 0 then 'partially_paid' else v_status end where id = p_invoice_id;
end; $$;

create or replace function public.guard_saas_invoice_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('app.allow_platform_maintenance', true) = 'true' or current_setting('app.allow_invoice_recalculation', true) = 'true' then
    return new;
  end if;
  if old.status <> 'draft'::public.saas_invoice_status then
    if new.office_id is distinct from old.office_id or new.subscription_id is distinct from old.subscription_id or new.invoice_number is distinct from old.invoice_number or new.currency is distinct from old.currency or new.tax_registration_number is distinct from old.tax_registration_number or new.customer_name is distinct from old.customer_name or new.customer_address is distinct from old.customer_address or new.subtotal_amount is distinct from old.subtotal_amount or new.tax_amount is distinct from old.tax_amount or new.total_amount is distinct from old.total_amount or new.due_at is distinct from old.due_at or new.notes is distinct from old.notes or new.issued_at is distinct from old.issued_at then
      raise exception 'لا يمكن تعديل الحقول الأساسية لفاتورة بعد اعتمادها أو إصدارها';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_saas_invoice_mutation
before update on public.saas_invoices
for each row execute function public.guard_saas_invoice_mutation();

commit;
