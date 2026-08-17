import { z } from 'zod';
import { assertAiQuota } from '../aiQuota';
import { executeResearch, legalResearchInput, saveResearchMemo, saveResearchMemoInput } from '../legalResearch';
import { generateContractDraft, generateContractInput, transitionContract, transitionInput } from '../contractStudio';
import { callChatCompletion } from '../aiClient';
import { assertPractitioner, getProfile, getVerifiedUser, readResponse, requiredEnv, supabaseHeaders, type Profile } from '../supabaseAccess';

/**
 * إطار الوكلاء القانونيين المقيدون — المنتج الثالث في خارطة التحول.
 * كل وكيل: خطة معروضة → خطوات مرئية بحالة كل خطوة → مخرج → إجراء مؤثر خلف موافقة صريحة.
 * لا وكيل يعمل بصفة دائمة أو مجدولة، ولا إجراء مؤثر ينفذ بلا موافقة مسجلة.
 */

export const AGENT_LIMITS = {
  maxSteps: 6,
  maxProposedTasks: 3,
  maxRetrievedSections: 8,
  requestTimeoutMs: 120_000,
} as const;

export type AgentType = 'research' | 'contract' | 'case_file';

export type AgentStepStatus = 'done' | 'skipped' | 'failed';
export type AgentStep = { id: string; title: string; status: AgentStepStatus; detail: string };

export type PendingAction =
  | { type: 'save_research_memo'; label: string; payload: z.infer<typeof saveResearchMemoInput> }
  | { type: 'transition_contract'; label: string; payload: Omit<z.infer<typeof transitionInput>, 'accessToken'> & { accessToken: string } }
  | { type: 'create_tasks'; label: string; payload: { tasks: Array<{ title: string; description: string | null; priority: 'low' | 'medium' | 'high' | 'urgent'; dueInDays: number | null; caseId: string | null }> } };

export type AgentRunResult = {
  runId: string;
  agentType: AgentType;
  objective: string;
  steps: AgentStep[];
  output: Record<string, unknown>;
  pendingAction: PendingAction | null;
  status: 'completed' | 'awaiting_approval';
};

export const runAgentInput = z.object({
  accessToken: z.string().min(20),
  agentType: z.enum(['research', 'contract', 'case_file']),
  // وكيل البحث
  question: z.string().max(4000).optional(),
  disputeType: z.enum(['civil', 'commercial', 'criminal', 'labor', 'family', 'administrative', 'other']).optional(),
  // وكيل العقد
  templateCode: z.string().max(80).optional(),
  title: z.string().max(160).optional(),
  answers: z.record(z.string(), z.string().max(2000)).optional(),
  instructions: z.string().max(3000).optional(),
  // مشترك
  caseId: z.string().uuid().optional(),
});

export const approveAgentInput = z.object({
  accessToken: z.string().min(20),
  runId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(600).optional(),
});

type AgentDeps = { fetchImpl?: typeof fetch };

function clampSteps(steps: AgentStep[]): AgentStep[] {
  return steps.slice(0, AGENT_LIMITS.maxSteps);
}

