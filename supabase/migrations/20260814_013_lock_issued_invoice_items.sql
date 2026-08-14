begin;

create or replace function public.guard_saas_invoice_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_status public.saas_invoice_status;
begin
  select status into v_status from public.saas_invoices where id = v_invoice_id for update;
  if v_status is null then
    raise exception 'الفاتورة غير موجودة';
  end if;
  if v_status <> 'draft'::public.saas_invoice_status then
    raise exception 'لا يمكن تعديل بنود فاتورة بعد اعتمادها أو إصدارها';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_saas_invoice_item_mutation
before update or delete on public.saas_invoice_items
for each row execute function public.guard_saas_invoice_item_mutation();

commit;
