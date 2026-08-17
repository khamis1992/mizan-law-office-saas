import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { trpc, trpcClient } from '@/lib/trpc';
import { supabase } from '@/lib/supabase';
import { CheckCircle2, History, Loader2, MessageSquare, Send, Sparkles, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';

/**
 * المحرر التعاوني للمذكرات:
 * تعليقات ومراجعات داخل المسودة + سجل تغييرات + قوالب متكيفة + سير اعتماد تلقائي.
 */

type DraftComment = { id: string; author_id: string; content: string; resolved: boolean; created_at: string };
type DraftRevision = { id: string; author_id: string; change_summary: string | null; created_at: string };
type AdaptiveTemplate = { id: string; code: string; titleAr: string; memoType: string; usageCount: number; approvedCount: number; approvalRate: number };
type ApprovalWorkflow = { id: string; draft_id: string; current_step: string; created_at: string; updated_at: string };

const STEP_LABELS: Record<string, string> = { lawyer_review: 'مراجعة محامٍ', manager_review: 'مراجعة مدير', approved: 'معتمد', rejected: 'مرفوض' };

export function CollaborativeDraftPanel({ accessToken, draftId, profileId, practitioner, manager }: { accessToken: string; draftId: string; profileId: string; practitioner: boolean; manager: boolean }) {
  const [comments, setComments] = useState<DraftComment[]>([]);
  const [revisions, setRevisions] = useState<DraftRevision[]>([]);
  const [commentText, setCommentText] = useState('');
  const [workflow, setWorkflow] = useState<ApprovalWorkflow | null>(null);
  const [busy, setBusy] = useState(false);
  const addComment = trpc.collaborativeDrafting.comments.add.useMutation();
  const resolveComment = trpc.collaborativeDrafting.comments.resolve.useMutation();
  const startWorkflow = trpc.collaborativeDrafting.approvals.start.useMutation();
  const advanceWorkflow = trpc.collaborativeDrafting.approvals.advance.useMutation();

  const load = async () => {
    const [commentsResult, revisionsResult, workflowsResult] = await Promise.all([
      trpcClient.collaborativeDrafting.comments.list.query({ accessToken, draftId }).catch(() => [] as DraftComment[]),
      trpcClient.collaborativeDrafting.revisions.list.query({ accessToken, draftId }).catch(() => [] as DraftRevision[]),
      trpcClient.collaborativeDrafting.approvals.list.query({ accessToken, status: 'all' }).catch(() => [] as ApprovalWorkflow[]),
    ]);
    setComments(commentsResult as DraftComment[]);
    setRevisions(revisionsResult as DraftRevision[]);
    setWorkflow((workflowsResult as ApprovalWorkflow[]).find(w => w.draft_id === draftId) ?? null);
  };
  useEffect(() => { load(); }, [draftId]);

  const submitComment = async () => {
    if (commentText.trim().length < 2) return;
    try {
      await addComment.mutateAsync({ accessToken, draftId, content: commentText.trim() });
      setCommentText('');
      toast.success('أُضيف التعليق.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إضافة التعليق.');
    }
  };

  const toggleResolve = async (comment: DraftComment) => {
    await resolveComment.mutateAsync({ accessToken, commentId: comment.id, resolved: !comment.resolved });
    setComments(current => current.map(c => c.id === comment.id ? { ...c, resolved: !c.resolved } : c));
  };

  const startApproval = async () => {
    if (!confirm('سيبدأ سير الاعتماد: مراجعة محامٍ ← مراجعة مدير ← اعتماد. متابعة؟')) return;
    setBusy(true);
    try {
      const result = await startWorkflow.mutateAsync({ accessToken, draftId });
      toast.success('بدأ سير الاعتماد — أُشعر مدير المكتب.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر بدء السير.');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'approve' | 'reject') => {
    if (!workflow) return;
    if (!confirm(decision === 'approve' ? 'اعتماد هذه المسودة؟' : 'رفض المسودة وإعادتها؟')) return;
    setBusy(true);
    try {
      await advanceWorkflow.mutateAsync({ accessToken, workflowId: workflow.id, decision });
      toast.success(decision === 'approve' ? 'اعتُمدت المسودة.' : 'رُفضت المسودة.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل القرار.');
    } finally {
      setBusy(false);
    }
  };

  const canDecide = workflow && (workflow.current_step === 'lawyer_review' || workflow.current_step === 'manager_review') && practitioner;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><MessageSquare className="h-5 w-5 text-[#b58524]" />المراجعة التعاونية</CardTitle>
        <CardDescription>تعليقات ومراجعات داخل المسودة + سجل تغييرات + سير اعتماد تلقائي.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {workflow && (
          <div className="rounded-xl bg-[#f0f7f4] border border-[#d3e4dd] p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-[#1b6258]" />
              <span className="font-semibold text-[#153a36]">سير الاعتماد:</span>
              <Badge variant="outline" className={workflow.current_step === 'approved' ? 'bg-emerald-50 text-emerald-700' : workflow.current_step === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}>
                {STEP_LABELS[workflow.current_step] ?? workflow.current_step}
              </Badge>
            </div>
            {canDecide && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" className="h-8 bg-[#0d3b36]" disabled={busy} onClick={() => decide('approve')}><ThumbsUp className="h-3.5 w-3.5" />اعتماد</Button>
                <Button size="sm" variant="outline" className="h-8 text-rose-700" disabled={busy} onClick={() => decide('reject')}>رفض</Button>
              </div>
            )}
          </div>
        )}
        {!workflow && practitioner && (
          <Button onClick={startApproval} disabled={busy} variant="outline" className="w-full h-10">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}بدء سير الاعتماد التلقائي
          </Button>
        )}

        <div className="space-y-2">
          <p className="text-sm font-bold text-[#153a36]">التعليقات ({comments.filter(c => !c.resolved).length} مفتوحة)</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {comments.length ? comments.map(comment => (
              <div key={comment.id} className={`rounded-xl border p-3 ${comment.resolved ? 'opacity-50' : 'border-[#e5ece9]'}`}>
                <p className="text-sm text-[#153a36] leading-6">{comment.content}</p>
                <div className="flex justify-between items-center mt-1.5">
                  <p className="text-[10px] text-muted-foreground">{new Date(comment.created_at).toLocaleString('ar-QA')}</p>
                  {practitioner && <button className="text-[11px] font-semibold text-[#1b6258] hover:underline" onClick={() => toggleResolve(comment)}>{comment.resolved ? 'إعادة فتح' : 'حلّ التعليق'}</button>}
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground py-3 text-center">لا تعليقات بعد — ابدأ مراجعة المسودة.</p>}
          </div>
          {practitioner && (
            <div className="flex gap-2">
              <Input value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitComment(); } }} placeholder="أضف تعليقاً أو ملاحظة مراجعة…" />
              <Button onClick={submitComment} disabled={commentText.trim().length < 2} className="bg-[#0d3b36] shrink-0"><Send className="h-4 w-4" /></Button>
            </div>
          )}
        </div>

        {revisions.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-sm font-bold text-[#153a36] flex items-center gap-1.5 mb-2"><History className="h-4 w-4 text-[#b58524]" />سجل التغييرات ({revisions.length})</p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {revisions.map(revision => (
                <div key={revision.id} className="flex justify-between gap-2 text-xs rounded-lg bg-[#f8fbfa] px-3 py-2">
                  <span className="text-[#153a36] truncate">{revision.change_summary ?? 'تعديل بدون ملخص'}</span>
                  <span className="text-muted-foreground shrink-0">{new Date(revision.created_at).toLocaleDateString('ar-QA')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdaptiveTemplatesPanel({ accessToken }: { accessToken: string }) {
  const [templates, setTemplates] = useState<AdaptiveTemplate[]>([]);
  useEffect(() => {
    trpcClient.collaborativeDrafting.templates.adaptive.query({ accessToken }).then(result => setTemplates(result as AdaptiveTemplate[])).catch(() => undefined);
  }, [accessToken]);

  if (!templates.length) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base text-[#153a36] flex gap-2"><Sparkles className="h-4 w-4 text-[#b58524]" />القوالب المتكيفة</CardTitle>
        <CardDescription>القوالب الأكثر اعتماداً في مكتبكم — تُقترح تلقائياً حسب معدل الاعتماد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {templates.map(template => (
          <div key={template.id} className="flex justify-between items-center rounded-lg bg-[#f8fbfa] px-3 py-2 text-sm">
            <span className="font-semibold text-[#153a36]">{template.titleAr}</span>
            <Badge variant="outline" className="text-[10px] shrink-0">{template.approvedCount}/{template.usageCount} اعتماد · {Math.round(template.approvalRate * 100)}%</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type SavedDraft = { id: string; title: string; content: string; status: string; updated_at: string };

export function SavedDraftsPanel({ accessToken, caseId, profileId, practitioner, manager }: { accessToken: string; caseId: string; profileId: string; practitioner: boolean; manager: boolean }) {
  const [drafts, setDrafts] = useState<SavedDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const saveRevision = trpc.collaborativeDrafting.revisions.save.useMutation();

  const load = async () => {
    const { data } = await supabase.from('legal_drafts').select('id,title,content,status,updated_at').eq('case_id', caseId).order('updated_at', { ascending: false }).limit(20);
    setDrafts((data ?? []) as SavedDraft[]);
    if (!selectedId && (data ?? []).length) {
      setSelectedId((data as SavedDraft[])[0].id);
      setContent((data as SavedDraft[])[0].content);
    }
  };
  useEffect(() => { load(); }, [caseId]);

  const selectDraft = (draft: SavedDraft) => {
    setSelectedId(draft.id);
    setContent(draft.content);
    setChangeSummary('');
  };

  const persist = async () => {
    if (!selectedId) return;
    const draft = drafts.find(d => d.id === selectedId);
    if (!draft) return;
    setBusy(true);
    try {
      await saveRevision.mutateAsync({ accessToken, draftId: selectedId, contentBefore: draft.content, contentAfter: content, changeSummary: changeSummary || undefined });
      toast.success('حُفظ التعديل وسُجل في سجل التغييرات.');
      setChangeSummary('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر الحفظ.');
    } finally {
      setBusy(false);
    }
  };

  const selected = drafts.find(d => d.id === selectedId);

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#153a36] flex gap-2"><MessageSquare className="h-5 w-5 text-[#b58524]" />مذكرات القضية — محرر تعاوني</CardTitle>
        <CardDescription>حرر المذكرات المحفوظة مع تعليقات وسجل تغييرات وسير اعتماد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {drafts.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {drafts.map(draft => (
                <button key={draft.id} onClick={() => selectDraft(draft)} className={`text-xs rounded-full px-3 py-1.5 font-semibold transition-colors ${selectedId === draft.id ? 'bg-[#0d3b36] text-white' : 'bg-[#f4f7f5] text-[#5d716c] hover:bg-[#eaf3ef]'}`}>
                  {draft.title.slice(0, 40)}
                </button>
              ))}
            </div>
            {selected && (
              <>
                <div className="flex justify-between items-center gap-2">
                  <p className="text-sm font-bold text-[#153a36] truncate">{selected.title}</p>
                  <Badge variant="outline" className="shrink-0">{selected.status === 'approved' ? 'معتمد' : selected.status === 'review' ? 'مراجعة' : 'مسودة'}</Badge>
                </div>
                <Textarea value={content} onChange={e => setContent(e.target.value)} className="min-h-64 leading-8 text-sm" />
                <div className="flex gap-2">
                  <Input value={changeSummary} onChange={e => setChangeSummary(e.target.value)} placeholder="ملخص التعديل (اختياري)…" />
                  <Button onClick={persist} disabled={busy || !practitioner} className="bg-[#0d3b36] shrink-0">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}حفظ التعديل
                  </Button>
                </div>
                <CollaborativeDraftPanel accessToken={accessToken} draftId={selected.id} profileId={profileId} practitioner={practitioner} manager={manager} />
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">لا مذكرات محفوظة بعد — احفظ مسودة من تبويب «الذكاء» أو من قوالب المذكرات.</p>
        )}
      </CardContent>
    </Card>
  );
}
