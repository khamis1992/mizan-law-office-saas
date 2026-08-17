import { z } from 'zod';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';
import { recordLegalAudit } from './legalIntelligence';

/**
 * المحرر التعاوني للمذكرات:
 * - تعليقات ومراجعات بين المحامي والمدير داخل المسودة
 * - سجل تغييرات (revisions) لكل تعديل
 * - قوالب متكيفة: تتعلم من المذكرات المعتمدة السابقة
 * - سير عمل اعتماد تلقائي (محامٍ → مدير → معتمد)
 */

type CollabDeps = { fetchImpl?: typeof fetch };

// ---------------------------------------------------------------------------
// التعليقات
// ---------------------------------------------------------------------------

export const addDraftCommentInput = z.object({
  accessToken: z.string().min(20),
  draftId: z.string().uuid(),
  content: z.string().min(2).max(4000),
});

export async function addDraftComment(input: z.infer<typeof addDraftCommentInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'التعليق على المسودات متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const draftResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=id,office_id&id=eq.${input.draftId}&limit=1`, { headers });
  const drafts = await readResponse<Array<{ id: string; office_id: string }>>(draftResponse);
  const draft = drafts[0];
  if (!draft) throw new Error('المسودة غير موجودة.');
  if (draft.office_id !== profile.office_id) throw new Error('هذه المسودة خارج نطاق مكتبك.');

  const response = await fetchImpl(`${baseUrl}/rest/v1/draft_comments`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ office_id: profile.office_id, draft_id: input.draftId, author_id: profile.id, content: input.content }),
  });
  const rows = await readResponse<Array<{ id: string }>>(response);
  const comment = rows[0];
  if (!comment) throw new Error('تعذر إضافة التعليق.');

  await recordLegalAudit(input.accessToken, profile.office_id, profile.id, 'draft_comment_added', 'legal_drafts', input.draftId, {}, { commentId: comment.id }, fetchImpl);
  return { id: comment.id };
}

export const listDraftCommentsInput = z.object({ accessToken: z.string().min(20), draftId: z.string().uuid() });

export async function listDraftComments(input: z.infer<typeof listDraftCommentsInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/draft_comments?select=id,author_id,content,resolved,created_at&draft_id=eq.${input.draftId}&order=created_at.asc&limit=100`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; author_id: string; content: string; resolved: boolean; created_at: string }>>(response);
}

export const resolveDraftCommentInput = z.object({ accessToken: z.string().min(20), commentId: z.string().uuid(), resolved: z.boolean() });

export async function resolveDraftComment(input: z.infer<typeof resolveDraftCommentInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/draft_comments?id=eq.${input.commentId}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({ resolved: input.resolved }),
  });
  if (!response.ok) throw new Error('تعذر تحديث التعليق.');
  return { updated: true };
}

// ---------------------------------------------------------------------------
// سجل التغييرات
// ---------------------------------------------------------------------------

export const saveDraftRevisionInput = z.object({
  accessToken: z.string().min(20),
  draftId: z.string().uuid(),
  contentBefore: z.string().max(80000),
  contentAfter: z.string().min(1).max(80000),
  changeSummary: z.string().max(1000).optional(),
});

export async function saveDraftRevision(input: z.infer<typeof saveDraftRevisionInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'حفظ التعديلات متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const draftResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=id,office_id&id=eq.${input.draftId}&limit=1`, { headers });
  const drafts = await readResponse<Array<{ id: string; office_id: string }>>(draftResponse);
  const draft = drafts[0];
  if (!draft) throw new Error('المسودة غير موجودة.');
  if (draft.office_id !== profile.office_id) throw new Error('هذه المسودة خارج نطاق مكتبك.');

  const response = await fetchImpl(`${baseUrl}/rest/v1/draft_revisions`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      office_id: profile.office_id, draft_id: input.draftId, author_id: profile.id,
      content_before: input.contentBefore, content_after: input.contentAfter,
      change_summary: input.changeSummary ?? null,
    }),
  });
  if (!response.ok) throw new Error('تعذر حفظ سجل التعديل.');

  await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?id=eq.${input.draftId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ content: input.contentAfter, updated_by: profile.id, updated_at: new Date().toISOString() }),
  });

  await recordLegalAudit(input.accessToken, profile.office_id, profile.id, 'draft_revised', 'legal_drafts', input.draftId, { contentLength: input.contentBefore.length }, { contentLength: input.contentAfter.length, summary: input.changeSummary ?? null }, fetchImpl);
  return { saved: true };
}