async function runResearchAgent(
  input: z.infer<typeof runAgentInput>,
  profile: Profile,
  deps: AgentDeps,
): Promise<{ steps: AgentStep[]; output: Record<string, unknown>; pendingAction: PendingAction | null; objective: string }> {
  const question = input.question?.trim();
  const objective = question ?? 'بحث قانوني';
  if (!question || question.length < 10) throw new Error('وكيل البحث يتطلب سؤالاً قانونياً من عشرة أحرف على الأقل.');

  const parsedInput = legalResearchInput.parse({
    accessToken: input.accessToken,
    caseId: input.caseId,
    question,
    disputeType: input.disputeType,
  });

  const steps: AgentStep[] = [
    { id: 'decompose', title: 'تفكيك المسألة القانونية', status: 'done', detail: `استخراج المصطلحات الدلالية من السؤال لقيادة الاسترجاع.${input.disputeType ? ` نوع النزاع: ${input.disputeType}.` : ''}` },
  ];

  const result = await executeResearch(parsedInput, profile, deps);

  steps.push({
    id: 'retrieve',
    title: 'استرجاع المصادر الموثقة',
    status: result.citations.length ? 'done' : 'skipped',
    detail: result.citations.length
      ? `استُرجع ${result.citations.length} مقطعاً تشريعياً و${result.precedentCitations.length} سابقة موثقة بترتيب درجة الصلة.`
      : 'لم تُطابق قاعدة المصادر أي مقطع ذي صلة.',
  });

  if (result.gap) {
    steps.push({ id: 'gap', title: 'إعلان فجوة البحث', status: 'done', detail: 'لا أدلة كافية؛ لم يُولَّد تحليل منع للاختلاق.', });
    return { steps, output: { research: result }, pendingAction: null, objective };
  }

  steps.push({ id: 'synthesize', title: 'مقارنة المصادر وصياغة المذكرة', status: 'done', detail: `قاعدة واستثناءات وعناصر انطباق من ${result.citations.length} مصدراً مستشهداً به.` });
  steps.push({
    id: 'verify',
    title: 'تدقيق الاستشهاد',
    status: result.verification.passed ? 'done' : 'failed',
    detail: result.verification.passed
      ? 'اجتازت كل الاقتباسات الحرفية وأرقام المواد بوابة التحقق.'
      : `عُلّمت ${result.verification.unverifiedQuotes.length + result.verification.unverifiedArticles.length} إشارة بأنها غير موثقة وظهرت بوضوح في المخرج.`,
  });

  let pendingAction: PendingAction | null = null;
  if (input.caseId && result.citations.length) {
    pendingAction = {
      type: 'save_research_memo',
      label: 'حفظ مذكرة البحث ونتائجها بملف القضية',
      payload: {
        accessToken: input.accessToken,
        caseId: input.caseId,
        question,
        memoMarkdown: `${result.answer?.summary ?? ''}\n\nالقاعدة:\n${result.answer?.rule ?? ''}\n\nالاستثناءات:\n- ${(result.answer?.exceptions ?? []).join('\n- ')}\n\nعناصر الانطباق:\n- ${(result.answer?.application ?? []).join('\n- ')}`,
        citations: result.citations.slice(0, AGENT_LIMITS.maxRetrievedSections).map(citation => ({
          sectionId: citation.id,
          excerpt: citation.excerpt.slice(0, 2000),
          relevanceScore: citation.relevanceScore,
          rationale: `تطابق مصطلحات: ${citation.matchedTerms.join('، ')}`,
        })),
        precedentIds: result.precedentCitations.map(precedent => precedent.id),
      },
    };
  }

  return { steps, output: { research: result }, pendingAction, objective };
}

async function runContractAgent(
  input: z.infer<typeof runAgentInput>,
  _profile: Profile,
  deps: AgentDeps,
): Promise<{ steps: AgentStep[]; output: Record<string, unknown>; pendingAction: PendingAction | null; objective: string }> {
  if (!input.templateCode || !input.title) throw new Error('وكيل العقد يتطلب اختيار قالب وعنواناً للمستند.');
  const objective = `إعداد مسودة عقد من قالب ${input.templateCode}`;

  const steps: AgentStep[] = [
    { id: 'collect', title: 'جمع حقول المقابلة', status: 'done', detail: `استُلمت ${Object.keys(input.answers ?? {}).length} قيمة من نموذج الصياغة.` },
    { id: 'clauses', title: 'اختيار البنود المعتمدة', status: 'done', detail: 'تعبئة بنود القالب النشطة وتحديد الأساس القانوني لكل بند.' },
  ];

  const generated = await generateContractDraft(generateContractInput.parse({
    accessToken: input.accessToken,
    templateCode: input.templateCode,
    title: input.title,
    caseId: input.caseId,
    answers: input.answers ?? {},
    instructions: input.instructions,
  }), deps);

  steps.push({ id: 'draft', title: 'كشف التعارض والصياغة', status: 'done', detail: `مسودة بحالة «مسودة» وسجل ${generated.clauseDecisions.length} بنداً و${generated.risks.length} مخاطرة.` });
  steps.push({
    id: 'verify',
    title: 'تحقق اقتباسات التشريع',
    status: generated.verification.passed ? 'done' : 'failed',
    detail: generated.verification.passed
      ? 'كل الاقتباسات الحرفية طابقت سجل المصادر الموثقة.'
      : `${generated.verification.unverifiedQuotes.length} اقتباساً عُلّم «غير موثق» ويلزم تحققه يدوياً قبل الاعتماد.`,
  });

  const pendingAction: PendingAction = {
    type: 'transition_contract',
    label: 'رفع حالة المسودة إلى «مراجعة محامٍ»',
    payload: { accessToken: input.accessToken, documentId: generated.documentId, to: 'in_review', note: 'مرفوع بواسطة وكيل العقد بعد موافقة المحامي.' },
  };

  return { steps, output: { contract: generated }, pendingAction, objective };
}

