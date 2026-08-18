import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc, trpcClient } from '@/lib/trpc';
import { downloadWord } from '@/lib/document-export';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Download, FileSearch, Gavel, Globe, Landmark, Loader2, MessageSquareQuote, Scale, SearchCheck, ShieldCheck, Sparkles, Target, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

/**
 * طبقة الذكاء العميق — «النظام التشغيلي القانوني»:
 * خريطة الإثبات، مدد الطعون، ليلة الجلسة، تقرير الموكل، محلل الخبراء،
 * حاسبة التسوية، تعلّم التفضيلات، مدقق الاتساق، الطمس، اتجاهات الدوائر، رادار الجريدة.
 */

export function EvidenceMapPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [elements, setElements] = useState<Array<{ id: string; requirement: string; element_type: string; proof_status: string; note: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const build = trpc.deepIntelligence.evidence.build.useMutation();

  const load = async () => {
    const result = await trpcClient.deepIntelligence.evidence.list.query({ accessToken, caseId }).catch(() => [] as typeof elements);
    setElements(result as typeof elements);
  };
  useEffect(() => { load(); }, [caseId]);

  const run = async () => {
    if (!practitioner) return;
    setBusy(true);
    try {
      await build.mutateAsync({ accessToken, caseId });
      toast.success('أُنشئت خريطة عبء الإثبات.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر بناء الخريطة.');
    } finally { setBusy(false); }
  };

  const STATUS_TONES: Record<string, string> = { proven: 'bg-emerald-50 text-emerald-700 border-emerald-200', partial: 'bg-amber-50 text-amber-700 border-amber-200', unproven: 'bg-rose-50 text-rose-700 border-rose-200', n_a: 'bg-slate-100 text-slate-600 border-slate-200' };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Target className="h-5 w-5 text-[#b58524]" />خريطة عبء الإثبات</CardTitle>
          <CardDescription>تفكيك طلبات الدعوى إلى أركان، وربط كل ركن بحالة إثباته والمستندات اللازمة.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={busy || !practitioner} onClick={run}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />}بناء الخريطة
        </Button>
      </CardHeader>
      <CardContent>
        {elements.length ? (
          <div className="space-y-2">
            {elements.map(element => (
              <div key={element.id} className="rounded-xl border border-[#e5ece9] p-3">
                <div className="flex justify-between gap-2 items-start">
                  <p className="text-sm font-semibold text-[#153a36]">{element.requirement}</p>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${STATUS_TONES[element.proof_status] ?? ''}`}>
                    {element.proof_status === 'proven' ? 'مثبت' : element.proof_status === 'partial' ? 'مثبت جزئياً' : element.proof_status === 'unproven' ? 'غير مثبت' : 'لا يلزم'}
                  </Badge>
                </div>
                {element.note && <p className="text-xs text-muted-foreground mt-1 leading-5">{element.note}</p>}
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">ابنِ الخريطة لتفكيك أركان الدعوى ومتطلبات الإثبات.</p>}
      </CardContent>
    </Card>
  );
}

export function DeadlinesPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [judgmentKind, setJudgmentKind] = useState('civil');
  const [result, setResult] = useState<{ deadlines: Array<{ type: string; label: string; days: number; dueDate: string }> } | null>(null);
  const compute = trpc.deepIntelligence.deadlines.useMutation();

  const run = async () => {
    try {
      const outcome = await compute.mutateAsync({ accessToken, caseId, eventDate, eventType: 'judgment', judgmentKind: judgmentKind as 'civil' | 'commercial' | 'urgent' | 'criminal' | 'labor' | 'administrative' | 'other' });
      setResult({ deadlines: (outcome as unknown as { deadlines: Array<{ type: string; label: string; days: number; dueDate: Date }> }).deadlines.map(d => ({ ...d, dueDate: d.dueDate.toISOString().slice(0, 10) })) });
      toast.success('حُسبت مدد الطعون.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحساب.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><CalendarClock className="h-5 w-5 text-[#b58524]" />محرك مدد الطعون</CardTitle>
        <CardDescription>احتساب ميعاد الاستئناف والتمييز والمعارضة وفق قانون المرافعات القطري مع إيقاف سريان المواعيد أثناء العطل الرسمية.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>تاريخ الحكم/الإعلان</Label>
            <Input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>نوع الدعوى</Label>
            <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={judgmentKind} onChange={e => setJudgmentKind(e.target.value)}>
              <option value="civil">مدنية</option>
              <option value="commercial">تجارية</option>
              <option value="urgent">أمور مستعجلة</option>
              <option value="criminal">جنائية</option>
              <option value="labor">عمالية</option>
              <option value="administrative">إدارية</option>
            </select>
          </div>
        </div>
        <Button onClick={run} disabled={compute.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {compute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}حساب المدّد
        </Button>
        {result && (
          <div className="space-y-2">
            {result.deadlines.map(deadline => (
              <div key={deadline.type} className="flex justify-between items-center rounded-xl border border-[#e5ece9] p-3 text-sm">
                <span className="font-semibold text-[#153a36]">{deadline.label}</span>
                <Badge variant="outline" className="shrink-0">{deadline.days} يوماً · ينتهي {new Date(deadline.dueDate).toLocaleDateString('ar-QA')}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function HearingPrepPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ hearingAt: string; onePageSummary: string; expectedQuestions: string[]; missingDocuments: string[]; topDefenses: string[]; weakPoints: string[]; oralPoints: string[] } | null>(null);
  const prep = trpc.deepIntelligence.hearingPrep.useMutation();

  const run = async () => {
    try {
      const outcome = await prep.mutateAsync({ accessToken, caseId });
      setResult(outcome as typeof result);
      toast.success('أُعدّت حزمة ليلة الجلسة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التجهيز.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><ClipboardList className="h-5 w-5 text-[#b58524]" />ليلة ما قبل الجلسة</CardTitle>
          <CardDescription>حزمة تحضير يومية: ملخص صفحة، أسئلة متوقعة، مستندات ناقصة، أقوى الدفوع، ونقاط المرافعة الشفوية.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={prep.isPending || !practitioner} onClick={run}>
          {prep.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardList className="h-3.5 w-3.5" />}تجهيز الحزمة
        </Button>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4">
              <p className="text-xs font-bold text-[#1b6258] mb-1">الجلسة القادمة: {new Date(result.hearingAt).toLocaleString('ar-QA')}</p>
              <p className="text-sm leading-7 text-[#153a36]">{result.onePageSummary}</p>
            </div>
            {result.expectedQuestions.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">الأسئلة المتوقعة</p>
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">{result.expectedQuestions.map((q, i) => <li key={i}>{q}</li>)}</ol>
              </div>
            )}
            {result.missingDocuments.length > 0 && (
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />مستندات ناقصة</p>
                <ul className="list-disc list-inside text-sm text-amber-800 space-y-1">{result.missingDocuments.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
            )}
            {result.topDefenses.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">أقوى الدفوع</p>
                <div className="flex flex-wrap gap-1.5">{result.topDefenses.map((d, i) => <Badge key={i} variant="outline" className="bg-emerald-50 text-emerald-700">{d}</Badge>)}</div>
              </div>
            )}
            {result.weakPoints.length > 0 && (
              <div className="rounded-xl bg-rose-50 p-3">
                <p className="text-xs font-bold text-rose-800 mb-1">نقاط ضعف تحتاج تحوطاً</p>
                <ul className="list-disc list-inside text-sm text-rose-800 space-y-1">{result.weakPoints.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}
            {result.oralPoints.length > 0 && (
              <div>
                <p className="text-xs font-bold text-[#1b6258] mb-1.5">نقاط المرافعة الشفوية</p>
                <ol className="list-decimal list-inside text-sm text-[#153a36] space-y-1">{result.oralPoints.map((p, i) => <li key={i}>{p}</li>)}</ol>
              </div>
            )}
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">جهّز الحزمة قبل الجلسة القادمة لتصل جاهزاً.</p>}
      </CardContent>
    </Card>
  );
}

export function ClientBriefPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ content: string; language: string } | null>(null);
  const [language, setLanguage] = useState('ar');
  const brief = trpc.deepIntelligence.clientBrief.useMutation();

  const run = async () => {
    try {
      const outcome = await brief.mutateAsync({ accessToken, caseId, language: language as 'ar' | 'en' });
      setResult(outcome as typeof result);
      toast.success('أُعدّ تقرير الموكل.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر توليد التقرير.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><MessageSquareQuote className="h-5 w-5 text-[#b58524]" />تقرير الموكل التنفيذي</CardTitle>
        <CardDescription>موقف قضائي بلغة إدارية واضحة (عربي/إنجليزي) يُرسل للموكل — ما تم، الموقف، الخطوة القادمة، التاريخ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <select className="flex-1 h-10 rounded-lg border bg-background px-3 text-sm" value={language} onChange={e => setLanguage(e.target.value)}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
          <Button onClick={run} disabled={brief.isPending || !practitioner} className="bg-[#0d3b36] shrink-0">
            {brief.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareQuote className="h-4 w-4" />}توليد
          </Button>
        </div>
        {result && (
          <>
            <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-8 whitespace-pre-wrap max-h-72 overflow-y-auto" dir={result.language === 'ar' ? 'rtl' : 'ltr'}>{result.content}</div>
            <Button size="sm" variant="outline" onClick={() => downloadWord(result.language === 'ar' ? 'تقرير الموكل' : 'Client Brief', result.content)}><Download className="h-3.5 w-3.5" />تحميل</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ExpertReportPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [reportText, setReportText] = useState('');
  const [result, setResult] = useState<{ findings: Array<{ finding: string; severity: string; basis: string; suggestedObjection: string }>; objectionsDraft: string } | null>(null);
  const analyze = trpc.deepIntelligence.expertReport.useMutation();

  const run = async () => {
    if (reportText.trim().length < 50) return toast.error('الصق نص تقرير الخبير أولاً (50 حرفاً على الأقل).');
    try {
      const outcome = await analyze.mutateAsync({ accessToken, caseId, reportText });
      setResult(outcome as typeof result);
      toast.success('حُلّل تقرير الخبير.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التحليل.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Gavel className="h-5 w-5 text-[#b58524]" />محلل تقارير الخبراء</CardTitle>
        <CardDescription>يكتشف تجاوز المأمورية والأخطاء الحسابية والمنطقية، ويولّد مسودة مذكرة اعتراض على تقرير الخبير.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={reportText} onChange={e => setReportText(e.target.value)} className="min-h-28 text-sm" placeholder="الصق نص تقرير الخبير…" />
        <Button onClick={run} disabled={analyze.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}تحليل التقرير
        </Button>
        {result && (
          <div className="space-y-3">
            {result.findings.length > 0 && (
              <div className="space-y-2">
                {result.findings.map((finding, i) => (
                  <div key={i} className={`rounded-xl p-3 ${finding.severity === 'مرتفع' ? 'bg-rose-50' : finding.severity === 'متوسط' ? 'bg-amber-50' : 'bg-slate-50'}`}>
                    <div className="flex justify-between gap-2"><p className="text-sm font-semibold text-[#153a36]">{finding.finding}</p><Badge variant="outline" className="text-[10px] shrink-0">خطورة {finding.severity}</Badge></div>
                    <p className="text-xs text-muted-foreground mt-1 leading-5">{finding.basis}</p>
                    <p className="text-xs text-[#1b6258] mt-1 leading-5">الاعتراض: {finding.suggestedObjection}</p>
                  </div>
                ))}
              </div>
            )}
            {result.objectionsDraft && (
              <>
                <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-7 whitespace-pre-wrap max-h-72 overflow-y-auto">{result.objectionsDraft}</div>
                <Button size="sm" variant="outline" onClick={() => downloadWord('مذكرة اعتراض على تقرير الخبير', result.objectionsDraft)}><Download className="h-3.5 w-3.5" />Word</Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettlementPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [claimAmount, setClaimAmount] = useState('');
  const [probability, setProbability] = useState('');
  const [offer, setOffer] = useState('');
  const [costs, setCosts] = useState('');
  const [result, setResult] = useState<{ expectedValue: number; recommendation: string; breakdown: { claimAmount: number; probability: number; estimatedCosts: number; settlementOffer: number | null } } | null>(null);
  const val = trpc.deepIntelligence.settlement.useMutation();

  const run = async () => {
    const amount = Number(claimAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('أدخل مبلغ المطالبة.');
    try {
      const outcome = await val.mutateAsync({
        accessToken, caseId, claimAmount: amount,
        successProbability: probability ? Number(probability) : undefined,
        settlementOffer: offer ? Number(offer) : undefined,
        estimatedCosts: Number(costs) || 0,
      });
      setResult(outcome as typeof result);
      toast.success('حُسبت القيمة المتوقعة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحساب.');
    }
  };

  const REC_TONES: Record<string, string> = { accept: 'bg-emerald-50 text-emerald-700', reject: 'bg-rose-50 text-rose-700', negotiate: 'bg-amber-50 text-amber-700', neutral: 'bg-slate-100 text-slate-600' };
  const money = (v: number) => new Intl.NumberFormat('ar-QA', { style: 'currency', currency: 'QAR' }).format(v);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Scale className="h-5 w-5 text-[#b58524]" />حاسبة الجدوى والتسوية</CardTitle>
        <CardDescription>القيمة المتوقعة للتقاضي مقابل عرض التسوية — قرار مستند إلى الأرقام.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>مبلغ المطالبة (ريال)</Label><Input type="number" value={claimAmount} onChange={e => setClaimAmount(e.target.value)} /></div>
          <div className="space-y-2"><Label>احتمالية النجاح % (اختياري)</Label><Input type="number" min="0" max="100" value={probability} onChange={e => setProbability(e.target.value)} /></div>
          <div className="space-y-2"><Label>عرض التسوية (اختياري)</Label><Input type="number" value={offer} onChange={e => setOffer(e.target.value)} /></div>
          <div className="space-y-2"><Label>التكاليف المتوقعة</Label><Input type="number" value={costs} onChange={e => setCosts(e.target.value)} /></div>
        </div>
        <Button onClick={run} disabled={val.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {val.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}حساب القيمة المتوقعة
        </Button>
        {result && (
          <div className="space-y-2">
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4 text-center">
              <p className="text-3xl font-bold text-[#0d3b36]">{money(result.expectedValue)}</p>
              <p className="text-xs text-muted-foreground mt-1">القيمة المتوقعة للتقاضي</p>
            </div>
            <Badge variant="outline" className={`w-full justify-center py-2 text-sm ${REC_TONES[result.recommendation] ?? ''}`}>
              {result.recommendation === 'accept' ? 'يُنصح بقبول عرض التسوية' : result.recommendation === 'reject' ? 'يُنصح برفض العرض' : result.recommendation === 'negotiate' ? 'يُنصح بالتفاوض' : 'بدون توصية'}
            </Badge>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">المطالبة: {money(result.breakdown.claimAmount)}</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">الاحتمالية: {Math.round(result.breakdown.probability * 100)}%</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">التكاليف: {money(result.breakdown.estimatedCosts)}</p>
              <p className="rounded-lg bg-[#f8fbfa] px-3 py-2">عرض الخصم: {result.breakdown.settlementOffer !== null ? money(result.breakdown.settlementOffer) : '—'}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConsistencyPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ issues: Array<{ issue: string; severity: string; location: string; suggestion: string }>; requestsMatch: boolean } | null>(null);
  const check = trpc.deepIntelligence.consistency.useMutation();

  const run = async () => {
    if (text.trim().length < 100) return toast.error('الصق نص المذكرة أولاً (100 حرف على الأقل).');
    try {
      const outcome = await check.mutateAsync({ accessToken, memoText: text });
      setResult(outcome as typeof result);
      toast.success('اكتمل فحص الاتساق.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الفحص.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><SearchCheck className="h-5 w-5 text-[#b58524]" />مدقق الاتساق</CardTitle>
        <CardDescription>فحص المذكرة قبل الاعتماد: مطابقة الطلبات للدفوع، تناسق التواريخ، وسلامة الترويسة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={text} onChange={e => setText(e.target.value)} className="min-h-28 text-sm" placeholder="الصق نص المذكرة قبل الاعتماد…" />
        <Button onClick={run} disabled={check.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}فحص الاتساق
        </Button>
        {result && (
          <div className="space-y-2">
            <Badge variant="outline" className={result.requestsMatch ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
              {result.requestsMatch ? 'الطلبات مطابقة للمتن ✓' : 'الطلبات غير مطابقة للمتن — راجعها'}
            </Badge>
            {result.issues.length > 0 && (
              <div className="space-y-2">
                {result.issues.map((issue, i) => (
                  <div key={i} className={`rounded-xl p-3 ${issue.severity === 'مرتفع' ? 'bg-rose-50' : issue.severity === 'متوسط' ? 'bg-amber-50' : 'bg-slate-50'}`}>
                    <div className="flex justify-between gap-2"><p className="text-sm font-semibold text-[#153a36]">{issue.issue}</p><Badge variant="outline" className="text-[10px] shrink-0">خطورة {issue.severity}</Badge></div>
                    {issue.location && <p className="text-xs text-muted-foreground mt-1">الموقع: {issue.location}</p>}
                    <p className="text-xs text-[#1b6258] mt-1 leading-5">الاقتراح: {issue.suggestion}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RedactionPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ redactedText: string; redactions: Array<{ type: string; original: string; replacedWith: string }> } | null>(null);
  const redact = trpc.deepIntelligence.redact.useMutation();

  const run = async () => {
    if (text.trim().length < 10) return toast.error('الصق النص أولاً.');
    try {
      const outcome = await redact.mutateAsync({ accessToken, text });
      setResult(outcome as typeof result);
      toast.success('طُمست البيانات الحساسة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الطمس.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><ShieldCheck className="h-5 w-5 text-[#b58524]" />طمس البيانات الحساسة</CardTitle>
        <CardDescription>حجب أرقام الهوية والحسابات البنكية والهواتف قبل مشاركة المستندات خارجياً.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={text} onChange={e => setText(e.target.value)} className="min-h-28 text-sm" placeholder="الصق النص المراد طمسه…" />
        <Button onClick={run} disabled={redact.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {redact.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}طمس البيانات
        </Button>
        {result && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-7 whitespace-pre-wrap max-h-64 overflow-y-auto">{result.redactedText}</div>
            {result.redactions.length > 0 && (
              <div className="text-xs text-muted-foreground">
                طُمس {result.redactions.length} قيمة: {result.redactions.map(r => r.type).join('، ')}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(result.redactedText); toast.success('نُسخ النص المطموس.'); }}>نسخ النص المطموس</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CircuitInsightsPanel({ accessToken }: { accessToken: string }) {
  const [result, setResult] = useState<{ circuits: Array<{ court: string; cases: number; winRate: number; expertDeferrals: number }>; note: string } | null>(null);
  useEffect(() => {
    trpcClient.deepIntelligence.circuits.query({ accessToken }).then(result => setResult(result as typeof result)).catch(() => undefined);
  }, [accessToken]);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Landmark className="h-5 w-5 text-[#b58524]" />اتجاهات الدوائر القضائية</CardTitle>
        <CardDescription>معدلات النجاح وميول الدوائر من سجل مكتبك — تُكيِّف لغة المذكرات.</CardDescription>
      </CardHeader>
      <CardContent>
        {result?.circuits.length ? (
          <div className="space-y-2">
            {result.circuits.map(circuit => (
              <div key={circuit.court} className="rounded-xl border border-[#e5ece9] p-3 flex justify-between items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#153a36] truncate">{circuit.court}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{circuit.cases} قضية · {circuit.expertDeferrals} ندب خبير</p>
                </div>
                <Badge variant="outline" className={`shrink-0 ${circuit.winRate >= 60 ? 'bg-emerald-50 text-emerald-700' : circuit.winRate >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{circuit.winRate}% نجاح</Badge>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground leading-4 pt-1">{result.note}</p>
          </div>
        ) : <p className="text-sm text-muted-foreground py-6 text-center">لا بيانات كافية بعد — تظهر الاتجاهات مع تراكم القضايا المغلقة.</p>}
      </CardContent>
    </Card>
  );
}

export function GazetteRadarPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ checked: number; results: Array<{ id: string; query: string; found: boolean }> } | null>(null);
  const add = trpc.deepIntelligence.gazette.add.useMutation();
  const check = trpc.deepIntelligence.gazette.check.useMutation();

  const runCheck = async () => {
    const outcome = await check.mutateAsync({ accessToken }).catch(() => null);
    setResult(outcome as typeof result);
    if (outcome) toast.success(`فُحص ${outcome.checked} مصطلحاً.`);
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Globe className="h-5 w-5 text-[#b58524]" />رادار الجريدة الرسمية</CardTitle>
          <CardDescription>مراقبة المنشورات الرسمية لمصطلحات تخص تخصصات المكتب — تنبيه عند ظهور جديد.</CardDescription>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={runCheck} disabled={check.isPending}>{check.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}فحص الآن</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="مصطلح للمراقبة: مثال «قانون الشركات»" />
          <Button onClick={async () => { if (query.trim().length < 3) return toast.error('أدخل مصطلحاً أطول.'); try { await add.mutateAsync({ accessToken, query: query.trim() }); setQuery(''); toast.success('أُضيف للمراقبة.'); } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر الإضافة.'); } }} disabled={add.isPending || !practitioner} className="bg-[#0d3b36] shrink-0">إضافة</Button>
        </div>
        {result && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-[#153a36]">آخر فحص: {result.checked} مصطلحاً</p>
            {result.results.filter(r => r.found).map(r => <p key={r.id} className="text-emerald-700">✓ {r.query} — ظهور محتمل</p>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PreferenceInsightsPanel({ accessToken }: { accessToken: string }) {
  const [result, setResult] = useState<{ totalSignals: number; byKind: Record<string, { accepted: number; rejected: number }>; recentAccepted: string[] } | null>(null);
  useEffect(() => {
    trpcClient.deepIntelligence.preferences.insights.query({ accessToken }).then(result => setResult(result as typeof result)).catch(() => undefined);
  }, [accessToken]);

  if (!result || result.totalSignals === 0) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-[#153a36] flex gap-2"><Sparkles className="h-4 w-4 text-[#b58524]" />تعلّم تفضيلات المكتب</CardTitle>
        <CardDescription>إشارات الاعتماد والرفض — تجعل الاسترجاع يقارب ما يقبله محاموكم.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {Object.entries(result.byKind).map(([kind, counts]) => (
            <Badge key={kind} variant="outline" className="text-[10px]">{kind}: {counts.accepted}✓ / {counts.rejected}✗</Badge>
          ))}
        </div>
        {result.recentAccepted.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <p className="font-semibold text-[#153a36] mb-1">أحدث ما قُبل:</p>
            {result.recentAccepted.map((value, i) => <p key={i} className="truncate">• {value}</p>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DocumentChainPanel({ accessToken, documentId }: { accessToken: string; documentId: string }) {
  const [result, setResult] = useState<{ fileName: string; fingerprint: string; chain: Array<{ event: string; actor: string | null; at: string }> } | null>(null);
  useEffect(() => {
    if (!documentId) return;
    trpcClient.deepIntelligence.documentChain.query({ accessToken, documentId }).then(result => setResult(result as typeof result)).catch(() => undefined);
  }, [accessToken, documentId]);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-[#153a36] flex gap-2"><ShieldCheck className="h-4 w-4 text-[#b58524]" />سلسلة عهدة المستند</CardTitle>
        <CardDescription>بصمة المستند وسجل من اطّلع وعدّل — يفيد في النزاعات المهنية.</CardDescription>
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center rounded-lg bg-[#f8fbfa] px-3 py-2">
              <span className="font-semibold text-[#153a36] truncate">{result.fileName}</span>
              <Badge variant="outline" className="text-[10px] shrink-0 font-mono" dir="ltr">{result.fingerprint}</Badge>
            </div>
            <div className="space-y-1.5">
              {result.chain.map((item, i) => (
                <div key={i} className="flex justify-between gap-2 text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                  <span className="text-[#153a36]">{item.event}</span>
                  <span className="text-muted-foreground shrink-0">{item.actor?.slice(0, 8) ?? 'نظام'} · {new Date(item.at).toLocaleDateString('ar-QA')}</span>
                </div>
              ))}
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground py-4 text-center">اختر مستنداً لعرض سلسلة العهدة.</p>}
      </CardContent>
    </Card>
  );
}
