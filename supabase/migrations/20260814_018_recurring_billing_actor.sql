begin;
create or replace function public.generate_due_recurring_invoices(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_settings public.billing_settings; v_invoice public.saas_invoices; v_start timestamptz; v_end timestamptz; v_price numeric(12,2); v_created integer := 0; v_actor uuid;
begin
  select user_id into v_actor from public.platform_admins where is_active = true order by created_at limit 1;
  if v_actor is null then raise exception 'لا يوجد Super Admin نشط لإصدار فواتير التجديد'; end if;
  select * into v_settings from public.billing_settings where id = true for update;
  for r in select s.*, p.monthly_price_qar, p.annual_price_qar, o.name as office_name, o.address as office_address from public.office_subscriptions s join public.saas_plans p on p.id = s.plan_id join public.offices o on o.id = s.office_id where s.status = 'active' and s.recurring_billing_enabled = true and s.billing_cycle in ('monthly','annual') and s.next_billing_at is not null and s.next_billing_at <= p_now and o.service_status in ('trial','active') for update of s skip locked
  loop
    v_start := r.next_billing_at; v_end := case when r.billing_cycle = 'annual' then v_start + interval '1 year' else v_start + interval '1 month' end; v_price := case when r.billing_cycle = 'annual' then coalesce(r.annual_price_qar, 0) else coalesce(r.monthly_price_qar, 0) end;
    if v_price <= 0 or exists(select 1 from public.subscription_billing_cycles c where c.subscription_id = r.id and c.period_starts_at = v_start) then continue; end if;
    insert into public.saas_invoices (office_id, subscription_id, invoice_number, due_at, currency, tax_registration_number, customer_name, customer_address, notes, created_by) values (r.office_id, r.id, v_settings.invoice_prefix || '-' || lpad(v_settings.next_invoice_number::text, 6, '0'), v_start, v_settings.currency, v_settings.tax_registration_number, r.office_name, r.office_address, 'فاتورة تجديد دورية: ' || r.billing_cycle, v_actor) returning * into v_invoice;
    update public.billing_settings set next_invoice_number = next_invoice_number + 1 where id = true;
    insert into public.saas_invoice_items (invoice_id, description, quantity, unit_price, tax_rate) values (v_invoice.id, r.renewal_description, 1, v_price, r.renewal_tax_rate);
    insert into public.subscription_billing_cycles(subscription_id, office_id, period_starts_at, period_ends_at, invoice_id) values (r.id, r.office_id, v_start, v_end, v_invoice.id);
    update public.office_subscriptions set current_period_starts_at = v_start, current_period_ends_at = v_end, next_billing_at = v_end where id = r.id;
    insert into public.platform_audit_logs(actor_id, action, office_id, metadata) values (v_actor, 'recurring_invoice_drafted', r.office_id, jsonb_build_object('invoice_id', v_invoice.id, 'subscription_id', r.id, 'period_start', v_start)); v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'executed_at', p_now);
end; $$;
commit;