type CaseFileAnalysis = {
  factsSummary: string;
  timeline: Array<{ date: string; event: string }>;
  missingItems: string[];
  researchPlan: Array<{ question: string; why: string }>;
  proposedTasks: Array<{ title: string; description: string; priority: 'low' | 'medium' | 'high' | 'urgent'; dueInDays: number | null }>;
};

const caseFileSchema = z.object({
  factsSummary: z.string(),
  timeline: z.array(z.object({ date: z.string(), event: z.string() })),
  missingItems: z.array(z.string()),
  researchPlan: z.array(z.object({ question: z.string(), why: z.string() })),
  proposedTasks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    dueInDays: z.number().int().min(0).max(180).transform(value => (value === 0 ? null : value)),
  })),
});

function caseFilePrompt(caseContext: string) {
  return `أنت وكيل تحليل ملفات القضايا في مكتب محاماة قطري. تحلل بيانات ملف قضية داخل النظام وتعد ملخصاً وخطة عمل للمحامي المسؤول.

القواعد الملزمة:
1) اعتمد حصراً على بيانات الملف أدناه؛ لا تفترض وقائع غير مذكورة.
2) timeline يرتب الأحداث المسجلة (فتح القضية، الجلسات، المهام) بتواريخها الفعلية من البيانات.
3) missingItems يسرد ما يلزم استكماله (مستندات، بيانات، إجراءات) بصيغة قابلة للتنفيذ.
4) researchPlan يقترح أسئلة بحث قانوني محددة مع سبب كل سؤال، ولا يدعي الإحالة لأي مادة أو حكم غير موجود في البيانات.
5) proposedTasks ثلاث مهام داخلية على الأكثر بأولويات واقعية، واكتب 0 في dueInDays إن لم يكن للمهمة موعد محدد.
6) لا تقترح أي إرسال خارجي أو تقديم أو حذف؛ هذه إجراءات يدوية للمحامي حصراً.

بيانات ملف القضية:
${caseContext}`;
}