export const listDraftRevisionsInput = z.object({ accessToken: z.string().min(20), draftId: z.string().uuid() });

export async function listDraftRevisions(input: z.infer<typeof listDraftRevisionsInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  await getVerifiedUser(input.accessToken, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/draft_revisions?select=id,author_id,change_summary,created_at&draft_id=eq.${input.draftId}&order=created_at.desc&limit=50`, { headers: supabaseHeaders(input.accessToken) });
  return readResponse<Array<{ id: string; author_id: string; change_summary: string | null; created_at: string }>>(response);
}

// ---------------------------------------------------------------------------
// القوالب المتكيفة
// ---------------------------------------------------------------------------

export const recordTemplateUsageInput = z.object({
  accessToken: z.string().min(20),
  templateId: z.string().uuid(),
  courtName: z.string().max(200).optional(),
  approved: z.boolean().default(false),
});

export async function recordTemplateUsage(input: z.infer<typeof recordTemplateUsageInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'تسجيل استخدام القوالب متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/memo_template_usage`, {
    method: 'POST',
    headers: { ...supabaseHeaders(input.accessToken), Prefer: 'return=minimal' },
    body: JSON.stringify({ office_id: profile.office_id, template_id: input.templateId, lawyer_id: profile.id, court_name: input.courtName ?? null, approved: input.approved }),
  });
  if (!response.ok) throw new Error('تعذر تسجيل الاستخدام.');
  return { recorded: true };
}

export const adaptiveTemplateSuggestionsInput = z.object({ accessToken: z.string().min(20) });

export async function adaptiveTemplateSuggestions(input: z.infer<typeof adaptiveTemplateSuggestionsInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const usageResponse = await fetchImpl(`${baseUrl}/rest/v1/memo_template_usage?select=template_id,court_name,approved&office_id=eq.${profile.office_id}&order=created_at.desc&limit=100`, { headers });
  const usage = await readResponse<Array<{ template_id: string; court_name: string | null; approved: boolean }>>(usageResponse).catch(() => []);

  const templatesResponse = await fetchImpl(`${baseUrl}/rest/v1/memo_templates?select=id,code,title_ar,memo_type&is_active=eq.true&limit=20`, { headers });
  const templates = await readResponse<Array<{ id: string; code: string; title_ar: string; memo_type: string }>>(templatesResponse).catch(() => []);

  const counts = new Map<string, { total: number; approved: number }>();
  for (const item of usage) {
    const entry = counts.get(item.template_id) ?? { total: 0, approved: 0 };
    entry.total++;
    if (item.approved) entry.approved++;
    counts.set(item.template_id, entry);
  }

  return templates
    .map(template => {
      const stats = counts.get(template.id) ?? { total: 0, approved: 0 };
      return { id: template.id, code: template.code, titleAr: template.title_ar, memoType: template.memo_type, usageCount: stats.total, approvedCount: stats.approved, approvalRate: stats.total ? stats.approved / stats.total : 0 };
    })
    .sort((left, right) => right.approvalRate - left.approvalRate || right.usageCount - left.usageCount)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// سير عمل الاعتماد التلقائي
// ---------------------------------------------------------------------------

export const startApprovalWorkflowInput = z.object({
  accessToken: z.string().min(20),
  draftId: z.string().uuid(),
});

export async function startApprovalWorkflow(input: z.infer<typeof startApprovalWorkflowInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'سير الاعتماد متاح لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const draftResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?select=id,office_id,title&id=eq.${input.draftId}&limit=1`, { headers });
  const drafts = await readResponse<Array<{ id: string; office_id: string; title: string }>>(draftResponse);
  const draft = drafts[0];
  if (!draft) throw new Error('المسودة غير موجودة.');
  if (draft.office_id !== profile.office_id) throw new Error('هذه المسودة خارج نطاق مكتبك.');

  const existingResponse = await fetchImpl(`${baseUrl}/rest/v1/approval_workflows?select=id,current_step&draft_id=eq.${input.draftId}&limit=1`, { headers });
  const existing = await readResponse<Array<{ id: string; current_step: string }>>(existingResponse).catch(() => []);

  if (existing[0]) {
    return { workflowId: existing[0].id, currentStep: existing[0].current_step, alreadyStarted: true };
  }

  const response = await fetchImpl(`${baseUrl}/rest/v1/approval_workflows`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id, draft_id: input.draftId,
      current_step: 'lawyer_review',
      history: [{ step: 'lawyer_review', actor_id: profile.id, at: new Date().toISOString() }],
      created_by: profile.id,
    }),
  });
  const rows = await readResponse<Array<{ id: string }>>(response);
  const workflow = rows[0];
  if (!workflow) throw new Error('تعذر بدء سير الاعتماد.');

  // إشعار لمدير المكتب بمراجعة المسودة
  const managersResponse = await fetchImpl(`${baseUrl}/rest/v1/profiles?select=id&office_id=eq.${profile.office_id}&role=eq.manager&is_active=eq.true&limit=10`, { headers });
  const managers = await readResponse<Array<{ id: string }>>(managersResponse).catch(() => []);
  for (const manager of managers) {
    if (manager.id === profile.id) continue;
    await fetchImpl(`${baseUrl}/rest/v1/notifications`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        office_id: profile.office_id, recipient_id: manager.id, type: 'approval_required',
        title: `مسودة بانتظار مراجعتك: ${draft.title}`,
        body: 'أُرسلت مسودة عبر سير الاعتماد — راجعها واعتمدها أو أعدها للمراجعة.',
        reference_url: null,
      }),
    });
  }

  await recordLegalAudit(input.accessToken, profile.office_id, profile.id, 'approval_workflow_started', 'legal_drafts', input.draftId, {}, { step: 'lawyer_review' }, fetchImpl);
  return { workflowId: workflow.id, currentStep: 'lawyer_review', alreadyStarted: false };
}

