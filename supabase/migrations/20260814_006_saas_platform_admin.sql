begin;

create type public.office_service_status as enum ('trial', 'active', 'suspended', 'cancelled');
create type public.saas_subscription_status as enum ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired');

alter table public.offices add column service_status public.office_service_status not null default 'trial';
alter table public.offices add column service_status_changed_at timestamptz not null default now();

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saas_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  description_ar text,
  monthly_price_qar numeric(12,2),
  annual_price_qar numeric(12,2),
  max_users integer,
  max_cases integer,
  ai_monthly_requests integer,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.office_subscriptions (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null unique references public.offices(id) on delete cascade,
  plan_id uuid not null references public.saas_plans(id) on delete restrict,
  status public.saas_subscription_status not null default 'trialing',
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual', 'manual')),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz not null default now(),
  current_period_ends_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  office_id uuid references public.offices(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index office_subscriptions_status_idx on public.office_subscriptions(status, current_period_ends_at);
create index offices_service_status_idx on public.offices(service_status, created_at);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and is_active = true)
$$;

create or replace function public.is_current_office_operational()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select service_status in ('trial'::public.office_service_status, 'active'::public.office_service_status) from public.offices where id = public.current_office_id()), false)
$$;

create or replace function public.guard_suspended_office_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_office_id uuid := coalesce(new.office_id, old.office_id);
begin
  if public.is_platform_admin() then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.offices where id = v_office_id and service_status in ('trial'::public.office_service_status, 'active'::public.office_service_status)) then
    raise exception 'تم تعليق مساحة المكتب. تواصل مع مسؤول المنصة لتفعيل الاشتراك.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger set_platform_admins_updated_at before update on public.platform_admins for each row execute function public.set_updated_at();
create trigger set_saas_plans_updated_at before update on public.saas_plans for each row execute function public.set_updated_at();
create trigger set_office_subscriptions_updated_at before update on public.office_subscriptions for each row execute function public.set_updated_at();

create trigger guard_clients_office_state before insert or update or delete on public.clients for each row execute function public.guard_suspended_office_writes();
create trigger guard_communications_office_state before insert or update or delete on public.client_communications for each row execute function public.guard_suspended_office_writes();
create trigger guard_cases_office_state before insert or update or delete on public.legal_cases for each row execute function public.guard_suspended_office_writes();
create trigger guard_hearings_office_state before insert or update or delete on public.hearings for each row execute function public.guard_suspended_office_writes();
create trigger guard_tasks_office_state before insert or update or delete on public.tasks for each row execute function public.guard_suspended_office_writes();
create trigger guard_documents_office_state before insert or update or delete on public.documents for each row execute function public.guard_suspended_office_writes();

alter table public.platform_admins enable row level security;
alter table public.saas_plans enable row level security;
alter table public.office_subscriptions enable row level security;
alter table public.platform_audit_logs enable row level security;

drop policy if exists offices_select on public.offices;
drop policy if exists offices_update on public.offices;
create policy offices_select_platform on public.offices for select to authenticated using (id = (select public.current_office_id()) or (select public.is_platform_admin()));
create policy offices_update_platform on public.offices for update to authenticated using ((id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin())) with check ((id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin()));

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select_platform on public.profiles for select to authenticated using (id = auth.uid() or (office_id is not null and office_id = (select public.current_office_id())) or (select public.is_platform_admin()));
create policy profiles_update_platform on public.profiles for update to authenticated using (id = auth.uid() or (office_id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin())) with check (id = auth.uid() or (office_id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin()));

drop policy if exists audit_read on public.audit_logs;
create policy audit_read_platform on public.audit_logs for select to authenticated using ((office_id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin()));

create policy platform_admins_self_or_platform on public.platform_admins for select to authenticated using (user_id = auth.uid() or (select public.is_platform_admin()));
create policy platform_admins_platform_write on public.platform_admins for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy plans_read on public.saas_plans for select to authenticated using (is_active or (select public.is_platform_admin()));
create policy plans_platform_write on public.saas_plans for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy subscriptions_read on public.office_subscriptions for select to authenticated using (office_id = (select public.current_office_id()) or (select public.is_platform_admin()));
create policy subscriptions_platform_write on public.office_subscriptions for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy platform_audit_read on public.platform_audit_logs for select to authenticated using ((select public.is_platform_admin()));
create policy platform_audit_write on public.platform_audit_logs for insert to authenticated with check ((select public.is_platform_admin()) and actor_id = auth.uid());

insert into public.saas_plans (code, name_ar, description_ar, monthly_price_qar, annual_price_qar, max_users, max_cases, ai_monthly_requests, sort_order)
values
  ('trial', 'تجربة مجانية', 'تجربة أولية لمدة 14 يوماً.', 0, 0, 3, 30, 20, 1),
  ('professional', 'احترافي', 'للمكاتب النامية مع إدارة كاملة ومساعد المذكرات.', 499, 4990, 15, 1000, 300, 2),
  ('enterprise', 'مؤسسي', 'للمكاتب الكبيرة مع حدود مرنة ودعم مخصص.', null, null, null, null, null, 3)
on conflict (code) do update set name_ar = excluded.name_ar, description_ar = excluded.description_ar, monthly_price_qar = excluded.monthly_price_qar, annual_price_qar = excluded.annual_price_qar, max_users = excluded.max_users, max_cases = excluded.max_cases, ai_monthly_requests = excluded.ai_monthly_requests, is_active = true;

insert into public.office_subscriptions (office_id, plan_id, status, billing_cycle, trial_ends_at, current_period_ends_at)
select o.id, p.id, 'trialing', 'monthly', now() + interval '14 days', now() + interval '14 days'
from public.offices o cross join public.saas_plans p
where p.code = 'trial'
  and not exists (select 1 from public.office_subscriptions s where s.office_id = o.id);

grant select, insert, update, delete on public.platform_admins, public.saas_plans, public.office_subscriptions, public.platform_audit_logs to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_current_office_operational() to authenticated, service_role;
grant execute on function public.guard_suspended_office_writes() to service_role;

commit;
