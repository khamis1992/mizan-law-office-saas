import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { Bot, CheckCircle2, ClipboardList, FileSearch, FileSignature, Loader2, PlayCircle, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export type AgentCaseOption = { id: string; case_number: string; title: string };

type AgentStep = { id: string; title: string; status: 'done' | 'skipped' | 'failed'; detail: string };
type PendingAction = { type: string; label: string; payload: unknown };
type AgentRunResult = {
  runId: string; agentType: 'research' | 'contract' | 'case_file'; objective: string;
  steps: AgentStep[]; output: Record<string, unknown>; pendingAction: PendingAction | null;
  status: 'completed' | 'awaiting_approval';
};
type AgentRunRecord = {
  id: string; agent_type: 'research' | 'contract' | 'case_file'; status: 'completed' | 'awaiting_approval' | 'executed' | 'rejected' | 'failed';
  objective: string; steps: AgentStep[]; output: Record<string, unknown>; pending_action: PendingAction | null; created_at: string;
};

const AGENTS = [
  { id: 'contract', label: 'وكيل العقد', icon: FileSignature, description: 'جمع الحقول، اختيار البنود المعتمدة، صياغة وكشف تعارض — والحالة لا تتحول إلى «مراجعة» إلا بموافقتك.' },
  { id: 'case_file', label: 'وكيل ملف القضية', icon: ClipboardList, description: 'استخراج وقائع وخط زمني وكشف نواقص وخطة بحث — والمهام لا تُنشأ إلا بموافقتك.' },
] as const;

const RUN_STATUS_LABELS: Record<AgentRunRecord['status'], string> = {
  completed: 'مكتمل', awaiting_approval: 'بانتظار موافقة', executed: 'نُفذ بعد موافقة', rejected: 'مرفوض', failed: 'فاشل',
};

export default function AgentsBoard({ accessToken, cases, canUse }: { accessToken: string; cases: AgentCaseOption[]; canUse: boolean }) {
  const [agentType, setAgentType] = useState<'research' | 'contract' | 'case_file'>('case_file');
  const [caseId, setCaseId] = useState(cases[0]?.id ?? 'none');
  const [templateCode, setTemplateCode] = useState('');
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [history, setHistory] = useState<AgentRunRecord[]>([]);
  const run = trpc.agents.run.useMutation();
  const approve = trpc.agents.approve.useMutation();
  const templatesQuery = trpc.contractStudio.templates.useQuery({ accessToken }, { staleTime: 300_000 });
  const templates = (templatesQuery.data ?? []) as Array<{ code: string; titleAr: string; variables: Array<{ key: string; label_ar: string; type: string; required?: boolean }> }>;
  const selectedTemplate = templates.find(item => item.code === templateCode);

  const loadHistory = async () => {
    const { data } = await supabase.from('agent_runs').select('id,agent_type,status,objective,steps,output,pending_action,created_at').order('created_at', { ascending: false }).limit(12);
    setHistory((data ?? []) as AgentRunRecord[]);
  };
  useEffect(() => { loadHistory(); }, []);

  const submit = async () => {
    if (!canUse) return toast.error('الوكلاء متاحون لمحامي ومدير المكتب فقط.');
    try {
      const output = await run.mutateAsync({
        accessToken, agentType,
        caseId: agentType !== 'contract' && caseId !== 'none' ? caseId : undefined,
        templateCode: agentType === 'contract' ? templateCode : undefined,
        title: agentType === 'contract' ? title : undefined,
        answers: agentType === 'contract' ? answers : undefined,
      });
      setResult(output as AgentRunResult);
      await loadHistory();
      toast.success('اكتمل تشغيل الوكيل وعرض خطة الخطوات والناتج.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تشغيل الوكيل.');
    }
  };

  const decide = async (decision: 'approved' | 'rejected') => {
    if (!result) return;
    const actionLabel = result.pendingAction?.label ?? 'الإجراء';
    if (!confirm(`${decision === 'approved' ? 'سيُنفذ' : 'سيُرفض'}: ${actionLabel}. القرار يُسجل باسمك في سجل الموافقات. متابعة؟`)) return;
    try {
      await approve.mutateAsync({ accessToken, runId: result.runId, decision });
      toast.success(decision === 'approved' ? 'نُفذ الإجراء بعد الموافقة وسُجل في سجل التدقيق.' : 'رُفض الإجراء وسُجل القرار.');
      setResult(null);
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل القرار.');
    }
  };

  const stepIcon = (status: AgentStep['status']) =>
    status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    : status === 'failed' ? <XCircle className="h-4 w-4 text-amber-600" />
    : <span className="h-4 w-4 grid place-items-center text-muted-foreground text-xs">–</span>;

  const renderOutput = (output: Record<string, unknown>) => {
    const research = output.research as undefined | { gap: boolean; suggestedFollowUps?: string[]; answer?: { summary: string; rule: string; exceptions: string[]; application: string[]; uncertainties: string[] } | null; citations?: unknown[] };
    const contract = output.contract as undefined | { documentId: string; draft: string; clauseDecisions: unknown[]; risks: unknown[]; verification: { passed: boolean } };
    const caseFile = output.caseFile as undefined | { factsSummary: string; timeline: Array<{ date: string; event: string }>; missingItems: string[]; researchPlan: Array<{ question: string; why: string }>; proposedTasks: Array<{ title: string; description: string; priority: string }> };
    if (research) {
      if (research.gap) return <div className="p-3 rounded-xl bg-amber-50 text-sm leading-7 text-amber-900">فجوة بحث: لا أدلة كافية، ولم يُولَّد تحليل. الاقتراحات: {(research.suggestedFollowUps ?? []).join(' · ')}</div>;
      return <div className="space-y-3 text-sm leading-7">
        <p><span className="font-semibold">الملخص: </span>{research.answer?.summary}</p>
        <p><span className="font-semibold">القاعدة: </span>{research.answer?.rule}</p>
        {research.answer?.exceptions.length ? <p><span className="font-semibold">الاستثناءات: </span>{research.answer.exceptions.join(' · ')}</p> : null}
        {research.answer?.uncertainties.length ? <p className="text-muted-foreground"><span className="font-semibold">عدم اليقين: </span>{research.answer.uncertainties.join(' · ')}</p> : null}
        <p className="text-xs text-muted-foreground">{research.citations?.length ?? 0} مصدراً مستشهداً به — راجع مركز البحث للتفاصيل الكاملة.</p>
      </div>;
    }
    if (contract) return <div className="space-y-2 text-sm leading-7">
      <p>أُعدت مسودة المستند <span className="font-mono text-xs">{contract.documentId.slice(0, 8)}</span> بحالة «مسودة» وسجل {contract.clauseDecisions.length} بنداً و{contract.risks.length} مخاطرة.</p>
      <p className="text-muted-foreground text-xs">{contract.verification.passed ? 'تحقق اقتباسات التشريع سليم.' : 'بعض الاقتباسات معلَّمة «غير موثقة» — راجعها في استديو العقود.'}</p>
    </div>;
    if (caseFile) return <div className="space-y-3 text-sm leading-7">
      <p><span className="font-semibold">ملخص الوقائع: </span>{caseFile.factsSummary}</p>
      {caseFile.timeline.length > 0 && <div><p className="font-semibold mb-1">الخط الزمني:</p><ul className="list-disc list-inside text-muted-foreground">{caseFile.timeline.map((item, index) => <li key={index}>{item.date}: {item.event}</li>)}</ul></div>}
      {caseFile.missingItems.length > 0 && <div><p className="font-semibold mb-1">النواقص:</p><ul className="list-disc list-inside text-muted-foreground">{caseFile.missingItems.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {caseFile.researchPlan.length > 0 && <div><p className="font-semibold mb-1">خطة البحث المقترحة:</p><ul className="list-disc list-inside text-muted-foreground">{caseFile.researchPlan.map((item, index) => <li key={index}>{item.question} — {item.why}</li>)}</ul></div>}
      {caseFile.proposedTasks.length > 0 && <div className="p-3 rounded-xl bg-[#f4f7f5]"><p className="font-semibold mb-1">مهام مقترحة (لا تُنشأ إلا بموافقتك):</p><ul className="list-disc list-inside">{caseFile.proposedTasks.map((task, index) => <li key={index}>{task.title}</li>)}</ul></div>}
    </div>;
    return null;
  };

  return (
    <>
      <div className="mb-6">
        <p className="text-xs tracking-[.15em] font-bold text-[#b58524]">المنتج الثالث</p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-1 text-[#153a36]">لوحة الوكلاء القانونيين</h1>
        <p className="text-sm leading-6 text-muted-foreground mt-2 max-w-2xl">وكيلان محدودا الهدف: خطة معروضة قبل التنفيذ، خطوات مرئية بحالة كل خطوة، وكل إجراء مؤثر خلف موافقة صريحة تُسجل باسمك. لا وكيل يعمل بصفة دائمة أو يرسل شيئاً خارج المكتب.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {AGENTS.map(agent => {
          const Icon = agent.icon;
          const active = agentType === agent.id;
          return (
            <button key={agent.id} onClick={() => { setAgentType(agent.id); setResult(null); }} className={`text-right rounded-2xl border p-5 transition-colors ${active ? 'border-[#1b6258] bg-[#f0f7f4]' : 'border-border bg-white hover:bg-[#f8fbfa]'}`}>
              <div className="flex justify-between items-start">
                <div className="h-10 w-10 rounded-xl grid place-items-center bg-[#edf4f1] text-[#1b6258]"><Icon className="h-5 w-5" /></div>
                {active && <Badge className="bg-[#0d3b36]">محدد</Badge>}
              </div>
              <p className="font-bold text-[#153a36] mt-3">{agent.label}</p>
              <p className="text-xs leading-6 text-muted-foreground mt-1">{agent.description}</p>
            </button>
          );
        })}
      </div>

      <div className="grid xl:grid-cols-[.9fr_1.1fr] gap-5">
        <Card className="border-0 shadow-sm h-fit">
          <CardHeader>
            <CardTitle className="text-lg text-[#153a36] flex gap-2"><PlayCircle className="h-5 w-5 text-[#b58524]" />تشغيل الوكيل</CardTitle>
            <CardDescription>حدد المدخلات ثم شغّل الوكيل؛ ستظهر الخطة والخطوات قبل أي إجراء.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {agentType !== 'contract' && (
              <div className="space-y-2">
                <Label>القضية</Label>
                <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={caseId} onChange={e => setCaseId(e.target.value)}>
                  <option value="none">بدون قضية</option>
                  {cases.map(item => <option key={item.id} value={item.id}>{item.case_number} — {item.title}</option>)}
                </select>
                {agentType === 'case_file' && caseId === 'none' && <p className="text-xs text-amber-700">وكيل ملف القضية يتطلب اختيار قضية.</p>}
              </div>
            )}
            <Button onClick={submit} disabled={run.isPending || !canUse} className="w-full h-11 bg-[#0d3b36]">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              {run.isPending ? 'الوكيل يعمل ضمن الحدود المقررة…' : 'تشغيل الوكيل'}
            </Button>
            {!canUse && <p className="text-xs bg-amber-50 text-amber-700 p-3 rounded-lg">الوكلاء متاحون للمحامي ومدير المكتب فقط.</p>}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {result && (
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg text-[#153a36]">{AGENTS.find(agent => agent.id === result.agentType)?.label}: {result.objective.slice(0, 80)}</CardTitle>
                <CardDescription>خطة التنفيذ وحالة كل خطوة</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  {result.steps.map(step => (
                    <div key={step.id} className="flex gap-3 items-start">
                      <div className="mt-0.5">{stepIcon(step.status)}</div>
                      <div>
                        <p className="font-semibold text-sm">{step.title}</p>
                        <p className="text-xs leading-6 text-muted-foreground">{step.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-4">{renderOutput(result.output)}</div>
                {result.pendingAction && result.status === 'awaiting_approval' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="font-semibold text-sm text-amber-900 flex gap-2"><ShieldCheck className="h-4 w-4" />إجراء مؤثر يتطلب موافقتك</p>
                    <p className="text-xs leading-6 text-amber-800 mt-1">{result.pendingAction.label}</p>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" onClick={() => decide('approved')} disabled={approve.isPending} className="bg-[#0d3b36]">{approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}موافقة وتنفيذ</Button>
                      <Button size="sm" variant="outline" onClick={() => decide('rejected')} disabled={approve.isPending}><XCircle className="h-3.5 w-3.5" />رفض</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base text-[#153a36]">سجل التشغيلات والموافقات</CardTitle>
              <CardDescription>آخر 12 تشغيلاً — كل موافقة أو رفض مسجل باسم صاحبه ووقته.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.map(record => (
                <div key={record.id} className="rounded-xl border p-3">
                  <div className="flex justify-between gap-2 items-start">
                    <p className="font-semibold text-sm">{AGENTS.find(agent => agent.id === record.agent_type)?.label ?? record.agent_type}: {record.objective.slice(0, 60)}</p>
                    <Badge variant="outline" className={record.status === 'executed' ? 'bg-emerald-50 text-emerald-700' : record.status === 'rejected' ? 'bg-rose-50 text-rose-700' : record.status === 'awaiting_approval' ? 'bg-amber-50 text-amber-700' : ''}>{RUN_STATUS_LABELS[record.status]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{new Intl.DateTimeFormat('ar-QA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(record.created_at))} · {record.steps?.length ?? 0} خطوة</p>
                  {record.pending_action && record.status === 'awaiting_approval' && <p className="text-xs text-amber-700 mt-1">معلق: {record.pending_action.label}</p>}
                </div>
              ))}
              {!history.length && <p className="text-sm text-muted-foreground">لا تشغيلات بعد.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
