import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc, trpcClient } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { downloadPdf, downloadWord } from '@/lib/document-export';
import { AlertTriangle, Bell, Clock, Download, FileText, Gavel, Hourglass, Loader2, Scale, ShieldAlert, ShieldCheck, Timer } from 'lucide-react';
import { toast } from 'sonner';

/**
 * ميزات المكتب القانونية المتقدمة:
 * - قوالب المذكرات (دفاع/رد/استئناف) مع تصدير Word/PDF
 * - فحص تعارض المصالح
 * - تتبع الوقت والفوترة لكل قضية
 * - متابعة التقادم
 * - إعدادات إشعارات الجلسات
 */

type MemoTemplate = {
  id: string; code: string; titleAr: string; descriptionAr: string | null; memoType: string; jurisdiction: string;
  variables: { key: string; label_ar: string; type: string; required?: boolean }[];
  sections: { id: string; code: string; titleAr: string; bodyTemplate: string; sectionOrder: number; isOptional: boolean }[];
};
type TimeEntry = { id: string; case_id: string; lawyer_id: string; started_at: string; ended_at: string | null; minutes: number; description: string | null; billable: boolean; hourly_rate: number };
type CaseInvoice = { id: string; invoice_number: string; status: string; issue_date: string; due_date: string | null; subtotal: number; tax_rate: number; tax_amount: number; total: number; paid_amount: number; notes: string | null };

const MEMO_TYPE_LABELS: Record<string, string> = { defense: 'دفاع', reply: 'رد', appeal: 'استئناف', general: 'عامة' };
const INVOICE_STATUS: Record<string, string> = { draft: 'مسودة', issued: 'صادرة', paid: 'مدفوعة', cancelled: 'ملغاة' };

