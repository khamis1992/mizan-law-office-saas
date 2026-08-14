begin;

drop policy if exists invitations_manager_all on public.office_invitations;
create policy invitations_manager_or_platform on public.office_invitations for all to authenticated
using ((office_id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin()))
with check ((office_id = (select public.current_office_id()) and (select public.is_manager())) or (select public.is_platform_admin()));

commit;
