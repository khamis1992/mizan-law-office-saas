begin;

create type public.saas_invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void', 'overdue');
create type public.saas_payment_method as enum ('cash');

create table public.billing_settings (
  id boolean primary key default true check (id),
  issuer_name text not null default 'ميزان المكتب',
  issuer_address text,
  issuer_email text,
  issuer_phone text,
  tax_registration_number text,
  invoice_prefix text not null default 'INV',
  next_invoice_number bigint not null default 1 check (next_invoice_number > 0),
  default_tax_rate numeric(7,4) not null default 0 check (default_tax_rate between 0 and 100),
  currency text not null default 'QAR',
  updated_at timestamptz not null default now()
);

create table public.saas_invoices (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete restrict,
  subscription_id uuid references public.office_subscriptions(id) on delete set null,
  invoice_number text not null unique,
  status public.saas_invoice_status not null default 'draft',
  issued_at timestamptz,
  due_at timestamptz,
  currency text not null default 'QAR',
  tax_registration_number text,
  customer_name text not null,
  customer_address text,
  customer_tax_registration_number text,
  subtotal_amount numeric(14,2) not null default 0 check (subtotal_amount >= 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  balance_amount numeric(14,2) not null default 0 check (balance_amount >= 0),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saas_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.saas_invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  subtotal_amount numeric(14,2) not null default 0 check (subtotal_amount >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate between 0 and 100),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_at timestamptz not null default now()
);

create table public.saas_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.saas_invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_method public.saas_payment_method not null default 'cash',
  received_at timestamptz not null default now(),
  reference text,
  notes text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index saas_invoices_office_status_idx on public.saas_invoices(office_id, status, issued_at desc);
create index saas_invoice_payments_invoice_idx on public.saas_invoice_payments(invoice_id, received_at desc);

create or replace function public.set_billing_settings_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.set_saas_invoice_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end; $$;

create or replace function public.recalculate_invoice_items()
returns trigger language plpgsql set search_path = public as $$
begin
  new.subtotal_amount = round(new.quantity * new.unit_price, 2);
  new.tax_amount = round(new.subtotal_amount * new.tax_rate / 100, 2);
  new.total_amount = new.subtotal_amount + new.tax_amount;
  return new;
end; $$;

create or replace function public.recalculate_saas_invoice_totals(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_subtotal numeric(14,2); v_tax numeric(14,2); v_total numeric(14,2); v_paid numeric(14,2); v_status public.saas_invoice_status;
begin
  select coalesce(sum(subtotal_amount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(total_amount), 0) into v_subtotal, v_tax, v_total from public.saas_invoice_items where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_paid from public.saas_invoice_payments where invoice_id = p_invoice_id;
  select status into v_status from public.saas_invoices where id = p_invoice_id for update;
  update public.saas_invoices set subtotal_amount = v_subtotal, tax_amount = v_tax, total_amount = v_total, paid_amount = v_paid, balance_amount = greatest(v_total - v_paid, 0), status = case when v_status = 'void' then 'void' when v_paid >= v_total and v_total > 0 then 'paid' when v_paid > 0 then 'partially_paid' else v_status end where id = p_invoice_id;
end; $$;

create or replace function public.sync_saas_invoice_after_item()
returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.recalculate_saas_invoice_totals(coalesce(new.invoice_id, old.invoice_id)); return coalesce(new, old); end; $$;
create or replace function public.sync_saas_invoice_after_payment()
returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.recalculate_saas_invoice_totals(coalesce(new.invoice_id, old.invoice_id)); return coalesce(new, old); end; $$;

create or replace function public.create_saas_invoice(p_office_id uuid, p_due_at timestamptz default null, p_notes text default null)
returns public.saas_invoices language plpgsql security definer set search_path = public as $$
declare v_setting public.billing_settings; v_office public.offices; v_subscription uuid; v_invoice public.saas_invoices;
begin
  if not public.is_platform_admin() then raise exception 'تتطلب هذه العملية صلاحية Super Admin'; end if;
  select * into v_setting from public.billing_settings where id = true for update;
  select * into v_office from public.offices where id = p_office_id;
  if not found then raise exception 'المكتب غير موجود'; end if;
  select id into v_subscription from public.office_subscriptions where office_id = p_office_id;
  insert into public.saas_invoices (office_id, subscription_id, invoice_number, due_at, currency, tax_registration_number, customer_name, customer_address, notes, created_by)
  values (p_office_id, v_subscription, v_setting.invoice_prefix || '-' || lpad(v_setting.next_invoice_number::text, 6, '0'), p_due_at, v_setting.currency, v_setting.tax_registration_number, v_office.name, v_office.address, p_notes, auth.uid()) returning * into v_invoice;
  update public.billing_settings set next_invoice_number = v_setting.next_invoice_number + 1 where id = true;
  insert into public.platform_audit_logs(actor_id, action, office_id, metadata) values (auth.uid(), 'invoice_created', p_office_id, jsonb_build_object('invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number));
  return v_invoice;
end; $$;

create trigger set_billing_settings_updated_at before update on public.billing_settings for each row execute function public.set_billing_settings_updated_at();
create trigger set_saas_invoice_updated_at before update on public.saas_invoices for each row execute function public.set_saas_invoice_updated_at();
create trigger calculate_saas_invoice_item before insert or update on public.saas_invoice_items for each row execute function public.recalculate_invoice_items();
create trigger sync_saas_invoice_item after insert or update or delete on public.saas_invoice_items for each row execute function public.sync_saas_invoice_after_item();
create trigger sync_saas_invoice_payment after insert or update or delete on public.saas_invoice_payments for each row execute function public.sync_saas_invoice_after_payment();

alter table public.billing_settings enable row level security;
alter table public.saas_invoices enable row level security;
alter table public.saas_invoice_items enable row level security;
alter table public.saas_invoice_payments enable row level security;

create policy billing_settings_platform on public.billing_settings for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy invoices_select on public.saas_invoices for select to authenticated using ((select public.is_platform_admin()) or office_id = (select public.current_office_id()));
create policy invoices_platform_write on public.saas_invoices for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy invoice_items_select on public.saas_invoice_items for select to authenticated using (exists (select 1 from public.saas_invoices i where i.id = invoice_id and ((select public.is_platform_admin()) or i.office_id = (select public.current_office_id()))));
create policy invoice_items_platform_write on public.saas_invoice_items for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy invoice_payments_select on public.saas_invoice_payments for select to authenticated using (exists (select 1 from public.saas_invoices i where i.id = invoice_id and ((select public.is_platform_admin()) or i.office_id = (select public.current_office_id()))));
create policy invoice_payments_platform_write on public.saas_invoice_payments for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));

insert into public.billing_settings (id) values (true) on conflict (id) do nothing;
grant select, insert, update, delete on public.billing_settings, public.saas_invoices, public.saas_invoice_items, public.saas_invoice_payments to authenticated, service_role;
grant execute on function public.create_saas_invoice(uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.recalculate_saas_invoice_totals(uuid) to service_role;

commit;
