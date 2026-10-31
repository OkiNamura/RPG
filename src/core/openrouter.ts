/**
 * Клиент OpenRouter. Без SDK — только fetch.
 *
 * Два решения, которые тут спрятаны:
 *   1) reasoning отключён: для прозы размышления модели — потеря времени,
 *      денег и места (они съедают max_tokens, текст обрывается);
 *   2) структурный вывод: проза и изменения приходят двумя полями по схеме,
 *      поэтому «забыл блок изменений» становится невозможным.
 */

import { estimateTokens } from './context.ts';
import type { Delta } from './delta.ts';
import type { Model, ModelReply, Msg } from './model.ts';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';

export interface OpenRouterConfig {
  apiKey: string;
  /** база API: по умолчанию OpenRouter, можно свой совместимый */
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** по умолчанию reasoning выключен */
  reasoning?: boolean;
  /** по умолчанию структурный вывод включён */
  structured?: boolean;
  /**
   * Как OpenRouter выбирает провайдера модели.
   * 'throughput' вдвое быстрее на длинной генерации, 'price' — дешевле.
   */
  sort?: 'price' | 'throughput' | 'latency';
}

export interface ModelPricing {
  /** $ за 1M токенов */
  input: number;
  output: number;
  cachedInput: number;
  context: number;
}

/** Схема одного хода: проза обязательна, изменения обязательны (могут быть пустыми). */
const TURN_SCHEMA = {
  type: 'object',
  properties: {
    prose: {
      type: 'string',
      description: 'Художественный текст сцены. Без JSON, без служебных пометок, без вопросов игроку.',
    },
    delta: {
      type: 'object',
      description: 'Изменения состояния за этот ход. Пустой объект, если ничего не изменилось.',
      properties: {
        place: { type: 'string' },
        weather: { type: 'string' },
        advanceHours: { type: 'number' },
        money: {
          type: 'object',
          properties: { gold: { type: 'number' }, silver: { type: 'number' }, copper: { type: 'number' } },
        },
        addItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              qty: { type: 'number' },
              where: { type: 'string', enum: ['equipped', 'inventory', 'vault', 'lost'] },
            },
            required: ['name', 'qty'],
          },
        },
        removeItems: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, qty: { type: 'number' } },
            required: ['name', 'qty'],
          },
        },
        conditions: { type: 'array', items: { type: 'string' } },
        wounds: {
          type: 'array',
          items: {
            type: 'object',
            properties: { where: { type: 'string' }, severity: { type: 'number' } },
            required: ['where', 'severity'],
          },
        },
        promises: { type: 'array', items: { type: 'string' } },
        hiddenFacts: {
          type: 'array',
          description: 'Не больше одного за ход. Только то, что уже существует в мире и станет важным позже.',
          items: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        },
        flags: { type: 'object', additionalProperties: true },
      },
    },
  },
  required: ['prose', 'delta'],
  additionalProperties: false,
};

let catalog: Map<string, ModelPricing> | null = null;

/**
 * Провайдер не всегда соблюдает схему: бывает, что присылает прозу,
 * а следом JSON отдельным куском. Достаём объект из любого места строки,
 * а всё, что стоит до него, считаем прозой.
 */
function extractTurn(raw: string): { prose: string; delta: Delta } | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { prose?: unknown; delta?: unknown };
    if (typeof obj.prose !== 'string') return null;
    const before = raw.slice(0, start).trim();
    return { prose: before || obj.prose, delta: (obj.delta as Delta) ?? {} };
  } catch {
    return null;
  }
}

export async function fetchPricing(modelId: string, baseUrl?: string, apiKey?: string): Promise<ModelPricing | null> {
  if (!catalog) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
    const res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: { id: string; pricing: Record<string, string>; context_length: number }[] };
    catalog = new Map(
      json.data.map((m) => [
        m.id,
        {
          input: Number(m.pricing.prompt ?? 0) * 1e6,
          output: Number(m.pricing.completion ?? 0) * 1e6,
          cachedInput: Number(m.pricing.input_cache_read ?? m.pricing.prompt ?? 0) * 1e6,
          context: m.context_length ?? 0,
        },
      ]),
    );
  }
  return catalog.get(modelId) ?? null;
}

export class OpenRouterModel implements Model {
  readonly name: string;
  private readonly cfg: OpenRouterConfig;

  constructor(cfg: OpenRouterConfig) {
    this.cfg = cfg;
    this.name = cfg.model;
  }

  private chatUrl(): string {
    const base = String(this.cfg.baseUrl ?? '').replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
    return `${base}/chat/completions`;
  }

  private body(messages: Msg[], maxTokens: number | undefined, structured: boolean): string {
    return JSON.stringify({
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature ?? 1,
      max_tokens: maxTokens ?? this.cfg.maxTokens ?? (structured ? 1200 : 900),
      usage: { include: true },
      ...(this.cfg.reasoning ? {} : { reasoning: { enabled: false } }),
      ...(this.cfg.sort ? { provider: { sort: this.cfg.sort, allow_fallbacks: true } } : {}),
      ...(structured
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'turn', strict: false, schema: TURN_SCHEMA },
            },
          }
        : {}),
    });
  }

  async stream(messages: Msg[], onDelta: (text: string) => void): Promise<ModelReply> {
    const res = await fetch(this.chatUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost',
        'X-Title': 'Omika',
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        temperature: this.cfg.temperature ?? 1,
        max_tokens: this.cfg.maxTokens ?? 1200,
        usage: { include: true },
        stream: true,
        ...(this.cfg.reasoning ? {} : { reasoning: { enabled: false } }),
        ...(this.cfg.sort ? { provider: { sort: this.cfg.sort, allow_fallbacks: true } } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenRouter stream ${res.status}: ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } = {};

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const obj = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
            usage?: typeof usage;
          };
          const piece = obj.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            text += piece;
            onDelta(piece);
          }
          if (obj.usage) usage = obj.usage;
        } catch {
          /* кусок не разобрался — пропускаем */
        }
      }
    }

    return {
      text,
      outputTokens: usage.completion_tokens ?? estimateTokens(text),
      inputTokens: usage.prompt_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens,
    };
  }

  async complete(messages: Msg[], maxTokens?: number): Promise<ModelReply> {
    const structured = this.cfg.structured ?? true;

    const send = async (withSchema: boolean): Promise<Response> => {
      let last: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await fetch(this.chatUrl(), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.cfg.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://localhost',
            'X-Title': 'Omika',
          },
          body: this.body(messages, maxTokens, withSchema),
          // Модель может зависнуть: не ждём вечно.
          signal: AbortSignal.timeout(120_000),
        });
        last = res;
        if (res.ok) return res;
        // 429 и 5xx имеют смысл повторить; 4xx — нет.
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
          continue;
        }
        return res;
      }
      return last as Response;
    };

    let res = await send(structured);
    // Схему поддерживают не все провайдеры: откат только на явный отказ схемы.
    if (!res.ok && structured && (res.status === 400 || res.status === 422)) {
      res = await send(false);
    }

    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OpenRouter ${res.status} (${this.cfg.model}): ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
      provider?: string;
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    if (data.choices?.[0]?.finish_reason === 'length') {
      console.warn(`[openrouter] обрыв по max_tokens (${this.cfg.model})`);
    }

    let text = content;
    let delta: Delta | null | undefined;

    if (structured) {
      const turn = extractTurn(content);
      if (turn) {
        text = turn.prose;
        delta = turn.delta;
      }
    }

    return {
      text,
      delta,
      outputTokens: usage.completion_tokens ?? estimateTokens(content),
      inputTokens: usage.prompt_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens,
    };
  }
}
