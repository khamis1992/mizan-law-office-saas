import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { caseStatusLabel, dateLabel, hearingStatusLabel, isOverdue, taskStatusLabel } from '@/lib/office-utils';
import { supabase } from '@/lib/supabase';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Streamdown } from 'streamdown';
import { AlertTriangle, CalendarClock, ClipboardCheck, Download, ExternalLink, FileSearch, FileSignature, FileText, Gavel, Hourglass, Loader2, RefreshCw, Save, Scale, SearchCheck, ShieldCheck, Timer, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Hearing, LegalCase, OfficeDocument, Profile, Task } from './types';
import { ConflictCheckPanel, LimitationPanel, MemoTemplatesPanel, TimeTrackingPanel } from './OfficeFeaturesPanel';
import { AdversarialPanel, AutoIndexPanel, CaseAgentPanel, CaseChatPanel, CaseExportPanel, CourtCalendarPanel, CourtPortalPanel, GraduatedRemindersPanel, JudgmentAnalysisPanel, PredictionPanel } from './LegalIntelligencePanel';
import { AdaptiveTemplatesPanel, SavedDraftsPanel } from './CollaborativeDraftPanel';
import { CircuitInsightsPanel, ClientBriefPanel, ConsistencyPanel, DeadlinesPanel, EvidenceMapPanel, ExpertReportPanel, GazetteRadarPanel, HearingPrepPanel, PreferenceInsightsPanel, RedactionPanel, SettlementPanel } from './DeepIntelligencePanel';
import { CaseTwinPanel, DeliberativeMootPanel, EconomicsPanel, FeeProposalPanel, FinancialPortalPanel, KnowledgeGraphPanel, OfficeDoctrinePanel, PostJudgmentPanel, ProceduralStatePanel, TemporalSourcesPanel } from './CompleteIntelligencePanel';
import DeepJourneys from './DeepJourneys';
import { downloadPdf, downloadWord } from '@/lib/document-export';

/**
 * مساحة عمل القضية — قلب التجربة: ملف واحد يجمع خط القضية الزمني الكامل
 * وجلساتها ومهامها ومستنداتها (ومستندات عميلها العامة) وعقودها وتشغيلات وكلائها.
 */

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'جديدة' }, { value: 'active', label: 'نشطة' }, { value: 'on_hold', label: 'معلقة' },
  { value: 'appeal', label: 'استئناف' }, { value: 'closed', label: 'مغلقة' }, { value: 'archived', label: 'مؤرشفة' },
];
const CATEGORY_LABELS: Record<string, string> = {
  court_filing: 'مذكرة قضائية', power_of_attorney: 'وكالة', contract: 'عقد', evidence: 'دليل',
  identity: 'هوية', correspondence: 'مراسلة', memo: 'مذكرة', other: 'أخرى',
};

type Props = {
  caseItem: LegalCase;
  clients: Client[];
  team: Profile[];
  hearings: Hearing[];
  tasks: Task[];
  documents: OfficeDocument[];
  accessToken: string;
  officeId: string;
  autoAnalyze?: boolean;
  onAutoAnalyzeDone?: () => void;
  practitioner: boolean;
  manager: boolean;
  profileId: string;
  onClose: () => void;
  onScheduleHearing: (caseId: string) => void;
  onNewTask: (caseId: string) => void;
  onUploadDoc: (caseId: string) => void;
  onRefresh: () => Promise<void> | void;
};

type IntakeLawView = { title: string; articleNumber: string | null; url: string; why: string; body?: string };
type IntakeView = { hasImages: boolean; analyzedFiles: number; claimsSummary: string; parties: string[]; keyFacts: string[]; legalIssues: string[]; relevantLaws: IntakeLawView[]; similarPrecedents: Array<{ title: string; referenceNumber: string | null; url: string; why: string }>; defenses: Array<{ heading: string; argument: string; strength: string }>; gaps: Array<{ gap: string; severity: string; mitigation: string }>; memoDraft: string; followUps: string[]; limitations: string; verification?: { passed: boolean; unverifiedQuotes: string[]; unverifiedArticles: string[] } };
type ContractDoc = { id: string; title: string; status: string; current_version: number };
const CONTRACT_STATUS: Record<string, string> = { draft: 'مسودة', in_review: 'مراجعة', approved: 'معتمد', ready_for_export: 'جاهز للتصدير' };

