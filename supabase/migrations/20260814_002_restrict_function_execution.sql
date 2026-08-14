begin;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_office_id() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;
grant execute on function public.is_lawyer_or_manager() to authenticated, service_role;
grant execute on function public.create_office_with_manager(text, text, text, text) to authenticated, service_role;
grant execute on function public.accept_office_invitation(uuid) to authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.protect_profile_sensitive_fields() to service_role;
grant execute on function public.protect_employee_task_edit() to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
