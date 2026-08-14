begin;

create or replace function public.create_default_office_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial_plan uuid;
begin
  select id into v_trial_plan from public.saas_plans where code = 'trial' and is_active = true limit 1;
  if v_trial_plan is null then
    raise exception 'خطة التجربة غير متاحة';
  end if;
  insert into public.office_subscriptions (office_id, plan_id, status, billing_cycle, trial_ends_at, current_period_ends_at)
  values (new.id, v_trial_plan, 'trialing', 'monthly', now() + interval '14 days', now() + interval '14 days')
  on conflict (office_id) do nothing;
  return new;
end;
$$;

create trigger create_default_office_subscription
after insert on public.offices
for each row execute function public.create_default_office_subscription();

grant execute on function public.create_default_office_subscription() to service_role;

commit;