export default function CaseWorkspace({ caseItem, clients, team, hearings, tasks, documents, accessToken, officeId, autoAnalyze, onAutoAnalyzeDone, practitioner, manager, profileId, onClose, onScheduleHearing, onNewTask, onUploadDoc, onRefresh }: Props) {
  const [tab, setTab] = useState<'timeline' | 'hearings' | 'tasks' | 'docs' | 'ai' | 'features' | 'intelligence' | 'deep'>('timeline');
  const [status, setStatus] = useState(caseItem.status);
  const [contracts, setContracts] = useState<ContractDoc[]>([]);
  const [intake, setIntake] = useState<IntakeView | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [fixPapers, setFixPapers] = useState<File[]>([]);
  const [fixNotes, setFixNotes] = useState('');
  const [fixBusy, setFixBusy] = useState(false);
  const [limitationDate, setLimitationDate] = useState<string | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState<string | null>(null);
  const intakeStarted = useRef(false);
  const intakeMutation = trpc.caseIntake.analyze.useMutation();

  const client = clients.find(item => item.id === caseItem.client_id);
  const lawyer = team.find(item => item.id === caseItem.responsible_lawyer_id);
  const caseHearings = hearings.filter(item => item.case_id === caseItem.id).sort((left, right) => new Date(left.hearing_at).getTime() - new Date(right.hearing_at).getTime());
  const caseTasks = tasks.filter(item => item.case_id === caseItem.id);
  const caseDocs = documents.filter(item => item.case_id === caseItem.id);
  const clientDocs = caseItem.client_id ? documents.filter(item => !item.case_id && item.client_id === caseItem.client_id) : [];

  useEffect(() => {
    setStatus(caseItem.status);
    supabase.from('contract_documents').select('id,title,status,current_version').eq('case_id', caseItem.id).order('created_at', { ascending: false })
      .then(({ data }) => setContracts((data ?? []) as ContractDoc[]));
  }, [caseItem.id, caseItem.status]);
  useEffect(() => {
    setIntake(null); intakeStarted.current = false;
    supabase.from('case_intake_analyses').select('result').eq('case_id', caseItem.id).maybeSingle()
      .then(({ data }) => { if (data?.result) setIntake(data.result as IntakeView); });
  }, [caseItem.id]);
  useEffect(() => {
    supabase.from('legal_cases').select('limitation_date').eq('id', caseItem.id).maybeSingle()
      .then(({ data }) => setLimitationDate((data?.limitation_date as string | null) ?? null));
  }, [caseItem.id]);
  const runIntake = async (extraNotes?: string) => {
    try {
      setIntakeError(null);
      const result = await intakeMutation.mutateAsync({ accessToken, caseId: caseItem.id, extraNotes });
      setIntake(result as IntakeView);
      toast.success('اكتمل التحليل الافتتاحي الذكي.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر التحليل الافتتاحي.';
      setIntakeError(message);
      toast.error(message);
    } finally {
      onAutoAnalyzeDone?.();
    }
  };
  const runFollowUp = async (question: string) => {
    if (!practitioner) return;
    setFollowUpBusy(question);
    try {
      const result = await intakeMutation.mutateAsync({ accessToken, caseId: caseItem.id, extraNotes: `سؤال متابعة من المحامي: ${question}` });
      setIntake(result as IntakeView);
      toast.success('أُعيد التحليل بسياق السؤال الإضافي.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إعادة التحليل.');
    } finally {
      setFollowUpBusy(null);
    }
  };
  const fixAndAnalyze = async () => {
    if (!practitioner) return;
    setFixBusy(true);
    try {
      const uploaded: string[] = [];
      for (const file of fixPapers) {
        if (!file.name) continue;
        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
        const base = file.name.slice(0, file.name.length - ext.length).replace(/[^a-zA-Z0-9\-_]/g, '');
        const safeBase = (base || 'file').slice(0, 60);
        const path = `${officeId}/${Date.now()}-${safeBase}${ext}`;
        const upload = await supabase.storage.from('legal-documents').upload(path, file, { contentType: file.type });
        if (upload.error) { toast.error(upload.error.message); continue; }
        const { error: insertError } = await supabase.from('documents').insert({ office_id: officeId, file_name: file.name, storage_path: path, mime_type: file.type || null, byte_size: file.size, category: 'court_filing', case_id: caseItem.id, client_id: caseItem.client_id, uploaded_by: profileId });
        if (insertError) { toast.error(insertError.message); continue; }
        uploaded.push(file.name);
      }
      if (fixNotes.trim().length >= 30) {
        const { error: updateError } = await supabase.from('legal_cases').update({ description: fixNotes.trim() }).eq('id', caseItem.id);
        if (updateError) return toast.error(updateError.message);
      }
      if (uploaded.length) toast.success(`رُفعت ${uploaded.length} ورقة إلى ملف القضية.`);
      setFixPapers([]); setFixNotes('');
      await onRefresh();
      await runIntake();
    } finally {
      setFixBusy(false);
    }
  };
  useEffect(() => {
    if (autoAnalyze && !intake && !intakeStarted.current && practitioner) { intakeStarted.current = true; runIntake(); }
  }, [autoAnalyze, intake, practitioner]);
  const saveMemo = async () => {
    if (!intake) return;
    const { error } = await supabase.from('legal_drafts').insert({ office_id: officeId, case_id: caseItem.id, title: `مسودة مذكرة افتتاحية - ${caseItem.case_number}`, document_type: 'legal_memo', content: intake.memoDraft, status: 'draft', created_by: profileId });
    if (error) return toast.error(error.message);
    toast.success('حُفظت المسودة في ملف القضية كمسودة قابلة للتحرير.');
  };

  const timeline = useMemo(() => {
    type Event = { key: string; at: number; kind: 'opened' | 'hearing' | 'task' | 'doc'; title: string; meta: string; tone: string };
    const events: Event[] = [];
    if (caseItem.opening_date) events.push({ key: 'opened', at: new Date(caseItem.opening_date).getTime(), kind: 'opened', title: 'فتح القضية', meta: `${caseItem.case_number} · ${client?.full_name ?? 'عميل غير محدد'}`, tone: 'bg-[#21685e]' });
    for (const hearing of caseHearings) events.push({ key: `h-${hearing.id}`, at: new Date(hearing.hearing_at).getTime(), kind: 'hearing', title: `جلسة — ${hearingStatusLabel(hearing.status)}`, meta: `${hearing.court_name ?? ''}${hearing.court_room ? ` · ${hearing.court_room}` : ''}${hearing.outcome ? ` · ${hearing.outcome.slice(0, 80)}` : ''}`, tone: hearing.status === 'scheduled' ? 'bg-[#b58524]' : 'bg-slate-400' });
    for (const task of caseTasks) if (task.due_at) events.push({ key: `t-${task.id}`, at: new Date(task.due_at).getTime(), kind: 'task', title: task.title, meta: `${taskStatusLabel(task.status)} · ${team.find(member => member.id === task.assigned_to)?.display_name ?? 'غير مسند'}`, tone: isOverdue(task.due_at, task.status) ? 'bg-rose-500' : task.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-400' });
    for (const doc of caseDocs) events.push({ key: `d-${doc.id}`, at: new Date(doc.created_at).getTime(), kind: 'doc', title: doc.file_name, meta: `مستند · ${CATEGORY_LABELS[doc.category] ?? doc.category}`, tone: 'bg-slate-400' });
    return events.sort((left, right) => right.at - left.at);
  }, [caseItem, caseHearings, caseTasks, caseDocs, client, team]);

  const canEditStatus = practitioner && (manager || caseItem.responsible_lawyer_id === profileId);

  const changeStatus = async (next: string) => {
    const { error } = await supabase.from('legal_cases').update({ status: next }).eq('id', caseItem.id);
    if (error) return toast.error(error.message);
    setStatus(next);
    toast.success(`حالة القضية الآن: ${STATUS_OPTIONS.find(option => option.value === next)?.label ?? next}`);
    await onRefresh();
  };

  const tabs = [
    { id: 'timeline' as const, label: `الخط الزمني (${timeline.length})` },
    { id: 'hearings' as const, label: `الجلسات (${caseHearings.length})` },
    { id: 'tasks' as const, label: `المهام (${caseTasks.filter(task => task.status !== 'completed').length})` },
    { id: 'docs' as const, label: `المستندات (${caseDocs.length})` },
    { id: 'ai' as const, label: `الذكاء (${contracts.length})` },
    { id: 'intelligence' as const, label: 'شريك المرافعة' },
    { id: 'deep' as const, label: 'الذكاء العميق' },
    { id: 'features' as const, label: 'أدوات المكتب' },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-[#092a26]/45 backdrop-blur-sm p-4 grid place-items-center" dir="rtl" onClick={onClose}>
      <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 26 }} onClick={event => event.stopPropagation()} className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-[#e5ece9]">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[#e5ece9]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-start gap-3">
            <button className="p-2 rounded-lg hover:bg-muted shrink-0" onClick={onClose} title="إغلاق"><X className="h-4 w-4" /></button>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-[#1b6258] bg-[#edf4f1] rounded-lg px-2 py-1">{caseItem.case_number}</span>
                {canEditStatus ? (
                  <select value={status} onChange={event => changeStatus(event.target.value)} className="h-8 rounded-lg border border-[#e5ece9] bg-white px-2 text-xs font-semibold text-[#145348]">
                    {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{caseStatusLabel(status)}</Badge>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-[#153a36] mt-2 truncate">{caseItem.title}</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {client?.full_name ?? 'عميل غير محدد'} · المحامي المسؤول: {lawyer?.display_name ?? 'غير مخصص'}
                {caseItem.court_name ? ` · ${caseItem.court_name}` : ''}{caseItem.opening_date ? ` · فُتحت ${dateLabel(caseItem.opening_date)}` : ''}
              </p>
            </div>
            {caseItem.description && <p className="hidden xl:block max-w-xs text-xs leading-5 text-muted-foreground bg-white rounded-xl border border-[#e5ece9] p-3 line-clamp-4">{caseItem.description}</p>}
          </div>
          <nav className="flex gap-1 mt-4 overflow-x-auto">
            {tabs.map(item => (
              <button key={item.id} onClick={() => setTab(item.id)} className={`h-9 px-3.5 rounded-full text-sm whitespace-nowrap transition-colors ${tab === item.id ? 'bg-[#0d3b36] text-white' : 'text-[#5d716c] hover:bg-[#f4f7f5]'}`}>{item.label}</button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 pb-10">
        {tab === 'timeline' && (
          <section className="rounded-2xl border border-[#e5ece9] p-5">
            <h2 className="font-bold text-[#153a36] mb-4">خط القضية الزمني</h2>
            {timeline.length ? (
              <div className="relative pr-4">
                <div className="absolute top-2 bottom-2 right-[9px] w-px bg-[#e5ece9]" />
                {timeline.map((event, index) => (
                  <motion.div key={event.key} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + index * 0.04 }} className="relative flex gap-4 py-3 pr-5">
                    <span className={`absolute right-[5px] top-5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${event.tone}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#153a36]">{event.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{dateLabel(new Date(event.at).toISOString())} · {event.meta}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground py-6 text-center">لا أحداث مسجلة بعد لهذه القضية.</p>}
          </section>
        )}

        {tab === 'hearings' && (
          <section className="rounded-2xl border border-[#e5ece9] overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#e5ece9]">
              <h2 className="font-bold text-[#153a36]">جلسات القضية</h2>
              {practitioner && <Button size="sm" className="h-9 bg-[#0d3b36]" onClick={() => onScheduleHearing(caseItem.id)}><CalendarClock className="h-3.5 w-3.5" />جدولة جلسة</Button>}
            </div>
            {caseHearings.length ? (
              <div className="divide-y divide-[#f4f7f5]">
                {caseHearings.slice().reverse().map(hearing => (
                  <div key={hearing.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#153a36]">{dateLabel(hearing.hearing_at)} · {new Intl.DateTimeFormat('ar-QA', { hour: 'numeric', minute: '2-digit' }).format(new Date(hearing.hearing_at))}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{hearing.court_name ?? 'المحكمة غير محددة'}{hearing.court_room ? ` · ${hearing.court_room}` : ''}</p>
                      {hearing.outcome && <p className="text-xs mt-1.5 p-2 rounded-lg bg-[#f4f7f5] text-[#1b6258]">{hearing.outcome}</p>}
                    </div>
                    <Badge variant="outline" className="shrink-0">{hearingStatusLabel(hearing.status)}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="py-10 text-center text-sm text-muted-foreground">لا جلسات بعد — جدول الأولى من الزر أعلاه.</p>}
          </section>
        )}

        {tab === 'tasks' && (
          <section className="rounded-2xl border border-[#e5ece9] overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#e5ece9]">
              <h2 className="font-bold text-[#153a36]">مهام القضية</h2>
              {practitioner && <Button size="sm" className="h-9 bg-[#0d3b36]" onClick={() => onNewTask(caseItem.id)}><ClipboardCheck className="h-3.5 w-3.5" />مهمة جديدة</Button>}
            </div>
            {caseTasks.length ? (
              <div className="divide-y divide-[#f4f7f5]">
                {caseTasks.map(task => (
                  <div key={task.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold ${task.status === 'completed' ? 'line-through text-muted-foreground' : 'text-[#153a36]'}`}>{task.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{team.find(member => member.id === task.assigned_to)?.display_name ?? 'غير مسند'}{task.due_at ? ` · ${dateLabel(task.due_at)}` : ''}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {task.due_at && isOverdue(task.due_at, task.status) && <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">متأخرة</Badge>}
                      <Badge variant="outline">{taskStatusLabel(task.status)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="py-10 text-center text-sm text-muted-foreground">لا مهام مرتبطة بهذه القضية.</p>}
          </section>
        )}

        {tab === 'docs' && (
          <section className="rounded-2xl border border-[#e5ece9] overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between border-b border-[#e5ece9]">
              <h2 className="font-bold text-[#153a36]">مستندات القضية</h2>
              {practitioner && <Button size="sm" className="h-9 bg-[#0d3b36]" onClick={() => onUploadDoc(caseItem.id)}><UploadCloud className="h-3.5 w-3.5" />رفع مستند</Button>}
            </div>
            {caseDocs.length ? (
              <div className="divide-y divide-[#f4f7f5]">
                {caseDocs.map(doc => (
                  <div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl grid place-items-center bg-[#edf4f1] text-[#1b6258] shrink-0"><FileText className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#153a36] truncate" dir="ltr">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{dateLabel(doc.created_at)}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="py-10 text-center text-sm text-muted-foreground">لا مستندات — ارفع الأول من الزر أعلاه.</p>}
            {clientDocs.length > 0 && (
              <div>
                <p className="px-5 pt-4 pb-2 text-[11px] font-bold text-muted-foreground">مستندات العميل العامة ({clientDocs.length})</p>
                <div className="divide-y divide-[#f4f7f5] border-t border-[#e5ece9]">
                  {clientDocs.map(doc => (
                    <div key={doc.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg grid place-items-center bg-[#edf4f1] text-[#1b6258] shrink-0"><FileText className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#153a36] truncate" dir="ltr">{doc.file_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{dateLabel(doc.created_at)}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">{CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'ai' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-[#e5ece9] overflow-hidden">
              <div className="px-5 pt-5 pb-3 border-b border-[#e5ece9] flex items-center justify-between gap-3">
                <h2 className="font-bold text-[#153a36] flex items-center gap-2"><FileSearch className="h-4 w-4 text-[#b58524]" />التحليل الافتتاحي الذكي</h2>
                {intake && practitioner && <Button size="sm" variant="outline" className="h-8" disabled={intakeMutation.isPending} onClick={() => runIntake()}><RefreshCw className="h-3.5 w-3.5" />إعادة التحليل</Button>}
              </div>
              {intakeMutation.isPending || (!intake && autoAnalyze) ? (
                <div className="px-5 py-8 text-center">
                  <Loader2 className="h-6 w-6 mx-auto animate-spin text-[#1b6258]" />
                  <p className="font-semibold text-sm mt-3 text-[#153a36]">يجري التحليل الافتتاحي…</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-6">قراءة أوراق الدعوى ثم استخراج المسائل ثم استرجاع القوانين الموثقة ثم بناء الدفوع والثغرات ومسودة المذكرة</p>
                </div>
              ) : intakeError && !intake ? (
                <div className="px-5 py-6">
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-4">
                    <p className="text-sm font-semibold text-rose-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />تعذر التحليل الافتتاحي</p>
                    <p className="text-xs leading-6 text-rose-700 mt-1.5">{intakeError}</p>
                  </div>
                  {practitioner && (
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-[#153a36]">أكمل الملف ثم أعد المحاولة — أيٌّ من الخيارين يكفي:</p>
                        <div className="rounded-xl border border-[#e5ece9] p-3.5 space-y-2.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-[#153a36]"><UploadCloud className="h-3.5 w-3.5 text-[#1b6258]" />رفع أوراق صحيفة الدعوى (صور PNG/JPG تُقرأ بصرياً عند استخدام OpenAI، وPDF/Word يُستخرج نصها دائماً)</div>
                          <Input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={event => setFixPapers(Array.from(event.target.files ?? []))} />
                          {fixPapers.length > 0 && <p className="text-[11px] text-muted-foreground">{fixPapers.length} ملف محدد</p>}
                        </div>
                        <div className="rounded-xl border border-[#e5ece9] p-3.5 space-y-2.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-[#153a36]"><FileText className="h-3.5 w-3.5 text-[#1b6258]" />أو اكتب وصف الوقائع (30 حرفاً على الأقل) — يُحفظ في ملف القضية</div>
                          <Textarea value={fixNotes} onChange={event => setFixNotes(event.target.value)} className="min-h-24 text-sm" placeholder="مثال: تقدم المدعي بدعوى مطالبة بمبلغ 50,000 ريال عن عقد توريد لم يُسدد ثمنه رغم استلام البضاعة…" />
                          <p className={`text-[11px] ${fixNotes.trim().length >= 30 ? 'text-emerald-600' : 'text-muted-foreground'}`}>{fixNotes.trim().length}/30 حرفاً</p>
                        </div>
                        <Button className="w-full h-10 bg-[#0d3b36]" disabled={fixBusy || intakeMutation.isPending || (fixPapers.length === 0 && fixNotes.trim().length < 30)} onClick={fixAndAnalyze}>{fixBusy || intakeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}حفظ وإعادة التحليل</Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : intake ? (
                <div className="px-5 py-5 space-y-5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-[#f4f7f5] px-2.5 py-1">{intake.hasImages ? `قُرئت ${intake.analyzedFiles} من الأوراق (صور ومستندات)` : `قُرئت ${intake.analyzedFiles} من المستندات نصياً`}</span>
                    {intake.verification && <span className={`rounded-full px-2.5 py-1 ${intake.verification.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{intake.verification.passed ? 'اقتباسات متحققة' : `${intake.verification.unverifiedQuotes.length + (intake.verification.unverifiedArticles?.length ?? 0)} إشارة معلمة غير موثقة`}</span>}
                  </div>
                  <div><p className="text-xs font-bold text-[#1b6258] mb-1.5">ملخص الدعاوى والوقائع</p><p className="text-sm leading-7">{intake.claimsSummary}</p></div>
                  {intake.parties.length > 0 && <div className="flex flex-wrap gap-1.5">{intake.parties.map((party, index) => <Badge key={index} variant="outline" className="text-[11px]">{party}</Badge>)}</div>}
                  {intake.keyFacts.length > 0 && (<div><p className="text-xs font-bold text-[#1b6258] mb-1.5">الوقائع الجوهرية</p><ul className="list-disc list-inside text-sm leading-7 space-y-1">{intake.keyFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></div>)}
                  {intake.legalIssues.length > 0 && (<div><p className="text-xs font-bold text-[#1b6258] mb-1.5">المسائل القانونية المطروحة</p><div className="flex flex-wrap gap-1.5">{intake.legalIssues.map((issue, index) => <span key={index} className="text-xs rounded-lg bg-[#f4f7f5] px-2.5 py-1.5 text-[#153a36]">{issue}</span>)}</div></div>)}
                  {intake.relevantLaws.length > 0 && (
                    <div><p className="text-xs font-bold text-[#1b6258] mb-2 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />القوانين المنطبقة (من قاعدة المصادر الموثقة)</p>
                    <div className="space-y-2">{intake.relevantLaws.map((law, index) => (
                      <div key={index} className="rounded-xl border border-[#e5ece9] p-3">
                        <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline" className="bg-[#edf4f1] text-[#1b6258] border-[#d3e4dd]">{law.articleNumber ?? 'نص عام'}</Badge><p className="text-sm font-semibold text-[#153a36]">{law.title}</p></div>
                        <p className="text-xs text-muted-foreground mt-1 leading-6">{law.why}</p>
                        {law.body && <p className="text-[13px] leading-7 text-[#153a36] bg-[#f8fbfa] border border-[#e5ece9] rounded-lg p-3 mt-2.5 whitespace-pre-line">{law.body}</p>}
                        {law.url && <a href={law.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1b6258] hover:underline mt-2.5">عرض النص الكامل في المصدر الموثق <ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    ))}</div></div>
                  )}
                  {intake.similarPrecedents.length > 0 && (
                    <div><p className="text-xs font-bold text-[#1b6258] mb-2 flex items-center gap-1.5"><Gavel className="h-3.5 w-3.5" />قضايا مشابهة (سوابق موثقة)</p>
                    <div className="space-y-2">{intake.similarPrecedents.map((precedent, index) => (
                      <a key={index} href={precedent.url} target="_blank" rel="noreferrer" className="block rounded-xl border border-[#e5ece9] p-3 hover:bg-[#f8fbfa]">
                        <p className="text-sm font-semibold text-[#153a36]">{precedent.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{precedent.referenceNumber ?? 'مرجع غير منشور'}</p>
                        <p className="text-xs text-muted-foreground mt-1 leading-6">{precedent.why}</p>
                      </a>
                    ))}</div></div>
                  )}
                  {intake.defenses.length > 0 && (
                    <div><p className="text-xs font-bold text-[#1b6258] mb-2">الدفوع المقترحة</p>
                    <div className="space-y-2.5">{intake.defenses.map((defense, index) => (
                      <div key={index} className="border-r-2 border-[#e8c377] pr-3">
                        <div className="flex justify-between gap-2"><p className="text-sm font-semibold">{defense.heading}</p><Badge variant="outline" className="text-[10px] shrink-0">قوة {defense.strength}</Badge></div>
                        <p className="text-xs leading-6 text-muted-foreground mt-1">{defense.argument}</p>
                      </div>
                    ))}</div></div>
                  )}
                  {intake.gaps.length > 0 && (
                    <div><p className="text-xs font-bold text-[#8d6515] mb-2 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />أهم الثغرات ونواقص الملف</p>
                    <div className="space-y-2">{intake.gaps.map((gap, index) => (
                      <div key={index} className="rounded-xl bg-[#fff8e8] p-3">
                        <div className="flex justify-between gap-2"><p className="text-sm font-semibold">{gap.gap}</p><Badge variant="outline" className="text-[10px] shrink-0">خطورة {gap.severity}</Badge></div>
                        <p className="text-xs leading-6 mt-1">{gap.mitigation}</p>
                      </div>
                    ))}</div></div>
                  )}
                  <div>
                    <div className="flex items-center justify-between mb-2"><p className="text-xs font-bold text-[#1b6258]">مسودة المذكرة (قابلة للتحرير لاحقاً)</p>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { navigator.clipboard?.writeText(intake.memoDraft); toast.success('نُسخت المسودة.'); }}>نسخ</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => downloadWord(`مسودة مذكرة - ${caseItem.case_number}`, intake.memoDraft)}><Download className="h-3 w-3" />Word</Button>
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => downloadPdf(`مسودة مذكرة - ${caseItem.case_number}`, intake.memoDraft)}><Download className="h-3 w-3" />PDF</Button>
                        <Button size="sm" className="h-7 text-[11px] bg-[#0d3b36]" onClick={saveMemo}><Save className="h-3 w-3" />حفظ في الملف</Button>
                      </div></div>
                    <div className="min-h-56 rounded-xl border border-[#e5ece9] bg-background p-4 text-sm leading-8 whitespace-pre-wrap"><Streamdown>{intake.memoDraft.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, '    ')}</Streamdown></div>
                  </div>
                  {intake.followUps.length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-[#1b6258] mb-2">الخطوات المقترحة — اضغط سؤالاً لإعادة التحليل بسياقه</p>
                      <div className="flex flex-wrap gap-2">
                        {intake.followUps.map((step, index) => (
                          <button key={index} disabled={followUpBusy === step || !practitioner} onClick={() => runFollowUp(step)}
                            className="text-xs rounded-full border border-[#d3e4dd] bg-[#f0f7f4] px-3 py-1.5 text-[#1b6258] font-semibold hover:bg-[#e2f0ea] disabled:opacity-50 transition-colors text-right">
                            {followUpBusy === step ? <Loader2 className="h-3 w-3 inline animate-spin ml-1" /> : <SearchCheck className="h-3 w-3 inline ml-1" />}{step}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] leading-5 text-muted-foreground border-t border-[#e5ece9] pt-3">{intake.limitations}</p>
                </div>
              ) : (
                <div className="px-6 py-8 text-center">
                  <FileSearch className="h-7 w-7 mx-auto text-[#1b6258] opacity-60" />
                  <p className="font-semibold text-sm mt-3 text-[#153a36]">لم يُشغَّل التحليل الافتتاحي بعد</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-6 max-w-md mx-auto">يقرأ مستندات القضية (PDF/Word والصور عند دعم النموذج) ويجهز لك: ملخص الدعاوى، القوانين المنطبقة من المصادر الموثقة، القضايا المشابهة، الدفوع المناسبة، أهم الثغرات، ومسودة مذكرة جاهزة للتحرير.</p>
                  {practitioner && <Button className="mt-4 bg-[#0d3b36]" disabled={intakeMutation.isPending} onClick={() => runIntake()}>{intakeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}تحليل أوراق القضية بالذكاء</Button>}
                </div>
              )}
            </section>
            <section className="rounded-2xl border border-[#e5ece9] overflow-hidden">
              <div className="px-5 pt-5 pb-3 border-b border-[#e5ece9]"><h2 className="font-bold text-[#153a36]">عقود مرتبطة بالقضية</h2></div>
              {contracts.length ? (
                <div className="divide-y divide-[#f4f7f5]">
                  {contracts.map(doc => (
                    <div key={doc.id} className="px-5 py-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-xl grid place-items-center bg-[#fff8e8] text-[#ae7f1e] shrink-0"><FileSignature className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#153a36] truncate">{doc.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">نسخة {doc.current_version}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">{CONTRACT_STATUS[doc.status] ?? doc.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : <p className="py-8 text-center text-sm text-muted-foreground">لا عقود مرتبطة بعد.</p>}
            </section>
          </div>
        )}

        {tab === 'intelligence' && (
          <div className="space-y-5">
            <CaseAgentPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
            <div className="grid lg:grid-cols-2 gap-5">
              <AdversarialPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
              <div className="space-y-5">
                <PredictionPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
                <JudgmentAnalysisPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
              </div>
            </div>
            <CaseChatPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
            <div className="grid lg:grid-cols-2 gap-5">
              <CourtCalendarPanel accessToken={accessToken} />
              <CourtPortalPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
            </div>
            <div className="grid lg:grid-cols-2 gap-5">
              <GraduatedRemindersPanel accessToken={accessToken} practitioner={practitioner} />
              <AutoIndexPanel accessToken={accessToken} practitioner={practitioner} />
            </div>
            <CaseExportPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
          </div>
        )}

        {tab === 'deep' && (
          <DeepJourneys
            accessToken={accessToken}
            caseId={caseItem.id}
            clientId={caseItem.client_id}
            practitioner={practitioner}
          />
        )}

        {tab === 'features' && (
          <div className="space-y-5">
            <MemoTemplatesPanel accessToken={accessToken} caseId={caseItem.id} officeId={officeId} profileId={profileId} practitioner={practitioner} />
            <SavedDraftsPanel accessToken={accessToken} caseId={caseItem.id} profileId={profileId} practitioner={practitioner} manager={manager} />
            <AdaptiveTemplatesPanel accessToken={accessToken} />
            <div className="grid lg:grid-cols-2 gap-5">
              <ConflictCheckPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
              <LimitationPanel accessToken={accessToken} caseId={caseItem.id} limitationDate={limitationDate} practitioner={practitioner} onSaved={() => onRefresh()} />
            </div>
            <TimeTrackingPanel accessToken={accessToken} caseId={caseItem.id} practitioner={practitioner} />
          </div>
        )}
      </div>
      </motion.div>
    </motion.div>
  );
}
