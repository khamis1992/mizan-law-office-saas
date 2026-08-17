import { COOKIE_NAME } from "@shared/const";
import { approveAgentInput, runAgentInput, approveAgentRun, runAgent } from "./agents/agentRunner";
import { generateContractDraft, generateContractInput, listContractTemplates, listTemplatesInput, saveContractVersion, saveVersionInput, transitionContract, transitionInput } from "./contractStudio";
import { legalAssistantInput, runLegalAssistant } from "./legalAssistant";
import { caseIntakeInput, runCaseIntake } from './caseIntake';
import { addTimeEntry, addTimeEntryInput, checkConflictInput, checkConflictOfInterest, createCaseInvoice, createCaseInvoiceInput, getNotificationPrefs, getNotificationPrefsInput, listCaseInvoices, listCaseInvoicesInput, listMemoTemplates, listMemoTemplatesInput, listTimeEntries, listTimeEntriesInput, renderMemo, renderMemoInput, sendHearingReminder, sendHearingReminderInput, setLimitationDate, setLimitationDateInput, setNotificationPrefs, setNotificationPrefsInput } from './officeFeatures';
import { legalResearchInput, runLegalResearch, saveResearchMemo, saveResearchMemoInput } from "./legalResearch";
import { adaptiveTemplateSuggestions, adaptiveTemplateSuggestionsInput, addDraftComment, addDraftCommentInput, advanceApproval, advanceApprovalInput, listApprovalWorkflows, listApprovalWorkflowsInput, listDraftComments, listDraftCommentsInput, listDraftRevisions, listDraftRevisionsInput, recordTemplateUsage, recordTemplateUsageInput, resolveDraftComment, resolveDraftCommentInput, saveDraftRevision, saveDraftRevisionInput, startApprovalWorkflow, startApprovalWorkflowInput } from "./collaborativeDrafting";
import { acceptJudgmentPrecedent, acceptJudgmentPrecedentInput, analyzeJudgment, analyzeJudgmentInput, autoIndexEmbeddings, autoIndexEmbeddingsInput, caseChat, caseChatInput, dispatchGraduatedReminders, dispatchGraduatedRemindersInput, exportCaseFile, exportCaseFileInput, generateAdversarialMemo, generateAdversarialMemoInput, lawyerDayBoard, lawyerDayBoardInput, listAdversarialMemos, listAdversarialMemosInput, listAgentSuggestions, listAgentSuggestionsInput, listCaseChat, listCaseChatInput, listCourtHolidays, listCourtHolidaysInput, listLegalAudit, listLegalAuditInput, predictCaseOutcome, predictCaseOutcomeInput, runCaseAgent, runCaseAgentInput, syncCourtCase, syncCourtCaseInput, updateSuggestion, updateSuggestionInput } from "./legalIntelligence";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { indexKnowledgeBaseEmbeddings } from "./retrieval";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  legalAssistant: router({
    generate: publicProcedure
      .input(legalAssistantInput)
      .mutation(({ input }) => runLegalAssistant(input)),
  }),

  // مركز البحث القانوني الموثق — المنتج الأول في خارطة التحول
  legalResearch: router({
    run: publicProcedure
      .input(legalResearchInput)
      .mutation(({ input }) => runLegalResearch(input)),
    saveMemo: publicProcedure
      .input(saveResearchMemoInput)
      .mutation(({ input }) => saveResearchMemo(input)),
    indexEmbeddings: publicProcedure
      .input(z.object({ accessToken: z.string().min(20), limit: z.number().int().min(1).max(200).default(50) }))
      .mutation(({ input }) => indexKnowledgeBaseEmbeddings(input.accessToken, fetch, input.limit)),
  }),

  // استديو العقود والمذكرات — المنتج الثاني
  contractStudio: router({
    templates: publicProcedure
      .input(listTemplatesInput)
      .query(({ input }) => listContractTemplates(input)),
    generate: publicProcedure
      .input(generateContractInput)
      .mutation(({ input }) => generateContractDraft(input)),
    saveVersion: publicProcedure
      .input(saveVersionInput)
      .mutation(({ input }) => saveContractVersion(input)),
    transition: publicProcedure
      .input(transitionInput)
      .mutation(({ input }) => transitionContract(input)),
  }),

  // التحليل الافتتاحي الذكي للقضية: أوراق الدعوى → قوانين ودفوع وثغرات ومسودة مذكرة
  caseIntake: router({
    analyze: publicProcedure
      .input(caseIntakeInput)
      .mutation(({ input }) => runCaseIntake(input)),
  }),

  // ميزات المكتب القانونية: قوالب المذكرات، تعارض المصالح، تتبع الوقت، التقادم، الإشعارات
  officeFeatures: router({
    memoTemplates: publicProcedure
      .input(listMemoTemplatesInput)
      .query(({ input }) => listMemoTemplates(input)),
    renderMemo: publicProcedure
      .input(renderMemoInput)
      .mutation(({ input }) => renderMemo(input)),
    checkConflict: publicProcedure
      .input(checkConflictInput)
      .mutation(({ input }) => checkConflictOfInterest(input)),
    addTimeEntry: publicProcedure
      .input(addTimeEntryInput)
      .mutation(({ input }) => addTimeEntry(input)),
    listTimeEntries: publicProcedure
      .input(listTimeEntriesInput)
      .query(({ input }) => listTimeEntries(input)),
    createCaseInvoice: publicProcedure
      .input(createCaseInvoiceInput)
      .mutation(({ input }) => createCaseInvoice(input)),
    listCaseInvoices: publicProcedure
      .input(listCaseInvoicesInput)
      .query(({ input }) => listCaseInvoices(input)),
    setLimitationDate: publicProcedure
      .input(setLimitationDateInput)
      .mutation(({ input }) => setLimitationDate(input)),
    getNotificationPrefs: publicProcedure
      .input(getNotificationPrefsInput)
      .query(({ input }) => getNotificationPrefs(input)),
    setNotificationPrefs: publicProcedure
      .input(setNotificationPrefsInput)
      .mutation(({ input }) => setNotificationPrefs(input)),
    sendHearingReminder: publicProcedure
      .input(sendHearingReminderInput)
      .mutation(({ input }) => sendHearingReminder(input)),
  }),

  // الوكلاء القانونيون المقيدون — المنتج الثالث
  agents: router({
    run: publicProcedure
      .input(runAgentInput)
      .mutation(({ input }) => runAgent(input)),
    approve: publicProcedure
      .input(approveAgentInput)
      .mutation(({ input }) => approveAgentRun(input)),
  }),

  // الذكاء القانوني المتقدم — «شريك المرافعة»
  legalIntelligence: router({
    caseAgent: router({
      run: publicProcedure
        .input(runCaseAgentInput)
        .mutation(({ input }) => runCaseAgent(input)),
      suggestions: publicProcedure
        .input(listAgentSuggestionsInput)
        .query(({ input }) => listAgentSuggestions(input)),
      updateSuggestion: publicProcedure
        .input(updateSuggestionInput)
        .mutation(({ input }) => updateSuggestion(input)),
    }),
    adversarial: router({
      generate: publicProcedure
        .input(generateAdversarialMemoInput)
        .mutation(({ input }) => generateAdversarialMemo(input)),
      list: publicProcedure
        .input(listAdversarialMemosInput)
        .query(({ input }) => listAdversarialMemos(input)),
    }),
    judgments: router({
      analyze: publicProcedure
        .input(analyzeJudgmentInput)
        .mutation(({ input }) => analyzeJudgment(input)),
      acceptPrecedent: publicProcedure
        .input(acceptJudgmentPrecedentInput)
        .mutation(({ input }) => acceptJudgmentPrecedent(input)),
    }),
    prediction: router({
      predict: publicProcedure
        .input(predictCaseOutcomeInput)
        .mutation(({ input }) => predictCaseOutcome(input)),
    }),
    chat: router({
      send: publicProcedure
        .input(caseChatInput)
        .mutation(({ input }) => caseChat(input)),
      list: publicProcedure
        .input(listCaseChatInput)
        .query(({ input }) => listCaseChat(input)),
    }),
    courts: router({
      holidays: publicProcedure
        .input(listCourtHolidaysInput)
        .query(({ input }) => listCourtHolidays(input)),
      syncCase: publicProcedure
        .input(syncCourtCaseInput)
        .mutation(({ input }) => syncCourtCase(input)),
    }),
    reminders: publicProcedure
      .input(dispatchGraduatedRemindersInput)
      .mutation(({ input }) => dispatchGraduatedReminders(input)),
    autoIndex: publicProcedure
      .input(autoIndexEmbeddingsInput)
      .mutation(({ input }) => autoIndexEmbeddings(input)),
    dayBoard: publicProcedure
      .input(lawyerDayBoardInput)
      .query(({ input }) => lawyerDayBoard(input)),
    audit: publicProcedure
      .input(listLegalAuditInput)
      .query(({ input }) => listLegalAudit(input)),
    exportCase: publicProcedure
      .input(exportCaseFileInput)
      .mutation(({ input }) => exportCaseFile(input)),
  }),

  // المحرر التعاوني للمذكرات: تعليقات، سجل تغييرات، قوالب متكيفة، اعتماد تلقائي
  collaborativeDrafting: router({
    comments: router({
      add: publicProcedure
        .input(addDraftCommentInput)
        .mutation(({ input }) => addDraftComment(input)),
      list: publicProcedure
        .input(listDraftCommentsInput)
        .query(({ input }) => listDraftComments(input)),
      resolve: publicProcedure
        .input(resolveDraftCommentInput)
        .mutation(({ input }) => resolveDraftComment(input)),
    }),
    revisions: router({
      save: publicProcedure
        .input(saveDraftRevisionInput)
        .mutation(({ input }) => saveDraftRevision(input)),
      list: publicProcedure
        .input(listDraftRevisionsInput)
        .query(({ input }) => listDraftRevisions(input)),
    }),
    templates: router({
      recordUsage: publicProcedure
        .input(recordTemplateUsageInput)
        .mutation(({ input }) => recordTemplateUsage(input)),
      adaptive: publicProcedure
        .input(adaptiveTemplateSuggestionsInput)
        .query(({ input }) => adaptiveTemplateSuggestions(input)),
    }),
    approvals: router({
      start: publicProcedure
        .input(startApprovalWorkflowInput)
        .mutation(({ input }) => startApprovalWorkflow(input)),
      advance: publicProcedure
        .input(advanceApprovalInput)
        .mutation(({ input }) => advanceApproval(input)),
      list: publicProcedure
        .input(listApprovalWorkflowsInput)
        .query(({ input }) => listApprovalWorkflows(input)),
    }),
  }),

  // سقف استخدام الذكاء الاصطناعي للمكتب (قراءة للعرض في لوحة التحكم)
  aiUsage: router({
    quota: publicProcedure
      .input(z.object({ accessToken: z.string().min(20) }))
      .query(async ({ input }) => {
        const { getVerifiedUser, getProfile } = await import("./supabaseAccess");
        const { checkAiQuota } = await import("./aiQuota");
        const user = await getVerifiedUser(input.accessToken);
        const profile = await getProfile(input.accessToken, user.id);
        if (!profile.office_id) return { allowed: false, used: 0, cap: null as number | null };
        return checkAiQuota(input.accessToken, profile.office_id);
      }),
  }),
});

export type AppRouter = typeof appRouter;
