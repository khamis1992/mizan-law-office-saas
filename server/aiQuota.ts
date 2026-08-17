import { readResponse, requiredEnv, supabaseHeaders, type Profile } from './supabaseAccess';

/**
 * سقف استخدام الذكاء الاصطناعي: مربوط بخطة المكتب (ai_monthly_requests)
 * ويُفحص قبل كل نداء للنموذج. الدالة check_ai_request_quota أمنية (security definer)
 * وتتحقق من انتماء المستخدم للمكتب قبل أي حساب.
 */

export type AiQuota = { allowed: boolean; used: number; cap: number | null };

export async function checkAiQuota(accessToken: string, officeId: string, fetchImpl: typeof fetch = fetch): Promise<AiQuota> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/check_ai_request_quota`, {
    method: 'POST',
    headers: supabaseHeaders(accessToken),
    body: JSON.stringify({ p_office_id: officeId }),
  });
  const rows = await readResponse<Array<{ allowed: boolean; used: number; cap: number | null }>>(response);
  const quota = rows[0];
  if (!quota) throw new Error('تعذر التحقق من سقف الاستخدام الخاص بمكتبك.');
  return { allowed: quota.allowed, used: quota.used, cap: quota.cap };
}

export async function assertAiQuota(accessToken: string, profile: Profile, fetchImpl: typeof fetch = fetch) {
  const officeId = profile.office_id;
  if (!officeId) throw new Error('يرجى إنشاء مكتب أو قبول دعوة الانضمام قبل استخدام خدمات الذكاء الاصطناعي.');
  const quota = await checkAiQuota(accessToken, officeId, fetchImpl);
  if (!quota.allowed) {
    const capText = quota.cap === null ? 'غير محدود' : String(quota.cap);
    throw new Error(`بلغ مكتبك سقف طلبات الذكاء الاصطناعي لهذا الشهر (${quota.used} من ${capText}). يمكن لمدير المكتب ترقية الخطة أو الانتظار حتى بداية الشهر القادم.`);
  }
  return quota;
}
