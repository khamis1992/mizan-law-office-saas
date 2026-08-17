/**
 * وصول مشترك إلى Supabase باسم المستخدم (RLS) — يُستخدم من المساعد ومركز البحث والوكلاء.
 * كل استعلام يمر برمز وصول المستخدم نفسه حتى يبقى عزل المكاتب مفروضاً من قواعد الصفوف.
 */

export type SupabaseUser = { id: string; email?: string | null };
export type Profile = { id: string; office_id: string | null; role: 'manager' | 'lawyer' | 'employee'; display_name: string };

export function requiredEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY' | 'XAI_API_KEY') {
  const value = process.env[name];
  if (!value) throw new Error(`الإعداد ${name} غير متوفر على الخادم.`);
  return value;
}

export function supabaseHeaders(accessToken: string) {
  return {
    apikey: requiredEnv('VITE_SUPABASE_PUBLISHABLE_KEY'),
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

export async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`تعذر تنفيذ الطلب الآمن (${response.status}): ${detail.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

export async function getVerifiedUser(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<SupabaseUser> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const response = await fetchImpl(`${baseUrl}/auth/v1/user`, { headers: supabaseHeaders(accessToken) });
  return readResponse<SupabaseUser>(response);
}

export async function getProfile(accessToken: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<Profile> {
  const baseUrl = requiredEnv('VITE_SUPABASE_URL');
  const query = new URLSearchParams({ select: 'id,office_id,role,display_name', id: `eq.${userId}`, limit: '1' });
  const response = await fetchImpl(`${baseUrl}/rest/v1/profiles?${query.toString()}`, { headers: supabaseHeaders(accessToken) });
  const profiles = await readResponse<Profile[]>(response);
  if (!profiles[0]?.office_id) throw new Error('يرجى إنشاء مكتب أو قبول دعوة الانضمام قبل استخدام المساعد القانوني.');
  return profiles[0];
}

export function assertPractitioner(profile: Profile, message = 'هذه المساحة متاحة لمدير المكتب والمحامي فقط.') {
  if (!['manager', 'lawyer'].includes(profile.role)) throw new Error(message);
  return profile;
}
