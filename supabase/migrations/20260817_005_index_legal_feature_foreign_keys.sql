-- Cover foreign keys introduced by the legal-office and advanced-intelligence
-- migrations. These indexes improve delete checks, joins, and RLS-scoped reads.
begin;

create index if not exists case_time_entries_case_id_idx on public.case_time_entries(case_id);
create index if not exists case_time_entries_lawyer_id_idx on public.case_time_entries(lawyer_id);
create index if not exists case_invoices_case_id_idx on public.case_invoices(case_id);
create index if not exists case_invoices_client_id_idx on public.case_invoices(client_id);
create index if not exists case_invoices_created_by_idx on public.case_invoices(created_by);
create index if not exists case_invoice_items_time_entry_id_idx on public.case_invoice_items(time_entry_id);
create index if not exists memo_templates_office_id_idx on public.memo_templates(office_id);
create index if not exists conflict_checks_case_id_idx on public.conflict_checks(case_id);
create index if not exists conflict_checks_checked_by_idx on public.conflict_checks(checked_by);

create index if not exists case_agent_runs_case_id_idx on public.case_agent_runs(case_id);
create index if not exists case_agent_suggestions_case_id_idx on public.case_agent_suggestions(case_id);
create index if not exists case_agent_suggestions_run_id_idx on public.case_agent_suggestions(run_id);
create index if not exists adversarial_memos_case_id_idx on public.adversarial_memos(case_id);
create index if not exists adversarial_memos_draft_id_idx on public.adversarial_memos(draft_id);
create index if not exists adversarial_memos_created_by_idx on public.adversarial_memos(created_by);
create index if not exists judgment_analyses_case_id_idx on public.judgment_analyses(case_id);
create index if not exists judgment_analyses_hearing_id_idx on public.judgment_analyses(hearing_id);
create index if not exists judgment_analyses_created_by_idx on public.judgment_analyses(created_by);
create index if not exists case_predictions_case_id_idx on public.case_predictions(case_id);
create index if not exists case_predictions_created_by_idx on public.case_predictions(created_by);
create index if not exists court_schedule_syncs_case_id_idx on public.court_schedule_syncs(case_id);
create index if not exists case_chat_messages_case_id_idx on public.case_chat_messages(case_id);
create index if not exists case_chat_messages_sender_id_idx on public.case_chat_messages(sender_id);
create index if not exists draft_comments_draft_id_idx on public.draft_comments(draft_id);
create index if not exists draft_comments_author_id_idx on public.draft_comments(author_id);
create index if not exists draft_revisions_draft_id_idx on public.draft_revisions(draft_id);
create index if not exists draft_revisions_author_id_idx on public.draft_revisions(author_id);
create index if not exists memo_template_usage_template_id_idx on public.memo_template_usage(template_id);
create index if not exists memo_template_usage_lawyer_id_idx on public.memo_template_usage(lawyer_id);
create index if not exists approval_workflows_draft_id_idx on public.approval_workflows(draft_id);
create index if not exists approval_workflows_created_by_idx on public.approval_workflows(created_by);
create index if not exists notification_deliveries_office_id_idx on public.notification_deliveries(office_id);
create index if not exists embedding_index_jobs_office_id_idx on public.embedding_index_jobs(office_id);
create index if not exists legal_audit_logs_actor_id_idx on public.legal_audit_logs(actor_id);
create index if not exists case_exports_case_id_idx on public.case_exports(case_id);
create index if not exists case_exports_requested_by_idx on public.case_exports(requested_by);
create index if not exists case_intake_analyses_office_id_idx on public.case_intake_analyses(office_id);
create index if not exists case_intake_analyses_requested_by_idx on public.case_intake_analyses(requested_by);

commit;
