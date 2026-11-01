/**
 * Сохранение и загрузка кампании.
 *
 * Формат: один JSON на кампанию — стейт, конспект, тексты, счётчики.
 * Килобайты, читается глазами, диффится гитом, легко переносится между
 * машинами. Никакой базы, пока не понадобится.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Conspect, type Arc } from './conspect.ts';
import type { GameState } from './state.ts';
import type { CampaignText, Totals } from './turn.ts';

export interface CampaignMeta {
  title?: string;
  presetId?: string;
  presetTitle?: string;
  tags?: { group: string; field: string; value: string }[];
  createdAt?: string;
  /** 0..11: от детской сказки до предела жестокости */
  toneLevel?: number;
  toneLevelName?: string;
  /** замки на блоках ядра: что нельзя править */
  locked?: { core?: boolean; tone?: boolean; world?: boolean; hero?: boolean };
  /** промты, собранные мастером промтов под эту игру */
  prompts?: {
    gm?: string;
    /** версия сборки статики: 2 — GM+ТОН, ПРАВИЛА, МИР, ГЕРОЙ */
    assembly?: number;
    temperature?: number;
    artists?: { hero?: string; npc?: string; item?: string; scene?: string };
  };
  /** теги иллюстратора, выбранные в этой игре */
  art?: { include: string[]; exclude: string[] };
  /** параметры ИИ, выбранные в иллюстраторе */
  aiSettings?: string[];
  /** эпоха игры: год, выбранный бегунком */
  epochYear?: number;
  /** мир живёт вне обычного года */
  altTime?: boolean;
  /** своё название эпохи/летоисчисления */
  eraLabel?: string;
  /** пол героя: male | female */
  gender?: 'male' | 'female';
  /** смерть постоянная; false — герой может очнуться */
  permadeath?: boolean;
  /** распределение опыта пати */
  xpMode?: 'own' | 'heroParty' | 'even' | 'dynamic';
  /** заморожена в админке: ходы запрещены */
  frozen?: boolean;
}

/** Один вариант ответа на ход: проза и состояние после него. */
export interface TurnVariant {
  prose: string;
  state: GameState;
  summary: string;
  lastSummaryTurn?: number;
}

/** Снимок состояния после хода — основа для перегенерации и откатов. */
export interface TurnSnapshot {
  turn: number;
  input: string;
  prose: string;
  state: GameState;
  summary: string;
  /** до какого хода конспект уже собран */
  lastSummaryTurn?: number;
  /** какой вариант сейчас показан: 1 — основной, 2..N — альтернативы */
  variant?: number;
  variants?: TurnVariant[];
}

export interface SavedCampaign {
  version: 1;
  savedAt: string;
  text: CampaignText;
  state: GameState;
  conspect: Arc[];
  /** скользящий конспект: всё, что старше окна последних ходов */
  summary?: string;
  /** старые арки, вытесненные из summary, но сохранённые в архиве */
  arcArchive?: string[];
  /** до какого хода конспект уже собран (переживает перезапуск) */
  lastSummaryTurn?: number;
  /** память истории: закреплённые игроком факты */
  memory?: string;
  /** состояние и конспект до первого хода — точка полного откката */
  initial?: TurnVariant;
  /** агенты этой игры: у каждой кампании свои */
  agents?: Record<string, unknown>;
  /** по одному снимку на ход: перегенерация, редактирование, варианты */
  turns?: TurnSnapshot[];
  /** расход по агентам */
  usage?: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>;
  totals: Totals;
  meta?: CampaignMeta;
}

export function campaignPath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

export async function saveCampaign(dir: string, id: string, data: Omit<SavedCampaign, 'version' | 'savedAt'>): Promise<string> {
  await mkdir(dir, { recursive: true });
  const payload: SavedCampaign = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...data,
  };
  const path = campaignPath(dir, id);
  // Атомарная запись: сначала temp, потом rename — сейв не бьётся при падении.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
  return path;
}

export async function loadCampaign(dir: string, id: string): Promise<SavedCampaign | null> {
  try {
    const raw = await readFile(campaignPath(dir, id), 'utf8');
    const parsed = JSON.parse(raw) as SavedCampaign;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function conspectFrom(saved: SavedCampaign): Conspect {
  return Conspect.fromJSON(saved.conspect, '# Конспект кампании');
}
