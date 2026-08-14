begin;

create or replace function public.prevent_saas_invoice_overpayment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
  v_status public.saas_invoice_status;
begin
  select balance_amount, status into v_balance, v_status from public.saas_invoices where id = new.invoice_id for update;
  if v_balance is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_status not in ('issued'::public.saas_invoice_status, 'partially_paid'::public.saas_invoice_status, 'overdue'::public.saas_invoice_status) then
    raise exception 'لا يمكن تسجيل تحصيل قبل اعتماد الفاتورة وإصدارها';
  end if;
  if new.amount > v_balance then
    raise exception 'لا يمكن أن يتجاوز التحصيل الرصيد المتبقي في الفاتورة';
  end if;
  return new;
end;
$$;

commit;
