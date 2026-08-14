import { supabase } from '@/lib/supabase';
import { downloadInvoicePdf } from '@/lib/invoice-pdf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Download, FileText, Loader2, Pencil, Plus, ReceiptText, Settings2, WalletCards } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

type Office = { id: string; name: string; email: string | null; address: string | null };
type BillingSettings = { issuer_name: string; issuer_address: string | null; issuer_email: string | null; issuer_phone: string | null; tax_registration_number: string | null; invoice_prefix: string; default_tax_rate: number; currency: string };
type Invoice = { id: string; office_id: string; invoice_number: string; status: string; issued_at: string | null; due_at: string | null; currency: string; customer_name: string; customer_address: string | null; subtotal_amount: number; tax_amount: number; total_amount: number; paid_amount: number; balance_amount: number; notes: string | null; created_at: string };
type InvoiceItem = { description: string; quantity: number; unit_price: number; tax_rate: number; total_amount: number };

const labels: Record<string, string> = { draft: 'مسودة', issued: 'صادرة', partially_paid: 'مدفوعة جزئياً', paid: 'مدفوعة', void: 'ملغاة', overdue: 'متأخرة' };
const tones: Record<string, string> = { draft: 'bg-slate-100 text-slate-700', issued: 'bg-blue-50 text-blue-700 border-blue-200', partially_paid: 'bg-amber-50 text-amber-700 border-amber-200', paid: 'bg-emerald-50 text-emerald-700 border-emerald-200', void: 'bg-rose-50 text-rose-700 border-rose-200', overdue: 'bg-rose-50 text-rose-700 border-rose-200' };
const formatMoney = (value: number | string | null | undefined, currency = 'QAR') => new Intl.NumberFormat('ar-QA', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(value ?? 0));
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('ar-QA', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '—';

export default function InvoiceManager({ adminId, offices }: { adminId: string; offices: Office[] }) {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const load = async () => {
    setLoading(true);
    const [settingResult, invoiceResult] = await Promise.all([
      supabase.from('billing_settings').select('issuer_name,issuer_address,issuer_email,issuer_phone,tax_registration_number,invoice_prefix,default_tax_rate,currency').eq('id', true).maybeSingle(),
      supabase.from('saas_invoices').select('id,office_id,invoice_number,status,issued_at,due_at,currency,customer_name,customer_address,subtotal_amount,tax_amount,total_amount,paid_amount,balance_amount,notes,created_at').order('created_at', { ascending: false }),
    ]);
    if (settingResult.error || invoiceResult.error) toast.error('تعذر تحميل بيانات الفواتير.');
    setSettings(settingResult.data as BillingSettings | null);
    setInvoices((invoiceResult.data ?? []) as Invoice[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => ({
    issued: invoices.filter(item => ['issued', 'partially_paid', 'paid'].includes(item.status)).reduce((sum, item) => sum + Number(item.total_amount), 0),
    paid: invoices.reduce((sum, item) => sum + Number(item.paid_amount), 0),
    due: invoices.filter(item => !['paid', 'void'].includes(item.status)).reduce((sum, item) => sum + Number(item.balance_amount), 0),
  }), [invoices]);

  const writeAudit = async (action: string, invoice: { id: string; office_id: string; invoice_number: string }, metadata: Record<string, unknown>) => {
    await supabase.from('platform_audit_logs').insert({ actor_id: adminId, action, office_id: invoice.office_id, metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, ...metadata } });
  };

  const submitInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const officeId = String(form.get('office_id') || '');
    const description = String(form.get('description') || '').trim();
    const amount = Number(form.get('amount') || 0);
    const taxRate = Number(form.get('tax_rate') || 0);
    if (!officeId || !description || amount < 0 || taxRate < 0 || taxRate > 100) return toast.error('أدخل بيانات الفاتورة بصورة صحيحة.');
    setBusy(true);
    const { data: invoice, error } = await supabase.rpc('create_saas_invoice', { p_office_id: officeId, p_due_at: form.get('due_at') ? new Date(String(form.get('due_at'))).toISOString() : null, p_notes: form.get('notes') || null });
    if (error || !invoice) { toast.error(error?.message || 'تعذر إنشاء الفاتورة.'); setBusy(false); return; }
    const itemResult = await supabase.from('saas_invoice_items').insert({ invoice_id: invoice.id, description, quantity: 1, unit_price: amount, tax_rate: taxRate });
    if (itemResult.error) { toast.error(itemResult.error.message); setBusy(false); return; }
    await writeAudit('invoice_drafted', invoice, { amount, tax_rate: taxRate });
    toast.success('تم حفظ الفاتورة كمسودة. راجعها ثم اعتمدها للإصدار.');
    setShowNew(false);
    await load();
    setBusy(false);
  };

  const approveInvoice = async (invoice: Invoice) => {
    setBusy(true);
    const { error } = await supabase.from('saas_invoices').update({ status: 'issued', issued_at: new Date().toISOString() }).eq('id', invoice.id).eq('status', 'draft');
    if (error) toast.error(error.message);
    else { await writeAudit('invoice_issued', invoice, {}); toast.success('تم اعتماد الفاتورة وإصدارها.'); await load(); }
    setBusy(false);
  };

  const updateDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingInvoice) return;
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from('saas_invoices').update({ due_at: form.get('due_at') ? new Date(String(form.get('due_at'))).toISOString() : null, notes: form.get('notes') || null }).eq('id', editingInvoice.id).eq('status', 'draft');
    if (error) toast.error(error.message);
    else { await writeAudit('invoice_draft_updated', editingInvoice, {}); toast.success('تم تحديث مسودة الفاتورة.'); setEditingInvoice(null); await load(); }
  };

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentInvoice) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount') || 0);
    if (amount <= 0 || amount > Number(paymentInvoice.balance_amount)) return toast.error('قيمة التحصيل يجب أن تكون ضمن الرصيد المتبقي.');
    setBusy(true);
    const { error } = await supabase.from('saas_invoice_payments').insert({ invoice_id: paymentInvoice.id, amount, payment_method: 'cash', received_at: form.get('received_at') ? new Date(String(form.get('received_at'))).toISOString() : new Date().toISOString(), reference: form.get('reference') || null, notes: form.get('notes') || null, recorded_by: adminId });
    if (error) toast.error(error.message);
    else { await writeAudit('invoice_payment_recorded', paymentInvoice, { amount, payment_method: 'cash' }); toast.success('تم تسجيل التحصيل وتحديث الرصيد.'); setPaymentInvoice(null); await load(); }
    setBusy(false);
  };

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.from('billing_settings').update({ issuer_name: String(form.get('issuer_name') || ''), issuer_address: form.get('issuer_address') || null, issuer_email: form.get('issuer_email') || null, issuer_phone: form.get('issuer_phone') || null, tax_registration_number: form.get('tax_registration_number') || null, invoice_prefix: String(form.get('invoice_prefix') || 'INV'), default_tax_rate: Number(form.get('default_tax_rate') || 0) }).eq('id', true);
    if (error) toast.error(error.message);
    else { toast.success('تم حفظ إعدادات الفوترة.'); setShowSettings(false); await load(); }
  };

  const voidInvoice = async (invoice: Invoice) => {
    if (Number(invoice.paid_amount) > 0) return toast.error('لا يمكن إلغاء فاتورة لديها تحصيل مسجل.');
    const { error } = await supabase.from('saas_invoices').update({ status: 'void' }).eq('id', invoice.id);
    if (error) toast.error(error.message);
    else { await writeAudit('invoice_voided', invoice, {}); toast.success('تم إلغاء الفاتورة.'); await load(); }
  };

  const exportPdf = async (invoice: Invoice) => {
    if (!settings) return toast.error('أكمل إعدادات جهة إصدار الفاتورة أولاً.');
    const { data, error } = await supabase.from('saas_invoice_items').select('description,quantity,unit_price,tax_rate,total_amount').eq('invoice_id', invoice.id);
    if (error) return toast.error(error.message);
    const { data: payments } = await supabase.from('saas_invoice_payments').select('reference,received_at').eq('invoice_id', invoice.id).not('reference', 'is', null).order('received_at', { ascending: false }).limit(1);
    const pdfItems = ((data ?? []) as InvoiceItem[]).map(item => ({ description: item.description, quantity: Number(item.quantity), unitPrice: Number(item.unit_price), taxRate: Number(item.tax_rate), total: Number(item.total_amount) }));
    await downloadInvoicePdf({ invoiceNumber: invoice.invoice_number, status: labels[invoice.status] || invoice.status, issuedAt: invoice.issued_at || invoice.created_at, dueAt: invoice.due_at, currency: invoice.currency, customerName: invoice.customer_name, customerAddress: invoice.customer_address, subtotal: Number(invoice.subtotal_amount), tax: Number(invoice.tax_amount), total: Number(invoice.total_amount), paid: Number(invoice.paid_amount), balance: Number(invoice.balance_amount), notes: invoice.notes, paymentReference: payments?.[0]?.reference ?? null }, pdfItems, { name: settings.issuer_name, address: settings.issuer_address, email: settings.issuer_email, phone: settings.issuer_phone, taxNumber: settings.tax_registration_number });
    toast.success('تم إنشاء ملف PDF وتنزيله.');
  };

  if (loading) return <Card className="border-0 shadow-sm mt-6"><CardContent className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#1b6258]" /></CardContent></Card>;

  return <><Card className="border-0 shadow-sm mt-6 overflow-hidden" dir="rtl">
    <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><CardTitle className="text-xl text-[#153a36] flex items-center gap-2"><ReceiptText className="h-5 w-5 text-[#b58524]" />الفواتير الضريبية</CardTitle><CardDescription>إصدار فواتير الاشتراكات وتسجيل التحصيل اليدوي وتنزيل فاتورة PDF عربية.</CardDescription></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setShowSettings(true)}><Settings2 className="h-4 w-4" />إعدادات الفوترة</Button><Button className="bg-[#0d3b36]" onClick={() => setShowNew(true)}><Plus className="h-4 w-4" />فاتورة جديدة</Button></div>
    </CardHeader>
    <CardContent>
      <div className="grid sm:grid-cols-3 gap-3 mb-5">{[{ label: 'الفواتير الصادرة', value: totals.issued, tone: 'text-blue-700' }, { label: 'المحصل', value: totals.paid, tone: 'text-emerald-700' }, { label: 'المتبقي', value: totals.due, tone: 'text-amber-700' }].map(item => <div key={item.label} className="rounded-xl bg-[#f4f7f5] p-4"><p className="text-xs text-muted-foreground">{item.label}</p><p className={`font-bold mt-2 ${item.tone}`}>{formatMoney(item.value, settings?.currency)}</p></div>)}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-[#edf4f1] text-muted-foreground"><tr>{['الرقم', 'المكتب', 'الإصدار', 'الإجمالي', 'المدفوع / المتبقي', 'الحالة', 'الإجراءات'].map(item => <th key={item} className="p-4 text-right font-medium">{item}</th>)}</tr></thead><tbody className="divide-y">{invoices.map(invoice => <tr key={invoice.id} className="hover:bg-[#f8fbfa]"><td className="p-4 font-mono text-xs text-[#1b6258]">{invoice.invoice_number}</td><td className="p-4 font-semibold text-[#153a36]">{invoice.customer_name}</td><td className="p-4 text-muted-foreground">{formatDate(invoice.issued_at || invoice.created_at)}</td><td className="p-4 font-semibold">{formatMoney(invoice.total_amount, invoice.currency)}</td><td className="p-4"><p>{formatMoney(invoice.paid_amount, invoice.currency)}</p><p className="text-xs text-muted-foreground mt-1">متبقي: {formatMoney(invoice.balance_amount, invoice.currency)}</p></td><td className="p-4"><Badge variant="outline" className={tones[invoice.status]}>{labels[invoice.status] || invoice.status}</Badge></td><td className="p-4"><div className="flex gap-1 flex-wrap"><Button size="sm" variant="outline" onClick={() => exportPdf(invoice)}><Download className="h-4 w-4" />PDF</Button>{['issued', 'partially_paid', 'overdue'].includes(invoice.status) && <Button size="sm" variant="outline" className="text-[#1b6258]" onClick={() => setPaymentInvoice(invoice)}><WalletCards className="h-4 w-4" />تحصيل</Button>}{['draft', 'issued'].includes(invoice.status) && Number(invoice.paid_amount) === 0 && <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => voidInvoice(invoice)}>إلغاء</Button>}</div></td></tr>)}</tbody></table></div>
      {invoices.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground"><FileText className="h-7 w-7 mx-auto mb-3 text-[#1b6258]" />لا توجد فواتير صادرة حتى الآن.</div>}
    </CardContent>
    <Dialog open={showNew} onOpenChange={setShowNew}><DialogContent dir="rtl" className="max-w-xl"><DialogHeader><DialogTitle>إصدار فاتورة ضريبية</DialogTitle><DialogDescription>تُصدر فاتورة اشتراك ببند واحد مع حساب الضريبة وحفظها في السجل.</DialogDescription></DialogHeader><form className="grid grid-cols-2 gap-4" onSubmit={submitInvoice}><div className="col-span-2"><Label>المكتب المشترك</Label><select name="office_id" required className="w-full h-10 rounded-md border bg-background px-3"><option value="">اختر المكتب</option>{offices.map(office => <option key={office.id} value={office.id}>{office.name}</option>)}</select></div><div className="col-span-2"><Label>وصف الخدمة</Label><Input name="description" defaultValue="اشتراك منصة ميزان المكتب" required /></div><div><Label>المبلغ قبل الضريبة</Label><Input name="amount" type="number" min="0" step="0.01" required /></div><div><Label>نسبة الضريبة %</Label><Input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={settings?.default_tax_rate ?? 0} required /></div><div className="col-span-2"><Label>تاريخ الاستحقاق</Label><Input name="due_at" type="date" /></div><div className="col-span-2"><Label>ملاحظات</Label><Textarea name="notes" /></div><Button disabled={busy || offices.length === 0} className="col-span-2 bg-[#0d3b36]">{busy && <Loader2 className="h-4 w-4 animate-spin" />}إصدار الفاتورة</Button>{offices.length === 0 && <p className="col-span-2 text-xs text-amber-700">أنشئ مكتباً مشتركاً أولاً قبل إصدار الفاتورة.</p>}</form></DialogContent></Dialog>
    <Dialog open={showSettings} onOpenChange={setShowSettings}><DialogContent dir="rtl" className="max-w-xl"><DialogHeader><DialogTitle>بيانات مُصدر الفاتورة</DialogTitle><DialogDescription>نسبة الضريبة افتراضية وقابلة للمراجعة قبل إصدار كل فاتورة.</DialogDescription></DialogHeader><form className="grid grid-cols-2 gap-4" onSubmit={submitSettings}><div className="col-span-2"><Label>اسم الجهة</Label><Input name="issuer_name" defaultValue={settings?.issuer_name} required /></div><div><Label>البريد</Label><Input name="issuer_email" dir="ltr" defaultValue={settings?.issuer_email ?? ''} /></div><div><Label>الهاتف</Label><Input name="issuer_phone" dir="ltr" defaultValue={settings?.issuer_phone ?? ''} /></div><div><Label>الرقم الضريبي</Label><Input name="tax_registration_number" dir="ltr" defaultValue={settings?.tax_registration_number ?? ''} /></div><div><Label>بادئة الفاتورة</Label><Input name="invoice_prefix" dir="ltr" defaultValue={settings?.invoice_prefix} required /></div><div><Label>نسبة الضريبة الافتراضية %</Label><Input name="default_tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={settings?.default_tax_rate ?? 0} required /></div><div className="col-span-2"><Label>العنوان</Label><Textarea name="issuer_address" defaultValue={settings?.issuer_address ?? ''} /></div><Button className="col-span-2 bg-[#0d3b36]">حفظ الإعدادات</Button></form></DialogContent></Dialog>
    <Dialog open={Boolean(paymentInvoice)} onOpenChange={open => !open && setPaymentInvoice(null)}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>تسجيل تحصيل نقدي</DialogTitle><DialogDescription>{paymentInvoice?.invoice_number} · الرصيد {formatMoney(paymentInvoice?.balance_amount, paymentInvoice?.currency)}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submitPayment}><div><Label>المبلغ</Label><Input name="amount" type="number" min="0.01" max={paymentInvoice?.balance_amount} step="0.01" defaultValue={paymentInvoice?.balance_amount} required /></div><div><Label>تاريخ التحصيل</Label><Input name="received_at" type="datetime-local" /></div><div><Label>المرجع</Label><Input name="reference" placeholder="رقم إيصال أو حوالة" /></div><div><Label>ملاحظات</Label><Textarea name="notes" /></div><Button disabled={busy} className="w-full bg-[#0d3b36]">{busy && <Loader2 className="h-4 w-4 animate-spin" />}تسجيل التحصيل</Button></form></DialogContent></Dialog>
  </Card><DraftWorkflow invoices={invoices} adminId={adminId} onChanged={load} /></>;
}

function DraftWorkflow({ invoices, adminId, onChanged }: { invoices: Invoice[]; adminId: string; onChanged: () => Promise<void> }) {
  const drafts = invoices.filter(invoice => invoice.status === 'draft');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [draftItem, setDraftItem] = useState<{ id: string; description: string; unit_price: number; tax_rate: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const audit = async (action: string, invoice: Invoice) => supabase.from('platform_audit_logs').insert({ actor_id: adminId, action, office_id: invoice.office_id, metadata: { invoice_id: invoice.id, invoice_number: invoice.invoice_number } });
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget); setBusy(true);
    const invoiceUpdate = await supabase.from('saas_invoices').update({ due_at: form.get('due_at') ? new Date(String(form.get('due_at'))).toISOString() : null, notes: form.get('notes') || null }).eq('id', selected.id).eq('status', 'draft');
    const itemUpdate = draftItem ? await supabase.from('saas_invoice_items').update({ description: String(form.get('description') || ''), unit_price: Number(form.get('unit_price') || 0), tax_rate: Number(form.get('tax_rate') || 0) }).eq('id', draftItem.id).eq('invoice_id', selected.id) : { error: null };
    if (invoiceUpdate.error || itemUpdate.error) toast.error(invoiceUpdate.error?.message || itemUpdate.error?.message || 'تعذر تحديث المسودة.'); else { await audit('invoice_draft_updated', selected); toast.success('تم حفظ تعديلات المسودة والبند.'); setSelected(null); setDraftItem(null); await onChanged(); }
    setBusy(false);
  };
  const openEditor = async (invoice: Invoice) => {
    const { data, error } = await supabase.from('saas_invoice_items').select('id,description,unit_price,tax_rate').eq('invoice_id', invoice.id).limit(1).maybeSingle();
    if (error) return toast.error(error.message);
    setDraftItem(data as { id: string; description: string; unit_price: number; tax_rate: number } | null); setSelected(invoice);
  };
  const approve = async (invoice: Invoice) => {
    setBusy(true); const { error } = await supabase.from('saas_invoices').update({ status: 'issued', issued_at: new Date().toISOString() }).eq('id', invoice.id).eq('status', 'draft');
    if (error) toast.error(error.message); else { await audit('invoice_issued', invoice); toast.success('تم اعتماد الفاتورة وإصدارها.'); await onChanged(); }
    setBusy(false);
  };
  if (drafts.length === 0) return null;
  return <Card className="border-0 shadow-sm mt-6" dir="rtl"><CardHeader><CardTitle className="text-lg text-[#153a36]">مسودات بانتظار الاعتماد</CardTitle><CardDescription>راجع البند والقيمة والضريبة وتاريخ الاستحقاق، ثم اعتمد الفاتورة قبل التحصيل.</CardDescription></CardHeader><CardContent className="space-y-3">{drafts.map(invoice => <div key={invoice.id} className="flex flex-col gap-3 rounded-xl border bg-[#f8fbfa] p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-[#153a36]">{invoice.invoice_number} · {invoice.customer_name}</p><p className="text-xs text-muted-foreground mt-1">{formatMoney(invoice.total_amount, invoice.currency)} · استحقاق {formatDate(invoice.due_at)}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openEditor(invoice)}><Pencil className="h-4 w-4" />تحرير</Button><Button size="sm" disabled={busy} className="bg-[#0d3b36]" onClick={() => approve(invoice)}><CheckCircle2 className="h-4 w-4" />اعتماد وإصدار</Button></div></div>)}</CardContent><Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}><DialogContent dir="rtl" className="max-w-md"><DialogHeader><DialogTitle>تحرير مسودة الفاتورة</DialogTitle><DialogDescription>يمكن تعديل البند والقيمة والضريبة وبيانات المسودة قبل اعتمادها فقط.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={save}><div><Label>وصف البند</Label><Input name="description" defaultValue={draftItem?.description ?? ''} required /></div><div className="grid grid-cols-2 gap-3"><div><Label>المبلغ</Label><Input name="unit_price" type="number" min="0" step="0.01" defaultValue={draftItem?.unit_price ?? 0} required /></div><div><Label>الضريبة %</Label><Input name="tax_rate" type="number" min="0" max="100" step="0.01" defaultValue={draftItem?.tax_rate ?? 0} required /></div></div><div><Label>تاريخ الاستحقاق</Label><Input name="due_at" type="date" defaultValue={selected?.due_at ? selected.due_at.slice(0, 10) : ''} /></div><div><Label>ملاحظات</Label><Textarea name="notes" defaultValue={selected?.notes ?? ''} /></div><Button className="w-full bg-[#0d3b36]" disabled={busy}>حفظ التعديلات</Button></form></DialogContent></Dialog></Card>;
}
