drop policy if exists clients_write on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists documents_insert on public.documents;

create policy clients_insert_professional on public.clients
  for insert to authenticated
  with check (
    office_id = (select public.current_office_id())
    and (select public.is_lawyer_or_manager())
  );

create policy clients_update_professional on public.clients
  for update to authenticated
  using (
    office_id = (select public.current_office_id())
    and (select public.is_lawyer_or_manager())
  )
  with check (
    office_id = (select public.current_office_id())
    and (select public.is_lawyer_or_manager())
  );

create policy documents_insert_professional on public.documents
  for insert to authenticated
  with check (
    office_id = (select public.current_office_id())
    and (select public.is_lawyer_or_manager())
  );
