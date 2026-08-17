import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { caseStatusLabel, dateLabel, isOverdue, roleLabel } from '@/lib/office-utils';
import { trpc, trpcClient } from '@/lib/trpc';
import { AlertTriangle, BellRing, Bot, BriefcaseBusiness, CalendarClock, CheckCircle2, ChevronLeft, ClipboardCheck, FileSignature, Hourglass, ListChecks, Plus, SearchCheck, Sparkles, UploadCloud, UserPlus, Users, XCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

/**
 * لوحة تحكم «غرفة القرار» — تصميم من العصف الذهني والتفكير المتسلسل (docs/plans/).
 * المحور: ما ينتظر قرارك ← مسطرة يومك ← نبض المكتب. صفوف داخل لوحات، لا بطاقات حرة،
 * ونفس هوية الألوان القائمة حرفياً.
 */

type Role = 'manager' | 'lawyer' | 'employee';
type Profile = { id: string; office_id: string | null; role: Role; display_name: string };
type Client = { id: string; full_name: string };
type LegalCase = { id: string; case_number: string; title: string; client_id: string; responsible_lawyer_id: string | null; type: string; status: string; court_name: string | null };
type Hearing = { id: string; case_id: string; hearing_at: string; court_name: string | null; court_room: string | null; status: string; outcome: string | null; reminder_at: string | null };
type Task = { id: string; title: string; description: string | null; assigned_to: string | null; priority: string; status: string; due_at: string | null; case_id: string | null };
type TeamMember = { id: string; role: Role; display_name: string; is_active: boolean };
type Communication = { id: string; client_id: string; subject: string; occurred_at: string };

export type PendingContract = { id: string; title: string; status: 'in_review'; current_version: number; created_at: string };
export type PendingRun = { id: string; agent_type: 'research' | 'contract' | 'case_file'; status: 'awaiting_approval'; objective: string; pending_action: { type: string; label: string } | null; created_at: string };

type Props = {
  accessToken: string;
  profile: Profile;
  officeName: string;
  cases: LegalCase[];
  clients: Client[];
  hearings: Hearing[];
  tasks: Task[];
  team: TeamMember[];
  communications: Communication[];
  contractDocs: PendingContract[];
  agentRuns: PendingRun[];
  practitioner: boolean;
  manager: boolean;
  setPage: (page: 'cases' | 'schedule' | 'clients' | 'research' | 'contracts' | 'agents' | 'office') => void;
  openModal: (modal: 'client' | 'case' | 'hearing' | 'task' | 'doc') => void;
  onRecordOutcome: (hearing: Hearing) => void;
  onCloseTask: (task: Task) => void;
  onRefresh: () => Promise<void> | void;
  onOpenCase?: (caseId: string) => void;
};

const DAY = 86400000;
const AGENT_LABELS: Record<string, string> = { research: 'وكيل البحث', contract: 'وكيل العقد', case_file: 'وكيل ملف القضية' };

export default function DashboardOverview({ accessToken, profile, officeName, cases, clients, hearings, tasks, team, communications, contractDocs, agentRuns, practitioner, manager, setPage, openModal, onRecordOutcome, onCloseTask, onRefresh, onOpenCase }: Props) {
  const caseById = (id?: string | null) => cases.find(item => item.id === id);
  const transition = trpc.contractStudio.transition.useMutation();
  const approveAgent = trpc.agents.approve.useMutation();
  const quota = trpc.aiUsage.quota.useQuery({ accessToken }, { enabled: practitioner, staleTime: 60_000 });
  const [dayBoard, setDayBoard] = useState<{ upcomingHearings: Array<{ id: string; case_id: string; hearing_at: string; court_name: string | null }>; overdueTasks: Array<{ id: string; title: string; due_at: string | null }>; nearLimitation: Array<{ id: string; case_number: string; title: string; limitation_date: string | null }>; hearingsOnHolidays: Array<{ id: string; case_id: string; hearing_at: string }>; suggestions: Array<{ kind: string; title: string; detail: string; priority: string }> } | null>(null);

  useEffect(() => {
    if (!practitioner) return;
    trpcClient.legalIntelligence.dayBoard.query({ accessToken }).then(result => setDayBoard(result as typeof dayBoard)).catch(() => undefined);
  }, [accessToken, practitioner]);

  const activeCases = cases.filter(item => ['new', 'active', 'on_hold', 'appeal'].includes(item.status));
  const openTasks = tasks.filter(item => item.status !== 'completed');
  const overdue = openTasks.filter(item => isOverdue(item.due_at, item.status));
  const upcoming = hearings.filter(item => item.status === 'scheduled' && new Date(item.hearing_at) > new Date());
  const weekHearings = upcoming.filter(item => new Date(item.hearing_at).getTime() < Date.now() + 7 * DAY);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'طاب يومك' : 'مساء الخير';
  const today = new Intl.DateTimeFormat('ar-QA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  // مسطرة اليوم: جلسات اليوم/غد + مهام مستحقة اليوم/غد، مرتبة زمنياً
  type Slot = { key: string; at: Date; kind: 'hearing' | 'task'; title: string; meta: string; hearing?: Hearing; task?: Task };
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 2 * DAY);
  const slots = useMemo<Slot[]>(() => {
    const items: Slot[] = [];
    for (const hearing of hearings) {
      const at = new Date(hearing.hearing_at);
      if (hearing.status !== 'scheduled' || at < dayStart || at >= dayEnd) continue;
      items.push({ key: `h-${hearing.id}`, at, kind: 'hearing', title: caseById(hearing.case_id)?.title || 'قضية مرتبطة', meta: `${hearing.court_name || 'المحكمة غير محددة'}${hearing.court_room ? ` · ${hearing.court_room}` : ''}`, hearing });
    }
    for (const task of openTasks) {
      if (!task.due_at) continue;
      const at = new Date(task.due_at);
      if (at < dayStart || at >= dayEnd) continue;
      items.push({ key: `t-${task.id}`, at, kind: 'task', title: task.title, meta: `${caseById(task.case_id)?.case_number || 'مهمة عامة'} · استحقاق ${dateLabel(task.due_at)}`, task });
    }
    return items.sort((left, right) => left.at.getTime() - right.at.getTime());
  }, [hearings, openTasks, cases]);
  const canComplete = (task: Task) => manager || task.assigned_to === profile.id;

  const workload = useMemo(() => team
    .filter(member => member.is_active && ['manager', 'lawyer'].includes(member.role))
    .map(member => ({
      name: member.display_name || 'عضو',
      load: cases.filter(item => item.responsible_lawyer_id === member.id && ['new', 'active', 'on_hold', 'appeal'].includes(item.status)).length
        + openTasks.filter(item => item.assigned_to === member.id).length,
    }))
    .sort((left, right) => right.load - left.load).slice(0, 3), [team, cases, openTasks]);
  const workloadMax = Math.max(1, ...workload.map(member => member.load));

  const activity = useMemo(() => [
    ...communications.slice(0, 3).map(item => ({ id: `c-${item.id}`, text: `${clients.find(client => client.id === item.client_id)?.full_name ?? 'عميل'} — ${item.subject}`, when: item.occurred_at })),
    ...hearings.filter(item => item.outcome).slice(0, 2).map(item => ({ id: `h-${item.id}`, text: `${caseById(item.case_id)?.title ?? 'قضية'} — ${item.outcome!.slice(0, 50)}`, when: item.hearing_at })),
  ].sort((left, right) => new Date(right.when).getTime() - new Date(left.when).getTime()).slice(0, 3), [communications, hearings, cases, clients]);

  const isNewOffice = !cases.length && !clients.length && !tasks.length && !hearings.length;
  const onboarding = [
    { done: clients.length > 0, label: 'إضافة أول عميل', action: practitioner ? () => openModal('client') : undefined, cta: 'عميل جديد' },
    { done: cases.length > 0, label: 'تسجيل أول قضية', action: practitioner ? () => openModal('case') : undefined, cta: 'قضية جديدة' },
    { done: hearings.length > 0, label: 'جدولة أول جلسة', action: practitioner ? () => openModal('hearing') : undefined, cta: 'جدولة جلسة' },
    { done: team.length > 1, label: 'دعوة فريق المكتب', action: manager ? () => setPage('office') : undefined, cta: 'الفريق' },
  ];

  const decideContract = async (doc: PendingContract, to: 'approved' | 'draft') => {
    const label = to === 'approved' ? 'الاعتماد الداخلي' : 'الإعادة إلى مسودة';
    if (!confirm(`سيتم ${label} لمستند «${doc.title}» ويُسجل القرار باسمك في سجل الاعتماد. متابعة؟`)) return;
    try {
      await transition.mutateAsync({ accessToken, documentId: doc.id, to, note: 'قرار من لوحة التحكم' });
      toast.success(to === 'approved' ? 'اعتُمد المستند داخلياً.' : 'أُعيد المستند إلى مسودة.');
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل القرار.');
    }
  };

  const decideAgent = async (run: PendingRun, decision: 'approved' | 'rejected') => {
    if (!confirm(`${decision === 'approved' ? 'سيُنفذ' : 'سيُرفض'}: ${run.pending_action?.label ?? 'الإجراء المعلق'}. القرار يُسجل باسمك. متابعة؟`)) return;
    try {
      await approveAgent.mutateAsync({ accessToken, runId: run.id, decision });
      toast.success(decision === 'approved' ? 'نُفذ الإجراء بعد الموافقة.' : 'رُفض الإجراء وسُجل القرار.');
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل القرار.');
    }
  };

  const timeChip = (at: Date) => ({
    time: new Intl.DateTimeFormat('ar-QA', { hour: 'numeric', minute: '2-digit' }).format(at),
    day: at.toDateString() === new Date().toDateString() ? 'اليوم' : 'غداً',
  });

  const quotaData = quota.data as { allowed: boolean; used: number; cap: number | null } | undefined;
  const remaining = quotaData ? (quotaData.cap === null ? null : Math.max(0, quotaData.cap - quotaData.used)) : null;
  const ringRatio = quotaData?.cap ? Math.min(1, quotaData.used / quotaData.cap) : 0;
  const RING_LENGTH = 2 * Math.PI * 22;

  return (
    <>
      {/* الصحيفة الافتتاحية: بطل داكن بتوهج ذهبي وملمس حبيبي — من منهجية مهارة التصميم */}
      <motion.section initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 24 }} className="relative overflow-hidden rounded-3xl bg-[#103b35] text-white shadow-xl shadow-[#0d3b36]/25 mz-hero mz-grain mb-6">
        <div className="relative p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[.18em] text-[#e8c377]">{today} · {officeName}</p>
            <h1 className="font-display text-3xl sm:text-4xl leading-snug mt-2 text-white">{greeting}، <span className="text-[#e8c377]">{profile.display_name || 'زميلنا'}</span> <span className="text-sm font-medium text-emerald-50/70">— {roleLabel(profile.role)}</span></h1>
            <p className="text-sm leading-7 text-emerald-50/80 mt-2 max-w-2xl">
              {practitioner && (contractDocs.length + agentRuns.length) > 0 && <span className="font-bold text-[#e8c377]">{contractDocs.length + agentRuns.length} قراراً ينتظرك</span>}
              {slots.length > 0 && <span>{(practitioner && (contractDocs.length + agentRuns.length) > 0 ? ' · ' : '')}{slots.length} موعداً اليوم وغداً</span>}
              {overdue.length > 0 && <span className="font-bold text-[#e8c377]"> · {overdue.length} مهمة متأخرة</span>}
              {!slots.length && !overdue.length && !(practitioner && contractDocs.length + agentRuns.length > 0) && 'لا أولويات عاجلة اليوم — وقت مناسب للبحث القانوني وإعداد المستندات.'}
            </p>
          </div>
          {practitioner && (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button variant="outline" size="sm" className="h-9 border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm" onClick={() => openModal('client')}><Plus className="h-3.5 w-3.5" />عميل</Button>
              <Button variant="outline" size="sm" className="h-9 border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm" onClick={() => openModal('hearing')}><Plus className="h-3.5 w-3.5" />جلسة</Button>
              <Button variant="outline" size="sm" className="h-9 border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm" onClick={() => openModal('task')}><Plus className="h-3.5 w-3.5" />مهمة</Button>
              <Button variant="outline" size="sm" className="h-9 border-white/15 bg-white/10 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm" onClick={() => openModal('doc')}><UploadCloud className="h-3.5 w-3.5" />مستند</Button>
              <Button size="sm" className="h-9 bg-[#e8c377] text-[#153a36] hover:bg-[#f0d18a]" onClick={() => setPage('research')}><SearchCheck className="h-3.5 w-3.5" />بحث قانوني</Button>
            </div>
          )}
        </div>
        </div>
      </motion.section>

      {/* خط البداية للمكاتب الجديدة */}
      {isNewOffice && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="rounded-2xl bg-white shadow-sm p-5 mb-5">
          <p className="font-bold text-[#153a36] flex gap-2 mb-4"><ListChecks className="h-5 w-5 text-[#b58524]" />خط البداية — جهّز مكتبك في أربع خطوات</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {onboarding.map(step => (
              <div key={step.label} className={`rounded-xl border p-4 ${step.done ? 'border-emerald-200 bg-emerald-50' : 'border-[#e5ece9]'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[#153a36]">{step.label}</p>
                  {step.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <span className="h-4 w-4 rounded-full border-2 border-[#6b9b91]" />}
                </div>
                {!step.done && step.action && <Button size="sm" variant="outline" className="mt-3 h-8" onClick={step.action}>{step.cta}</Button>}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, type: 'spring', stiffness: 200, damping: 24 }} className="grid xl:grid-cols-[1.6fr_1fr] gap-5">
        {/* ═══ العمود الرئيسي: اليوم والقرار ═══ */}
        <div className="space-y-5">
          {/* 1) بانتظار قرارك — حلقة الحوكمة في صدر اللوحة */}
          {practitioner && (contractDocs.length > 0 || agentRuns.length > 0) && (
            <section className="rounded-2xl bg-white shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3 flex items-center gap-2 border-b border-[#e5ece9]">
                <ListChecks className="h-5 w-5 text-[#b58524]" />
                <h2 className="font-bold text-[#153a36]">بانتظار قرارك</h2>
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{contractDocs.length + agentRuns.length}</Badge>
              </div>
              <div className="divide-y divide-[#f4f7f5]">
                {contractDocs.map(doc => (
                  <div key={doc.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="h-9 w-9 rounded-xl grid place-items-center bg-blue-50 text-blue-700 shrink-0"><FileSignature className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#153a36] truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">عقد بانتظار مراجعة محامٍ · نسخة {doc.current_version} · {dateLabel(doc.created_at)}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" className="h-8 bg-[#0d3b36]" disabled={transition.isPending} onClick={() => decideContract(doc, 'approved')}><CheckCircle2 className="h-3.5 w-3.5" />اعتماد داخلي</Button>
                      <Button size="sm" variant="outline" className="h-8" disabled={transition.isPending} onClick={() => decideContract(doc, 'draft')}>إعادة لمسودة</Button>
                    </div>
                  </div>
                ))}
                {agentRuns.map(run => (
                  <div key={run.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="h-9 w-9 rounded-xl grid place-items-center bg-amber-50 text-amber-700 shrink-0"><Bot className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-[#153a36]">{AGENT_LABELS[run.agent_type] ?? run.agent_type}: {run.pending_action?.label ?? run.objective.slice(0, 60)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{dateLabel(run.created_at)} · القرار يُسجل باسمك في سجل الموافقات</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" className="h-8 bg-[#0d3b36]" disabled={approveAgent.isPending} onClick={() => decideAgent(run, 'approved')}><CheckCircle2 className="h-3.5 w-3.5" />موافقة وتنفيذ</Button>
                      <Button size="sm" variant="outline" className="h-8 text-rose-700" disabled={approveAgent.isPending} onClick={() => decideAgent(run, 'rejected')}><XCircle className="h-3.5 w-3.5" />رفض</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 2) مسطرة اليوم — خط زمني عمودي بإجراء سطري لكل بند */}
          <section className="rounded-2xl bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#e5ece9]">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-[#b58524]" />
                <h2 className="font-bold text-[#153a36]">{slots.length ? 'مسطرة اليوم وغداً' : 'جدول هذا الأسبوع'}</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPage('schedule')}>الجلسات<ChevronLeft className="h-4 w-4" /></Button>
            </div>
            {slots.length ? (
              <div className="relative px-5 py-4">
                <div className="absolute top-6 bottom-6 right-[86px] w-px bg-[#e5ece9]" />
                {slots.map(slot => {
                  const chip = timeChip(slot.at);
                  const overdueTask = slot.kind === 'task' && isOverdue(slot.task!.due_at, slot.task!.status);
                  return (
                    <div key={slot.key} className="relative flex gap-4 py-3">
                      <div className="w-16 shrink-0 text-center">
                        <p className="text-sm font-bold text-[#153a36]">{chip.time}</p>
                        <p className={`text-[10px] ${overdueTask ? 'text-rose-600 font-semibold' : 'text-muted-foreground'}`}>{chip.day}</p>
                      </div>
                      <span className={`absolute right-[82px] top-5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${slot.kind === 'hearing' ? 'bg-[#b58524]' : overdueTask ? 'bg-rose-500' : 'bg-[#21685e]'}`} />
                      <div className="flex-1 min-w-0 pr-4">
                        <p className="font-semibold text-sm text-[#153a36] truncate">{slot.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{slot.meta}</p>
                      </div>
                      {slot.kind === 'hearing' && practitioner && slot.hearing && (
                        <Button size="sm" variant="outline" className="h-8 shrink-0 self-center" onClick={() => onRecordOutcome(slot.hearing!)}>تسجيل النتيجة</Button>
                      )}
                      {slot.kind === 'task' && slot.task && canComplete(slot.task) && (
                        <Button size="sm" variant="outline" className="h-8 shrink-0 self-center" onClick={() => onCloseTask(slot.task!)}>إغلاق</Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : weekHearings.length ? (
              <div className="px-5 py-4 space-y-2">
                {weekHearings.slice(0, 6).map(item => {
                  const when = new Date(item.hearing_at);
                  return (
                    <button key={item.id} className="w-full text-right flex gap-3 items-center py-2" onClick={() => (onOpenCase ? onOpenCase(item.case_id) : setPage('schedule'))}>
                      <div className="w-14 rounded-xl bg-[#edf4f1] text-[#1b6258] text-center py-1.5 shrink-0">
                        <p className="font-bold leading-none">{new Intl.DateTimeFormat('ar-QA', { day: 'numeric' }).format(when)}</p>
                        <p className="text-[10px] mt-1">{new Intl.DateTimeFormat('ar-QA', { month: 'short', weekday: 'short' }).format(when)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[#153a36] truncate">{caseById(item.case_id)?.title || 'قضية مرتبطة'}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Intl.DateTimeFormat('ar-QA', { hour: 'numeric', minute: '2-digit' }).format(when)} · {item.court_name || 'المحكمة غير محددة'}</p>
                      </div>
                    </button>
                  );
                })}
                {weekHearings.length > 6 && <button className="w-full text-xs text-[#1b6258] font-semibold pt-1" onClick={() => setPage('schedule')}>+ {weekHearings.length - 6} جلسة أخرى هذا الأسبوع</button>}
              </div>
            ) : (
              <div className="py-10 text-center px-6">
                <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-600" />
                <p className="font-semibold mt-3 text-[#153a36]">لا مواعيد اليوم ولا غداً</p>
                <p className="text-sm text-muted-foreground mt-1">لا جلسات مجدولة ولا مهام مستحقة خلال يومين — جدولك صافٍ.</p>
              </div>
            )}
          </section>
        </div>

        {/* ═══ الشريط الجانبي: نبض المكتب ═══ */}
        <div className="space-y-5">
          {/* مؤشرات مصغرة بأشرطة نسبية */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'قضايا نشطة', value: activeCases.length, max: Math.max(activeCases.length, 1), icon: BriefcaseBusiness, chip: 'bg-[#edf4f1] text-[#1b6258]', page: 'cases' as const },
              { label: 'جلسات الأسبوع', value: weekHearings.length, max: Math.max(weekHearings.length, 1), icon: CalendarClock, chip: 'bg-amber-50 text-amber-700', page: 'schedule' as const },
              { label: 'مهام متأخرة', value: overdue.length, max: Math.max(openTasks.length, 1), icon: BellRing, chip: 'bg-rose-50 text-rose-700', page: 'schedule' as const },
              { label: 'فريق نشط', value: team.filter(member => member.is_active).length, max: Math.max(team.length, 1), icon: Users, chip: 'bg-blue-50 text-blue-700', page: 'office' as const },
            ].map(card => {
              const Icon = card.icon;
              return (
                <button key={card.label} onClick={() => setPage(card.page)} className="text-right rounded-2xl bg-white shadow-sm p-4 hover:bg-[#f8fbfa] transition-colors">
                  <div className="flex justify-between items-start">
                    <p className="text-2xl font-bold text-[#153a36]">{card.value}</p>
                    <div className={`h-8 w-8 rounded-lg grid place-items-center ${card.chip}`}><Icon className="h-4 w-4" /></div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{card.label}</p>
                  <div className="h-1.5 rounded-full bg-[#f4f7f5] mt-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-[#21685e]" style={{ width: `${Math.min(100, Math.round(card.value / card.max * 100))}%` }} />
                  </div>
                </button>
              );
            })}
          </div>

          {/* عبء الفريق */}
          <section className="rounded-2xl bg-white shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[#153a36]">عبء الفريق</h3>
              <Button variant="ghost" size="sm" onClick={() => setPage('office')}><UserPlus className="h-3.5 w-3.5" />الفريق</Button>
            </div>
            {workload.length ? workload.map(member => (
              <div key={member.name} className="mb-3 last:mb-0">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[#153a36]">{member.name}</span>
                  <span className="text-muted-foreground">{member.load} عمل نشط</span>
                </div>
                <div className="h-2 rounded-full bg-[#f4f7f5] overflow-hidden">
                  <div className="h-full rounded-full bg-[#21685e]" style={{ width: `${Math.max(6, Math.round(member.load / workloadMax * 100))}%` }} />
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground">لا أعضاء نشطين بعد.</p>}
          </section>

          {/* آخر النشاطات */}
          <section className="rounded-2xl bg-white shadow-sm p-5">
            <h3 className="font-bold text-[#153a36] mb-4">آخر النشاطات</h3>
            {activity.length ? (
              <div className="space-y-3">
                {activity.map(item => (
                  <div key={item.id} className="flex gap-3 items-start">
                    <div className="h-8 w-8 rounded-lg bg-[#edf4f1] text-[#1b6258] grid place-items-center shrink-0"><Users className="h-4 w-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm text-[#153a36] truncate">{item.text}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{dateLabel(item.when)}</p>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="text-[#1b6258]" onClick={() => setPage('office')}>التقارير<ChevronLeft className="h-4 w-4" /></Button>
              </div>
            ) : <p className="text-sm text-muted-foreground">لا نشاطات بعد — ابدأ بمتابعة عميل من صفحة العملاء.</p>}
          </section>

          {/* يوم المحامي — اقتراحات ذكية */}
          {dayBoard && (dayBoard.suggestions.length > 0 || dayBoard.nearLimitation.length > 0 || dayBoard.hearingsOnHolidays.length > 0) && (
            <section className="rounded-2xl bg-white shadow-sm p-5">
              <h3 className="font-bold text-[#153a36] flex items-center gap-2 mb-4"><Sparkles className="h-4 w-4 text-[#b58524]" />يوم المحامي — اقتراحات ذكية</h3>
              <div className="space-y-2.5">
                {dayBoard.suggestions.map((suggestion, index) => (
                  <div key={index} className={`rounded-xl p-3 text-sm ${suggestion.priority === 'high' ? 'bg-rose-50' : 'bg-amber-50'}`}>
                    <p className="font-semibold text-[#153a36] flex items-center gap-1.5">
                      {suggestion.kind === 'risk' ? <AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> : <Hourglass className="h-3.5 w-3.5 text-amber-600" />}
                      {suggestion.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 leading-5">{suggestion.detail}</p>
                  </div>
                ))}
                {dayBoard.nearLimitation.length > 0 && (
                  <div className="rounded-xl bg-amber-50 p-3">
                    <p className="font-semibold text-sm text-[#153a36] flex items-center gap-1.5"><Hourglass className="h-3.5 w-3.5 text-amber-600" />تقادم قريب ({dayBoard.nearLimitation.length})</p>
                    <div className="mt-1.5 space-y-1">
                      {dayBoard.nearLimitation.slice(0, 3).map(item => (
                        <button key={item.id} className="block w-full text-right text-xs text-[#1b6258] hover:underline truncate" onClick={() => onOpenCase?.(item.id)}>
                          {item.case_number} — {item.title} · {item.limitation_date}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* لوح الذكاء القانوني — الداكن الوحيد، بحلقة الحصة */}
          <section className="rounded-2xl bg-[#103b35] text-white shadow-sm p-5">            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-bold flex items-center gap-2"><SearchCheck className="h-4 w-4 text-[#e8c377]" />الذكاء القانوني</h3>
                {practitioner && quotaData ? (
                  remaining === null
                    ? <p className="text-xs text-emerald-50/70 mt-2 leading-5">استخدام غير محدود بخطتكم الحالية · استُهلك {quotaData.used} طلباً هذا الشهر</p>
                    : <p className="text-xs text-emerald-50/70 mt-2 leading-5">متبقٍ {remaining} من {quotaData.cap} طلباً هذا الشهر</p>
                ) : (
                  <p className="text-xs text-emerald-50/70 mt-2 leading-5">{practitioner ? 'بحث موثق واستديو عقود ووكلاء مقيدون.' : 'هذه المساحة مخصصة للمحامين ومدير المكتب.'}</p>
                )}
              </div>
              {practitioner && quotaData && remaining !== null && (
                <svg viewBox="0 0 52 52" className="h-14 w-14 shrink-0 -rotate-90">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
                  <circle cx="26" cy="26" r="22" fill="none" stroke="#e8c377" strokeWidth="5" strokeLinecap="round" strokeDasharray={RING_LENGTH} strokeDashoffset={RING_LENGTH * (1 - ringRatio)} />
                  <text x="26" y="30" textAnchor="middle" className="fill-white" fontSize="12" fontWeight="700" transform="rotate(90 26 26)">{quotaData.used}</text>
                </svg>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <Button variant="outline" size="sm" className="h-9 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white justify-center" onClick={() => setPage('research')}><SearchCheck className="h-3.5 w-3.5" />بحث</Button>
              <Button variant="outline" size="sm" className="h-9 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white justify-center" onClick={() => setPage('contracts')}><FileSignature className="h-3.5 w-3.5" />عقود</Button>
              <Button variant="outline" size="sm" className="h-9 border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white justify-center" onClick={() => setPage('agents')}><Bot className="h-3.5 w-3.5" />وكلاء</Button>
            </div>
            <p className="text-[10px] leading-4 text-emerald-50/60 mt-3">المخرجات مسودات ومذكرات للمحامي المراجع، وكل إجراء مؤثر خلف موافقتك الصريحة.</p>
          </section>
        </div>
      </motion.div>
    </>
  );
}
