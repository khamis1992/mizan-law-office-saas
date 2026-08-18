import { requiredEnv, supabaseHeaders } from './supabaseAccess';

/**
 * تغذية الرسم البياني للمعرفة تلقائياً من الأحداث:
 * - رفع مستند → حافة document→case
 * - اعتماد مذكرة → حافة defense→source
 * - نتيجة جلسة → حافة case→court/circuit
 * - تعارض مصالح → حافة party→affiliate
 * بدون هذه التغذية تبقى الشبكة فارغة والاستدلال المتقدم ديكوراً.
 */

type EdgeInput = {
  accessToken: string;
  officeId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation: string;
  strength?: number;
};

export async function writeEdge(input: EdgeInput, fetchImpl: typeof fetch = fetch) {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const headers = supabaseHeaders(input.accessToken);
  try {
    const response = await fetchImpl(`${baseUrl}/rest/v1/knowledge_graph_edges`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        office_id: input.officeId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        target_type: input.targetType,
        target_id: input.targetId,
        relation: input.relation,
        strength: input.strength ?? 1,
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      if (!detail.includes('duplicate')) console.warn('[KG] فشل كتابة الحافة:', detail.slice(0, 150));
    }
  } catch (error) {
    console.warn('[KG] خطأ في كتابة الحافة:', error instanceof Error ? error.message : String(error));
  }
}

/** ربط مستند بقضيته. */
export async function linkDocumentToCase(accessToken: string, officeId: string, documentId: string, caseId: string, fetchImpl: typeof fetch = fetch) {
  await writeEdge({ accessToken, officeId, sourceType: 'document', sourceId: documentId, targetType: 'case', targetId: caseId, relation: 'belongs_to' }, fetchImpl);
}

/** ربط مذكرة معتمدة بمصدرها القانوني. */
export async function linkDraftToSource(accessToken: string, officeId: string, draftId: string, sourceId: string, fetchImpl: typeof fetch = fetch) {
  await writeEdge({ accessToken, officeId, sourceType: 'draft', sourceId: draftId, targetType: 'source', targetId: sourceId, relation: 'cites' }, fetchImpl);
}

/** ربط قضية بمحكمتها/دائرتها. */
export async function linkCaseToCourt(accessToken: string, officeId: string, caseId: string, courtName: string, fetchImpl: typeof fetch = fetch) {
  const courtId = `court:${courtName}`;
  await writeEdge({ accessToken, officeId, sourceType: 'case', sourceId: caseId, targetType: 'court', targetId: courtId, relation: 'heard_in' }, fetchImpl);
}

/** ربط طرف بشركة تابعة/ممثل (تعارض موسع). */
export async function linkPartyToAffiliate(accessToken: string, officeId: string, partyId: string, affiliateId: string, relation: 'affiliate' | 'representative' | 'partner', fetchImpl: typeof fetch = fetch) {
  await writeEdge({ accessToken, officeId, sourceType: 'party', sourceId: partyId, targetType: 'party', targetId: affiliateId, relation }, fetchImpl);
}