async function runCaseFileAgent(
  input: z.infer<typeof runAgentInput>,
  profile: Profile,
  deps: AgentDeps,
): Promise<{ steps: AgentStep[]; output: Record<string, unknown>; pendingAction: PendingAction | null; objective: string }> {
  if (!input.caseId) throw new Error('وكيل ملف القضية يتطلب اختيار قضية.');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const casesResponse = await fetchImpl(`${baseUrl}/rest/v1/legal_cases?id=eq.${input.caseId}&select=id,case_number,title,type,status,court_name,opening_date,description`, { headers });
  const cases = await readResponse<Array<{ id: string; case_number: string; title: string; type: string; status: string; court_name: string | null; opening_date: string | null; description: string | null }>>(casesResponse);
  const legalCase = cases[0];
  if (!legalCase) throw new Error('القضية غير موجودة أو خارج نطاق مكتبك.');
  const objective = `تحليل ملف القضية ${legalCase.case_number}`;

  const steps: AgentStep[] = [
    { id: 'load', title: 'استخراج بيانات الملف', status: 'done', detail: `قضية ${legalCase.case_number}: ${legalCase.title}.` },
  ];

  const [hearingsResponse, tasksResponse, docsResponse] = await Promise.all([
    fetchImpl(`${baseUrl}/rest/v1/hearings?case_id=eq.${input.caseId}&select=hearing_at,court_name,status,outcome&order=hearing_at.asc`, { headers }),
    fetchImpl(`${baseUrl}/rest/v1/tasks?case_id=eq.${input.caseId}&select=title,status,due_at,priority`, { headers }),
    fetchImpl(`${baseUrl}/rest/v1/documents?case_id=eq.${input.caseId}&select=file_name,category,created_at`, { headers }),
  ]);
  const hearings = await readResponse<Array<{ hearing_at: string; court_name: string | null; status: string; outcome: string | null }>>(hearingsResponse);
  const tasks = await readResponse<Array<{ title: string; status: string; due_at: string | null; priority: string }>>(tasksResponse);
  const documents = await readResponse<Array<{ file_name: string; category: string; created_at: string }>>(docsResponse);
  steps.push({ id: 'context', title: 'بناء الخط الزمني', status: 'done', detail: `${hearings.length} جلسة، ${tasks.length} مهمة، ${documents.length} مستنداً مرتبطاً بالملف.` });

  const caseContext = [
    `القضية: ${legalCase.case_number} — ${legalCase.title}`,
    `النوع: ${legalCase.type} · الحالة: ${legalCase.status} · المحكمة: ${legalCase.court_name ?? 'غير محددة'} · تاريخ الفتح: ${legalCase.opening_date ?? '—'}`,
    `الوصف: ${legalCase.description ?? 'لا يوجد وصف مسجل.'}`,
    `الجلسات: ${hearings.map(hearing => `${hearing.hearing_at} (${hearing.status}${hearing.outcome ? ` — ${hearing.outcome}` : ''})`).join(' | ') || 'لا جلسات مسجلة.'}`,
    `المهام: ${tasks.map(task => `${task.title} [${task.status}${task.due_at ? ` حتى ${task.due_at}` : ''}]`).join(' | ') || 'لا مهام مسجلة.'}`,
    `المستندات: ${documents.map(document => `${document.file_name} [${document.category}]`).join(' | ') || 'لا مستندات مسجلة.'}`,
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_LIMITS.requestTimeoutMs);
  let analysis: CaseFileAnalysis;
  try {
    const content = await callChatCompletion({
      temperature: 0.2,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'qatar_case_file_agent_output',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              factsSummary: { type: 'string' },
              timeline: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { date: { type: 'string' }, event: { type: 'string' } }, required: ['date', 'event'] } },
              missingItems: { type: 'array', items: { type: 'string' } },
              researchPlan: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, why: { type: 'string' } }, required: ['question', 'why'] } },
              proposedTasks: {
                type: 'array', items: {
                  type: 'object', additionalProperties: false,
                  properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, dueInDays: { type: 'integer' } },
                  required: ['title', 'description', 'priority', 'dueInDays'],
                },
              },
            },
            required: ['factsSummary', 'timeline', 'missingItems', 'researchPlan', 'proposedTasks'],
          },
        },
      },
      messages: [
        { role: 'system', content: caseFilePrompt(caseContext) },
        { role: 'user', content: 'حلل الملف وأعد الملخص والخط الزمني والنواقص وخطة البحث والمهام المقترحة.' },
      ],
    }, fetchImpl, controller.signal);
    if (!content) throw new Error('لم تُرجع خدمة الذكاء الاصطناعي تحليلاً صالحاً.');
    analysis = caseFileSchema.parse(JSON.parse(content));
  } finally {
    clearTimeout(timeout);
  }

  const limitedTasks = analysis.proposedTasks.slice(0, AGENT_LIMITS.maxProposedTasks);
  steps.push({ id: 'gaps', title: 'كشف النواقص وخطة البحث', status: 'done', detail: `${analysis.missingItems.length} نقصاً و${analysis.researchPlan.length} سؤال بحث مقترحاً.` });

  const pendingAction: PendingAction | null = limitedTasks.length
    ? { type: 'create_tasks', label: 'إنشاء المهام الداخلية المقترحة داخل ملف القضية', payload: { tasks: limitedTasks.map(task => ({ ...task, caseId: input.caseId ?? null })) } }
    : null;

  return {
    steps,
    output: { caseFile: { ...analysis, proposedTasks: limitedTasks } },
    pendingAction,
    objective,
  };
}

async function persistAgentRun(
  accessToken: string,
  profile: Profile,
  params: { agentType: AgentType; caseId?: string; objective: string; steps: AgentStep[]; output: Record<string, unknown>; pendingAction: PendingAction | null },
  deps: AgentDeps,
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...supabaseHeaders(accessToken), Prefer: 'return=representation' },
    body: JSON.stringify({
      office_id: profile.office_id,
      case_id: params.caseId ?? null,
      agent_type: params.agentType,
      requested_by: profile.id,
      status: params.pendingAction ? 'awaiting_approval' : 'completed',
      objective: params.objective,
      plan: params.steps.map(step => ({ title: step.title })),
      steps: params.steps,
      output: params.output,
      pending_action: params.pendingAction,
      approval_required: Boolean(params.pendingAction),
      completed_at: new Date().toISOString(),
    }),
  });
  const runs = await readResponse<Array<{ id: string }>>(response);
  if (!runs[0]) throw new Error('تعذر تسجيل تشغيل الوكيل.');
  return runs[0].id;
}

