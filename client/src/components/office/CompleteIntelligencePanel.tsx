import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc, trpcClient } from '@/lib/trpc';
import { downloadWord } from '@/lib/document-export';
import { Activity, AlertTriangle, BriefcaseBusiness, Building2, CircleDollarSign, Download, FileText, Gavel, GitBranch, Landmark, Loader2, Network, ScrollText, Sparkles, Target, TrendingUp, Wallet } from 'lucide-react';
import { toast } from 'sonner';

/**
 * استكمال الذكاء العميق:
 * الرسم البياني للمعرفة، آلة الحالة الإجرائية، التوأم الرقمي، المحاكاة المتعددة،
 * الاستدلال الزمني، رادار الفرص، مسار ما بعد الحكم، الربحية، التقييم، العقيدة، الأتعاب، الشفافية.
 */

export function KnowledgeGraphPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ outgoing: unknown[]; incoming: unknown[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await trpcClient.completeIntelligence.knowledgeGraph.query.query({ accessToken, entityType: 'case', entityId: caseId });
      setResult(outcome as typeof result);
      toast.success('عُرضت حواف الرسم البياني.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الاستعلام.');
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Network className="h-5 w-5 text-[#b58524]" />الرسم البياني للمعرفة</CardTitle>
          <CardDescription>حواف العلاقات بين القضية والأطراف والمواد والدفوع والدوائر — أساس الاستدلال المتقدم.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={busy || !practitioner} onClick={run}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}استعلام
        </Button>
      </CardHeader>
      <CardContent>
        {result && ((result.outgoing as unknown[]).length > 0 || (result.incoming as unknown[]).length > 0) ? (
          <div className="space-y-3">
            {(result.outgoing as Array<{ target_type: string; relation: string; strength: number }>).length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">صادرة (من القضية)</p>
                <div className="space-y-1.5">
                  {(result.outgoing as Array<{ target_type: string; target_id: string; relation: string; strength: number }>).map((edge, i) => (
                    <div key={i} className="flex justify-between items-center text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                      <span className="text-[#153a36]">← {edge.target_type}: {edge.target_id.slice(0, 8)}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{edge.relation} · {Math.round(edge.strength * 100)}%</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(result.incoming as Array<{ source_type: string; relation: string; strength: number }>).length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">واردة (إلى القضية)</p>
                <div className="space-y-1.5">
                  {(result.incoming as Array<{ source_type: string; source_id: string; relation: string; strength: number }>).map((edge, i) => (
                    <div key={i} className="flex justify-between items-center text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                      <span className="text-[#153a36]">{edge.source_type}: {edge.source_id.slice(0, 8)} ←</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{edge.relation} · {Math.round(edge.strength * 100)}%</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">استعلم لعرض علاقات القضية — تُبنى الحواف تلقائياً مع الأحداث.</p>}
      </CardContent>
    </Card>
  );
}

export function ProceduralStatePanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [state, setState] = useState<{ stateId: string; currentState: string; transitions: unknown[]; autoTasks: unknown[]; allowedTransitions: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const transition = trpc.completeIntelligence.procedural.transition.useMutation();

  const load = async () => {
    const result = await trpcClient.completeIntelligence.procedural.get.query({ accessToken, caseId }).catch(() => null);
    setState(result as typeof state);
  };
  useEffect(() => { load(); }, [caseId]);

  const STATE_LABELS: Record<string, string> = { new_filing: 'قيد التقديم', pending_review: 'قيد المراجعة', expert_appointment: 'ندب خبير', hearings: 'جلسات', judgment_reserved: 'حجز للحكم', judgment_issued: 'صدر الحكم', appeal: 'استئناف', execution: 'تنفيذ', closed: 'مغلقة' };
  const STATE_TONES: Record<string, string> = { new_filing: 'bg-slate-100 text-slate-700', pending_review: 'bg-blue-50 text-blue-700', expert_appointment: 'bg-violet-50 text-violet-700', hearings: 'bg-amber-50 text-amber-700', judgment_reserved: 'bg-orange-50 text-orange-700', judgment_issued: 'bg-emerald-50 text-emerald-700', appeal: 'bg-rose-50 text-rose-700', execution: 'bg-indigo-50 text-indigo-700', closed: 'bg-slate-100 text-slate-500' };

  const advance = async (to: string) => {
    if (!state) return;
    setBusy(to);
    try {
      const result = await transition.mutateAsync({ accessToken, caseId, to: to as never });
      toast.success(`انتقلت الحالة إلى «${STATE_LABELS[to] ?? to}» — أُنشئت ${(result as { createdTasks: number }).createdTasks} مهام تلقائية.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الانتقال.');
    } finally { setBusy(null); }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><GitBranch className="h-5 w-5 text-[#b58524]" />آلة الحالة الإجرائية</CardTitle>
        <CardDescription>نمذجة دورة حياة الدعوى قانونياً: كل انتقال يفرض مهام ومستندات تلقائياً.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state && (
          <>
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4 flex items-center justify-between">
              <span className="text-sm font-bold text-[#153a36]">الحالة الحالية:</span>
              <Badge variant="outline" className={`text-sm ${STATE_TONES[state.currentState] ?? ''}`}>{STATE_LABELS[state.currentState] ?? state.currentState}</Badge>
            </div>
            {state.allowedTransitions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-[#1b6258]">الانتقالات المتاحة</p>
                <div className="flex flex-wrap gap-1.5">
                  {state.allowedTransitions.map(to => (
                    <Button key={to} size="sm" variant="outline" className="h-8" disabled={busy === to || !practitioner} onClick={() => advance(to)}>
                      {busy === to ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}{STATE_LABELS[to] ?? to}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {(state.autoTasks as unknown[]).length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">مهام هذه المرحلة (تُنشأ تلقائياً)</p>
                <div className="space-y-1">
                  {(state.autoTasks as Array<{ task: string; dueInDays: number }>).map((task, i) => (
                    <div key={i} className="flex justify-between text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                      <span className="text-[#153a36]">{task.task}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{task.dueInDays} يوم</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CaseTwinPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ healthScore: number; risks: Array<{ risk: string; severity: string; mitigation: string }>; scenarios: Array<{ scenario: string; probability: number; nextStep: string }>; recommendedNextAction: string; state: string; hours: number; billedValue: number; invoiced: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const twin = trpc.completeIntelligence.twin.useMutation();

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await twin.mutateAsync({ accessToken, caseId });
      setResult(outcome as typeof result);
      toast.success('حُدّث التوأم الرقمي.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحديث.');
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Activity className="h-5 w-5 text-[#b58524]" />التوأم الرقمي للقضية</CardTitle>
          <CardDescription>نموذج حيّ يقيم صحة القضية وسيناريوهاتها وتكلفتها ومخاطرها.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={busy || !practitioner} onClick={run}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}تحديث
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {result ? (
          <>
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4 text-center">
              <p className={`text-4xl font-bold ${result.healthScore >= 60 ? 'text-emerald-700' : result.healthScore >= 40 ? 'text-amber-600' : 'text-rose-700'}`}>{result.healthScore}%</p>
              <p className="text-xs text-muted-foreground mt-1">مؤشر صحة القضية · {result.hours} ساعة · {Math.round(result.billedValue)} ريال قابلة للفوترة</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-semibold flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" />الإجراء الموصى به</p>
              <p className="text-xs mt-1 leading-5">{result.recommendedNextAction}</p>
            </div>
            {result.risks.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">المخاطر</p>
                <div className="space-y-1.5">
                  {result.risks.map((risk, i) => (
                    <div key={i} className="rounded-lg bg-[#f8fbfa] px-3 py-2 text-xs">
                      <span className="font-semibold text-[#153a36]">{risk.risk}</span> · <span className="text-muted-foreground">{risk.mitigation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.scenarios.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">السيناريوهات المحتملة</p>
                <div className="space-y-1.5">
                  {result.scenarios.map((scenario, i) => (
                    <div key={i} className="flex justify-between items-center rounded-lg bg-[#f8fbfa] px-3 py-2 text-xs">
                      <span className="text-[#153a36]">{scenario.scenario} — {scenario.nextStep}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{Math.round(scenario.probability * 100)}%</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">حدّث التوأم الرقمي لعرض تقييم حيّ للقضية.</p>}
      </CardContent>
    </Card>
  );
}

export function DeliberativeMootPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [memo, setMemo] = useState('');
  const [result, setResult] = useState<{ defensePosition: string; opponentPosition: string; courtAssessment: string; courtProbability: number; pointsToClose: Array<{ point: string; severity: string; action: string }>; disagreementSummary: string } | null>(null);
  const moot = trpc.completeIntelligence.moot.useMutation();

  const run = async () => {
    if (memo.trim().length < 100) return toast.error('الصق المذكرة أولاً (100 حرف على الأقل).');
    try {
      const outcome = await moot.mutateAsync({ accessToken, caseId, memoDraft: memo });
      setResult(outcome as typeof result);
      toast.success('اكتملت المحاكاة الخصمية المتعددة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التشغيل.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Target className="h-5 w-5 text-[#b58524]" />المحاكاة الخصمية المتعددة</CardTitle>
        <CardDescription>ثلاثة وكلاء (دفاع / خصم / محكمة متحفظة) يجادلون المذكرة ويكشفون نقاط يجب إغلاقها قبل الإيداع.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={memo} onChange={e => setMemo(e.target.value)} className="min-h-28 text-sm" placeholder="الصق مسودة المذكرة الجوهرية قبل الإيداع…" />
        <Button onClick={run} disabled={moot.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {moot.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}تشغيل المحاكاة
        </Button>
        {result && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-bold text-emerald-800 mb-1">موقف الدفاع</p>
                <p className="text-xs leading-5 text-emerald-800">{result.defensePosition}</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-bold text-rose-800 mb-1">موقف الخصم</p>
                <p className="text-xs leading-5 text-rose-800">{result.opponentPosition}</p>
              </div>
            </div>
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3">
              <div className="flex justify-between items-center">
                <p className="text-xs font-bold text-[#1b6258]">تقييم المحكمة المتقدّر</p>
                <Badge variant="outline" className="text-[10px]">{Math.round(result.courtProbability * 100)}% احتمال نجاح الدفاع</Badge>
              </div>
              <p className="text-xs text-[#153a36] mt-1.5 leading-5">{result.courtAssessment}</p>
            </div>
            {result.pointsToClose.length > 0 && (
              <div>
                <p className="text-xs font-bold text-rose-700 mb-1.5">نقاط يجب إغلاقها قبل الإيداع</p>
                <div className="space-y-1.5">
                  {result.pointsToClose.map((point, i) => (
                    <div key={i} className={`rounded-lg p-3 text-xs ${point.severity === 'مرتفع' ? 'bg-rose-50' : point.severity === 'متوسط' ? 'bg-amber-50' : 'bg-slate-50'}`}>
                      <p className="font-semibold text-[#153a36]">{point.point}</p>
                      <p className="text-[#1b6258] mt-0.5">الإجراء: {point.action}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TemporalSourcesPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [question, setQuestion] = useState('');
  const [referenceDate, setReferenceDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<Array<{ id: string; title: string; articleNumber: string | null; body: string; url: string; versionStatus: string; isCurrent: boolean }>>([]);
  const temporal = trpc.completeIntelligence.temporal.useQuery;

  const run = async () => {
    if (question.trim().length < 10) return toast.error('اكتب السؤال أولاً.');
    try {
      const outcome = await temporal({ accessToken, question, referenceDate }).refetch();
      if (outcome.data) setResult(outcome.data as typeof result);
      toast.success('عُرضت المصادر وفق التاريخ المرجعي.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الاستعلام.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Landmark className="h-5 w-5 text-[#b58524]" />الاستدلال الزمني على القانون الساري</CardTitle>
        <CardDescription>أي نص كان سارياً في تاريخ الواقعة — يقيّد النتائج بالتاريخ المرجعي للدعوى.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-[1fr_auto] gap-2">
          <Input value={question} onChange={e => setQuestion(e.target.value)} placeholder="مثال: ما نص المادة عن الإيجار في تاريخ 2020؟" />
          <Input type="date" value={referenceDate} onChange={e => setReferenceDate(e.target.value)} className="sm:w-44" />
        </div>
        <Button onClick={run} disabled={!practitioner} className="w-full h-10 bg-[#0d3b36]"><Landmark className="h-4 w-4" />استعلام زمني</Button>
        {result.length > 0 && (
          <div className="space-y-2">
            {result.map(section => (
              <div key={section.id} className="rounded-xl border border-[#e5ece9] p-3">
                <div className="flex justify-between gap-2">
                  <p className="text-sm font-semibold text-[#153a36]">{section.title}{section.articleNumber ? ` — ${section.articleNumber}` : ''}</p>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${section.isCurrent ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{section.isCurrent ? 'ساري' : 'تحقق'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-5">{section.versionStatus}</p>
                <p className="text-xs text-[#153a36] mt-1.5 leading-5 line-clamp-3">{section.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FeeProposalPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [title, setTitle] = useState('');
  const [feeType, setFeeType] = useState('lump_sum');
  const [amount, setAmount] = useState('');
  const [scope, setScope] = useState('');
  const [result, setResult] = useState<{ id: string; amount: number; content: string } | null>(null);
  const generate = trpc.completeIntelligence.fees.useMutation();

  const run = async () => {
    if (title.trim().length < 3) return toast.error('أدخل عنواناً لعرض الأتعاب.');
    try {
      const outcome = await generate.mutateAsync({
        accessToken, caseId, title, feeType: feeType as never,
        claimAmount: Number(amount) || undefined,
        scope: scope || undefined,
      });
      setResult(outcome as typeof result);
      toast.success('أُنشئ عرض الأتعاب.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الإنشاء.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Wallet className="h-5 w-5 text-[#b58524]" />منشئ عروض الأتعاب</CardTitle>
        <CardDescription>عرض أتعاب احترافي للموكل مع خيارات مقطوع/ساعات/نسبة نجاح/هجين.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2"><Label>عنوان العرض</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: تمثيل قانوني في قضية تعويض" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>النوع</Label>
            <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={feeType} onChange={e => setFeeType(e.target.value)}>
              <option value="lump_sum">مبلغ مقطوع</option>
              <option value="hourly">ساعات عمل</option>
              <option value="contingency">نسبة نجاح</option>
              <option value="hybrid">هجين</option>
            </select>
          </div>
          <div className="space-y-2"><Label>المبلغ (ريال)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label>نطاق العمل</Label><Textarea value={scope} onChange={e => setScope(e.target.value)} className="min-h-20 text-sm" placeholder="ما يشمله التمثيل…" /></div>
        <Button onClick={run} disabled={generate.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}توليد العرض
        </Button>
        {result && (
          <div className="space-y-2">
            <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-7 whitespace-pre-wrap max-h-64 overflow-y-auto">{result.content}</div>
            <Button size="sm" variant="outline" onClick={() => downloadWord('عرض أتعاب', result.content)}><Download className="h-3.5 w-3.5" />Word</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FinancialPortalPanel({ accessToken, clientId, practitioner }: { accessToken: string; clientId: string | null; practitioner: boolean }) {
  const [result, setResult] = useState<{ token: string; link: string; alreadyExists: boolean } | null>(null);
  const generate = trpc.completeIntelligence.financialPortal.useMutation();

  const run = async () => {
    if (!clientId) return toast.error('القضية غير مرتبطة بعميل.');
    try {
      const outcome = await generate.mutateAsync({ accessToken, clientId });
      setResult(outcome as typeof result);
      toast.success('أُنشئت بوابة الشفافية المالية.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الإنشاء.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><CircleDollarSign className="h-5 w-5 text-[#b58524]" />بوابة الشفافية المالية للموكل</CardTitle>
        <CardDescription>رابط خاص للموكل يستعرض فيه الرصيد والمدفوعات والمصروفات المرتبطة بقضيته.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={generate.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />}توليد رابط البوابة
        </Button>
        {result && (
          <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3 text-xs leading-6 text-[#1b6258]">
            <p className="font-semibold">{result.alreadyExists ? 'الرابط موجود مسبقاً' : 'أُنشئ الرابط'}</p>
            <p className="font-mono truncate mt-1" dir="ltr">{result.link}</p>
            <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={() => { navigator.clipboard?.writeText(result.link); toast.success('نُسخ الرابط.'); }}>نسخ الرابط</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PostJudgmentPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [judgmentText, setJudgmentText] = useState('');
  const [actions, setActions] = useState<Array<{ id: string; action_type: string; title: string; due_date: string | null; status: string }>>([]);
  const analyze = trpc.completeIntelligence.postJudgment.analyze.useMutation();

  const load = async () => {
    const result = await trpcClient.completeIntelligence.postJudgment.list.query({ accessToken, caseId }).catch(() => [] as typeof actions);
    setActions(result as typeof actions);
  };
  useEffect(() => { load(); }, [caseId]);

  const ACTION_LABELS: Record<string, string> = { execution: 'تنفيذ', seizure: 'حجز', appeal: 'طعن', settlement: 'تسوية', collection: 'تحصيل', other: 'أخرى' };

  const run = async () => {
    if (judgmentText.trim().length < 30) return toast.error('الصق نص الحكم أولاً (30 حرفاً على الأقل).');
    try {
      await analyze.mutateAsync({ accessToken, caseId, judgmentText });
      toast.success('أُنشئ مسار ما بعد الحكم.');
      setJudgmentText('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحليل.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Gavel className="h-5 w-5 text-[#b58524]" />مسار ما بعد الحكم</CardTitle>
        <CardDescription>تنفيذ، حجز، طعن، تسوية، تحصيل — إجراءات أولوية بمدد مقترحة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={judgmentText} onChange={e => setJudgmentText(e.target.value)} className="min-h-24 text-sm" placeholder="الصق نص الحكم لتحليل مساره…" />
        <Button onClick={run} disabled={analyze.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}تحليل المسار
        </Button>
        {actions.length > 0 && (
          <div className="space-y-1.5">
            {actions.map(action => (
              <div key={action.id} className="flex justify-between items-center text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[#153a36]">{action.title}</p>
                  {action.due_date && <p className="text-muted-foreground mt-0.5">الموعد: {new Date(action.due_date).toLocaleDateString('ar-QA')}</p>}
                </div>
                <Badge variant="outline" className={`shrink-0 text-[10px] ${action.status === 'done' ? 'bg-emerald-50 text-emerald-700' : action.status === 'blocked' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{ACTION_LABELS[action.action_type] ?? action.action_type}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EconomicsPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ actualHours: number; billedValue: number; invoiced: number; paid: number; margin: number; health: string; utilizationRate: number } | null>(null);
  const compute = trpc.completeIntelligence.economics.useMutation();

  const run = async () => {
    try {
      const outcome = await compute.mutateAsync({ accessToken, caseId });
      setResult(outcome as typeof result);
      toast.success('حُسبت ربحية القضية.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحساب.');
    }
  };

  const money = (v: number) => new Intl.NumberFormat('ar-QA', { style: 'currency', currency: 'QAR' }).format(v);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><TrendingUp className="h-5 w-5 text-[#b58524]" />ذكاء الربحية</CardTitle>
          <CardDescription>ساعات فعلية مقابل قيمة مفاتورة — هامش القضية وصحتها المالية.</CardDescription>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" disabled={compute.isPending || !practitioner} onClick={run}>{compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'احتساب'}</Button>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-2">
            <div className={`rounded-xl p-4 text-center ${result.health === 'healthy' ? 'bg-emerald-50' : result.health === 'loss' ? 'bg-rose-50' : 'bg-slate-50'}`}>
              <p className="text-3xl font-bold text-[#153a36]">{money(result.margin)}</p>
              <p className="text-xs text-muted-foreground mt-1">{result.health === 'healthy' ? 'قضية مربحة' : result.health === 'loss' ? 'خسارة تشغيلية' : 'لا بيانات كافية'}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">الساعات: {Math.round(result.actualHours * 10) / 10}</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">قيمة الساعات: {money(result.billedValue)}</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">المفوتر: {money(result.invoiced)}</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">المدفوع: {money(result.paid)}</p>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">احسب ربحية القضية من ساعاتها وفواتيرها.</p>}
      </CardContent>
    </Card>
  );
}

export function OfficeDoctrinePanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [doctrines, setDoctrines] = useState<Array<{ topic: string; principle: string; usage_count: number }>>([]);
  const [busy, setBusy] = useState(false);
  const distill = trpc.completeIntelligence.doctrines.distill.useMutation();

  const load = async () => {
    const result = await trpcClient.completeIntelligence.doctrines.list.query({ accessToken }).catch(() => [] as typeof doctrines);
    setDoctrines(result as typeof doctrines);
  };
  useEffect(() => { load(); }, [accessToken]);

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await distill.mutateAsync({ accessToken });
      if (outcome.note) toast.success(outcome.note);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الاستخلاص.');
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Building2 className="h-5 w-5 text-[#b58524]" />عقيدة المكتب المستخلصة</CardTitle>
          <CardDescription>مبادئ صياغة متكررة من مذكراتكم المعتمدة — هوية مهنية قابلة للتوريث.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={busy || !practitioner} onClick={run}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}استخلاص
        </Button>
      </CardHeader>
      <CardContent>
        {doctrines.length ? (
          <div className="space-y-2">
            {doctrines.map((doctrine, i) => (
              <div key={i} className="rounded-xl border border-[#e5ece9] p-3">
                <div className="flex justify-between gap-2"><p className="text-sm font-semibold text-[#153a36]">{doctrine.topic}</p><Badge variant="outline" className="text-[10px] shrink-0">{doctrine.usage_count} استخدام</Badge></div>
                <p className="text-xs text-muted-foreground mt-1 leading-5">{doctrine.principle}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">استخلص العقيدة من المذكرات المعتمدة — تنمو مع كل اعتماد.</p>}
      </CardContent>
    </Card>
  );
}
