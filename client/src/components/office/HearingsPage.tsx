import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateLabel, hearingStatusLabel } from '@/lib/office-utils';
import { BellRing, CalendarClock, Plus } from 'lucide-react';
import { EmptyState, FilterChips, LeadChip, ListPanel, PageHeader, Row, RowMeta, RowTitle, statusTone } from './office-ui';
import type { Hearing, LegalCase } from './types';

export default function HearingsPage({ hearings, cases, practitioner, onNewHearing, onRecordOutcome }: {
  hearings: Hearing[];
  cases: LegalCase[];
  practitioner: boolean;
  onNewHearing: () => void;
  onRecordOutcome: (hearing: Hearing) => void;
}) {
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const caseById = (id?: string | null) => cases.find(item => item.id === id);
  const now = Date.now();

  const filtered = useMemo(() => hearings
    .filter(item => filter === 'all' ? true : filter === 'upcoming' ? item.status === 'scheduled' && new Date(item.hearing_at).getTime() >= now : !(item.status === 'scheduled' && new Date(item.hearing_at).getTime() >= now))
    .sort((left, right) => filter === 'upcoming'
      ? new Date(left.hearing_at).getTime() - new Date(right.hearing_at).getTime()
      : new Date(right.hearing_at).getTime() - new Date(left.hearing_at).getTime()), [hearings, filter, now]);

  const upcomingCount = hearings.filter(item => item.status === 'scheduled' && new Date(item.hearing_at).getTime() >= now).length;

  return (
    <>
      <PageHeader
        eyebrow="تقويم القضاء"
        title="الجلسات والتذكيرات"
        text="جدولة الجلسات وربطها بالقضية مع تنبيه قبل الموعد وتسجيل النتيجة من السطر نفسه."
        action={practitioner ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onNewHearing}><Plus className="h-4 w-4" />جدولة جلسة</Button> : undefined}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'upcoming', label: 'القادمة', count: upcomingCount },
          { id: 'past', label: 'السابقة', count: hearings.length - upcomingCount },
          { id: 'all', label: 'الكل', count: hearings.length },
        ]}
      />
      {filtered.length ? (
        <ListPanel icon={CalendarClock} title={filter === 'upcoming' ? 'الجلسات القادمة' : 'سجل الجلسات'} count={filtered.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {filtered.map(item => {
              const when = new Date(item.hearing_at);
              return (
                <Row key={item.id} lead={
                  <div className="w-14 rounded-xl bg-[#edf4f1] text-[#1b6258] text-center py-1.5 shrink-0">
                    <p className="font-bold leading-none">{new Intl.DateTimeFormat('ar-QA', { day: 'numeric' }).format(when)}</p>
                    <p className="text-[10px] mt-1">{new Intl.DateTimeFormat('ar-QA', { month: 'short' }).format(when)}</p>
                  </div>
                }>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <RowTitle>{caseById(item.case_id)?.title || 'قضية مرتبطة'}</RowTitle>
                      <RowMeta>
                        {new Intl.DateTimeFormat('ar-QA', { hour: 'numeric', minute: '2-digit' }).format(when)} · {dateLabel(item.hearing_at)}
                        {item.court_name ? ` · ${item.court_name}` : ''}{item.court_room ? ` · ${item.court_room}` : ''}
                      </RowMeta>
                      {item.outcome && <p className="text-xs mt-1 p-2 rounded-lg bg-[#f4f7f5] text-[#1b6258] line-clamp-1">{item.outcome}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        {item.reminder_at && item.status === 'scheduled' && <BellRing className="h-4 w-4 text-[#b58524]" />}
                        <Badge variant="outline" className={statusTone(item.status)}>{hearingStatusLabel(item.status)}</Badge>
                      </div>
                      {practitioner && item.status === 'scheduled' && (
                        <Button size="sm" variant="outline" className="h-8" onClick={() => onRecordOutcome(item)}>تسجيل النتيجة</Button>
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
            icon={CalendarClock}
            title={hearings.length ? 'لا جلسات ضمن هذا العرض' : 'لا جلسات مجدولة'}
            text={hearings.length ? 'غيّر عامل التصفية لعرض الجلسات الأخرى.' : practitioner ? 'أضف جلسة مرتبطة بقضية لمتابعة المواعيد والتنبيهات.' : 'لا توجد جلسات مخصصة للمراجعة حالياً.'}
            action={practitioner && !hearings.length ? <Button className="bg-[#0d3b36]" onClick={onNewHearing}><Plus className="h-4 w-4" />جدولة جلسة</Button> : undefined}
          />
        </div>
      )}
    </>
  );
}
