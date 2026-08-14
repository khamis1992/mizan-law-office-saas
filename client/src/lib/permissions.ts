export type OfficeRole = 'manager' | 'lawyer' | 'employee' | null | undefined;
export type OfficeCapability =
  | 'manage_office'
  | 'create_case'
  | 'manage_hearing'
  | 'create_client'
  | 'create_task'
  | 'upload_document'
  | 'use_legal_assistant'
  | 'record_communication'
  | 'complete_assigned_task';

export function can(role: OfficeRole, capability: OfficeCapability): boolean {
  if (role === 'manager') return true;
  if (role === 'lawyer') return capability !== 'manage_office';
  return capability === 'record_communication' || capability === 'complete_assigned_task';
}
