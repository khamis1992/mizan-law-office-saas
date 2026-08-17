import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateLabel, hearingStatusLabel, isOverdue, taskStatusLabel } from '@/lib/office-utils';
import { Bot, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react';
import { EmptyState, FilterChips, ListPanel, PageHeader } from './office-ui';
import type { Hearing, LegalCase, Profile, Task } from './types';

/**
 * «الجدول» — الدمج الأمثل للجلسات والمهام في تقويم واحد:
 * شبكة شهر RTL بنقاط ملونة لكل يوم + أجندة اليوم المختار بإجراءات سطرية
 * + قائمة الأسبوع القادم. محوّل نتيجته: "متى موعدي التالي؟" من نظرة واحدة.
 */

const WEEK_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY = 86400000;

type Props = {
  hearings: Hearing[];
  tasks: Task[];
  cases: LegalCase[];
  team: Profile[];
  practitioner: boolean;
  manager: boolean;
  profileId: string;
  onRecordOutcome: (hearing: Hearing) => void;
  onCloseTask: (task: Task) => void;
  onOpenCase: (caseId: string) => void;
};

export default function SchedulePage({ hearings, tasks, cases, team, practitioner, manager, profileId, onRecordOutcome, onCloseTask, onOpenCase }: Props) {
  const [filter, setFilter] = useState<'all' | 'hearings' | 'tasks'>('all');
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const caseById = (id?: string | null) => cases.find(item => item.id === id);
  const memberById = (id?: string | null) => team.find(item => item.id === id);
  const openTasks = tasks.filter(task => task.status !== 'completed');
  const todayKey = new Date().toDateString();

  const showHearings = filter !== 'tasks';
  const showTasks = filter !== 'hearings';

  const dayKey = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).toDateString();

  const byDay = useMemo(() => {
    const map = new Map<string, { hearings: Hearing[]; tasks: Task[] }>();
    const bucket = (key: string) => {
      if (!map.has(key)) map.set(key, { hearings: [], tasks: [] });
      return map.get(key)!;
    };
    if (showHearings) for (const hearing of hearings) bucket(dayKey(new Date(hearing.hearing_at))).hearings.push(hearing);
    if (showTasks) for (const task of openTasks) if (task.due_at) bucket(dayKey(new Date(task.due_at))).tasks.push(task);
    return map;
  }, [hearings, openTasks, showHearings, showTasks]);

  const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
  const monthLabel = new Intl.DateTimeFormat('ar-QA', { month: 'long', year: 'numeric' }).format(monthDate);
  const firstWeekday = monthDate.getDay();
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const cells: Array<{ day: number; date: Date } | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ day: index + 1, date: new Date(monthDate.getFullYear(), monthDate.getMonth(), index + 1) })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const upcoming = useMemo(() => {
    type Row = { key: string; at: Date; kind: 'hearing' | 'task'; hearing?: Hearing; task?: Task };
    const rows: Row[] = [];
    if (showHearings) for (const hearing of hearings) {
      if (hearing.status !== 'scheduled') continue;
      const at = new Date(hearing.hearing_at);
      if (at.getTime() < Date.now() || at.getTime() > Date.now() + 7 * DAY) continue;
      rows.push({ key: `h-${hearing.id}`, at, kind: 'hearing', hearing });
    }
    if (showTasks) for (const task of openTasks) {
      if (!task.due_at) continue;
      const at = new Date(task.due_at);
      if (at.getTime() > Date.now() + 7 * DAY) continue;
      rows.push({ key: `t-${task.id}`, at, kind: 'task', task });
    }
    return rows.sort((left, right) => left.at.getTime() - right.at.getTime()).slice(0, 8);
  }, [hearings, openTasks, showHearings, showTasks]);

  const selected = selectedDay ? byDay.get(selectedDay) : null;
  const canComplete = (task: Task) => manager || task.assigned_to === profileId;

  return (
    <>
      <PageHeader
        eyebrow="تقويم المكتب"
        title="الجدول — جلسات ومهام في تقويم واحد"
        text="كل مواعيد المكتب في شبكة شهرية بنقاط ملونة، وأجندة اليوم المختار بإجراء مباشر من السطر، وقائمة الأسبوع القادم."
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'الكل', count: hearings.filter(item => item.status === 'scheduled').length + openTasks.filter(item => item.due_at).length },
          { id: 'hearings', label: 'الجلسات', count: hearings.filter(item => item.status === 'scheduled').length },
          { id: 'tasks', label: 'المهام', count: openTasks.filter(item => item.due_at).length },
        ]}
      />
      <div className="grid xl:grid-cols-[1.5fr_1fr] gap-5">
        <section className="mz-lift rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#e5ece9]">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-[#b58524]" />
              <h2 className="font-bold text-[#153a36]">{monthLabel}</h2>
            </div>
            <div className="flex items-center gap-1.5">
              {monthOffset !== 0 && <Button size="sm" variant="outline" className="h-8" onClick={() => { setMonthOffset(0); setSelectedDay(null); }}>اليوم</Button>}
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => { setMonthOffset(offset => offset + 1); setSelectedDay(null); }}><ChevronRight className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => { setMonthOffset(offset => offset - 1); setSelectedDay(null); }}><ChevronLeft className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-7 mb-1">
              {WEEK_DAYS.map(day => <p key={day} className="text-center text-[11px] font-semibold text-muted-foreground py-1.5">{day.slice(0, 3)}</p>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((cell, index) => {
                if (!cell) return <div key={`e-${index}`} className="h-[74px] rounded-xl bg-[#f8fbfa]" />;
                const key = dayKey(cell.date);
                const bucket = byDay.get(key);
                const hearingCount = bucket?.hearings.length ?? 0;
                const taskCount = bucket?.tasks.length ?? 0;
                const isToday = key === todayKey;
                const isSelected = key === selectedDay;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDay(isSelected ? null : key)}
                    className={`h-[74px] rounded-xl border p-1.5 text-right flex flex-col transition-colors ${isSelected ? 'border-[#1b6258] bg-[#e9f2ef]' : isToday ? 'border-[#b58524] bg-[#fff8e8]' : hearingCount + taskCount > 0 ? 'border-[#e5ece9] bg-white hover:bg-[#f8fbfa]' : 'border-transparent hover:bg-[#f8fbfa]'}`}
                  >
                    <span className={`text-xs font-bold ${isToday ? 'text-[#8d6515]' : 'text-[#153a36]'}`}>{cell.day}</span>
                    {(hearingCount > 0 || taskCount > 0) && (
                      <span className="mt-auto flex flex-wrap gap-1">
                        {hearingCount > 0 && <span className="h-2 w-2 rounded-full bg-[#b58524]" title={`${hearingCount} جلسة`} />}
                        {taskCount > 0 && <span className="h-2 w-2 rounded-full bg-[#21685e]" title={`${taskCount} مهمة`} />}
                        {hearingCount + taskCount > 1 && <span className="text-[10px] text-muted-foreground">{hearingCount + taskCount}</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 px-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#b58524]" />جلسة</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#21685e]" />استحقاق مهمة</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-[#b58524]" />اليوم</span>
            </div>
          </div>
        </section>

        <div className="space-y-5">
          <ListPanel icon={CalendarClock} title={selectedDay ? `أجندة ${new Intl.DateTimeFormat('ar-QA', { day: 'numeric', month: 'long' }).format(new Date(selectedDay))}` : 'الأسبوع القادم'}>
            {selected ? (
              <div className="divide-y divide-[#f4f7f5]">
                {[...selected.hearings.map(item => ({ kind: 'hearing' as const, item })), ...selected.tasks.map(item => ({ kind: 'task' as const, item }))].sort((left, right) =>
                  new Date(left.kind === 'hearing' ? (left.item as Hearing).hearing_at : (left.item as Task).due_at!).getTime()
                  - new Date(right.kind === 'hearing' ? (right.item as Hearing).hearing_at : (right.item as Task).due_at!).getTime()
                ).map(({ kind, item }) => kind === 'hearing' ? (
                  <div key={(item as Hearing).id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg grid place-items-center bg-amber-50 text-amber-700 shrink-0"><CalendarClock className="h-4 w-4" /></div>
                    <button className="flex-1 min-w-0 text-right" onClick={() => onOpenCase((item as Hearing).case_id)}>
                      <p className="text-sm font-semibold text-[#153a36] truncate">{caseById((item as Hearing).case_id)?.title ?? 'قضية مرتبطة'}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{new Intl.DateTimeFormat('ar-QA', { hour: 'numeric', minute: '2-digit' }).format(new Date((item as Hearing).hearing_at))} · {(item as Hearing).court_name ?? 'المحكمة غير محددة'}</p>
                    </button>
                    <Badge variant="outline" className="shrink-0">{hearingStatusLabel((item as Hearing).status)}</Badge>
                    {practitioner && (item as Hearing).status === 'scheduled' && <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => onRecordOutcome(item as Hearing)}>تسجيل النتيجة</Button>}
                  </div>
                ) : (
                  <div key={(item as Task).id} className="px-5 py-3.5 flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${isOverdue((item as Task).due_at, (item as Task).status) ? 'bg-rose-50 text-rose-700' : 'bg-[#edf4f1] text-[#1b6258]'}`}><ClipboardCheck className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#153a36] truncate">{(item as Task).title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{memberById((item as Task).assigned_to)?.display_name ?? 'غير مسند'} · {caseById((item as Task).case_id)?.case_number ?? 'عامة'}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">{taskStatusLabel((item as Task).status)}</Badge>
                    {canComplete(item as Task) && <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => onCloseTask(item as Task)}><CheckCircle2 className="h-3.5 w-3.5" />إغلاق</Button>}
                  </div>
                ))}
              </div>
            ) : upcoming.length ? (
              <div className="divide-y divide-[#f4f7f5]">
                {upcoming.map(row => {
                  const when = new Intl.DateTimeFormat('ar-QA', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(row.at);
                  return (
                    <button key={row.key} className="w-full text-right px-5 py-3.5 flex items-center gap-3 hover:bg-[#f8fbfa]" onClick={() => row.hearing ? onOpenCase(row.hearing.case_id) : undefined}>
                      <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${row.kind === 'hearing' ? 'bg-amber-50 text-amber-700' : 'bg-[#edf4f1] text-[#1b6258]'}`}>
                        {row.kind === 'hearing' ? <CalendarClock className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#153a36] truncate">{row.hearing ? caseById(row.hearing.case_id)?.title ?? 'قضية مرتبطة' : row.task!.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{when}{row.hearing?.court_name ? ` · ${row.hearing.court_name}` : ''}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={CalendarClock} title="لا مواعيد قادمة" text="لا جلسات مجدولة ولا مهام مستحقة خلال الأسبوع القادم." />
            )}
          </ListPanel>
        </div>
      </div>
    </>
  );
}
