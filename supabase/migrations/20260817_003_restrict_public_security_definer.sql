-- Reconcile Supabase function ACLs: SECURITY DEFINER routines must not inherit
-- PUBLIC/anon execution. Restore only the explicit application or service-role grants.
begin;

revoke execute on function public.accept_office_invitation(uuid) from public;
revoke execute on function public.check_ai_request_quota(uuid) from public;
revoke execute on function public.create_default_office_subscription() from public;
revoke execute on function public.create_office_with_manager(text, text, text, text) from public;
revoke execute on function public.create_saas_invoice(uuid, timestamptz, text) from public;
revoke execute on function public.current_office_id() from public;
revoke execute on function public.current_user_role() from public;
revoke execute on function public.dispatch_hearing_reminders() from public;
revoke execute on function public.dispatch_limitation_alerts() from public;
revoke execute on function public.generate_due_recurring_invoices(timestamptz) from public;
revoke execute on function public.guard_saas_invoice_item_mutation() from public;
revoke execute on function public.guard_saas_invoice_mutation() from public;
revoke execute on function public.guard_suspended_office_writes() from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.is_current_office_operational() from public;
revoke execute on function public.is_lawyer_or_manager() from public;
revoke execute on function public.is_manager() from public;
revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.most_cited_sources(integer) from public;
revoke execute on function public.platform_ai_usage_summary() from public;
revoke execute on function public.prevent_saas_invoice_overpayment() from public;
revoke execute on function public.recalculate_saas_invoice_totals(uuid) from public;
revoke execute on function public.record_subscription_lifecycle_event() from public;
revoke execute on function public.run_recurring_billing_manual() from public;
revoke execute on function public.split_law_sections() from public;
revoke execute on function public.sync_platform_notifications() from public;
revoke execute on function public.sync_saas_invoice_after_item() from public;
revoke execute on function public.sync_saas_invoice_after_payment() from public;

grant execute on function public.accept_office_invitation(uuid) to authenticated, service_role;
grant execute on function public.check_ai_request_quota(uuid) to authenticated, service_role;
grant execute on function public.create_office_with_manager(text, text, text, text) to authenticated, service_role;
grant execute on function public.create_saas_invoice(uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.current_office_id() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_current_office_operational() to authenticated, service_role;
grant execute on function public.is_lawyer_or_manager() to authenticated, service_role;
grant execute on function public.is_manager() to authenticated, service_role;
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.most_cited_sources(integer) to authenticated, service_role;
grant execute on function public.platform_ai_usage_summary() to authenticated, service_role;
grant execute on function public.run_recurring_billing_manual() to authenticated, service_role;
grant execute on function public.sync_platform_notifications() to authenticated, service_role;

grant execute on function public.create_default_office_subscription() to service_role;
grant execute on function public.dispatch_hearing_reminders() to service_role;
grant execute on function public.dispatch_limitation_alerts() to service_role;
grant execute on function public.generate_due_recurring_invoices(timestamptz) to service_role;
grant execute on function public.guard_saas_invoice_item_mutation() to service_role;
grant execute on function public.guard_saas_invoice_mutation() to service_role;
grant execute on function public.guard_suspended_office_writes() to service_role;
grant execute on function public.handle_new_user() to service_role;
grant execute on function public.prevent_saas_invoice_overpayment() to service_role;
grant execute on function public.recalculate_saas_invoice_totals(uuid) to service_role;
grant execute on function public.record_subscription_lifecycle_event() to service_role;
grant execute on function public.split_law_sections() to service_role;
grant execute on function public.sync_saas_invoice_after_item() to service_role;
grant execute on function public.sync_saas_invoice_after_payment() to service_role;

commit;
