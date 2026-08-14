begin;

alter table public.saas_plans add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.saas_plans add column if not exists billing_email text;

create table if not exists public.platform_brand_settings (
  id boolean primary key default true check (id),
  app_name text not null default 'ميزان المكتب',
  legal_name text,
  logo_url text,
  support_email text,
  support_phone text,
  invoice_footer text,
  primary_contact_name text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_notifications (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('billing_due','payment_overdue','trial_ending','renewal_failed','support','system')),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title_ar text not null,
  body_ar text not null,
  office_id uuid references public.offices(id) on delete cascade,
  subscription_id uuid references public.office_subscriptions(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_subscription_events (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.office_subscriptions(id) on delete cascade,
  office_id uuid not null references public.offices(id) on delete cascade,
  event_type text not null check (event_type in ('created','status_changed','plan_changed','cycle_changed','cancelled','renewed')),
  previous jsonb not null default '{}'::jsonb,
  current jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references public.offices(id) on delete cascade,
  opened_by uuid references auth.users(id) on delete set null,
  subject text not null,
  category text not null default 'general' check (category in ('general','billing','technical','account')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_office','resolved','closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists platform_notifications_unread_idx on public.platform_notifications(read_at, severity, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(status, priority, last_activity_at desc);
create index if not exists subscription_events_office_idx on public.platform_subscription_events(office_id, created_at desc);

create or replace function public.record_subscription_lifecycle_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  if tg_op = 'INSERT' then
    insert into public.platform_subscription_events(subscription_id, office_id, event_type, current, actor_id)
    values (new.id, new.office_id, 'created', to_jsonb(new), new.updated_by);
    return new;
  end if;
  v_type := case
    when old.status is distinct from new.status and new.status = 'cancelled' then 'cancelled'
    when old.status is distinct from new.status then 'status_changed'
    when old.plan_id is distinct from new.plan_id then 'plan_changed'
    when old.billing_cycle is distinct from new.billing_cycle then 'cycle_changed'
    when old.current_period_ends_at is distinct from new.current_period_ends_at then 'renewed'
    else null end;
  if v_type is not null then
    insert into public.platform_subscription_events(subscription_id, office_id, event_type, previous, current, actor_id)
    values (new.id, new.office_id, v_type, to_jsonb(old), to_jsonb(new), new.updated_by);
  end if;
  return new;
end $$;

drop trigger if exists record_subscription_lifecycle_event on public.office_subscriptions;
create trigger record_subscription_lifecycle_event after insert or update on public.office_subscriptions for each row execute function public.record_subscription_lifecycle_event();
create trigger set_platform_brand_updated_at before update on public.platform_brand_settings for each row execute function public.set_updated_at();
create trigger set_support_ticket_updated_at before update on public.support_tickets for each row execute function public.set_updated_at();

create or replace function public.sync_platform_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare inserted_count integer := 0;
begin
  if not public.is_platform_admin() then raise exception 'platform admin required'; end if;
  insert into public.platform_notifications(category, severity, title_ar, body_ar, office_id, subscription_id, metadata)
  select case when s.status = 'past_due' then 'payment_overdue' when s.status = 'trialing' then 'trial_ending' else 'billing_due' end,
         case when s.status = 'past_due' then 'critical' else 'warning' end,
         case when s.status = 'past_due' then 'دفعة متأخرة' when s.status = 'trialing' then 'تجربة قاربت على الانتهاء' else 'تجديد اشتراك مستحق' end,
         'يتطلب اشتراك ' || o.name || ' مراجعة من مسؤول المنصة.', o.id, s.id,
         jsonb_build_object('status', s.status, 'period_ends_at', s.current_period_ends_at)
  from public.office_subscriptions s join public.offices o on o.id = s.office_id
  where (s.status = 'past_due' or s.current_period_ends_at <= now() + interval '7 days')
    and not exists (select 1 from public.platform_notifications n where n.subscription_id = s.id and n.read_at is null and n.created_at > now() - interval '24 hours');
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;

insert into public.platform_brand_settings(id) values (true) on conflict (id) do nothing;

alter table public.platform_brand_settings enable row level security;
alter table public.platform_notifications enable row level security;
alter table public.platform_subscription_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

create policy brand_platform_admin on public.platform_brand_settings for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy notifications_platform_admin on public.platform_notifications for all to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy subscription_events_platform_admin on public.platform_subscription_events for select to authenticated using ((select public.is_platform_admin()));
create policy tickets_platform_or_office_read on public.support_tickets for select to authenticated using ((select public.is_platform_admin()) or office_id = (select public.current_office_id()));
create policy tickets_platform_or_office_insert on public.support_tickets for insert to authenticated with check ((select public.is_platform_admin()) or (office_id = (select public.current_office_id()) and opened_by = auth.uid()));
create policy tickets_platform_update on public.support_tickets for update to authenticated using ((select public.is_platform_admin())) with check ((select public.is_platform_admin()));
create policy ticket_messages_platform_or_office_read on public.support_ticket_messages for select to authenticated using ((select public.is_platform_admin()) or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.office_id = (select public.current_office_id()) and is_internal = false));
create policy ticket_messages_platform_or_office_insert on public.support_ticket_messages for insert to authenticated with check ((select public.is_platform_admin()) or (author_id = auth.uid() and is_internal = false and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.office_id = (select public.current_office_id()))));

grant select, insert, update, delete on public.platform_brand_settings, public.platform_notifications, public.platform_subscription_events, public.support_tickets, public.support_ticket_messages to authenticated, service_role;
grant execute on function public.sync_platform_notifications() to authenticated, service_role;

commit;
