export const roleLabel = (role?: string | null) => ({
  manager: 'مدير المكتب',
  lawyer: 'محامٍ',
  employee: 'موظف',
}[role ?? ''] ?? 'غير محدد');

export const caseStatusLabel = (status?: string | null) => ({
  new: 'جديدة', active: 'نشطة', on_hold: 'معلّقة', closed: 'مغلقة', appeal: 'استئناف', archived: 'مؤرشفة',
}[status ?? ''] ?? 'غير محددة');

export const taskStatusLabel = (status?: string | null) => ({
  not_started: 'لم تبدأ', in_progress: 'قيد التنفيذ', completed: 'مكتملة', cancelled: 'ملغاة',
}[status ?? ''] ?? 'غير محددة');

export const hearingStatusLabel = (status?: string | null) => ({
  scheduled: 'مجدولة', held: 'عُقدت', postponed: 'مؤجلة', cancelled: 'ملغاة',
}[status ?? ''] ?? 'غير محددة');

export const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('ar-QA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

export const dateInputValue = (daysFromNow = 0) => {
  const date = new Date(Date.now() + daysFromNow * 86_400_000);
  return date.toISOString().slice(0, 16);
};

export const isOverdue = (value?: string | null, status?: string | null) => Boolean(
  value && status !== 'completed' && new Date(value).getTime() < Date.now(),
);

export const isReminderDue = (reminderAt?: string | null, hearingStatus?: string | null, now = Date.now()) => Boolean(
  reminderAt && hearingStatus === 'scheduled' && new Date(reminderAt).getTime() <= now,
);

export const isWithinDays = (value?: string | null, days?: number, now = Date.now()) => {
  if (!value || !days) return true;
  const timestamp = new Date(value).getTime();
  return timestamp >= now - days * 86_400_000 && timestamp <= now;
};