export function MemoTemplatesPanel({ accessToken, caseId, officeId, profileId, practitioner }: { accessToken: string; caseId: string; officeId: string; profileId: string; practitioner: boolean }) {
  const [templates, setTemplates] = useState<MemoTemplate[]>([]);
  const [templateCode, setTemplateCode] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<{ templateCode: string; titleAr: string; body: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const templatesQuery = trpc.officeFeatures.memoTemplates.useQuery({ accessToken }, { staleTime: 300_000 });
  const renderMutation = trpc.officeFeatures.renderMemo.useMutation();

  useEffect(() => { if (templatesQuery.data) setTemplates(templatesQuery.data as MemoTemplate[]); }, [templatesQuery.data]);

  const selected = templates.find(item => item.code === templateCode);

  const runRender = async () => {
    if (!selected) return toast.error('اختر قالب مذكرة.');
    const missing = selected.variables.filter(variable => variable.required && !answers[variable.key]?.trim());
    if (missing.length) return toast.error(`أكمل الحقول الإلزامية: ${missing.map(variable => variable.label_ar).join('، ')}`);
    try {
      const result = await renderMutation.mutateAsync({ accessToken, templateCode, answers });
      setRendered(result as { templateCode: string; titleAr: string; body: string });
      setSaved(false);
      toast.success('أُعدت المذكرة من القالب.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إعداد المذكرة.');
    }
  };

  const saveToCase = async () => {
    if (!rendered) return;
    const { error } = await supabase.from('legal_drafts').insert({
      office_id: officeId, case_id: caseId,
      title: `${rendered.titleAr} — ${new Date().toLocaleDateString('ar-QA')}`,
      document_type: 'legal_memo', content: rendered.body, status: 'draft', created_by: profileId,
    });
    if (error) return toast.error(error.message);
    setSaved(true);
    toast.success('حُفظت المذكرة في ملف القضية.');
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><FileText className="h-5 w-5 text-[#b58524]" />قوالب المذكرات</CardTitle>
        <CardDescription>مذكرات دفاع ورد واستئناف ببنية قضائية معتمدة — املأ المتغيرات ثم صدّر Word/PDF أو احفظ في الملف.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>القالب</Label>
          <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={templateCode} onChange={e => { setTemplateCode(e.target.value); setAnswers({}); setRendered(null); }}>
            <option value="">اختر قالباً</option>
            {templates.map(template => <option key={template.code} value={template.code}>{template.titleAr} ({MEMO_TYPE_LABELS[template.memoType] ?? template.memoType})</option>)}
          </select>
          {selected?.descriptionAr && <p className="text-xs text-muted-foreground leading-5">{selected.descriptionAr}</p>}
        </div>
        {selected?.variables.map(variable => (
          <div key={variable.key} className="space-y-2">
            <Label>{variable.label_ar}{variable.required ? ' *' : ''}</Label>
            {variable.type === 'textarea'
              ? <Textarea value={answers[variable.key] ?? ''} onChange={e => setAnswers(current => ({ ...current, [variable.key]: e.target.value }))} className="min-h-20" />
              : <Input value={answers[variable.key] ?? ''} onChange={e => setAnswers(current => ({ ...current, [variable.key]: e.target.value }))} />}
          </div>
        ))}
        <Button onClick={runRender} disabled={renderMutation.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {renderMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}إعداد المذكرة من القالب
        </Button>
        {rendered && (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#e5ece9] bg-[#f8fbfa] p-4 text-sm leading-8 whitespace-pre-wrap max-h-80 overflow-y-auto">{rendered.body}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadWord(rendered.titleAr, rendered.body)}><Download className="h-3.5 w-3.5" />Word</Button>
              <Button size="sm" variant="outline" onClick={() => downloadPdf(rendered.titleAr, rendered.body)}><Download className="h-3.5 w-3.5" />PDF</Button>
              <Button size="sm" className="bg-[#0d3b36]" onClick={saveToCase} disabled={saved}>{saved ? 'حُفظت ✓' : 'حفظ في ملف القضية'}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConflictCheckPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [partyName, setPartyName] = useState('');
  const [partyIdentifier, setPartyIdentifier] = useState('');
  const [result, setResult] = useState<{ verdict: 'clear' | 'conflict' | 'review'; matches: Array<{ caseId: string; caseNumber: string; caseTitle: string; partyName: string; partyType: string | null; field: string }> } | null>(null);
  const check = trpc.officeFeatures.checkConflict.useMutation();

  const runCheck = async () => {
    if (partyName.trim().length < 2) return toast.error('أدخل اسم الطرف للفحص.');
    try {
      const outcome = await check.mutateAsync({ accessToken, partyName, partyIdentifier: partyIdentifier || undefined, caseId });
      setResult(outcome as typeof result);
      if (outcome.verdict === 'clear') toast.success('لا تعارض مصالح — الطرف غير موجود في قضايا المكتب.');
      else if (outcome.verdict === 'conflict') toast.error('تنبيه: تعارض مصالح محتمل!');
      else toast.warning('نتيجة تحتاج مراجعة يدوية.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إجراء الفحص.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Scale className="h-5 w-5 text-[#b58524]" />فحص تعارض المصالح</CardTitle>
        <CardDescription>فحص تلقائي ضد أطراف القضايا الحالية (الأسماء والهويات والسجلات التجارية) قبل قبول تمثيل طرف جديد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label>اسم الطرف الجديد</Label>
          <Input value={partyName} onChange={e => setPartyName(e.target.value)} placeholder="مثال: شركة الخليج للتجارة" />
        </div>
        <div className="space-y-2">
          <Label>رقم الهوية / السجل التجاري (اختياري)</Label>
          <Input dir="ltr" value={partyIdentifier} onChange={e => setPartyIdentifier(e.target.value)} placeholder="QID أو CR" />
        </div>
        <Button onClick={runCheck} disabled={check.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {check.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}فحص التعارض
        </Button>
        {result && (
          <div className={`rounded-xl p-4 text-sm leading-6 ${result.verdict === 'clear' ? 'bg-emerald-50 text-emerald-800' : result.verdict === 'conflict' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
            <p className="font-bold flex items-center gap-2">
              {result.verdict === 'clear' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              {result.verdict === 'clear' ? 'لا تعارض — يمكن قبول التمثيل' : result.verdict === 'conflict' ? 'تعارض مصالح محتمل' : 'يحتاج مراجعة يدوية'}
            </p>
            {result.matches.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {result.matches.map((match, index) => (
                  <li key={index} className="text-xs">«{match.partyName}» ({match.partyType}) — قضية {match.caseNumber}: {match.caseTitle} — تطابق {match.field === 'name' ? 'بالاسم' : match.field === 'national_id' ? 'بالهوية' : 'بالسجل التجاري'}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TimeTrackingPanel({ accessToken, caseId, practitioner }: { accessToken: string; caseId: string; practitioner: boolean }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [minutes, setMinutes] = useState('30');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  const [hourlyRate, setHourlyRate] = useState('0');
  const [invoices, setInvoices] = useState<CaseInvoice[]>([]);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [taxRate, setTaxRate] = useState('0');
  const addEntry = trpc.officeFeatures.addTimeEntry.useMutation();
  const createInvoice = trpc.officeFeatures.createCaseInvoice.useMutation();

  const load = async () => {
    const [entriesResult, invoicesResult] = await Promise.all([
      trpcClient.officeFeatures.listTimeEntries.query({ accessToken, caseId }).catch(() => [] as TimeEntry[]),
      trpcClient.officeFeatures.listCaseInvoices.query({ accessToken, caseId }).catch(() => [] as CaseInvoice[]),
    ]);
    setEntries(entriesResult as TimeEntry[]);
    setInvoices(invoicesResult as CaseInvoice[]);
  };
  useEffect(() => { load(); }, [caseId]);

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
  const billableValue = entries.filter(entry => entry.billable).reduce((sum, entry) => sum + entry.minutes * (entry.hourly_rate / 60), 0);

  const submitEntry = async () => {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 1) return toast.error('أدخل عدد دقائق صحيحاً.');
    try {
      await addEntry.mutateAsync({ accessToken, caseId, minutes: value, description: description || undefined, billable, hourlyRate: Number(hourlyRate) || 0 });
      setDescription(''); setMinutes('30');
      toast.success('سُجلت ساعات العمل.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الوقت.');
    }
  };

  const submitInvoice = async () => {
    if (!invoiceNumber.trim()) return toast.error('أدخل رقم الفاتورة.');
    const billableEntries = entries.filter(entry => entry.billable);
    if (!billableEntries.length) return toast.error('لا توجد ساعات قابلة للفوترة — سجل ساعات أولاً.');
    try {
      const result = await createInvoice.mutateAsync({
        accessToken, caseId, invoiceNumber: invoiceNumber.trim(), taxRate: Number(taxRate) || 0,
        items: billableEntries.map(entry => ({
          description: entry.description ?? 'ساعات عمل محاماة',
          quantity: entry.minutes / 60,
          unitPrice: entry.hourly_rate,
          timeEntryId: entry.id,
        })),
      });
      toast.success(`أُنشئت الفاتورة بإجمالي ${new Intl.NumberFormat('ar-QA', { style: 'currency', currency: 'QAR' }).format((result as { total: number }).total)}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء الفاتورة.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Timer className="h-5 w-5 text-[#b58524]" />تتبع الوقت والفوترة</CardTitle>
        <CardDescription>سجل ساعات المحامي لكل قضية واربطها بفواتير قابلة للتحصيل.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>المدة (دقائق)</Label>
            <Input type="number" min="1" value={minutes} onChange={e => setMinutes(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>سعر الساعة (ريال)</Label>
            <Input type="number" min="0" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>وصف العمل</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="مثال: مراجعة صحيفة الدعوى وإعداد مذكرة الرد" />
        </div>
        <label className="flex items-center gap-2.5 text-sm font-semibold text-[#153a36]">
          <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="h-4 w-4 accent-[#0d3b36]" />
          ساعات قابلة للفوترة
        </label>
        <Button onClick={submitEntry} disabled={addEntry.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {addEntry.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}تسجيل الساعات
        </Button>
        <div className="rounded-xl bg-[#f4f7f5] p-3 text-sm">
          <p className="font-semibold text-[#153a36]">الإجمالي: {Math.floor(totalMinutes / 60)} ساعة و{totalMinutes % 60} دقيقة</p>
          <p className="text-xs text-muted-foreground mt-1">قيمة الساعات القابلة للفوترة: {new Intl.NumberFormat('ar-QA', { style: 'currency', currency: 'QAR' }).format(billableValue)}</p>
        </div>
        {entries.length > 0 && (
          <div className="divide-y divide-[#f4f7f5] border rounded-xl max-h-48 overflow-y-auto">
            {entries.map(entry => (
              <div key={entry.id} className="px-3 py-2.5 flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#153a36] truncate">{entry.description ?? 'ساعات عمل'}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(entry.started_at).toLocaleDateString('ar-QA')}</p>
                </div>
                <Badge variant="outline" className="shrink-0">{entry.minutes} د {entry.billable ? `· ${entry.hourly_rate} ر.س/س` : '· غير قابلة'}</Badge>
              </div>
            ))}
          </div>
        )}
        <div className="border-t pt-4 space-y-3">
          <p className="text-sm font-bold text-[#153a36]">فواتير القضية</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>رقم الفاتورة</Label>
              <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="2026/001" />
            </div>
            <div className="space-y-2">
              <Label>نسبة الضريبة %</Label>
              <Input type="number" min="0" max="100" value={taxRate} onChange={e => setTaxRate(e.target.value)} />
            </div>
          </div>
          <Button onClick={submitInvoice} disabled={createInvoice.isPending || !practitioner} variant="outline" className="w-full h-10">
            {createInvoice.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}إنشاء فاتورة من الساعات القابلة للفوترة
          </Button>
          {invoices.length > 0 && (
            <div className="divide-y divide-[#f4f7f5] border rounded-xl">
              {invoices.map(invoice => (
                <div key={invoice.id} className="px-3 py-2.5 flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-[#153a36]">{invoice.invoice_number}</p>
                    <p className="text-[11px] text-muted-foreground">{new Intl.NumberFormat('ar-QA', { style: 'currency', currency: 'QAR' }).format(invoice.total)}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">{INVOICE_STATUS[invoice.status] ?? invoice.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function LimitationPanel({ accessToken, caseId, limitationDate, practitioner, onSaved }: { accessToken: string; caseId: string; limitationDate: string | null; practitioner: boolean; onSaved: () => void }) {
  const [date, setDate] = useState(limitationDate ?? '');
  const save = trpc.officeFeatures.setLimitationDate.useMutation();

  const daysLeft = limitationDate ? Math.ceil((new Date(limitationDate).getTime() - Date.now()) / 86400000) : null;
  const urgent = daysLeft !== null && daysLeft <= 180;

  const submit = async () => {
    try {
      await save.mutateAsync({ accessToken, caseId, limitationDate: date || null });
      toast.success(date ? 'حُفظ تاريخ التقادم — سيصلك تنبيه قبل 6 أشهر.' : 'أُزيل تاريخ التقادم.');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحفظ.');
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Hourglass className="h-5 w-5 text-[#b58524]" />متابعة التقادم</CardTitle>
        <CardDescription>تاريخ انقضاء الدعوى — تنبيه تلقائي قبل 6 أشهر من الموعد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {daysLeft !== null && (
          <div className={`rounded-xl p-3 text-sm font-semibold flex items-center gap-2 ${urgent ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>
            <AlertTriangle className="h-4 w-4" />
            {urgent ? `تنبيه: يتبقى ${daysLeft} يوماً على التقادم!` : `يتبقى ${daysLeft} يوماً على تاريخ التقادم.`}
          </div>
        )}
        <div className="space-y-2">
          <Label>تاريخ التقادم</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <Button onClick={submit} disabled={save.isPending || !practitioner} className="w-full h-10 bg-[#0d3b36]">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hourglass className="h-4 w-4" />}حفظ تاريخ التقادم
        </Button>
      </CardContent>
    </Card>
  );
}

export function NotificationPrefsPanel({ accessToken, manager }: { accessToken: string; manager: boolean }) {
  const [prefs, setPrefs] = useState<{ hearing_email: boolean; hearing_whatsapp: boolean; hearing_lead_days: number; limitation_email: boolean; limitation_lead_months: number } | null>(null);
  const save = trpc.officeFeatures.setNotificationPrefs.useMutation();

  useEffect(() => {
    trpcClient.officeFeatures.getNotificationPrefs.query({ accessToken }).then((result: unknown) => setPrefs(result as typeof prefs)).catch(() => undefined);
  }, [accessToken]);
  const submit = async () => {
    if (!prefs) return;
    try {
      await save.mutateAsync({
        accessToken,
        hearingEmail: prefs.hearing_email,
        hearingWhatsapp: prefs.hearing_whatsapp,
        hearingLeadDays: prefs.hearing_lead_days,
        limitationEmail: prefs.limitation_email,
        limitationLeadMonths: prefs.limitation_lead_months,
      });
      toast.success('حُفظت إعدادات الإشعارات.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحفظ.');
    }
  };

  if (!prefs) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><Bell className="h-5 w-5 text-[#b58524]" />إعدادات الإشعارات</CardTitle>
        <CardDescription>تذكيرات الجلسات والتقادم: داخلية دائماً + بريد/واتساب عند التفعيل.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2.5">
          <p className="text-sm font-bold text-[#153a36]">الجلسات</p>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-[#153a36]">
            <input type="checkbox" checked={prefs.hearing_email} onChange={e => setPrefs({ ...prefs, hearing_email: e.target.checked })} className="h-4 w-4 accent-[#0d3b36]" />
            بريد إلكتروني تلقائي قبل الجلسة
          </label>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-[#153a36]">
            <input type="checkbox" checked={prefs.hearing_whatsapp} onChange={e => setPrefs({ ...prefs, hearing_whatsapp: e.target.checked })} className="h-4 w-4 accent-[#0d3b36]" />
            واتساب تلقائي قبل الجلسة
          </label>
          <div className="space-y-1.5">
            <Label className="text-xs">الإشعار قبل (أيام)</Label>
            <Input type="number" min="1" max="14" value={prefs.hearing_lead_days} onChange={e => setPrefs({ ...prefs, hearing_lead_days: Number(e.target.value) || 1 })} />
          </div>
        </div>
        <div className="space-y-2.5 border-t pt-3">
          <p className="text-sm font-bold text-[#153a36]">التقادم</p>
          <label className="flex items-center gap-2.5 text-sm font-semibold text-[#153a36]">
            <input type="checkbox" checked={prefs.limitation_email} onChange={e => setPrefs({ ...prefs, limitation_email: e.target.checked })} className="h-4 w-4 accent-[#0d3b36]" />
            بريد إلكتروني عند اقتراب التقادم
          </label>
          <div className="space-y-1.5">
            <Label className="text-xs">التنبيه قبل (أشهر)</Label>
            <Input type="number" min="1" max="24" value={prefs.limitation_lead_months} onChange={e => setPrefs({ ...prefs, limitation_lead_months: Number(e.target.value) || 6 })} />
          </div>
        </div>
        <Button onClick={submit} disabled={save.isPending || !manager} className="w-full h-10 bg-[#0d3b36]">
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}حفظ الإعدادات
        </Button>
      </CardContent>
    </Card>
  );
}
