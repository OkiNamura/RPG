/**
 * Библиотека карточек: одна карточка — один JSON-файл в data/cards.
 *
 * Имя файла: {type}_{id9}_{slug}.json.
 * Верхний уровень — общие поля для фильтров, `data` — специфика типа.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rank } from './rank.ts';

export const CARD_TYPES = [
  'hero',
  'npc',
  'item',
  'location',
  'faction',
  'quest',
  'creature',
] as const;

export type CardType = (typeof CARD_TYPES)[number];

export interface CardOrigin {
  campaignId?: string;
  turn?: number;
  title?: string;
}

export interface GameCard {
  schema: 1;
  id: string;
  type: CardType;
  name: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  rating?: string;
  gender?: 'male' | 'female';
  age?: number;
  role?: string;
  status?: string;
  rank?: Rank;
  rankPoints?: number;
  rankLocked?: boolean;
  appearance?: string;
  character?: string;
  biography?: string;
  habits?: string;
  abilities?: string;
  attributes?: Record<string, number>;
  skills?: Record<string, number>;
  relations?: { with: string; feeling: string }[];
  equipment?: { name: string; qty?: number; where?: string }[];
  data?: Record<string, unknown>;
  origin?: CardOrigin;
  createdAt: string;
  updatedAt: string;
}

const SLUG_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .split('')
    .map((char) => SLUG_MAP[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'unnamed';
}

export function cardFileName(card: Pick<GameCard, 'type' | 'id' | 'name'>): string {
  return `${card.type}_${card.id.split('_').at(-1)}_${slugify(card.name)}.json`;
}

export function nextCardId(cards: GameCard[], type: CardType): string {
  let max = 0;
  for (const card of cards) {
    if (card.type !== type) continue;
    const value = Number(card.id.split('_').at(-1));
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return `${type}_${String(max + 1).padStart(9, '0')}`;
}

function normalizeCard(raw: unknown): GameCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const card = raw as Partial<GameCard>;
  if (!card.type || !CARD_TYPES.includes(card.type)) return null;
  if (!card.name || !card.id) return null;
  const now = new Date().toISOString();
  return {
    schema: 1,
    ...card,
    type: card.type,
    name: String(card.name).slice(0, 160),
    tags: Array.isArray(card.tags) ? card.tags.map(String).slice(0, 20) : [],
    skills: card.skills && typeof card.skills === 'object' ? card.skills : {},
    attributes: card.attributes && typeof card.attributes === 'object' ? card.attributes : {},
    relations: Array.isArray(card.relations) ? card.relations : [],
    equipment: Array.isArray(card.equipment) ? card.equipment : [],
    data: card.data && typeof card.data === 'object' ? card.data : {},
    createdAt: card.createdAt ?? now,
    updatedAt: card.updatedAt ?? now,
  } as GameCard;
}

export async function listCards(dir: string): Promise<GameCard[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  const cards: GameCard[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
      const card = normalizeCard(raw);
      if (card) cards.push(card);
    } catch {
      /* битый файл пропускаем, остальные читаются */
    }
  }
  return cards.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, 'ru'));
}

export async function saveCard(dir: string, card: GameCard): Promise<GameCard> {
  await mkdir(dir, { recursive: true });
  const normalized = normalizeCard(card);
  if (!normalized) throw new Error('некорректная карточка');
  normalized.updatedAt = new Date().toISOString();
  const file = join(dir, cardFileName(normalized));
  await writeFile(file, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}