export const advanceApprovalInput = z.object({
  accessToken: z.string().min(20),
  workflowId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional(),
});

export async function advanceApproval(input: z.infer<typeof advanceApprovalInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'قرارات الاعتماد متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const workflowResponse = await fetchImpl(`${baseUrl}/rest/v1/approval_workflows?select=id,office_id,draft_id,current_step,history&id=eq.${input.workflowId}&limit=1`, { headers });
  const workflows = await readResponse<Array<{ id: string; office_id: string; draft_id: string; current_step: string; history: unknown }>>(workflowResponse);
  const workflow = workflows[0];
  if (!workflow) throw new Error('سير الاعتماد غير موجود.');
  if (workflow.office_id !== profile.office_id) throw new Error('هذا السير خارج نطاق مكتبك.');

  const history = Array.isArray(workflow.history) ? workflow.history as Array<{ step: string; actor_id: string; at: string; note?: string }> : [];
  let nextStep: string;
  if (input.decision === 'reject') {
    nextStep = 'rejected';
  } else if (workflow.current_step === 'lawyer_review') {
    nextStep = profile.role === 'manager' ? 'approved' : 'manager_review';
  } else if (workflow.current_step === 'manager_review') {
    nextStep = 'approved';
  } else {
    throw new Error('السير في حالة لا تقبل تقدماً إضافياً.');
  }

  history.push({ step: nextStep, actor_id: profile.id, at: new Date().toISOString(), note: input.note ?? undefined });

  const patchResponse = await fetchImpl(`${baseUrl}/rest/v1/approval_workflows?id=eq.${input.workflowId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ current_step: nextStep, history, updated_at: new Date().toISOString() }),
  });
  if (!patchResponse.ok) throw new Error('تعذر تحديث سير الاعتماد.');

  if (nextStep === 'approved') {
    await fetchImpl(`${baseUrl}/rest/v1/legal_drafts?id=eq.${workflow.draft_id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'approved', updated_at: new Date().toISOString() }),
    });
  }

  await recordLegalAudit(input.accessToken, profile.office_id, profile.id, `approval_${input.decision}`, 'legal_drafts', workflow.draft_id, { step: workflow.current_step }, { step: nextStep, note: input.note ?? null }, fetchImpl);
  return { workflowId: input.workflowId, currentStep: nextStep };
}

export const listApprovalWorkflowsInput = z.object({ accessToken: z.string().min(20), status: z.enum(['pending', 'all']).default('pending') });

export async function listApprovalWorkflows(input: z.infer<typeof listApprovalWorkflowsInput>, deps: CollabDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = await getProfile(input.accessToken, user.id, fetchImpl);
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  const params = new URLSearchParams({ select: 'id,draft_id,current_step,created_at,updated_at', order: 'updated_at.desc', limit: '50' });
  if (input.status === 'pending') params.set('current_step', 'in.(lawyer_review,manager_review)');
  const response = await fetchImpl(`${baseUrl}/rest/v1/approval_workflows?${params.toString()}`, { headers });
  return readResponse<Array<{ id: string; draft_id: string; current_step: string; created_at: string; updated_at: string }>>(response);
}

export type { Profile };
