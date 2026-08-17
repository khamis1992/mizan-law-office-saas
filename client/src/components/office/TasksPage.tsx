import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateLabel, isOverdue } from '@/lib/office-utils';
import { CheckCircle2, ClipboardCheck, Plus } from 'lucide-react';
import { EmptyState, FilterChips, LeadChip, ListPanel, PageHeader, Row, RowMeta, RowTitle, statusTone } from './office-ui';
import type { LegalCase, Profile, Task } from './types';

const PRIORITY_LABELS: Record<string, string> = { urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
const PRIORITY_TONES: Record<string, string> = { urgent: 'bg-rose-50 text-rose-700 border-rose-200', high: 'bg-amber-50 text-amber-700 border-amber-200', medium: 'bg-slate-100 text-slate-600 border-slate-200', low: 'bg-slate-100 text-slate-600 border-slate-200' };

export default function TasksPage({ tasks, cases, team, practitioner, manager, profileId, onNewTask, onCloseTask }: {
  tasks: Task[];
  cases: LegalCase[];
  team: Profile[];
  practitioner: boolean;
  manager: boolean;
  profileId: string;
  onNewTask: () => void;
  onCloseTask: (task: Task) => void;
}) {
  const [filter, setFilter] = useState<'open' | 'overdue' | 'mine' | 'completed'>('open');
  const caseById = (id?: string | null) => cases.find(item => item.id === id);
  const memberById = (id?: string | null) => team.find(item => item.id === id);
  const open = tasks.filter(item => item.status !== 'completed');

  const filtered = useMemo(() => tasks.filter(item => {
    if (filter === 'open') return item.status !== 'completed';
    if (filter === 'overdue') return isOverdue(item.due_at, item.status);
    if (filter === 'mine') return item.assigned_to === profileId && item.status !== 'completed';
    return item.status === 'completed';
  }), [tasks, filter, profileId]);

  return (
    <>
      <PageHeader
        eyebrow="إدارة العمل"
        title="المهام والتوزيع"
        text="إسناد العمل القانوني حسب الأولوية والاستحقاق والمسؤول — والإغلاق من السطر مباشرة."
        action={practitioner ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onNewTask}><Plus className="h-4 w-4" />مهمة جديدة</Button> : undefined}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'open', label: 'مفتوحة', count: open.length },
          { id: 'overdue', label: 'متأخرة', count: tasks.filter(item => isOverdue(item.due_at, item.status)).length },
          { id: 'mine', label: 'مهامي', count: tasks.filter(item => item.assigned_to === profileId && item.status !== 'completed').length },
          { id: 'completed', label: 'مكتملة', count: tasks.filter(item => item.status === 'completed').length },
        ]}
      />
      {filtered.length ? (
        <ListPanel icon={ClipboardCheck} title="قائمة المهام" count={filtered.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {filtered.map(task => {
              const overdue = isOverdue(task.due_at, task.status);
              const canComplete = manager || task.assigned_to === profileId;
              return (
                <Row key={task.id} lead={<LeadChip icon={ClipboardCheck} tone={task.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : overdue ? 'bg-rose-50 text-rose-700' : 'bg-[#edf4f1] text-[#1b6258]'} />}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <RowTitle><span className={task.status === 'completed' ? 'line-through text-muted-foreground' : ''}>{task.title}</span></RowTitle>
                      <RowMeta>
                        {memberById(task.assigned_to)?.display_name || 'غير مسند'}
                        {' · '}{caseById(task.case_id)?.case_number || 'مهمة عامة'}
                        {task.due_at ? ` · استحقاق ${dateLabel(task.due_at)}` : ' · دون موعد'}
                      </RowMeta>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={PRIORITY_TONES[task.priority] ?? PRIORITY_TONES.low}>{PRIORITY_LABELS[task.priority] ?? task.priority}</Badge>
                      <Badge variant="outline" className={statusTone(task.status)}>{task.status === 'completed' ? 'مكتملة' : task.status === 'in_progress' ? 'قيد التنفيذ' : 'لم تبدأ'}</Badge>
                      {task.status !== 'completed' && canComplete && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => onCloseTask(task)}><CheckCircle2 className="h-3.5 w-3.5" />إغلاق</Button>
                      )}
                    </div>
                  </div>
                </Row>
              );
            })}
          </div>
        </ListPanel>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm">
          <EmptyState
            icon={ClipboardCheck}
            title="لا مهام ضمن هذا العرض"
            text={filter === 'overdue' ? 'لا مهام متأخرة — عمل منتظم.' : 'أنشئ مهمة وأسندها إلى فريق المكتب.'}
            action={filter !== 'overdue' && filter !== 'completed' ? <Button className="bg-[#0d3b36]" onClick={onNewTask}><Plus className="h-4 w-4" />إضافة مهمة</Button> : undefined}
          />
        </div>
      )}
    </>
  );
}
