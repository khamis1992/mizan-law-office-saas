import { requiredEnv } from './supabaseAccess';

/**
 * عميل موحّد لمزود الذكاء الاصطناعي: OpenAI (أولوية عند توفر OPENAI_API_KEY)
 * أو Grok عبر XAI_API_KEY. صيغة json_schema strict متوافقة مع المزودين.
 */

export type ChatMessage = { role: 'system' | 'user'; content: string };
export type ChatRequest = { temperature: number; response_format: unknown; messages: ChatMessage[] };

type ProviderConfig = { provider: 'openai' | 'grok'; endpoint: string; apiKey: string; model: string };

function resolveProvider(): ProviderConfig {
  // قد تكون OPENAI_API_KEY موروثة من إعداد محلي قديم (مثل ollama)؛
  // المتغير المخصص MZ_OPENAI_API_KEY له الأولوية، ولا نقبل OPENAI_API_KEY إلا بمفتاح sk- صالح.
  const dedicated = process.env.MZ_OPENAI_API_KEY?.trim();
  const inherited = process.env.OPENAI_API_KEY?.trim();
  const openAiKey = dedicated || (inherited && inherited.startsWith('sk-') ? inherited : undefined);
  if (openAiKey) {
    const model = process.env.MZ_OPENAI_MODEL?.trim() || 'gpt-4o';
    return { provider: 'openai', endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: openAiKey, model };
  }
  return { provider: 'grok', endpoint: 'https://api.x.ai/v1/chat/completions', apiKey: requiredEnv('XAI_API_KEY'), model: 'grok-4.6' };
}

export function aiProviderName(): 'openai' | 'grok' {
  return resolveProvider().provider;
}

export function aiModelName(): string {
  return resolveProvider().model;
}

/**
 * قراءة استجابة مزود الذكاء الاصطناعي مع تحويل أخطاء الحساب الشائعة
 * إلى رسائل عربية واضحة للمستخدم النهائي بدل تفاصيل الخام.
 */
async function readAiCompletion<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (response.status === 401) throw new Error('مفتاح الذكاء الاصطناعي غير صالح — راجع إعداد المزود على الخادم (OPENAI_API_KEY أو XAI_API_KEY).');
    if (response.status === 403) {
      const credits = /credit|license|billing|quota/i.test(detail);
      throw new Error(credits
        ? 'حساب مزود الذكاء الاصطناعي لا يحتوي رصيداً — أضف الرصيد/الترخيص من لوحة المزود ثم أعد المحاولة.'
        : 'لا تملك صلاحية استخدام نموذج الذكاء الاصطناعي — راجع إعدادات الفريق لدى المزود.');
    }
    if (response.status === 429) throw new Error('تجاوزت حد الطلبات لدى مزود الذكاء الاصطناعي — انتظر قليلاً ثم أعد المحاولة.');
    throw new Error(`تعذر تنفيذ طلب الذكاء الاصطناعي (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
}

export async function callChatCompletion(request: ChatRequest, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<string | null> {
  const config = resolveProvider();
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: request.temperature,
      response_format: request.response_format,
      messages: request.messages,
    }),
  });
  const completion = await readAiCompletion<{ choices?: Array<{ message?: { content?: string } }> }>(response);
  return completion.choices?.[0]?.message?.content ?? null;
}


export type VisionRequest = { system: string; text: string; images: string[]; temperature: number; response_format: unknown };

/** تحليل صور المستندات (data URLs) — يتطلب مزوداً يدعم الرؤية (OpenAI gpt-4o). */
export async function callVisionCompletion(request: VisionRequest, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const config = resolveProvider();
  if (config.provider !== 'openai') {
    throw new Error('التحليل البصري للأوراق يتطلب مزود OpenAI — اضبط MZ_OPENAI_API_KEY أو أرفق وصفاً نصياً للوقائع بدلاً من الصور.');
  }
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.text }];
  for (const image of request.images) content.push({ type: 'image_url', image_url: { url: image } });
  const response = await fetchImpl(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: request.temperature,
      response_format: request.response_format,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content },
      ],
    }),
  });
  const completion = await readAiCompletion<{ choices?: Array<{ message?: { content?: string } }> }>(response);
  return completion.choices?.[0]?.message?.content ?? null;
}