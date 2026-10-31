/**
 * Ключи API и провайдеры моделей.
 *
 * Ключи живут локально в data/keys.json, в API отдаются только маской.
 * Один ключ = провайдер (OpenRouter по умолчанию или свой совместимый API).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ApiKey {
  id: string;
  name: string;
  /** 'openrouter' или 'custom' */
  provider: 'openrouter' | 'custom';
  baseUrl: string;
  apiKey: string;
  createdAt: string;
}

export interface MaskedKey extends Omit<ApiKey, 'apiKey'> {
  /** маска вида sk-…ab12 */
  masked: string;
}

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

export function maskKey(value: string): string {
  const text = String(value ?? '');
  if (text.length <= 8) return text ? '••••' : '';
  return `${text.slice(0, 3)}…${text.slice(-4)}`;
}

export function normalizeBaseUrl(url: string | undefined): string {
  const value = String(url ?? '').trim().replace(/\/+$/, '');
  if (!value) return DEFAULT_BASE;
  return value.endsWith('/v1') ? value : `${value}/v1`;
}

export class KeyStore {
  private file: string;
  private items: ApiKey[] = [];
  private loaded = false;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'keys.json');
  }

  async load(): Promise<ApiKey[]> {
    if (this.loaded) return this.items;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as ApiKey[];
      this.items = Array.isArray(raw) ? raw : [];
    } catch {
      this.items = [];
    }
    this.loaded = true;
    return this.items;
  }

  async list(): Promise<MaskedKey[]> {
    await this.load();
    return this.items.map(({ apiKey, ...rest }) => ({ ...rest, masked: maskKey(apiKey) }));
  }

  /** Синхронный доступ после load() — для сборки моделей. */
  getSync(id: string | undefined): ApiKey | null {
    if (!id) return null;
    return this.items.find((item) => item.id === id) ?? null;
  }

  async get(id: string): Promise<ApiKey | null> {
    await this.load();
    return this.items.find((item) => item.id === id) ?? null;
  }

  async save(input: {
    id?: string;
    name?: string;
    provider?: 'openrouter' | 'custom';
    baseUrl?: string;
    apiKey?: string;
  }): Promise<MaskedKey> {
    await this.load();
    const id = String(input.id ?? '').trim() || `key-${Date.now().toString(36)}`;
    const existing = this.items.find((item) => item.id === id);
    const provider = input.provider === 'custom' ? 'custom' : 'openrouter';
    const item: ApiKey = {
      id,
      name: String(input.name ?? existing?.name ?? 'Ключ').trim() || 'Ключ',
      provider,
      baseUrl: normalizeBaseUrl(input.baseUrl ?? existing?.baseUrl),
      apiKey: String(input.apiKey ?? '').trim() || existing?.apiKey || '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    if (!item.apiKey) throw new Error('пустой ключ API');
    if (existing) {
      Object.assign(existing, item);
    } else {
      this.items.push(item);
    }
    await this.persist();
    return { ...item, apiKey: undefined as never, masked: maskKey(item.apiKey) } as unknown as MaskedKey;
  }

  async remove(id: string): Promise<boolean> {
    await this.load();
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length !== before) await this.persist();
    return this.items.length !== before;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(this.items, null, 2)}\n`, 'utf8');
  }
}

export interface KeyModel {
  id: string;
  name: string;
  kind: 'text' | 'image';
  input: number | null;
  output: number | null;
  image: number | null;
  context: number | null;
  free: boolean;
}

interface RawModel {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string | number>;
}

/** Список моделей провайдера с ценами. Работает и с OpenRouter, и с OpenAI-совместимыми. */
export async function fetchKeyModels(
  key: Pick<ApiKey, 'baseUrl' | 'apiKey'>,
): Promise<KeyModel[]> {
  const base = normalizeBaseUrl(key.baseUrl);
  const res = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${key.apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`провайдер ответил ${res.status}`);
  const json = (await res.json()) as { data?: RawModel[] };
  const list = Array.isArray(json.data) ? json.data : [];

  return list
    .map((model) => {
      const id = String(model.id ?? '');
      const pricing = model.pricing ?? {};
      const num = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed * 1e6 : null;
      };
      const modality = String(model.architecture?.modality ?? '');
      const outputs = model.architecture?.output_modalities ?? [];
      const isImage =
        /image/i.test(modality) && !/text->text$/i.test(modality)
          ? true
          : outputs.includes('image') || /image|diffusion|dall|flux|seedream/i.test(id);
      const input = num(pricing.prompt ?? pricing.input ?? pricing.input_per_1m);
      const output = num(pricing.completion ?? pricing.output);
      const imagePrice = Number(pricing.image ?? pricing.image_output ?? NaN);
      const image = Number.isFinite(imagePrice) ? imagePrice : null;
      return {
        id,
        name: String(model.name ?? id),
        kind: (isImage ? 'image' : 'text') as 'text' | 'image',
        input,
        output,
        image,
        context: Number(model.context_length ?? 0) || null,
        free: input === 0 && output === 0,
      };
    })
    .filter((model) => model.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
