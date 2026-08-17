import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { dateLabel } from '@/lib/office-utils';
import { FileText, UploadCloud } from 'lucide-react';
import { EmptyState, FilterChips, LeadChip, ListPanel, PageHeader, Row, RowMeta, RowTitle } from './office-ui';
import type { Client, LegalCase, OfficeDocument } from './types';

const CATEGORY_LABELS: Record<string, string> = {
  court_filing: 'مذكرة قضائية', power_of_attorney: 'وكالة', contract: 'عقد', evidence: 'دليل',
  identity: 'هوية', correspondence: 'مراسلة', memo: 'مذكرة', other: 'أخرى',
};

export default function DocumentsPage({ documents, cases, clients, practitioner, onUpload }: {
  documents: OfficeDocument[];
  cases: LegalCase[];
  clients: Client[];
  practitioner: boolean;
  onUpload: () => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const caseById = (id?: string | null) => cases.find(item => item.id === id);
  const clientById = (id?: string | null) => clients.find(item => item.id === id);
  const categories = useMemo(() => Array.from(new Set(documents.map(item => item.category))), [documents]);
  const filtered = useMemo(() => filter === 'all' ? documents : documents.filter(item => item.category === filter), [documents, filter]);

  return (
    <>
      <PageHeader
        eyebrow="أرشيف آمن"
        title="المستندات والملفات"
        text="مستندات القضايا والعملاء في مساحة تخزين معزولة للمكتب — مصنفة وقابلة للتصفية."
        action={practitioner ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onUpload}><UploadCloud className="h-4 w-4" />رفع مستند</Button> : undefined}
      />
      <FilterChips
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'الكل', count: documents.length },
          ...categories.map(category => ({ id: category, label: CATEGORY_LABELS[category] ?? category, count: documents.filter(item => item.category === category).length })),
        ]}
      />
      {filtered.length ? (
        <ListPanel icon={FileText} title="المستندات" count={filtered.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {filtered.map(item => (
              <Row key={item.id} lead={<LeadChip icon={FileText} tone={item.category === 'contract' ? 'bg-[#fff8e8] text-[#ae7f1e]' : 'bg-[#edf4f1] text-[#1b6258]'} />}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <RowTitle><span dir="ltr">{item.file_name}</span></RowTitle>
                    <RowMeta>
                      {caseById(item.case_id)?.case_number || clientById(item.client_id)?.full_name || 'ملف عام'}
                      {' · '}أضيف {dateLabel(item.created_at)}
                    </RowMeta>
                  </div>
                  <Badge variant="outline" className="shrink-0">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                </div>
              </Row>
            ))}
          </div>
        </ListPanel>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm">
          <EmptyState
            icon={FileText}
            title={documents.length ? 'لا مستندات ضمن هذا التصنيف' : 'لا مستندات بعد'}
            text={documents.length ? 'غيّر التصنيف أعلاه.' : practitioner ? 'ارفع ملفاً واربطه بقضية أو عميل لحفظه في الأرشيف المعزول.' : 'لا مستندات متاحة للمراجعة حالياً.'}
            action={practitioner && !documents.length ? <Button className="bg-[#0d3b36]" onClick={onUpload}><UploadCloud className="h-4 w-4" />رفع مستند</Button> : undefined}
          />
        </div>
      )}
    </>
  );
}
