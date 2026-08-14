begin;

create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('app.allow_privileged_profile_write', true) = 'true' then
    return new;
  end if;

  if not public.is_manager() and not public.is_platform_admin() and (
    new.office_id is distinct from old.office_id
    or new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email is distinct from old.email
  ) then
    raise exception 'لا تملك صلاحية تعديل الدور أو المكتب أو حالة المستخدم';
  end if;

  return new;
end;
$$;

commit;
