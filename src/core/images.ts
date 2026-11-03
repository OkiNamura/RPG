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
  /** размер кадра для локального провайдера, например 512x768 */
  size?: string;
  timeoutMs?: number;
  /** отмена текущей генерации */
  signal?: AbortSignal;
}

function abortSignal(options: ImageOptions, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

/**
 * Unsloth Studio может быть запущен, но модель после ребута не загружена.
 * Лениво поднимаем Qwen-Image Turbo в low_vram и ждём готовности.
 */
async function ensureLocalImage(
  base: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<void> {
  const root = base.replace(/\/v1$/, '');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const status = async (): Promise<boolean> => {
    const res = await fetch(`${root}/api/inference/images/status`, { headers });
    if (!res.ok) throw new Error(`Unsloth Studio: статус ${res.status}`);
    return Boolean((await res.json()).loaded);
  };
  if (await status()) return;

  const load = await fetch(`${root}/api/inference/images/load`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_path: model,
      gguf_filename: process.env.UNSLOTH_GGUF ?? 'qwen-image-2.1-turbo-Q6_K.gguf',
      model_kind: 'gguf',
      memory_mode: 'low_vram',
      cpu_offload: true,
      speed_mode: 'eager',
    }),
  });
  if (!load.ok) {
    const detail = await load.text().catch(() => '');
    throw new Error(`Unsloth Studio: загрузка модели ${load.status} ${detail.slice(0, 160)}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (await status()) return;
  }
  throw new Error('Unsloth Studio: модель не загрузилась за отведённое время');
}

async function generateQwenImage(options: ImageOptions): Promise<ImageResult> {
  const started = Date.now();
  const base = String(options.baseUrl ?? '').replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(base);
  if (local) {
    await ensureLocalImage(base, options.apiKey, options.model, options.timeoutMs ?? 300_000);
    if (options.references?.length) {
      // Нативный endpoint умеет референсы и negative prompt; OpenAI-совместимый — нет.
      const root = base.replace(/\/v1$/, '');
      const [width, height] = (options.size ?? '512x768').split('x').map(Number);
      const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };
      try {
        const ref = await fetch(`${root}/api/inference/images/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prompt: options.prompt,
            negative_prompt:
              'text, letters, captions, subtitles, speech bubbles, comic panels, watermark, logo, UI',
            width: width || 512,
            height: height || 768,
            steps: 9,
            guidance: 0,
            reference_images: options.references.slice(0, 9),
            reference_resolution: 512,
          }),
          signal: abortSignal(options, options.timeoutMs ?? 300_000),
        });
        if (ref.ok) {
          const found = (await ref.json()) as { images?: { url?: string }[] };
          const imageUrl = found.images?.[0]?.url;
          if (imageUrl) {
            const absolute = imageUrl.startsWith('http') ? imageUrl : `${root}${imageUrl}`;
            const image = await fetch(absolute, { headers, signal: abortSignal(options, 60_000) });
            if (image.ok) {
              return {
                buffer: Buffer.from(await image.arrayBuffer()),
                mime: 'image/png',
                cost: 0,
                ms: Date.now() - started,
                model: options.model,
              };
            }
          }
        }
      } catch {
        /* ниже — обычный txt2img без референсов */
      }
    }
  }
  const body: Record<string, unknown> = local
    ? {
        model: options.model,
        prompt: options.prompt,
        n: 1,
        size: options.size ?? '512x768',
        response_format: 'b64_json',
      }
    : {
        model: options.model,
        prompt: options.prompt,
        aspect_ratio: '9:16',
        resolution: '1K',
        n: 1,
      };
  if (!local && options.references?.length) {
    body.input_references = options.references
      .slice(0, 3)
      .map((url) => ({ type: 'image_url', image_url: { url } }));
  }
  const res = await fetch(local ? `${base}/images/generations` : `${base}/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'Omika',
    },
    body: JSON.stringify(body),
    signal: abortSignal(options, options.timeoutMs ?? (local ? 300_000 : 120_000)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`картинка не вышла: ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
    usage?: { cost?: number };
  };
  const first = data.data?.[0];
  let buffer: Buffer;
  if (first?.b64_json) {
    buffer = Buffer.from(first.b64_json, 'base64');
  } else if (first?.url) {
    const image = await fetch(first.url, { signal: abortSignal(options, options.timeoutMs ?? 120_000) });
    if (!image.ok) throw new Error(`картинка не скачалась: ${image.status}`);
    buffer = Buffer.from(await image.arrayBuffer());
  } else {
    throw new Error('модель не вернула картинку');
  }
  return {
    buffer,
    mime:
      buffer[0] === 0xff && buffer[1] === 0xd8
        ? 'image/jpeg'
        : buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          ? 'image/png'
          : 'image/png',
    cost: local ? 0 : data.usage?.cost ?? 0.03 + (options.references?.length ?? 0) * 0.003,
    ms: Date.now() - started,
    model: options.model,
  };
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  // Qwen Image 3 живёт на отдельном /images endpoint, а не в chat/completions.
  if (/qwen.*image/i.test(options.model)) {
    return generateQwenImage(options);
  }
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
    signal: abortSignal(options, options.timeoutMs ?? 120_000),
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
  location?: string;
  hero?: { name: string; gender?: string; description?: string };
}): string {
  const parts = [
    params.style,
    'Одна иллюстрация конкретной сцены из текста, не обложка, не комикс и не раскадровка.',
    params.hero
      ? `Главный герой обязательно в кадре: ${params.hero.name}${
          params.hero.gender ? `, ${params.hero.gender}` : ''
        }${params.hero.description ? `, ${params.hero.description}` : ''}. Покажи его/её лицо и фигуру, не оставляй комнату без героя.`
      : '',
    `Место: ${params.place}.`,
    params.location ? `Детали места: ${params.location}.` : '',
    `Время: ${params.time}. Погода: ${params.weather}.`,
    params.characters.length ? `Кто ещё в кадре: ${params.characters.join(' | ')}.` : '',
    params.action ? `Что происходит (главное): ${params.action}.` : '',
    'Позы и выражения лиц соответствуют действию; одежда и вещи — из описания.',
    'Композиция: широкий кинематографичный кадр, глубина, свет по времени суток.',
    'Без панелей, реплик, подписей, заголовков и водяных знаков поверх изображения. Вывески — только мелкая деталь окружения, без крупного читаемого текста.',
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

/**
 * Лист персонажа: одна фигура в полный рост, вид спереди.
 * Без текста и цифр — атрибуты живут в HTML-карточке, а не на картинке.
 */
export function characterSheetPrompt(params: {
  style: string;
  name: string;
  role?: string;
  appearance?: string;
  clothes?: string;
  character?: string;
}): string {
  return [
    params.style,
    `Лист персонажа: ${params.name}.`,
    params.role ? `Роль: ${params.role}.` : '',
    params.appearance ? `Внешность: ${params.appearance}.` : '',
    params.clothes ? `Одежда: ${params.clothes}.` : '',
    params.character ? `Характер: ${params.character}.` : '',
    'Одна фигура в полный рост, вид спереди, нейтральная поза, лицо видно.',
    'Одинаковая одежда и причёска, ровный свет, однотонный фон.',
    'Без текста, без цифр, без рамок, без водяных знаков.',
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
