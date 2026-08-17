import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { diffLines, summarizeDiff } from '@shared/contractDiff';
import { downloadPdf, downloadWord } from '@/lib/document-export';
import { ArrowRightLeft, CheckCircle2, Download, FileSignature, GitCompareArrows, History, Loader2, Save, Send, ShieldAlert, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export type StudioCaseOption = { id: string; case_number: string; title: string };
export type StudioClientOption = { id: string; full_name: string };

type TemplateVariable = { key: string; label_ar: string; type: string; required?: boolean };
type StudioTemplate = {
  id: string; code: string; titleAr: string; descriptionAr: string | null; documentType: string; jurisdiction: string;
  variables: TemplateVariable[];
  clauses: { id: string; code: string; titleAr: string; bodyTemplate: string; clauseOrder: number; riskLevel: 'low' | 'medium' | 'high'; legalBasisNote: string | null; isOptional: boolean }[];
};
type ClauseDecision = { code: string; title: string; included: boolean; reason: string; edits: string };
type ContractRisk = { title: string; severity: 'مرتفع' | 'متوسط' | 'منخفض'; mitigation: string; legalBasis: string };
type StatuteCitation = { label: string; verifiedAgainstRegister: boolean; note: string };
type GeneratedContract = {
  documentId: string; version: number; draft: string; clauseDecisions: ClauseDecision[];
  risks: ContractRisk[]; clarificationQuestions: string[]; statuteCitations: StatuteCitation[];
  verification: { unverifiedQuotes: string[]; passed: boolean };
};
type ContractDocument = { id: string; title: string; status: 'draft' | 'in_review' | 'approved' | 'ready_for_export'; current_version: number; case_id: string | null; client_id: string | null; created_at: string };
type ContractVersion = { id: string; version_number: number; content: string; clause_registry: ClauseDecision[]; risks: ContractRisk[]; citations: StatuteCitation[]; clarification_questions: string[]; created_at: string };

const STATUS_LABELS: Record<ContractDocument['status'], string> = { draft: 'مسودة', in_review: 'مراجعة محامٍ', approved: 'معتمد داخلياً', ready_for_export: 'جاهز للتصدير' };
const STATUS_TONES: Record<ContractDocument['status'], string> = { draft: 'bg-slate-100 text-slate-700 border-slate-200', in_review: 'bg-blue-50 text-blue-700 border-blue-200', approved: 'bg-emerald-50 text-emerald-700 border-emerald-200', ready_for_export: 'bg-violet-50 text-violet-700 border-violet-200' };
const TRANSITIONS: Record<ContractDocument['status'], Array<{ to: ContractDocument['status']; label: string }>> = {
  draft: [{ to: 'in_review', label: 'إرسال إلى مراجعة محامٍ' }],
  in_review: [{ to: 'approved', label: 'اعتماد داخلي' }, { to: 'draft', label: 'إعادة إلى مسودة' }],
  approved: [{ to: 'ready_for_export', label: 'وسم جاهز للتصدير' }],
  ready_for_export: [],
};

export default function ContractStudio({ accessToken, cases, clients, canUse }: { accessToken: string; cases: StudioCaseOption[]; clients: StudioClientOption[]; canUse: boolean }) {
  const [templates, setTemplates] = useState<StudioTemplate[]>([]);
  const [templateCode, setTemplateCode] = useState('');
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState('');
  const [caseId, setCaseId] = useState('none');
  const [clientId, setClientId] = useState('none');
  const [generated, setGenerated] = useState<GeneratedContract | null>(null);
  const [documents, setDocuments] = useState<ContractDocument[]>([]);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<ContractDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [compareFrom, setCompareFrom] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(false);
  const templatesQuery = trpc.contractStudio.templates.useQuery({ accessToken }, { staleTime: 300_000 });
  const generate = trpc.contractStudio.generate.useMutation();
  const saveVersion = trpc.contractStudio.saveVersion.useMutation();
  const transition = trpc.contractStudio.transition.useMutation();

  useEffect(() => { if (templatesQuery.data) setTemplates(templatesQuery.data as StudioTemplate[]); }, [templatesQuery.data]);

  const loadDocuments = async () => {
    setLoadingDocs(true);
    const { data, error } = await supabase.from('contract_documents').select('id,title,status,current_version,case_id,client_id,created_at').order('created_at', { ascending: false }).limit(30);
    if (!error) setDocuments((data ?? []) as ContractDocument[]);
    setLoadingDocs(false);
  };
  useEffect(() => { loadDocuments(); }, []);

  const openDocument = async (doc: ContractDocument) => {
    setSelectedDocument(doc);
    setGenerated(null);
    const { data } = await supabase.from('contract_document_versions').select('id,version_number,content,clause_registry,risks,citations,clarification_questions,created_at').eq('document_id', doc.id).order('version_number', { ascending: true });
    const list = (data ?? []) as ContractVersion[];
    setVersions(list);
    const current = list.find(version => version.version_number === doc.current_version) ?? list.at(-1) ?? null;
    setDraft(current?.content ?? '');
    setCompareFrom(list.length > 1 ? String(list[list.length - 2].version_number) : '');
  };

  const selectedTemplate = templates.find(item => item.code === templateCode);

  const runGenerate = async () => {
    if (!canUse) return toast.error('استديو العقود متاح للمحامي ومدير المكتب فقط.');
    if (!selectedTemplate) return toast.error('اختر قالباً معتمداً.');
    if (title.trim().length < 3) return toast.error('أدخل عنواناً للمستند.');
    const missing = selectedTemplate.variables.filter(variable => variable.required && !answers[variable.key]?.trim());
    if (missing.length) return toast.error(`أكمل الحقول الإلزامية: ${missing.map(variable => variable.label_ar).join('، ')}`);
    try {
      const result = await generate.mutateAsync({
        accessToken, templateCode, title,
        caseId: caseId !== 'none' ? caseId : undefined,
        clientId: clientId !== 'none' ? clientId : undefined,
        answers, instructions: instructions || undefined,
      });
      setGenerated(result as GeneratedContract);
      setDraft((result as GeneratedContract).draft);
      await loadDocuments();
      toast.success('أُعدت المسودة بحالة «مسودة» — مراجعة محامٍ مطلوبة قبل أي اعتماد.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر توليد المسودة.');
    }
  };

  const persistVersion = async () => {
    const doc = selectedDocument ?? (generated ? documents.find(item => item.id === generated.documentId) : null);
    if (!doc) return;
    try {
      const result = await saveVersion.mutateAsync({
        accessToken, documentId: doc.id, content: draft,
        clauseRegistry: generated?.clauseDecisions ?? versions.find(v => v.version_number === doc.current_version)?.clause_registry ?? [],
        risks: generated?.risks ?? [],
      });
      toast.success(`حُفظت النسخة ${result.version}.`);
      await openDocument({ ...doc, current_version: result.version });
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ النسخة.');
    }
  };

  const applyTransition = async (doc: ContractDocument, to: ContractDocument['status']) => {
    if (!confirm(`سيتم تغيير حالة «${doc.title}» إلى «${STATUS_LABELS[to]}» ويسجل ذلك في سجل الاعتماد. متابعة؟`)) return;
    try {
      await transition.mutateAsync({ accessToken, documentId: doc.id, to });
      toast.success(`أصبحت الحالة: ${STATUS_LABELS[to]}.`);
      await loadDocuments();
      if (selectedDocument?.id === doc.id) await openDocument({ ...doc, status: to });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تغيير الحالة.');
    }
  };

  const diff = useMemo(() => {
    if (!versions.length || !compareFrom) return null;
    const from = versions.find(version => String(version.version_number) === compareFrom);
    const to = versions.find(version => version.version_number === (selectedDocument?.current_version ?? versions.at(-1)?.version_number));
    if (!from || !to || from.id === to.id) return null;
    return { lines: diffLines(from.content, to.content), summary: summarizeDiff(diffLines(from.content, to.content)) };
  }, [versions, compareFrom, selectedDocument]);

  const activeDoc = selectedDocument ?? (generated ? documents.find(item => item.id === generated.documentId) ?? null : null);
  const activeClauses = generated?.clauseDecisions ?? versions.find(v => v.version_number === activeDoc?.current_version)?.clause_registry ?? [];
  const activeRisks = generated?.risks ?? versions.find(v => v.version_number === activeDoc?.current_version)?.risks ?? [];
  const activeCitations = generated?.statuteCitations ?? versions.find(v => v.version_number === activeDoc?.current_version)?.citations ?? [];

  return (
    <>
      <div className="mb-6">
        <p className="text-xs tracking-[.15em] font-bold text-[#b58524]">المنتج الثاني</p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-1 text-[#153a36]">استديو العقود والمذكرات</h1>
        <p className="text-sm leading-6 text-muted-foreground mt-2 max-w-2xl">قوالب معتمدة ومقابلة صياغة موجّهة، ومسودة مع سجل بنود ومخاطر وأساس قانوني، ودورة حياة: مسودة ← مراجعة محامٍ ← معتمد ← جاهز للتصدير. لا إرسال خارجي من المنصة.</p>
      </div>

      <div className="grid xl:grid-cols-[.9fr_1.1fr] gap-5">
        <div className="space-y-5">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg text-[#153a36] flex gap-2"><FileSignature className="h-5 w-5 text-[#b58524]" />مقابلة الصياغة</CardTitle>
              <CardDescription>ابدأ من قالب مكتب معتمد؛ المتغيرات الإلزامية تُجمع قبل التوليد.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>القالب المعتمد</Label>
                <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={templateCode} onChange={e => { setTemplateCode(e.target.value); setAnswers({}); }}>
                  <option value="">اختر قالباً</option>
                  {templates.map(template => <option key={template.code} value={template.code}>{template.titleAr}</option>)}
                </select>
                {selectedTemplate?.descriptionAr && <p className="text-xs text-muted-foreground leading-5">{selectedTemplate.descriptionAr}</p>}
              </div>
              <div className="space-y-2">
                <Label>عنوان المستند</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: اتفاقية خدمات — شركة الخليج" />
              </div>
              {selectedTemplate?.variables.map(variable => (
                <div key={variable.key} className="space-y-2">
                  <Label>{variable.label_ar}{variable.required ? ' *' : ''}</Label>
                  {variable.type === 'textarea'
                    ? <Textarea value={answers[variable.key] ?? ''} onChange={e => setAnswers(current => ({ ...current, [variable.key]: e.target.value }))} />
                    : <Input type={variable.type === 'date' ? 'date' : variable.type === 'number' ? 'number' : 'text'} value={answers[variable.key] ?? ''} onChange={e => setAnswers(current => ({ ...current, [variable.key]: e.target.value }))} />}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>القضية (اختياري)</Label>
                  <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={caseId} onChange={e => setCaseId(e.target.value)}>
                    <option value="none">غير مرتبط</option>
                    {cases.map(item => <option key={item.id} value={item.id}>{item.case_number}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>العميل (اختياري)</Label>
                  <select className="w-full h-10 rounded-lg border bg-background px-3 text-sm" value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="none">غير مرتبط</option>
                    {clients.map(item => <option key={item.id} value={item.id}>{item.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>تعليمات إضافية للمحامي</Label>
                <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} className="min-h-20" placeholder="متطلبات تجارية أو تحفظات يجب مراعاتها…" />
              </div>
              <Button onClick={runGenerate} disabled={generate.isPending || !canUse} className="w-full h-11 bg-[#0d3b36]">
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
                {generate.isPending ? 'يجري إعداد المسودة…' : 'توليد المسودة'}
              </Button>
              {!canUse && <p className="text-xs bg-amber-50 text-amber-700 p-3 rounded-lg">هذه المساحة مخصصة للمحامين ومدير المكتب.</p>}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base text-[#153a36] flex gap-2"><History className="h-4 w-4" />مستندات المكتب ودورة الاعتماد</CardTitle>
              <CardDescription>{loadingDocs ? 'يجري التحميل…' : `${documents.length} مستنداً`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {documents.map(doc => (
                <div key={doc.id} className={`rounded-xl border p-3 ${selectedDocument?.id === doc.id ? 'border-[#1b6258] bg-[#f0f7f4]' : ''}`}>
                  <div className="flex justify-between gap-2 items-start">
                    <button className="text-right flex-1" onClick={() => openDocument(doc)}>
                      <p className="font-semibold text-sm text-[#153a36]">{doc.title}</p>
                      <p className="text-xs text-muted-foreground mt-1">نسخة {doc.current_version}</p>
                    </button>
                    <Badge variant="outline" className={STATUS_TONES[doc.status]}>{STATUS_LABELS[doc.status]}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {TRANSITIONS[doc.status].map(option => (
                      <Button key={option.to} size="sm" variant="outline" disabled={transition.isPending} onClick={() => applyTransition(doc, option.to)}>
                        {option.to === 'in_review' ? <Send className="h-3.5 w-3.5" /> : option.to === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {!documents.length && !loadingDocs && <p className="text-sm text-muted-foreground">لا مستندات بعد؛ ابدأ بمقابلة الصياغة.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {activeDoc && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg text-[#153a36]">مسودة: {activeDoc.title}</CardTitle>
                  <CardDescription>النسخة {activeDoc.current_version} · {STATUS_LABELS[activeDoc.status]}</CardDescription>
                </div>
                {generated && !generated.verification.passed ? (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200"><ShieldAlert className="inline h-3.5 w-3.5 ml-1" />اقتباسات معلَّمة «غير موثقة»</Badge>
                ) : (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200"><ShieldCheck className="inline h-3.5 w-3.5 ml-1" />تحقق الاقتباسات سليم</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="min-h-[380px] leading-8 text-sm" />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={persistVersion} disabled={saveVersion.isPending || activeDoc.status === 'approved' || activeDoc.status === 'ready_for_export'} className="bg-[#0d3b36]">
                    {saveVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}حفظ كنسخة جديدة
                  </Button>
                  <Button variant="outline" onClick={() => downloadWord(activeDoc.title, draft)}><Download className="h-4 w-4" />Word</Button>
                  <Button variant="outline" onClick={() => downloadPdf(activeDoc.title, draft)}><Download className="h-4 w-4" />PDF</Button>
                  {generated?.clarificationQuestions.length ? <span className="text-xs text-muted-foreground self-center">{generated.clarificationQuestions.length} أسئلة استكمال مقترحة أدناه</span> : null}
                </div>
              </CardContent>
            </Card>
          )}

          {versions.length > 1 && (
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base text-[#153a36] flex gap-2"><GitCompareArrows className="h-4 w-4" />مقارنة النسخ</CardTitle>
                <div className="flex gap-2 items-center pt-2">
                  <select className="h-9 rounded-lg border bg-background px-3 text-sm" value={compareFrom} onChange={e => setCompareFrom(e.target.value)}>
                    {versions.slice(0, -1).map(version => <option key={version.id} value={version.version_number}>نسخة {version.version_number}</option>)}
                  </select>
                  <span className="text-xs text-muted-foreground">مقارنة مع النسخة {selectedDocument?.current_version}</span>
                  {diff && <Badge variant="outline">+{diff.summary.added} / -{diff.summary.removed}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                {diff ? (
                  <div className="rounded-xl border overflow-hidden max-h-72 overflow-y-auto text-xs leading-6" dir="rtl">
                    {diff.lines.map((line, index) => (
                      <div key={index} className={`px-3 py-0.5 whitespace-pre-wrap ${line.kind === 'added' ? 'bg-emerald-50 text-emerald-800' : line.kind === 'removed' ? 'bg-rose-50 text-rose-700 line-through' : 'text-muted-foreground'}`}>
                        {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '− ' : '  '}{line.text}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">اختر نسخة سابقة لعرض الفروق.</p>}
              </CardContent>
            </Card>
          )}

          {activeClauses.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-[#153a36]">سجل البنود وأسبابها</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {activeClauses.map(clause => (
                  <div key={clause.code} className="border-r-2 border-[#e8c377] pr-3">
                    <div className="flex justify-between gap-2">
                      <p className="font-semibold text-sm">{clause.title}</p>
                      <Badge variant="outline" className={clause.included ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{clause.included ? 'مدرج' : 'مستبعد'}</Badge>
                    </div>
                    <p className="text-xs leading-6 text-muted-foreground mt-1">{clause.reason}</p>
                    {clause.edits && <p className="text-xs leading-6 text-[#1b6258] mt-1">تعديلات: {clause.edits}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeRisks.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-[#153a36]">قائمة المخاطر والتخفيف</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {activeRisks.map((risk, index) => (
                  <div key={index} className="p-3 rounded-xl bg-[#fff8e8]">
                    <div className="flex justify-between gap-2"><p className="font-semibold text-sm">{risk.title}</p><Badge variant="outline" className="text-[10px]">{risk.severity}</Badge></div>
                    <p className="text-xs leading-6 mt-1">{risk.mitigation}</p>
                    <p className="text-xs leading-6 text-[#8d6515] mt-1">الأساس: {risk.legalBasis}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeCitations.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-[#153a36]">إشارات تشريعية</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {activeCitations.map((citation, index) => (
                  <div key={index} className="flex justify-between gap-2 items-start p-3 rounded-xl border">
                    <div>
                      <p className="text-sm font-medium">{citation.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{citation.note}</p>
                    </div>
                    <Badge variant="outline" className={citation.verifiedAgainstRegister ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}>
                      {citation.verifiedAgainstRegister ? 'متحقق' : 'يتطلب تحققاً'}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {generated?.clarificationQuestions.length ? (
            <Card className="border-0 shadow-sm">
              <CardHeader><CardTitle className="text-base text-[#153a36]">أسئلة استكمال قبل الاعتماد</CardTitle></CardHeader>
              <CardContent><ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">{generated.clarificationQuestions.map((item, index) => <li key={index}>{item}</li>)}</ol></CardContent>
            </Card>
          ) : null}

          {!activeDoc && (
            <Card className="border border-dashed bg-white/50">
              <CardContent className="py-12 text-center">
                <FileSignature className="h-8 w-8 mx-auto text-[#1b6258] opacity-60" />
                <p className="font-semibold mt-4 text-[#153a36]">لا مستند محدد بعد</p>
                <p className="text-sm text-muted-foreground mt-1 px-6">أكمل مقابلة الصياغة لتوليد مسودة، أو اختر مستنداً من القائمة لمراجعته واعتماده.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
