import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { caseStatusLabel, dateLabel, roleLabel } from '@/lib/office-utils';
import { BriefcaseBusiness, Plus } from 'lucide-react';
import { EmptyState, FilterChips, LeadChip, ListPanel, PageHeader, Row, RowMeta, RowTitle, statusTone } from './office-ui';
import type { Client, LegalCase, Profile } from './types';

const TYPE_LABELS: Record<string, string> = { criminal: 'جنائية', civil: 'مدنية', commercial: 'تجارية', labor: 'عمالية', family: 'أسرة', administrative: 'إدارية', execution: 'تنفيذ', real_estate: 'عقارية', other: 'أخرى' };
const ACTIVE = ['new', 'active', 'on_hold', 'appeal'];

export default function CasesPage({ cases, clients, team, practitioner, onNewCase, onOpenCase }: {
  cases: LegalCase[];
  clients: Client[];
  team: Profile[];
  practitioner: boolean;
  onNewCase: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'on_hold' | 'closed'>('all');
  const clientById = (id?: string | null) => clients.find(item => item.id === id);
  const memberById = (id?: string | null) => team.find(item => item.id === id);

  const filtered = useMemo(() => cases.filter(item =>
    filter === 'all' ? true
    : filter === 'active' ? ACTIVE.includes(item.status)
    : filter === 'on_hold' ? item.status === 'on_hold'
    : ['closed', 'archived'].includes(item.status),
  ), [cases, filter]);

  return (
    <>
      <PageHeader
        eyebrow="ملف القضايا"
        title="القضايا والمتابعة"
        text="سجل مركزي للقضية: العميل والمحامي المسؤول والمحكمة والحالة الإجرائية — مرشَّح بضغطة واحدة."
        action={practitioner ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onNewCase}><Plus className="h-4 w-4" />قضية جديدة</Button> : undefined}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'الكل', count: cases.length },
          { id: 'active', label: 'نشطة', count: cases.filter(item => ACTIVE.includes(item.status)).length },
          { id: 'on_hold', label: 'معلقة', count: cases.filter(item => item.status === 'on_hold').length },
          { id: 'closed', label: 'مغلقة', count: cases.filter(item => ['closed', 'archived'].includes(item.status)).length },
        ]}
      />
      {filtered.length ? (
        <ListPanel icon={BriefcaseBusiness} title="سجل القضايا" count={filtered.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {filtered.map(item => (
              <Row key={item.id} onClick={() => onOpenCase(item.id)} lead={<LeadChip icon={BriefcaseBusiness} tone={item.status === 'closed' || item.status === 'archived' ? 'bg-slate-100 text-slate-600' : 'bg-[#edf4f1] text-[#1b6258]'} />}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <RowTitle>{item.case_number} — {item.title}</RowTitle>
                    <RowMeta>
                      {clientById(item.client_id)?.full_name || 'عميل غير محدد'} · {TYPE_LABELS[item.type] ?? item.type}
                      {' · '}{memberById(item.responsible_lawyer_id)?.display_name || 'غير مخصص'}
                      {item.court_name ? ` · ${item.court_name}` : ''}
                    </RowMeta>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className={statusTone(item.status)}>{caseStatusLabel(item.status)}</Badge>
                    <span className="text-[11px] text-muted-foreground">{item.opening_date ? `فُتحت ${dateLabel(item.opening_date)}` : ''}</span>
                  </div>
                </div>
              </Row>
            ))}
          </div>
        </ListPanel>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm">
          <EmptyState
            icon={BriefcaseBusiness}
            title={cases.length ? 'لا قضايا ضمن هذا التصفية' : 'ابدأ بالقضية الأولى'}
            text={cases.length ? 'غيّر عامل التصفية أعلاه لعرض قضايا أخرى.' : practitioner ? 'أضف العميل ثم أنشئ قضية واربطها بالمحامي المسؤول.' : 'لا توجد قضايا مخصصة للمراجعة حالياً.'}
            action={practitioner && !cases.length ? <Button className="bg-[#0d3b36]" onClick={onNewCase}><Plus className="h-4 w-4" />إضافة قضية</Button> : undefined}
          />
        </div>
      )}
    </>
  );
}
