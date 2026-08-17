import { useEffect, useState } from 'react';
import DocumentsPage from './DocumentsPage';
import ReportsPage from './ReportsPage';
import SourcesPage from './SourcesPage';
import TeamPage from './TeamPage';
import { NotificationPrefsPanel } from './OfficeFeaturesPanel';
import { LegalAuditPanel } from './LegalAuditPanel';
import { PageHeader } from './office-ui';
import type { Client, Hearing, LegalCase, LegalSource, OfficeDocument, Profile, Task } from './types';

/**
 * «المكتب» — الصفحة الإدارية الموحدة: الفريق والتقارير والمصادر في تبويبات،
 * فتنزل عناصر التشغيل منخفضة التكرار من شريط التنقل الرئيسي إلى مكانها الطبيعي.
 */

export default function OfficePage({ initialTab, team, cases, clients, tasks, hearings, documents, sources, practitioner, manager, accessToken, onInvite, onUpload }: {
  team: Profile[];
  cases: LegalCase[];
  clients: Client[];
  tasks: Task[];
  hearings: Hearing[];
  documents: OfficeDocument[];
  sources: LegalSource[];
  practitioner: boolean;
  manager: boolean;
  accessToken: string;
  initialTab?: 'team' | 'archive' | 'reports' | 'sources' | 'notifications' | 'audit';
  onInvite: () => void;
  onUpload: () => void;
}) {
  const [tab, setTab] = useState<'team' | 'archive' | 'reports' | 'sources' | 'notifications' | 'audit'>(initialTab ?? 'team');
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  const tabs = [
    { id: 'team' as const, label: `الفريق (${team.filter(member => member.is_active).length})` },
    { id: 'archive' as const, label: `أرشيف المستندات (${documents.length})` },
    { id: 'reports' as const, label: 'التقارير والتحليلات' },
    { id: 'sources' as const, label: `المصادر الموثقة (${sources.length})` },
    { id: 'notifications' as const, label: 'الإشعارات' },
    { id: 'audit' as const, label: 'سجل التدقيق' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="إدارة المكتب"
        title="المكتب — الفريق والتقارير والمصادر"
        text="عمليات التشغيل والإشراف في مكان واحد: أعضاء المكتب وأدوارهم، مؤشرات الأداء، وسجل المصادر القانونية المعتمدة."
      />
      <nav className="flex gap-1 mb-5 overflow-x-auto">
        {tabs.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)} className={`h-9 px-4 rounded-full text-sm whitespace-nowrap transition-colors ${tab === item.id ? 'bg-[#0d3b36] text-white' : 'text-[#5d716c] hover:bg-[#f4f7f5]'}`}>{item.label}</button>
        ))}
      </nav>
      {tab === 'team' && <TeamPage team={team} cases={cases} manager={manager} onInvite={onInvite} />}
      {tab === 'reports' && <ReportsPage cases={cases} tasks={tasks} hearings={hearings} />}
      {tab === 'archive' && <DocumentsPage documents={documents} cases={cases} clients={clients} practitioner={practitioner} onUpload={onUpload} />}
      {tab === 'sources' && <SourcesPage sources={sources} practitioner={practitioner} />}
      {tab === 'notifications' && <NotificationPrefsPanel accessToken={accessToken} manager={manager} />}
      {tab === 'audit' && <LegalAuditPanel accessToken={accessToken} manager={manager} />}
    </>
  );
}