export async function runAgent(input: z.infer<typeof runAgentInput>, deps: AgentDeps = {}): Promise<AgentRunResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'الوكلاء القانونيون متاحون لمدير المكتب والمحامي فقط.');
  await assertAiQuota(input.accessToken, profile, fetchImpl);

  const executed =
    input.agentType === 'research' ? await runResearchAgent(input, profile, deps)
    : input.agentType === 'contract' ? await runContractAgent(input, profile, deps)
    : await runCaseFileAgent(input, profile, deps);

  const steps = clampSteps(executed.steps);
  const runId = await persistAgentRun(input.accessToken, profile, {
    agentType: input.agentType,
    caseId: input.caseId,
    objective: executed.objective,
    steps,
    output: executed.output,
    pendingAction: executed.pendingAction,
  }, deps);

  return {
    runId,
    agentType: input.agentType,
    objective: executed.objective,
    steps,
    output: executed.output,
    pendingAction: executed.pendingAction,
    status: executed.pendingAction ? 'awaiting_approval' : 'completed',
  };
}

/** تنفيذ الإجراء المؤثر — لا يحدث إلا عبر هذه النقطة وبعد موافقة صريحة تُسجل في سجل الأحداث. */
export async function approveAgentRun(input: z.infer<typeof approveAgentInput>, deps: AgentDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const user = await getVerifiedUser(input.accessToken, fetchImpl);
  const profile = assertPractitioner(await getProfile(input.accessToken, user.id, fetchImpl), 'الموافقة على إجراءات الوكلاء متاحة لمدير المكتب والمحامي فقط.');
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);

  const runsResponse = await fetchImpl(`${baseUrl}/rest/v1/agent_runs?id=eq.${input.runId}&select=id,office_id,status,pending_action`, { headers });
  const runs = await readResponse<Array<{ id: string; office_id: string; status: string; pending_action: PendingAction | null }>>(runsResponse);
  const run = runs[0];
  if (!run) throw new Error('تشغيل الوكيل غير موجود.');
  if (run.office_id !== profile.office_id) throw new Error('هذا التشغيل خارج نطاق مكتبك.');
  if (run.status !== 'awaiting_approval') throw new Error('هذا التشغيل ليس بانتظار موافقة.');

  const recordDecision = async () => {
    await fetchImpl(`${baseUrl}/rest/v1/agent_approval_events`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ run_id: input.runId, actor_id: profile.id, decision: input.decision, note: input.note ?? null }),
    });
  };

  if (input.decision === 'rejected') {
    await fetchImpl(`${baseUrl}/rest/v1/agent_runs?id=eq.${input.runId}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    await recordDecision();
    return { runId: input.runId, status: 'rejected' as const, executed: null };
  }

  const action = run.pending_action;
  if (!action) throw new Error('لا يوجد إجراء مؤثر معلق على هذا التشغيل.');

  let executed: Record<string, unknown>;
  if (action.type === 'save_research_memo') {
    executed = await saveResearchMemo(saveResearchMemoInput.parse(action.payload), deps);
  } else if (action.type === 'transition_contract') {
    executed = await transitionContract(transitionInput.parse(action.payload), deps);
  } else {
    const tasks = action.payload.tasks.slice(0, AGENT_LIMITS.maxProposedTasks);
    const rows = tasks.map(task => ({
      office_id: profile.office_id,
      title: task.title.slice(0, 200),
      description: task.description?.slice(0, 2000) ?? null,
      assigned_to: profile.id,
      priority: task.priority,
      status: 'not_started',
      due_at: task.dueInDays ? new Date(Date.now() + task.dueInDays * 86400000).toISOString() : null,
      case_id: task.caseId,
      created_by: profile.id,
    }));
    const insertResponse = await fetchImpl(`${baseUrl}/rest/v1/tasks`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!insertResponse.ok) {
      const detail = await insertResponse.text();
      throw new Error(`تعذر إنشاء المهام: ${detail.slice(0, 200)}`);
    }
    executed = { createdTasks: rows.length };
  }

  await fetchImpl(`${baseUrl}/rest/v1/agent_runs?id=eq.${input.runId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'executed' }),
  });
  await recordDecision();

  return { runId: input.runId, status: 'executed' as const, executed };
}
