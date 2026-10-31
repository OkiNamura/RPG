/**
 * Генерация иллюстраций.
 *
 * Картинка приходит от модели как data-URL в ответе чата, мы сохраняем её
 * файлом и отдаём по обычному URL — так её можно кэшировать и пересматривать.
 */

export interface ImageResult {
  buffer: Buffer;
  mime: string;
  cost: number;
  ms: number;
  model: string;
}

interface ImageOptions {
  apiKey: string;
  /** своя база API: по умолчанию OpenRouter */
  baseUrl?: string;
  model: string;
  prompt: string;
  /**
   * Референсы (data-URL). Если переданы, модель держит внешность
   * с мастер-карточки и не «переизобретает» персонажа на каждом кадре.
   */
  references?: string[];
  timeoutMs?: number;
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  const started = Date.now();

  const content: unknown[] = [{ type: 'text', text: options.prompt }];
  for (const ref of options.references ?? []) {
    content.push({ type: 'image_url', image_url: { url: ref } });
  }

  const base = String(options.baseUrl ?? '').replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'Omika',
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: 'user',
          content: options.references?.length ? content : options.prompt,
        },
      ],
      modalities: ['image', 'text'],
      // Все кадры — вертикальные 9:16. Провайдер, который это не понимает,
      // просто проигнорирует поле; тогда работает подсказка в промте.
      image_config: { aspect_ratio: '9:16' },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`картинка не вышла: ${res.status} ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number };
  };

  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(url);
  if (!match) throw new Error('модель не вернула картинку');

  return {
    buffer: Buffer.from(match[2], 'base64'),
    mime: match[1],
    cost: data.usage?.cost ?? 0,
    ms: Date.now() - started,
    model: options.model,
  };
}

/** Промт сцены собираем из состояния, а не из прозы — так картинка не плывёт. */
export function scenePrompt(params: {
  style: string;
  place: string;
  time: string;
  weather: string;
  characters: string[];
  action: string;
}): string {
  const parts = [
    params.style,
    `Место: ${params.place}.`,
    `Время: ${params.time}.`,
    `Погода: ${params.weather}.`,
    params.characters.length ? `В кадре: ${params.characters.join(', ')}.` : '',
    params.action ? `Происходит: ${params.action}.` : '',
    'Композиция: широкий кадр, кинематографичный свет, без текста и водяных знаков.',
  ];
  return parts.filter(Boolean).join(' ');
}

export function portraitPrompt(params: {
  style: string;
  name: string;
  role?: string;
  appearance?: string;
  clothes?: string;
  character?: string;
}): string {
  return [
    params.style,
    `Портрет персонажа: ${params.name}.`,
    params.role ? `Роль: ${params.role}.` : '',
    params.appearance ? `Внешность: ${params.appearance}.` : '',
    params.clothes ? `Одежда: ${params.clothes}.` : '',
    params.character ? `Характер: ${params.character}.` : '',
    'Вертикальный кадр 9:16, плечевой портрет, тёмный фон, без текста и водяных знаков.',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Мастер-карточка персонажа: вид спереди, в полный рост, нейтральная поза.
 * Она становится референсом для всех дальнейших кадров, поэтому её и
 * просим «паспортной», без сцены и без эмоций.
 */
export function masterCardPrompt(params: {
  style: string;
  name: string;
  role?: string;
  appearance?: string;
  clothes?: string;
  character?: string;
}): string {
  return [
    params.style,
    `Мастер-лист персонажа: ${params.name}.`,
    params.role ? `Роль: ${params.role}.` : '',
    params.appearance ? `Внешность: ${params.appearance}.` : '',
    params.clothes ? `Одежда: ${params.clothes}.` : '',
    params.character ? `Характер: ${params.character}.` : '',
    'Вид спереди в полный рост, нейтральная поза, руки вдоль тела.',
    'Вертикальный кадр 9:16, ровный свет, однотонный фон, без сцены, без текста, без водяных знаков.',
  ]
    .filter(Boolean)
    .join(' ');
}

export function itemCardPrompt(params: { style: string; name: string; note?: string }): string {
  return [
    params.style,
    `Карточка предмета: ${params.name}.`,
    params.note ? `Описание: ${params.note}.` : '',
    'Вертикальный кадр 9:16, предмет крупно по центру, пергаментный фон, без текста, без рук.',
  ]
    .filter(Boolean)
    .join(' ');
}
