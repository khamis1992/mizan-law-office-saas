/** أنواع بيانات إدارة المكتب المشتركة بين صفحات ميزان المكتب. */

export type Role = 'manager' | 'lawyer' | 'employee';
export type Profile = { id: string; office_id: string | null; role: Role; display_name: string; email: string | null; is_active: boolean };
export type Office = { id: string; name: string; phone: string | null; email: string | null };
export type Client = { id: string; full_name: string; kind: string; phone: string | null; email: string | null; national_id: string | null; notes: string | null; created_at: string };
export type ClientCommunication = { id: string; client_id: string; channel: string; subject: string; content: string | null; occurred_at: string; created_by: string | null };
export type LegalCase = { id: string; case_number: string; title: string; client_id: string; responsible_lawyer_id: string | null; type: string; status: string; court_name: string | null; opening_date: string | null; description: string | null };
export type Hearing = { id: string; case_id: string; hearing_at: string; court_name: string | null; court_room: string | null; status: string; outcome: string | null; reminder_at: string | null };
export type Task = { id: string; title: string; description: string | null; assigned_to: string | null; priority: string; status: string; due_at: string | null; case_id: string | null };
export type OfficeDocument = { id: string; file_name: string; category: string; case_id: string | null; client_id: string | null; created_at: string };
export type LegalSource = { id: string; title: string; official_number: string | null; source_type: string; source_url: string; issued_on: string | null };
