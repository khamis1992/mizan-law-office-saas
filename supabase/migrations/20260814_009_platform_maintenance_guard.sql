begin;

create or replace function public.guard_suspended_office_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_office_id uuid := coalesce(new.office_id, old.office_id);
begin
  if current_setting('app.allow_platform_maintenance', true) = 'true' or public.is_platform_admin() then
    return coalesce(new, old);
  end if;
  if not exists (select 1 from public.offices where id = v_office_id and service_status in ('trial'::public.office_service_status, 'active'::public.office_service_status)) then
    raise exception 'تم تعليق مساحة المكتب. تواصل مع مسؤول المنصة لتفعيل الاشتراك.';
  end if;
  return coalesce(new, old);
end;
$$;

commit;
