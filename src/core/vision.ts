/**
 * Необязательная проверка кадра внешней vision-моделью.
 * Включается только если задан OMIKA_VISION_MODEL: без него никаких расходов.
 */
export interface VisionReview {
  score: number;
  match: boolean;
  missing: string[];
  extra: string[];
  text: boolean;
  note: string;
  model: string;
  cost: number;
}

export async function reviewImage(params: {
  buffer: Buffer;
  mime: string;
  scene: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}): Promise<VisionReview | null> {
  const model = params.model || process.env.OMIKA_VISION_MODEL || '';
  const apiKey = params.apiKey || process.env.OPENROUTER_API_KEY || '';
  if (!model || !apiKey) return null;
  const base = (params.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const image = `data:${params.mime};base64,${params.buffer.toString('base64')}`;
  const system =
    'Ты проверяешь иллюстрацию к сцене. Верни только JSON: ' +
    '{"score":0..1,"match":boolean,"missing":[],"extra":[],"text":boolean,"note":"кратко"}. ' +
    'missing — важные элементы сцены, которых нет. extra — лишние люди/объекты. text — есть ли читаемый текст.';
  const user = [
    { type: 'text', text: `Контракт сцены:\n${params.scene.slice(0, 3000)}` },
    { type: 'image_url', image_url: { url: image } },
  ];
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'Omika vision QA',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? 45_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.replace(/^```json\s*|```$/g, '').trim()) as Partial<VisionReview>;
    return {
      score: Math.max(0, Math.min(1, Number(parsed.score ?? 0))),
      match: Boolean(parsed.match),
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String).slice(0, 10) : [],
      extra: Array.isArray(parsed.extra) ? parsed.extra.map(String).slice(0, 10) : [],
      text: Boolean(parsed.text),
      note: String(parsed.note ?? '').slice(0, 500),
      model,
      cost: Number(data.usage?.cost ?? 0),
    };
  } catch {
    return null;
  }
}
