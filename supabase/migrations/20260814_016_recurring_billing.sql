begin;

alter table public.office_subscriptions
  add column if not exists recurring_billing_enabled boolean not null default true,
  add column if not exists next_billing_at timestamptz,
  add column if not exists renewal_tax_rate numeric(5,2) not null default 0 check (renewal_tax_rate between 0 and 100),
  add column if not exists renewal_description text not null default 'تجديد اشتراك منصة ميزان المكتب',
  add column if not exists schedule_cron_task_uid varchar(65);

update public.office_subscriptions
set next_billing_at = coalesce(current_period_ends_at, now())
where next_billing_at is null and billing_cycle in ('monthly', 'annual');

create table if not exists public.subscription_billing_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.office_subscriptions(id) on delete cascade,
  office_id uuid not null references public.offices(id) on delete cascade,
  period_starts_at timestamptz not null,
  period_ends_at timestamptz not null,
  invoice_id uuid unique references public.saas_invoices(id) on delete set null,
  generated_at timestamptz not null default now(),
  generated_by text not null default 'heartbeat',
  unique(subscription_id, period_starts_at)
);
create index if not exists subscription_billing_cycles_office_idx on public.subscription_billing_cycles(office_id, generated_at desc);

create or replace function public.generate_due_recurring_invoices(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_settings public.billing_settings; v_invoice public.saas_invoices; v_start timestamptz; v_end timestamptz; v_price numeric(12,2); v_created integer := 0;
begin
  select * into v_settings from public.billing_settings where id = true for update;
  for r in select s.*, p.monthly_price_qar, p.annual_price_qar, o.name as office_name, o.address as office_address
    from public.office_subscriptions s join public.saas_plans p on p.id = s.plan_id join public.offices o on o.id = s.office_id
    where s.status = 'active' and s.recurring_billing_enabled = true and s.billing_cycle in ('monthly','annual') and s.next_billing_at is not null and s.next_billing_at <= p_now and o.service_status in ('trial','active')
    for update of s skip locked
  loop
    v_start := r.next_billing_at;
    v_end := case when r.billing_cycle = 'annual' then v_start + interval '1 year' else v_start + interval '1 month' end;
    v_price := case when r.billing_cycle = 'annual' then coalesce(r.annual_price_qar, 0) else coalesce(r.monthly_price_qar, 0) end;
    if v_price <= 0 or exists(select 1 from public.subscription_billing_cycles c where c.subscription_id = r.id and c.period_starts_at = v_start) then continue; end if;
    insert into public.saas_invoices (office_id, subscription_id, invoice_number, due_at, currency, tax_registration_number, customer_name, customer_address, notes)
    values (r.office_id, r.id, v_settings.invoice_prefix || '-' || lpad(v_settings.next_invoice_number::text, 6, '0'), v_start, v_settings.currency, v_settings.tax_registration_number, r.office_name, r.office_address, 'فاتورة تجديد دورية: ' || r.billing_cycle)
    returning * into v_invoice;
    update public.billing_settings set next_invoice_number = next_invoice_number + 1 where id = true;
    insert into public.saas_invoice_items (invoice_id, description, quantity, unit_price, tax_rate) values (v_invoice.id, r.renewal_description, 1, v_price, r.renewal_tax_rate);
    insert into public.subscription_billing_cycles(subscription_id, office_id, period_starts_at, period_ends_at, invoice_id) values (r.id, r.office_id, v_start, v_end, v_invoice.id);
    update public.office_subscriptions set current_period_starts_at = v_start, current_period_ends_at = v_end, next_billing_at = v_end where id = r.id;
    insert into public.platform_audit_logs(action, office_id, metadata) values ('recurring_invoice_drafted', r.office_id, jsonb_build_object('invoice_id', v_invoice.id, 'subscription_id', r.id, 'period_start', v_start));
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object('created', v_created, 'executed_at', p_now);
end; $$;

alter table public.subscription_billing_cycles enable row level security;
create policy subscription_billing_cycles_platform on public.subscription_billing_cycles for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
grant select, insert, update, delete on public.subscription_billing_cycles to authenticated, service_role;
grant execute on function public.generate_due_recurring_invoices(timestamptz) to service_role;
commit;
