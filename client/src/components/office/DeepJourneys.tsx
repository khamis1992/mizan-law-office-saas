import { useState } from 'react';
import { CalendarClock, FileText, Gavel, Landmark, TrendingUp } from 'lucide-react';
import { CaseTwinPanel, DeliberativeMootPanel, EconomicsPanel, FeeProposalPanel, FinancialPortalPanel, KnowledgeGraphPanel, OfficeDoctrinePanel, PostJudgmentPanel, ProceduralStatePanel, TemporalSourcesPanel } from './CompleteIntelligencePanel';
import { CircuitInsightsPanel, ClientBriefPanel, ConsistencyPanel, DeadlinesPanel, EvidenceMapPanel, ExpertReportPanel, GazetteRadarPanel, HearingPrepPanel, PreferenceInsightsPanel, RedactionPanel, SettlementPanel } from './DeepIntelligencePanel';

/**
 * إعادة تغليف «الذكاء العميق» حول رحلات المحامي الأربع:
 * 1) قبل الجلسة  2) أثناء الصياغة  3) بعد الحكم  4) إدارة المكتب
 * بدل تبويبات تقنية مزدحمة — كل رحلة تجمع الأدوات التي يحتاجها المحامي في مرحلة واحدة.
 */

type Journey = 'pre_hearing' | 'drafting' | 'post_judgment' | 'office';

const JOURNEYS: Array<{ id: Journey; label: string; icon: typeof CalendarClock; desc: string }> = [
  { id: 'pre_hearing', label: 'قبل الجلسة', icon: CalendarClock, desc: 'التحضير للجلسة القادمة: الحزمة، المدّد، الأدلة، التسوية.' },
  { id: 'drafting', label: 'أثناء الصياغة', icon: FileText, desc: 'صياغة المذكرة: المحاكاة، الاتساق، الطمس، الاستدلال الزمني.' },
  { id: 'post_judgment', label: 'بعد الحكم', icon: Gavel, desc: 'مسار ما بعد الحكم: طعن، تنفيذ، تحصيل، تقارير الموكل.' },
  { id: 'office', label: 'إدارة المكتب', icon: TrendingUp, desc: 'الربحية، العقيدة، التقييم، اتجاهات الدوائر، الرادار.' },
];

export default function DeepJourneys({ accessToken, caseId, clientId, practitioner }: { accessToken: string; caseId: string; clientId: string | null; practitioner: boolean }) {
  const [journey, setJourney] = useState<Journey>('pre_hearing');
  const active = JOURNEYS.find(j => j.id === journey)!;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white shadow-sm p-4">
        <div className="flex flex-wrap gap-2">
          {JOURNEYS.map(item => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setJourney(item.id)}
                className={`flex items-center gap-2 h-10 px-4 rounded-full text-sm font-semibold transition-colors ${journey === item.id ? 'bg-[#0d3b36] text-white' : 'bg-[#f4f7f5] text-[#5d716c] hover:bg-[#eaf3ef]'}`}>
                <Icon className="h-4 w-4" />{item.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-5">{active.desc}</p>
      </div>

      {journey === 'pre_hearing' && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <CaseTwinPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <ProceduralStatePanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <HearingPrepPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <DeadlinesPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <EvidenceMapPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <SettlementPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
        </div>
      )}

      {journey === 'drafting' && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <DeliberativeMootPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <ConsistencyPanel accessToken={accessToken} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <ExpertReportPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <RedactionPanel accessToken={accessToken} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <TemporalSourcesPanel accessToken={accessToken} practitioner={practitioner} />
            <KnowledgeGraphPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
        </div>
      )}

      {journey === 'post_judgment' && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <PostJudgmentPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <ClientBriefPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <FinancialPortalPanel accessToken={accessToken} clientId={clientId} practitioner={practitioner} />
            <FeeProposalPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
          </div>
        </div>
      )}

      {journey === 'office' && (
        <div className="space-y-5">
          <div className="grid lg:grid-cols-2 gap-5">
            <EconomicsPanel accessToken={accessToken} caseId={caseId} practitioner={practitioner} />
            <OfficeDoctrinePanel accessToken={accessToken} practitioner={practitioner} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5">
            <CircuitInsightsPanel accessToken={accessToken} />
            <div className="space-y-5">
              <PreferenceInsightsPanel accessToken={accessToken} />
              <GazetteRadarPanel accessToken={accessToken} practitioner={practitioner} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
