/**
 * API-эмбеддинги (OpenAI-совместимый /embeddings).
 * Если ключ или сеть недоступны — вызывающий код падает на локальные hashing-векторы.
 */
const DEFAULT_URL = 'https://openrouter.ai/api/v1/embeddings';
const DEFAULT_MODEL = 'openai/text-embedding-3-small';

export interface EmbeddingConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export async function embedTexts(texts: string[], config: EmbeddingConfig): Promise<number[][] | null> {
  if (!config.apiKey || !texts.length) return null;
  const url = config.baseUrl || process.env.OMIKA_EMBED_BASE_URL || DEFAULT_URL;
  const model = config.model || process.env.OMIKA_EMBED_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost',
      },
      body: JSON.stringify({ model, input: texts.slice(0, 16) }),
      signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vectors = (data.data ?? []).map((item) => item.embedding).filter((vector): vector is number[] => Array.isArray(vector));
    return vectors.length === texts.slice(0, 16).length ? vectors : null;
  } catch {
    return null;
  }
}
