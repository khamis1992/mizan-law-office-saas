begin;
create or replace function public.run_recurring_billing_manual()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'تتطلب هذه العملية صلاحية Super Admin'; end if;
  return public.generate_due_recurring_invoices(now());
end; $$;
grant execute on function public.run_recurring_billing_manual() to authenticated;
commit;
