begin;

create or replace function public.prevent_saas_invoice_overpayment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
begin
  select balance_amount into v_balance from public.saas_invoices where id = new.invoice_id for update;
  if v_balance is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if new.amount > v_balance then
    raise exception 'لا يمكن أن يتجاوز التحصيل الرصيد المتبقي في الفاتورة';
  end if;
  return new;
end;
$$;

create trigger prevent_saas_invoice_overpayment
before insert on public.saas_invoice_payments
for each row execute function public.prevent_saas_invoice_overpayment();

commit;
