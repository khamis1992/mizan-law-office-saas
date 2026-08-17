import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateLabel } from '@/lib/office-utils';
import { ChevronLeft, Plus, Users } from 'lucide-react';
import { EmptyState, FilterChips, LeadInitial, ListPanel, PageHeader, Row, RowMeta, RowTitle } from './office-ui';
import type { Client, ClientCommunication, LegalCase } from './types';

export default function ClientsPage({ clients, cases, communications, practitioner, onNewClient, onAddCommunication }: {
  clients: Client[];
  cases: LegalCase[];
  communications: ClientCommunication[];
  practitioner: boolean;
  onNewClient: () => void;
  onAddCommunication: (clientId: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'company' | 'individual'>('all');
  const filtered = useMemo(() => clients.filter(item => filter === 'all' ? true : item.kind === filter), [clients, filter]);

  return (
    <>
      <PageHeader
        eyebrow="سجل العملاء"
        title="العملاء والاتصالات"
        text="ملف موحد لكل عميل: قضاياه ووسيلة تواصله وآخر متابعة — مع إضافة متابعة جديدة من السطر."
        action={practitioner ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onNewClient}><Plus className="h-4 w-4" />عميل جديد</Button> : undefined}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'كل العملاء', count: clients.length },
          { id: 'individual', label: 'أفراد', count: clients.filter(item => item.kind === 'individual').length },
          { id: 'company', label: 'شركات', count: clients.filter(item => item.kind === 'company').length },
        ]}
      />
      {filtered.length ? (
        <ListPanel icon={Users} title="العملاء" count={filtered.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {filtered.map(item => {
              const latest = communications.find(record => record.client_id === item.id);
              const clientCases = cases.filter(legalCase => legalCase.client_id === item.id);
              const activeCases = clientCases.filter(legalCase => ['new', 'active', 'on_hold', 'appeal'].includes(legalCase.status)).length;
              return (
                <Row key={item.id} lead={<LeadInitial letter={item.full_name.charAt(0)} tone={item.kind === 'company' ? 'bg-[#fff8e8] text-[#ae7f1e]' : 'bg-[#edf4f1] text-[#1b6258]'} />}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <RowTitle>{item.full_name}</RowTitle>
                        <Badge variant="outline" className="shrink-0">{item.kind === 'company' ? 'شركة' : 'فرد'}</Badge>
                      </div>
                      <RowMeta>
                        <span dir="ltr">{item.phone || item.email || 'لا وسيلة اتصال'}</span>
                        {' · '}{item.national_id || 'رقم غير مسجل'}
                        {' · '}{activeCases} نشطة من {clientCases.length} قضية
                      </RowMeta>
                      {latest
                        ? <p className="text-xs text-muted-foreground mt-1 line-clamp-1">آخر متابعة ({dateLabel(latest.occurred_at)}): {latest.subject}</p>
                        : <p className="text-xs text-muted-foreground mt-1">لا متابعات مسجلة بعد.</p>}
                    </div>
                    {practitioner && (
                      <Button size="sm" variant="ghost" className="text-[#1b6258] shrink-0" onClick={() => onAddCommunication(item.id)}>
                        إضافة متابعة<ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </Row>
              );
            })}
          </div>
        </ListPanel>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm">
          <EmptyState
            icon={Users}
            title={clients.length ? 'لا عملاء ضمن هذا التصفية' : 'لا يوجد عملاء بعد'}
            text={clients.length ? 'غيّر عامل التصفية أعلاه.' : practitioner ? 'أنشئ ملف العميل قبل بدء إجراءات القضية أو الأرشفة.' : 'لا ملفات عملاء متاحة حالياً.'}
            action={practitioner && !clients.length ? <Button className="bg-[#0d3b36]" onClick={onNewClient}><Plus className="h-4 w-4" />إضافة عميل</Button> : undefined}
          />
        </div>
      )}
    </>
  );
}
