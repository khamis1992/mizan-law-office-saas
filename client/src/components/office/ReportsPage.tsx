import { useMemo, useState } from 'react';
import { caseStatusLabel, isWithinDays } from '@/lib/office-utils';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FolderKanban } from 'lucide-react';
import { EmptyState, ListPanel, PageHeader } from './office-ui';
import type { Hearing, LegalCase, Task } from './types';

const TYPE_LABELS: Record<string, string> = { criminal: 'جنائية', civil: 'مدنية', commercial: 'تجارية', labor: 'عمالية', family: 'أسرة', administrative: 'إدارية', execution: 'تنفيذ', real_estate: 'عقارية', other: 'أخرى' };
const PIE_COLORS = ['#1e695f', '#cf9d31', '#547aaf', '#9d6aac', '#d26666'];

export default function ReportsPage({ cases, tasks, hearings }: { cases: LegalCase[]; tasks: Task[]; hearings: Hearing[] }) {
  const [range, setRange] = useState<'30' | '90' | '365' | 'all'>('all');
  const rangeDays = range === 'all' ? undefined : Number(range);
  const scoped = useMemo(() => cases.filter(item => isWithinDays(item.opening_date, rangeDays)), [cases, rangeDays]);
  const upcoming = hearings.filter(item => item.status === 'scheduled' && new Date(item.hearing_at) > new Date()).length;

  const charts = useMemo(() => ({
    status: Object.entries(scoped.reduce<Record<string, number>>((acc, item) => {
      const key = caseStatusLabel(item.status);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name, value })),
    type: Object.entries(scoped.reduce<Record<string, number>>((acc, item) => {
      const key = TYPE_LABELS[item.type] ?? 'أخرى';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {})).map(([name, value]) => ({ name, value })),
  }), [scoped]);

  const metrics = [
    { label: 'القضايا المغلقة', value: scoped.length ? Math.round(scoped.filter(item => item.status === 'closed').length / scoped.length * 100) : 0, suffix: '%' },
    { label: 'إنجاز المهام', value: tasks.length ? Math.round(tasks.filter(item => item.status === 'completed').length / tasks.length * 100) : 0, suffix: '%' },
    { label: 'جلسات قادمة', value: upcoming, suffix: '' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="مؤشرات المكتب"
        title="التقارير والتحليلات"
        text="متابعة مرئية لحالات القضايا وأنواع العمل ومؤشرات الإنجاز وفق النطاق الزمني المحدد."
        action={(
          <div className="flex gap-2">
            {([['30', 'آخر 30 يوماً'], ['90', 'آخر 90 يوماً'], ['365', 'آخر سنة'], ['all', 'كل الفترات']] as const).map(([id, label]) => (
              <button key={id} onClick={() => setRange(id)} className={`h-9 px-3.5 rounded-full text-sm border transition-colors ${range === id ? 'bg-[#0d3b36] text-white border-[#0d3b36]' : 'bg-white text-[#5d716c] border-[#e5ece9] hover:bg-[#f4f7f5]'}`}>{label}</button>
            ))}
          </div>
        )}
      />
      <p className="text-xs text-muted-foreground -mt-2 mb-4">يعتمد النطاق على تاريخ فتح القضية؛ يعرض التقرير {scoped.length} قضية ضمن النطاق المحدد.</p>

      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        {metrics.map(metric => (
          <div key={metric.label} className="rounded-2xl bg-white shadow-sm p-5 text-center">
            <p className="text-3xl font-bold text-[#1b6258]">{metric.value}{metric.suffix}</p>
            <p className="text-xs text-muted-foreground mt-1.5">{metric.label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ListPanel icon={FolderKanban} title="القضايا حسب الحالة">
          <div className="h-72 p-4">
            {charts.status.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts.status} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={3}>
                    {charts.status.map((_, index) => <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={FolderKanban} title="لا بيانات في هذا النطاق" text="غيّر الفترة أو أضف قضايا جديدة ليظهر التحليل." />}
          </div>
        </ListPanel>
        <ListPanel icon={FolderKanban} title="القضايا حسب النوع">
          <div className="h-72 p-4">
            {charts.type.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.type} layout="vertical">
                  <CartesianGrid horizontal={false} stroke="#e7eeeb" strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={72} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#c9962b" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState icon={FolderKanban} title="لا بيانات في هذا النطاق" text="غيّر الفترة أو سجّل نوع القضية لظهور التوزيع." />}
          </div>
        </ListPanel>
      </div>
    </>
  );
}
