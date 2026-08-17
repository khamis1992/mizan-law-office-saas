import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc, trpcClient } from '@/lib/trpc';
import { downloadPdf, downloadWord } from '@/lib/document-export';
import { AlertTriangle, Bot, CalendarClock, Download, Gavel, Globe, Loader2, MessageSquare, Scale, Send, Sparkles, Target, TrendingUp, Zap } from 'lucide-react';
import { toast } from 'sonner';

/**
 * الذكاء القانوني المتقدم — «شريك المرافعة»:
 * وكيل القضية الدائم، المحاكاة الخصمية، تحليل الأحكام، التنبؤ، الدردشة السياقية.
 */

type AgentSuggestion = { id: string; kind: string; title: string; detail: string | null; priority: string; status: string; created_at: string };
type ChatMessage = { id: string; role: string; content: string; created_at: string };

const KIND_LABELS: Record<string, string> = { defense: 'دفع', gap: 'ثغرة', action: 'إجراء', document: 'مستند', risk: 'مخاطرة' };
const PRIORITY_TONES: Record<string, string> = { high: 'bg-rose-50 text-rose-700 border-rose-200', medium: 'bg-amber-50 text-amber-700 border-amber-200', low: 'bg-slate-100 text-slate-600 border-slate-200' };

export function CaseAgentPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = trpc.legalIntelligence.caseAgent.run.useMutation();

  const load = async () => {
    const result = await trpcClient.legalIntelligence.caseAgent.suggestions.query({ accessToken, caseId }).catch(() => [] as AgentSuggestion[]);
    setSuggestions(result as AgentSuggestion[]);
  };
  useEffect(() => { load(); }, [caseId]);

  const runAgent = async (triggerType: 'manual' | 'daily' | 'new_document' = 'manual') => {
    if (!practitioner) return;
    setBusy(true);
    try {
      const result = await run.mutateAsync({ accessToken, caseId, triggerType });
      setSummary((result as { summary: string }).summary);
      toast.success('اكتمل فحص وكيل القضية.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تشغيل الوكيل.');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (id: string, status: 'accepted' | 'dismissed') => {
    await trpcClient.legalIntelligence.caseAgent.updateSuggestion.mutate({ accessToken, suggestionId: id, status });
    setSuggestions(current => current.map(s => s.id === id ? { ...s, status } : s));
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><Bot className="h-5 w-5 text-[#b58524]" />وكيل القضية الدائم</CardTitle>
          <CardDescription>يراقب القضية باستمرار: يقرأ المستندات الجديدة، يحدّث الدفوع والثغرات، ويقترح إجراءات عند كل حدث.</CardDescription>
        </div>
        <Button size="sm" className="bg-[#0d3b36] shrink-0" disabled={busy || !practitioner} onClick={() => runAgent()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}فحص القضية الآن
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4 text-sm leading-7 text-[#1b6258]">{summary}</div>}
        {suggestions.length > 0 && (
          <div className="space-y-2.5">
            <p className="text-sm font-bold text-[#153a36]">الاقتراحات ({suggestions.filter(s => s.status === 'open').length} مفتوحة)</p>
            {suggestions.map(suggestion => (
              <div key={suggestion.id} className={`rounded-xl border p-3 ${suggestion.status === 'dismissed' ? 'opacity-50' : ''}`}>
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#153a36] flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">{KIND_LABELS[suggestion.kind] ?? suggestion.kind}</Badge>
                      {suggestion.title}
                    </p>
                    {suggestion.detail && <p className="text-xs text-muted-foreground mt-1 leading-6">{suggestion.detail}</p>}
                  </div>
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${PRIORITY_TONES[suggestion.priority] ?? ''}`}>{suggestion.priority === 'high' ? 'عاجل' : suggestion.priority === 'medium' ? 'متوسط' : 'منخفض'}</Badge>
                </div>
                {suggestion.status === 'open' && (
                  <div className="flex gap-2 mt-2.5">
                    <Button size="sm" variant="outline" className="h-7 text-[11px] text-emerald-700" onClick={() => updateStatus(suggestion.id, 'accepted')}>اعتماد</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] text-muted-foreground" onClick={() => updateStatus(suggestion.id, 'dismissed')}>تجاهل</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {!suggestions.length && !summary && <p className="text-sm text-muted-foreground py-4 text-center">شغّل فحص القضية ليحلل الوكيل الوضع الحالي ويقترح الإجراءات.</p>}
      </CardContent>
    </Card>
  );
}

export function AdversarialPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [memoContent, setMemoContent] = useState('');
  const [result, setResult] = useState<{ id: string; content: string; weaknesses: Array<{ weakness: string; severity: string; mitigation: string }>; counterArguments: Array<{ argument: string; rebuttal: string }> } | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; perspective: string; content: string; created_at: string }>>([]);
  const generate = trpc.legalIntelligence.adversarial.generate.useMutation();

  const load = async () => {
    const result = await trpcClient.legalIntelligence.adversarial.list.query({ accessToken, caseId }).catch(() => [] as Array<{ id: string; perspective: string; content: string; created_at: string }>);
    setHistory(result as typeof history);
  };
  useEffect(() => { load(); }, [caseId]);

  const run = async () => {
    if (memoContent.trim().length < 50) return toast.error('الصق مسودة المذكرة أولاً (50 حرفاً على الأقل).');
    try {
      const outcome = await generate.mutateAsync({ accessToken, caseId, memoContent });
      setResult(outcome as typeof result);
      toast.success('أُعدت مذكرة الخصم المتوقعة.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر توليد المحاكاة.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Scale className="h-5 w-5 text-[#b58524]" />مذكرة الخصم المتوقعة</CardTitle>
        <CardDescription>محاكاة خصمية: يكتب الذكاء المذكرة من منظور الخصم ليكتشف المحامي نقاط الضعف قبل الجلسة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>مسودة مذكرة الدفاع (الصقها هنا)</Label>
          <Textarea value={memoContent} onChange={e => setMemoContent(e.target.value)} className="min-h-32 text-sm" placeholder="الصق مسودة المذكرة التي تريد اختبارها…" />
        </div>
        <Button onClick={run} disabled={generate.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4" />}توليد مذكرة الخصم المتوقعة
        </Button>
        {result && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-8 whitespace-pre-wrap max-h-72 overflow-y-auto">{result.content}</div>
            {result.weaknesses.length > 0 && (
              <div>
                <p className="text-sm font-bold text-[#153a36] mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-rose-500" />نقاط الضعف المكتشفة</p>
                <div className="space-y-2">
                  {result.weaknesses.map((weakness, index) => (
                    <div key={index} className="rounded-xl bg-rose-50 p-3">
                      <div className="flex justify-between gap-2"><p className="text-sm font-semibold text-rose-800">{weakness.weakness}</p><Badge variant="outline" className="text-[10px] shrink-0">خطورة {weakness.severity}</Badge></div>
                      <p className="text-xs text-rose-700 mt-1 leading-6">التخفيف: {weakness.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.counterArguments.length > 0 && (
              <div>
                <p className="text-sm font-bold text-[#153a36] mb-2">الردود المضادة الجاهزة</p>
                <div className="space-y-2">
                  {result.counterArguments.map((counter, index) => (
                    <div key={index} className="rounded-xl border border-[#e5ece9] p-3">
                      <p className="text-sm font-semibold text-[#153a36]">حجة الخصم: {counter.argument}</p>
                      <p className="text-xs text-[#1b6258] mt-1 leading-6">الرد: {counter.rebuttal}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadWord('مذكرة الخصم المتوقعة', result.content)}><Download className="h-3.5 w-3.5" />Word</Button>
              <Button size="sm" variant="outline" onClick={() => downloadPdf('مذكرة الخصم المتوقعة', result.content)}><Download className="h-3.5 w-3.5" />PDF</Button>
            </div>
          </div>
        )}
        {history.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-bold text-muted-foreground mb-2">سجل المحاكاة السابقة ({history.length})</p>
            <div className="space-y-1.5">
              {history.map(item => (
                <button key={item.id} className="w-full text-right text-xs text-[#1b6258] hover:underline truncate" onClick={() => setResult({ id: item.id, content: item.content, weaknesses: [], counterArguments: [] })}>
                  {new Date(item.created_at).toLocaleDateString('ar-QA')} — {item.content.slice(0, 80)}…
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function JudgmentAnalysisPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [outcomeText, setOutcomeText] = useState('');
  const [result, setResult] = useState<{ id: string; principle: string; proposedPrecedent: { title: string; summary: string; principleText: string; classification: string } } | null>(null);
  const analyze = trpc.legalIntelligence.judgments.analyze.useMutation();
  const accept = trpc.legalIntelligence.judgments.acceptPrecedent.useMutation();

  const run = async () => {
    if (outcomeText.trim().length < 30) return toast.error('الصق نص الحكم أو النتيجة أولاً (30 حرفاً على الأقل).');
    try {
      const outcome = await analyze.mutateAsync({ accessToken, caseId, outcomeText });
      setResult(outcome as typeof result);
      toast.success('حُلّل الحكم واستُخرج المبدأ القانوني.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحليل الحكم.');
    }
  };

  const acceptPrecedent = async () => {
    if (!result) return;
    const courtName = prompt('اسم المحكمة (للسابقة):') ?? '';
    if (!courtName.trim()) return toast.error('أدخل اسم المحكمة.');
    try {
      await accept.mutateAsync({ accessToken, analysisId: result.id, courtName: courtName.trim() });
      toast.success('أُضيفت السابقة إلى قاعدة المعرفة الموثقة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد السابقة.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Gavel className="h-5 w-5 text-[#b58524]" />تحليل الأحكام → سوابق</CardTitle>
        <CardDescription>عند تسجيل نتيجة جلسة أو حكم، يستخرج الذكاء المبدأ القانوني ويقترح سابقة موثقة — قاعدة المعرفة تنمو ذاتياً.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>نص الحكم / النتيجة</Label>
          <Textarea value={outcomeText} onChange={e => setOutcomeText(e.target.value)} className="min-h-28 text-sm" placeholder="الصق نص الحكم أو القرار الصادر…" />
        </div>
        <Button onClick={run} disabled={analyze.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}تحليل الحكم واستخراج المبدأ
        </Button>
        {result && (
          <div className="space-y-3">
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4">
              <p className="text-xs font-bold text-[#1b6258] mb-1.5">المبدأ القانوني المستفاد</p>
              <p className="text-sm leading-7 text-[#153a36]">{result.principle}</p>
            </div>
            <div className="rounded-xl border border-[#e5ece9] p-4">
              <p className="text-xs font-bold text-[#1b6258] mb-1.5">السابقة المقترحة ({result.proposedPrecedent.classification})</p>
              <p className="text-sm font-semibold text-[#153a36]">{result.proposedPrecedent.title}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-6">{result.proposedPrecedent.summary}</p>
              <p className="text-xs text-[#1b6258] mt-2 leading-6">نص المبدأ: {result.proposedPrecedent.principleText}</p>
            </div>
            <Button onClick={acceptPrecedent} disabled={accept.isPending} variant="outline" className="w-full h-10 text-emerald-700">
              {accept.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}اعتماد السابقة في قاعدة المعرفة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PredictionPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ successProbability: number; confidence: string; factors: Array<{ factor: string; impact: string; weight: string }>; whatIf: Array<{ scenario: string; probability: number; rationale: string }> } | null>(null);
  const [whatIf, setWhatIf] = useState('');
  const predict = trpc.legalIntelligence.prediction.predict.useMutation();

  const run = async () => {
    try {
      const outcome = await predict.mutateAsync({ accessToken, caseId, whatIf: whatIf || undefined });
      setResult(outcome as typeof result);
      toast.success('أُعدّ التنبؤ.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر توليد التنبؤ.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><TrendingUp className="h-5 w-5 text-[#b58524]" />توقع نتيجة القضية</CardTitle>
        <CardDescription>تقدير احتمالية النجاح من بيانات القضايا المغلقة المشابهة + تقييم «ماذا لو» للدفوع والمستندات.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={run} disabled={predict.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {predict.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}توليد التنبؤ
        </Button>
        {result && (
          <div className="space-y-4">
            <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-4 text-center">
              <p className="text-4xl font-bold text-[#0d3b36]">{Math.round(result.successProbability * 100)}%</p>
              <p className="text-xs text-muted-foreground mt-1">احتمالية النجاح · ثقة {result.confidence === 'high' ? 'عالية' : result.confidence === 'medium' ? 'متوسطة' : 'منخفضة'}</p>
            </div>
            {result.factors.length > 0 && (
              <div>
                <p className="text-sm font-bold text-[#153a36] mb-2">العوامل المؤثرة</p>
                <div className="space-y-1.5">
                  {result.factors.map((factor, index) => (
                    <div key={index} className="flex justify-between gap-2 text-sm rounded-lg bg-[#f8fbfa] px-3 py-2">
                      <span className="text-[#153a36]">{factor.factor}</span>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${factor.impact === 'positive' ? 'bg-emerald-50 text-emerald-700' : factor.impact === 'negative' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                        {factor.impact === 'positive' ? 'إيجابي' : factor.impact === 'negative' ? 'سلبي' : 'محايد'} · {factor.weight}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>سيناريو «ماذا لو» (اختياري)</Label>
              <div className="flex gap-2">
                <Input value={whatIf} onChange={e => setWhatIf(e.target.value)} placeholder="مثال: لو أضفنا دفع سقوط الخصومة…" />
                <Button variant="outline" onClick={run} disabled={predict.isPending}>تقييم</Button>
              </div>
            </div>
            {result.whatIf.length > 0 && (
              <div>
                <p className="text-sm font-bold text-[#153a36] mb-2">سيناريوهات «ماذا لو»</p>
                <div className="space-y-2">
                  {result.whatIf.map((scenario, index) => (
                    <div key={index} className="rounded-xl border border-[#e5ece9] p-3">
                      <div className="flex justify-between gap-2"><p className="text-sm font-semibold text-[#153a36]">{scenario.scenario}</p><Badge variant="outline" className="text-[10px] shrink-0">{Math.round(scenario.probability * 100)}%</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1 leading-6">{scenario.rationale}</p>
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

export function CaseChatPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const send = trpc.legalIntelligence.chat.send.useMutation();

  const load = async () => {
    const result = await trpcClient.legalIntelligence.chat.list.query({ accessToken, caseId }).catch(() => [] as ChatMessage[]);
    setMessages(result as ChatMessage[]);
  };
  useEffect(() => { load(); }, [caseId]);

  const submit = async () => {
    if (input.trim().length < 2) return;
    const question = input.trim();
    setInput('');
    setMessages(current => [...current, { id: `local-${Date.now()}`, role: 'user', content: question, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const result = await send.mutateAsync({ accessToken, caseId, message: question });
      setMessages(current => [...current, { id: `local-${Date.now() + 1}`, role: 'assistant', content: (result as { reply: string }).reply, created_at: new Date().toISOString() }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر توليد الرد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><MessageSquare className="h-5 w-5 text-[#b58524]" />المساعد السياقي</CardTitle>
        <CardDescription>اسأل داخل القضية: «ما أقوى دفع عندي؟» أو «جهز مذكرة رد على هذا الادعاء» — بسياق القضية كاملاً.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-80 overflow-y-auto space-y-2.5 rounded-xl border border-[#e5ece9] p-3 bg-[#f8fbfa]">
          {messages.length ? messages.map(message => (
            <div key={message.id} className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-7 whitespace-pre-wrap ${message.role === 'user' ? 'bg-[#0d3b36] text-white mr-auto' : 'bg-white border border-[#e5ece9] text-[#153a36]'}`}>
              {message.content}
            </div>
          )) : <p className="text-sm text-muted-foreground text-center py-6">اسأل عن القضية — الدفوع، الثغرات، صياغة مذكرات…</p>}
          {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />يفكر المساعد…</div>}
        </div>
        <div className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} placeholder="اكتب سؤالك عن القضية…" disabled={!practitioner} />
          <Button onClick={submit} disabled={busy || !practitioner || input.trim().length < 2} className="bg-[#0d3b36] shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CourtCalendarPanel({ accessToken }: { accessToken: string }) {
  const [holidays, setHolidays] = useState<Array<{ holiday_date: string; name_ar: string }>>([]);
  useEffect(() => {
    trpcClient.legalIntelligence.courts.holidays.query({ accessToken }).then(result => setHolidays(result as typeof holidays)).catch(() => undefined);
  }, [accessToken]);

  const upcoming = holidays.filter(h => new Date(h.holiday_date).getTime() >= Date.now()).slice(0, 8);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><CalendarClock className="h-5 w-5 text-[#b58524]" />تقويم المحاكم والعطل الرسمية</CardTitle>
        <CardDescription>العطل الرسمية القطرية — تُراعى عند جدولة الجلسات وتظهر التنبيهات عند تعارض موعد مع عطلة.</CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length ? (
          <div className="space-y-1.5">
            {upcoming.map(holiday => (
              <div key={holiday.holiday_date} className="flex justify-between items-center rounded-lg bg-[#f8fbfa] px-3 py-2 text-sm">
                <span className="text-[#153a36] font-semibold">{holiday.name_ar}</span>
                <span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('ar-QA', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(holiday.holiday_date))}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground py-4 text-center">لا عطل رسمية قادمة مسجلة.</p>}
      </CardContent>
    </Card>
  );
}

export function CaseExportPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [busy, setBusy] = useState(false);
  const exportCase = trpc.legalIntelligence.exportCase.useMutation();

  const run = async () => {
    setBusy(true);
    try {
      const result = await exportCase.mutateAsync({ accessToken, caseId });
      const { markdown, fileName } = result as { markdown: string; fileName: string };
      const blob = new Blob(['\ufeff', markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('صُدّر ملف القضية الكامل.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر التصدير.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Download className="h-5 w-5 text-[#b58524]" />تصدير ملف القضية</CardTitle>
        <CardDescription>ملف موحد يضم: القضية، الجلسات، المهام، المستندات، المذكرات، ساعات العمل، الفواتير، اقتراحات الوكيل، وسجل المحادثة.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={run} disabled={busy || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}تصدير الملف الكامل
        </Button>
      </CardContent>
    </Card>
  );
}

export function CourtPortalPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [courtCaseNumber, setCourtCaseNumber] = useState('');
  const [result, setResult] = useState<{ synced: boolean; courtCaseNumber: string; portalReachable: boolean; note: string } | null>(null);
  const sync = trpc.legalIntelligence.courts.syncCase.useMutation();

  const run = async () => {
    if (courtCaseNumber.trim().length < 2) return toast.error('أدخل رقم الدعوى في بوابة الميزان.');
    try {
      const outcome = await sync.mutateAsync({ accessToken, caseId, courtCaseNumber: courtCaseNumber.trim() });
      setResult(outcome as typeof result);
      toast.success('سُجل الاستعلام — تابع الجلسات من صفحة الجدول.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الاستعلام.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Globe className="h-5 w-5 text-[#b58524]" />بوابة الميزان الرسمية</CardTitle>
        <CardDescription>استعلام حالة الدعوى برقمها من بوابة المجلس الأعلى للقضاء — يُسجل ويُحدَّث تلقائياً عند توفر الواجهة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label>رقم الدعوى في بوابة الميزان</Label>
          <Input dir="ltr" value={courtCaseNumber} onChange={e => setCourtCaseNumber(e.target.value)} placeholder="مثال: 2026/1234" />
        </div>
        <Button onClick={run} disabled={sync.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}استعلام ومزامنة
        </Button>
        {result && (
          <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3 text-xs leading-6 text-[#1b6258]">
            <p className="font-semibold">رقم الدعوى: {result.courtCaseNumber} · البوابة: {result.portalReachable ? 'متاحة' : 'غير متاحة حالياً'}</p>
            <p className="mt-1">{result.note}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GraduatedRemindersPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ delivered: number; stages: Array<{ hearingId: string; stage: string }> } | null>(null);
  const dispatch = trpc.legalIntelligence.reminders.useMutation();

  const run = async () => {
    try {
      const outcome = await dispatch.mutateAsync({ accessToken });
      setResult(outcome as typeof result);
      toast.success('أُرسلت الإشعارات المتدرجة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الإرسال.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Zap className="h-5 w-5 text-[#b58524]" />الإشعارات المتدرجة</CardTitle>
        <CardDescription>جلسة بعد 7 أيام: تنبيه هادئ · يوم واحد: تذكير قياسي · ساعتان: تنبيه عاجل.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={dispatch.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {dispatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}إرسال الإشعارات المتدرجة الآن
        </Button>
        {result && result.delivered > 0 && (
          <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3 text-xs text-[#1b6258]">
            أُرسل {result.delivered} إشعاراً: {result.stages.filter(s => s.stage === 'urgent').length} عاجل · {result.stages.filter(s => s.stage === 'standard').length} قياسي · {result.stages.filter(s => s.stage === 'quiet').length} هادئ
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AutoIndexPanel({ accessToken, practitioner }: { accessToken: string; practitioner: boolean }) {
  const [result, setResult] = useState<{ sections: number; precedents: number } | null>(null);
  const index = trpc.legalIntelligence.autoIndex.useMutation();

  const run = async () => {
    try {
      const outcome = await index.mutateAsync({ accessToken, limit: 50 });
      setResult(outcome as typeof result);
      toast.success('اكتملت فهرسة المتجهات.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذرت الفهرسة.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Sparkles className="h-5 w-5 text-[#b58524]" />فهرسة المتجهات التلقائية</CardTitle>
        <CardDescription>توليد embeddings للمقاطع والسوابق الجديدة — يرفع جودة البحث الدلالي الهجين.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={run} disabled={index.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {index.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}فهرسة الدفعة التالية
        </Button>
        {result && (result.sections + result.precedents > 0) && (
          <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3 text-xs text-[#1b6258]">
            فُهرست {result.sections} مقطعاً و{result.precedents} سابقة.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
