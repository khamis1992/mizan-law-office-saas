import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { BookOpenText, CheckCircle2, FileDown, Loader2, SearchCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export type ResearchCaseOption = { id: string; case_number: string; title: string };

type ResearchCitation = {
  id: string; title: string; url: string; officialNumber: string | null; articleNumber: string | null;
  heading: string | null; excerpt: string; relevanceScore: number; effectiveOn: string | null; isCurrent: boolean | null;
};

type ResearchResult = {
  gap: boolean;
  evidenceQuality: 'none' | 'weak' | 'adequate';
  suggestedFollowUps: string[];
  answer: { summary: string; rule: string; exceptions: string[]; application: string[]; uncertainties: string[]; gapDeclaration: string | null } | null;
  citations: ResearchCitation[];
  precedentCitations: { id: string; courtName: string; referenceNumber: string | null; decidedOn: string | null; title: string; summary: string; url: string; relevanceScore: number }[];
  verification: { verifiedQuotes: string[]; unverifiedQuotes: string[]; unverifiedArticles: string[]; passed: boolean };
  limitations: string;
};

export default function ResearchCenter({ accessToken, cases, canUse, canManage, officeId }: { accessToken: string; cases: ResearchCaseOption[]; canUse: boolean; canManage?: boolean; officeId?: string | null }) {
  const [question, setQuestion] = useState('');
  const [disputeType, setDisputeType] = useState('');
  const [caseId, setCaseId] = useState('none');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [savingMemo, setSavingMemo] = useState(false);
  const [gapFormOpen, setGapFormOpen] = useState(false);
  const [gapBusy, setGapBusy] = useState(false);
  const [gapDraft, setGapDraft] = useState({ title: '', url: '', officialNumber: '', sourceType: 'law', body: '' });

  const run = trpc.legalResearch.run.useMutation();
  const saveMemo = trpc.legalResearch.saveMemo.useMutation();

  const submit = async () => {
    if (!canUse) return toast.error('مركز البحث متاح للمحامي ومدير المكتب فقط.');
    if (question.trim().length < 10) return toast.error('اكتب سؤالاً قانونياً واضحاً (10 أحرف على الأقل).');
    try {
      const output = await run.mutateAsync({
        accessToken,
        question,
        disputeType: (disputeType || undefined) as 'civil' | 'commercial' | 'criminal' | 'labor' | 'family' | 'administrative' | 'other' | undefined,
        caseId: caseId !== 'none' ? caseId : undefined,
      });
      setResult(output as ResearchResult);
      toast.success((output as ResearchResult).gap ? 'أُعلنت فجوة البحث بلا توليد.' : 'تم إعداد مذكرة البحث الموثقة.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تنفيذ البحث.');
    }
  };

  const confirmSaveMemo = async () => {
    if (!result?.answer || !result.citations.length) return;
    if (caseId === 'none') return toast.error('اختر قضية لربط المذكرة قبل الحفظ.');
    const memoMarkdown = [
      `## ملخص\n${result.answer.summary}`,
      `## القاعدة\n${result.answer.rule}`,
      result.answer.exceptions.length ? `## الاستثناءات\n- ${result.answer.exceptions.join('\n- ')}` : '',
      result.answer.application.length ? `## عناصر الانطباق\n- ${result.answer.application.join('\n- ')}` : '',
      result.answer.uncertainties.length ? `## نقاط عدم اليقين\n- ${result.answer.uncertainties.join('\n- ')}` : '',
    ].filter(Boolean).join('\n\n');
    if (!confirm(`سيتم حفظ مذكرة البحث و${result.citations.length} استشهاداً بملف القضية بعد مراجعتك. هل تريد المتابعة؟`)) return;
    setSavingMemo(true);
    try {
      await saveMemo.mutateAsync({
        accessToken,
        caseId,
        question,
        memoMarkdown,
        citations: result.citations.map(citation => ({
          sectionId: citation.id,
          excerpt: citation.excerpt.slice(0, 2000),
          relevanceScore: citation.relevanceScore,
          rationale: citation.articleNumber ? `مادة ${citation.articleNumber} من ${citation.title}` : citation.title,
        })),
        precedentIds: result.precedentCitations.map(precedent => precedent.id),
      });
      toast.success('حُفظت مذكرة البحث ونتائجها بملف القضية.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ المذكرة.');
    } finally {
      setSavingMemo(false);
    }
  };

  const submitGapSource = async () => {
    if (!officeId) return toast.error('لا يمكن تحديد مكتبك الحالي.');
    var pattern = /^https?:\/\/.+$/;
    if (gapDraft.title.trim().length < 5 || !pattern.test(gapDraft.url.trim()) || gapDraft.body.trim().length < 80) {
      return toast.error('أكمل العنوان ورابطاً رسمياً صحيحاً ونصاً لا يقل عن 80 حرفاً.');
    }
    setGapBusy(true);
    try {
      const { data: created, error: sourceError } = await supabase.from('legal_sources')
        .insert({ office_id: officeId, source_type: gapDraft.sourceType, title: gapDraft.title.trim(), official_number: gapDraft.officialNumber.trim() || null, source_url: gapDraft.url.trim(), is_current: true })
        .select('id').single();
      if (sourceError || !created?.id) throw new Error(sourceError?.message ?? 'تعذر إنشاء المصدر.');
      const { error: sectionError } = await supabase.from('legal_source_sections')
        .insert({ source_id: created.id, section_order: 0, article_number: 'النص الكامل', heading: 'النص الكامل', body: gapDraft.body.trim() });
      if (sectionError) throw new Error(sectionError.message);
      setGapFormOpen(false);
      setGapDraft({ title: '', url: '', officialNumber: '', sourceType: 'law', body: '' });
      toast.success('أُضيف المصدر إلى مكتبة مكتبكم — أعد تنفيذ البحث ليجده.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إضافة المصدر.');
    } finally {
      setGapBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <p className="text-xs tracking-[.15em] font-bold text-[#b58524]">المنتج الأول</p>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1 text-[#153a36]">مركز البحث القانوني الموثق</h1>
          <p className="text-sm leading-6 text-muted-foreground mt-2 max-w-2xl">إجابات مستشهد بها من التشريعات والأحكام المسجلة حصراً؛ وكل اقتباس حرفي يمر ببوابة تحقق آلية، وإذا قصرت الأدلة أُعلنت فجوة البحث بدل توليد إجابة بلا مصدر.</p>
        </div>
      </div>

      <div className="grid xl:grid-cols-[.85fr_1.15fr] gap-5">
        <Card className="border-0 shadow-sm h-fit">
          <CardHeader>
            <CardTitle className="text-lg text-[#153a36] flex gap-2"><SearchCheck className="h-5 w-5 text-[#b58524]" />سؤال البحث</CardTitle>
            <CardDescription>كل نتيجة تعرض مصدرها ورابطها وتاريخ سريانها ودرجة صلتها.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>السؤال القانوني</Label>
              <Textarea value={question} onChange={e => setQuestion(e.target.value)} className="min-h-32 leading-7" placeholder="مثال: ما ميعاد الطعن بالنقض في الأحكام المدنية القطري؟" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>نوع النزاع (اختياري)</Label>
                <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={disputeType} onChange={e => setDisputeType(e.target.value)}>
                  <option value="">غير محدد</option>
                  <option value="civil">مدني</option>
                  <option value="commercial">تجاري</option>
                  <option value="criminal">جنائي</option>
                  <option value="labor">عمالي</option>
                  <option value="family">أسرة</option>
                  <option value="administrative">إداري</option>
                  <option value="other">آخر</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>القضية المرتبطة</Label>
                <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={caseId} onChange={e => setCaseId(e.target.value)}>
                  <option value="none">بحث عام</option>
                  {cases.map(item => <option key={item.id} value={item.id}>{item.case_number} — {item.title}</option>)}
                </select>
              </div>
            </div>
            <Button disabled={run.isPending || !canUse} onClick={submit} className="w-full h-11 bg-[#0d3b36]">
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              {run.isPending ? 'يجري البحث في المصادر الموثقة…' : 'بحث وإعداد المذكرة'}
            </Button>
            {!canUse && <p className="text-xs bg-amber-50 text-amber-700 p-3 rounded-lg">هذه المساحة مخصصة للمحامين ومدير المكتب.</p>}
            <p className="text-xs leading-5 text-muted-foreground">النتائج مذكرة بحث أولية للمحامي المراجع وليست رأياً قانونياً نهائياً.</p>
          </CardContent>
        </Card>

        <div className="space-y-5">
          {!result && (
            <Card className="border border-dashed bg-white/50">
              <CardContent className="py-12 text-center">
                <BookOpenText className="h-8 w-8 mx-auto text-[#1b6258] opacity-60" />
                <p className="font-semibold mt-4 text-[#153a36]">ابدأ بسؤال محدد</p>
                <p className="text-sm text-muted-foreground mt-1 px-6">ستظهر هنا القاعدة والاستثناءات وعناصر الانطباق والاستشهادات المتحقق منها.</p>
              </CardContent>
            </Card>
          )}

          {result?.gap && (
            <Card className="border-0 shadow-sm border-r-4 border-r-amber-400">
              <CardHeader><CardTitle className="text-lg text-[#153a36] flex gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" />فجوة بحث — لا أدلة كافية</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-7">{result.limitations}</p>
                {canManage && officeId && !gapFormOpen && (
                  <Button size="sm" variant="outline" onClick={() => setGapFormOpen(true)}>سد الفجوة بإضافة مصدر رسمي</Button>
                )}
                {canManage && officeId && gapFormOpen && (
                  <div className="rounded-xl border border-[#e5ece9] bg-white p-4 space-y-3 text-right">
                    <p className="text-sm font-bold text-[#153a36]">إضافة مصدر رسمي إلى مكتبة المكتب</p>
                    <p className="text-[11px] text-muted-foreground leading-5">يلزم رابط رسمي ونص حرفي — لا يُعتمد نص بلا رابط، وسيخضع كل استشهاد مستقبلي لبوابة التحقق.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="عنوان المصدر" value={gapDraft.title} onChange={e => setGapDraft(d => ({ ...d, title: e.target.value }))} />
                      <Input dir="ltr" placeholder="https://..." value={gapDraft.url} onChange={e => setGapDraft(d => ({ ...d, url: e.target.value }))} />
                      <Input placeholder="الرقم/الرمز (اختياري)" value={gapDraft.officialNumber} onChange={e => setGapDraft(d => ({ ...d, officialNumber: e.target.value }))} />
                      <select className="h-9 rounded-md border bg-background px-3 text-sm" value={gapDraft.sourceType} onChange={e => setGapDraft(d => ({ ...d, sourceType: e.target.value }))}>
                        <option value="law">قانون</option><option value="regulation">لائحة</option><option value="decree">مرسوم</option><option value="ministerial_decision">قرار وزاري</option><option value="judgment">حكم</option><option value="guide">دليل</option>
                      </select>
                    </div>
                    <Textarea className="min-h-40 leading-7" placeholder="النص الحرفي الكامل (80 حرفاً على الأقل)…" value={gapDraft.body} onChange={e => setGapDraft(d => ({ ...d, body: e.target.value }))} />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setGapFormOpen(false)}>إلغاء</Button>
                      <Button size="sm" className="bg-[#0d3b36]" disabled={gapBusy} onClick={submitGapSource}>{gapBusy ? 'يجري الحفظ…' : 'إضافة المصدر'}</Button>
                    </div>
                  </div>
                )}
                <div>
                  <p className="font-semibold text-sm mb-2">استعلامات مقترحة لسد الفجوة:</p>
                  <ul className="space-y-2">{result.suggestedFollowUps.map((item, index) => <li key={index} className="p-3 rounded-xl bg-amber-50 text-sm">{item}</li>)}</ul>
                </div>
              </CardContent>
            </Card>
          )}

          {result && !result.gap && result.answer && (
            <>
              <Card className="border-0 shadow-sm">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-lg text-[#153a36]">مذكرة البحث</CardTitle>
                  <Badge variant="outline" className={result.verification.passed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
                    {result.verification.passed ? <ShieldCheck className="inline h-3.5 w-3.5 ml-1" /> : <ShieldAlert className="inline h-3.5 w-3.5 ml-1" />}
                    {result.verification.passed ? 'كل الاستشهادات متحققة' : `${result.verification.unverifiedQuotes.length + result.verification.unverifiedArticles.length} إشارة غير موثقة معلَّمة`}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div><p className="font-semibold text-sm text-[#1b6258] mb-1">الملخص</p><p className="text-sm leading-8">{result.answer.summary}</p></div>
                  <div><p className="font-semibold text-sm text-[#1b6258] mb-1">القاعدة</p><p className="text-sm leading-8">{result.answer.rule}</p></div>
                  {result.answer.exceptions.length > 0 && <div><p className="font-semibold text-sm text-[#1b6258] mb-1">الاستثناءات</p><ul className="list-disc list-inside text-sm leading-7 space-y-1">{result.answer.exceptions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                  {result.answer.application.length > 0 && <div><p className="font-semibold text-sm text-[#1b6258] mb-1">عناصر الانطباق</p><ul className="list-disc list-inside text-sm leading-7 space-y-1">{result.answer.application.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                  {result.answer.uncertainties.length > 0 && <div className="p-3 rounded-xl bg-slate-50"><p className="font-semibold text-sm text-[#1b6258] mb-1">نقاط عدم اليقين</p><ul className="list-disc list-inside text-sm leading-7 space-y-1">{result.answer.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
                  {result.answer.gapDeclaration && <p className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs leading-6 text-amber-800">فجوة جزئية: {result.answer.gapDeclaration}</p>}
                  {result.verification.unverifiedQuotes.length > 0 && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-100">
                      <p className="font-semibold text-xs text-rose-700 mb-1">اقتباسات لم تجتز التحقق الحرفي (غير موثقة):</p>
                      <ul className="text-xs leading-6 text-rose-700 list-disc list-inside">{result.verification.unverifiedQuotes.map((quote, index) => <li key={index}>{quote}</li>)}</ul>
                      {result.verification.unverifiedArticles.length > 0 && <p className="text-xs text-rose-700 mt-1">أرقام مواد غير موجودة في السياق المسترجع: {result.verification.unverifiedArticles.join('، ')}</p>}
                    </div>
                  )}
                  <p className="text-xs leading-6 text-muted-foreground border-t pt-3">{result.limitations}</p>
                  <Button onClick={confirmSaveMemo} disabled={savingMemo || caseId === 'none'} className="bg-[#0d3b36]">
                    {savingMemo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    حفظ المذكرة بملف القضية (يتطلب موافقتك)
                  </Button>
                  {caseId === 'none' && <p className="text-xs text-muted-foreground">اختر قضية من نموذج البحث لتفعيل الحفظ بملفها.</p>}
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm">
                <CardHeader><CardTitle className="text-base text-[#153a36]">المصادر المستشهد بها</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {result.citations.map(citation => (
                    <a key={citation.id} href={citation.url} target="_blank" rel="noreferrer" className="block p-3 rounded-xl bg-[#f4f7f5] hover:bg-[#eaf3ef]">
                      <div className="flex justify-between gap-2">
                        <p className="font-semibold text-sm text-[#1b6258]">{citation.title}</p>
                        <Badge variant="outline" className="shrink-0 text-[10px]">صلة {Math.round(citation.relevanceScore * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{citation.officialNumber || 'مصدر رسمي'}{citation.articleNumber ? ` · ${citation.articleNumber}` : ''}{citation.effectiveOn ? ` · نافذ من ${citation.effectiveOn}` : ''}</p>
                      {citation.isCurrent === false && <p className="text-[11px] text-amber-700 mt-1">تنبيه: النص غير ساري (نسخة تاريخية) — تحقق قبل الاستناد.</p>}
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{citation.excerpt}</p>
                    </a>
                  ))}
                  {result.precedentCitations.map(precedent => (
                    <a key={precedent.id} href={precedent.url} target="_blank" rel="noreferrer" className="block p-3 rounded-xl border hover:bg-[#f8fbfa]">
                      <div className="flex justify-between gap-3">
                        <p className="font-semibold text-sm text-[#153a36]">{precedent.title}</p>
                        <Badge variant="outline" className="shrink-0 text-[10px]">صلة {Math.round(precedent.relevanceScore * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{precedent.courtName} · {precedent.referenceNumber || 'مرجع غير منشور'} · {precedent.decidedOn || '—'}</p>
                    </a>
                  ))}
                  {!result.citations.length && !result.precedentCitations.length && <p className="text-sm text-muted-foreground">لم يُعتمد مصدر في هذه النتيجة.</p>}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
