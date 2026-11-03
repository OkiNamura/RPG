/**
 * HTTP-сервер игры: статика и API. Без зависимостей.
 *
 *   node src/server.ts
 *   → http://127.0.0.1:7801
 *
 * Сессии живут в памяти, после каждого хода пишутся на диск (data/campaigns).
 * Ключ OpenRouter читается только здесь и в браузер не попадает.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, sep } from 'node:path';
import { characterSheetPrompt, generateImage, itemCardPrompt, masterCardPrompt, portraitPrompt, scenePrompt } from './core/images.ts';
import { renderMap } from './core/map.ts';
import { createState, normalizeState, type Actor, type GameState, type NumberChange, type Resource } from './core/state.ts';
import { Conspect, type Arc } from './core/conspect.ts';
import { createSession, runTurn, addUsage, type Session, type TurnStats } from './core/turn.ts';
import {
  conspectFrom,
  loadCampaign,
  saveCampaign,
  type CampaignMeta,
  type TurnSnapshot,
  type TurnVariant,
} from './core/storage.ts';
import { OpenRouterModel, fetchPricing } from './core/openrouter.ts';
import { applyDelta, dedupeActorLists, type ActorPatch, type Delta } from './core/delta.ts';
import { listCards, nextCardId, saveCard, type CardType, type GameCard } from './core/cards.ts';
import { deletePreset, listPresets, nextPresetId, savePreset, type GamePreset } from './core/presets.ts';
import { addRankPoints, normalizeRank, randomStartRank, type Rank } from './core/rank.ts';
import { allowLogin, authEnabled, checkPassword, clearCookie, clearLoginAttempts, createCaptcha, createSessionToken, loginPage, requestSession, sessionCookie, turnstileConfigured, verifyCaptcha, verifySessionToken, verifyTurnstile } from './core/auth.ts';
import { renderState } from './core/context.ts';
import {
  DEFAULT_AGENTS,
  IMAGE_FALLBACK_MODEL,
  IMAGE_MODEL,
  loadAgents,
  resetAgent,
  saveAgents,
  type AgentConfig,
  type AgentId,
  type AgentSet,
} from './core/agents.ts';
import {
  heroBlock,
  loadCore,
  loadHeroPrompt,
  saveSource,
  loadTonePrompt,
  loadWorldPrompt,
  toneUserPrompt,
  worldUserPrompt,
  type ToneSelection,
  type WorldPreset,
} from './core/prompts.ts';
import { HERO_NAME, TONE, WORLD } from './start/texts.ts';
import { isLoreEntry, activateLore, renderLore, type LoreEntry } from './core/lore.ts';
import { resolveRoll, rollD36, skillForAction } from './core/dice.ts';
import { defaultSkills, hiddenCheck } from './core/skills.ts';
import { TONE_LEVELS, toneDirective, toneLevel } from './core/tone-levels.ts';
import { embedPngText, isPng } from './core/png.ts';
import { KeyStore, fetchKeyModels, normalizeBaseUrl, type KeyModel } from './core/keys.ts';
import { makeWorldProfile } from './core/world-profile.ts';
import { DEFAULT_FEATURES, normalizeFeatures, type FeatureFlags } from './core/features.ts';
import { estimatePrice } from './core/economy.ts';
import { directorNote, recallLog } from './core/recall.ts';
import { hashVector, retrieve, type VectorEntry } from './core/vectors.ts';

interface ArtTagField {
  name: string;
  description: string;
}

interface ArtTagCatalog {
  groups: { group: string; subgroups: { subgroup: string; fields: ArtTagField[] }[] }[];
}

let artTags: ArtTagCatalog = { groups: [] };
let artSelection: { include: string[]; exclude: string[] } = { include: [], exclude: [] };

const ART_TAGS_PATH = join(import.meta.dirname, '..', 'data', 'art-tags.json');
const ART_SELECTION_PATH = join(import.meta.dirname, '..', 'data', 'art-selection.json');

try {
  artTags = JSON.parse(await readFile(ART_TAGS_PATH, 'utf8')) as ArtTagCatalog;
} catch {
  console.error('[art-tags] не найден data/art-tags.json');
}

try {
  artSelection = JSON.parse(await readFile(ART_SELECTION_PATH, 'utf8')) as typeof artSelection;
} catch {
  /* выбора ещё нет */
}

let aiSettingsCatalog: { groups: { group: string; fields: ArtTagField[] }[] } = { groups: [] };
const AI_SETTINGS_PATH = join(import.meta.dirname, '..', 'data', 'ai-settings.json');
try {
  aiSettingsCatalog = JSON.parse(await readFile(AI_SETTINGS_PATH, 'utf8')) as typeof aiSettingsCatalog;
} catch {
  console.error('[ai-settings] не найден data/ai-settings.json');
}

// Шаблоны героя и NPC: карточки с историей, характером, навыками и способностями.

// Лор-книга: записи, которые подмешиваются только при совпадении ключей.
const LOREBOOK_PATH = join(import.meta.dirname, '..', 'data', 'lorebook.json');
const FEATURES_PATH = join(import.meta.dirname, '..', 'data', 'features.json');
const IMAGE_PROFILE_PATH = join(import.meta.dirname, '..', 'data', 'image-profile.json');
interface ImageProfile { style: 'natural' | 'booru'; negative: string; references: 'auto' | 'off' }
let imageProfile: ImageProfile = { style: 'natural', negative: 'text, watermark, logo, comic panels', references: 'auto' };
try {
  imageProfile = { ...imageProfile, ...(JSON.parse(await readFile(IMAGE_PROFILE_PATH, 'utf8')) as Partial<ImageProfile>) };
} catch {
  /* значения по умолчанию */
}
let features: FeatureFlags = { ...DEFAULT_FEATURES };
try {
  features = normalizeFeatures(JSON.parse(await readFile(FEATURES_PATH, 'utf8')));
} catch {
  /* значения по умолчанию */
}
let lorebook: LoreEntry[] = [];
try {
  const parsed = JSON.parse(await readFile(LOREBOOK_PATH, 'utf8')) as unknown;
  lorebook = Array.isArray(parsed) ? parsed.filter(isLoreEntry) : [];
} catch {
  /* пока пусто */
}

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'));
} catch {
  /* ключа может не быть */
}
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.unsloth.env'));
} catch {
  /* локальная генерация картинок не настроена */
}

const PORT = Number(process.env.PORT ?? 7801);
/** 127.0.0.1 для локальной игры, 0.0.0.0 в контейнере/на хостинге. */
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB_DIR = join(import.meta.dirname, 'web');
const DATA_DIR = join(import.meta.dirname, '..', 'data', 'campaigns');
const CARDS_DIR = join(import.meta.dirname, '..', 'data', 'cards');
const PRESETS_DIR = join(import.meta.dirname, '..', 'data', 'presets');
const TRASH_DIR = join(import.meta.dirname, '..', 'data', 'trash');
const FEEDBACK_DIR = join(import.meta.dirname, '..', 'data', 'feedback');
const INSPECTOR_DIR = join(import.meta.dirname, '..', 'data', 'inspectors');
const VECTOR_DIR = join(import.meta.dirname, '..', 'data', 'vectors');
const BRANCH_DIR = join(import.meta.dirname, '..', 'data', 'branches');
const TRACES_DIR = join(import.meta.dirname, '..', 'data', 'traces');

/** Один локальный GPU: картинки идут строго по очереди. */
let imageQueueTail: Promise<void> = Promise.resolve();
let imageQueueRunning = 0;
let imageQueueWaiting = 0;
const imageAbortControllers = new Set<AbortController>();

function withImageQueue<T>(task: () => Promise<T>): Promise<T> {
  imageQueueWaiting += 1;
  const run = imageQueueTail.then(async () => {
    imageQueueWaiting = Math.max(0, imageQueueWaiting - 1);
    imageQueueRunning += 1;
    try {
      return await task();
    } finally {
      imageQueueRunning = Math.max(0, imageQueueRunning - 1);
    }
  });
  imageQueueTail = run.then(() => undefined, () => undefined);
  return run;
}

const IMAGES_DIR = join(import.meta.dirname, '..', 'data', 'images');
const AGENTS_DIR = join(import.meta.dirname, '..', 'data');
const MODEL = process.env.OMIKA_MODEL ?? process.env.PRG_MODEL ?? 'deepseek/deepseek-v4-flash-0731';
const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
/** Локальный Qwen-Image через Unsloth Studio (OpenAI-совместимый /v1). */
const LOCAL_IMAGE_KEY = String(process.env.UNSLOTH_API_KEY ?? '').trim();
const LOCAL_IMAGE_BASE = String(process.env.UNSLOTH_BASE_URL ?? '').trim();
const LOCAL_IMAGE_MODEL = String(process.env.UNSLOTH_IMAGE_MODEL ?? '').trim();
const keyStore = new KeyStore(join(import.meta.dirname, '..', 'data'));
await keyStore.load();

const sessions = new Map<string, Session>();
/** Снимки по ходам: перегенерация, редактирование, варианты. */
const snapshots = new Map<string, TurnSnapshot[]>();
const initials = new Map<string, TurnVariant>();
const metas = new Map<string, CampaignMeta>();
let prices = { input: 0.0444, output: 0.1333, cachedInput: 0.0014 };

let agents: AgentSet = structuredClone(DEFAULT_AGENTS);

/** Модель под конкретного агента: свои модель, температура и лимит. */
function makeAgentModel(agent: AgentConfig, structured = false): OpenRouterModel {
  const key = keyStore.getSync(agent.keyRef);
  return new OpenRouterModel({
    apiKey: key?.apiKey || API_KEY,
    baseUrl: key?.baseUrl,
    model: agent.model,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    structured,
    sort: 'throughput',
  });
}

/** Мастер промтов: собрать промты ведущего и иллюстраторов под тон и мир. */
async function composePrompts(input: {
  tone: string;
  world: string;
  hero: string;
  level: number;
  temperature?: number;
}): Promise<{ gm: string; temperature: number; artists: Record<string, string> }> {
  const agent = agents.prompter;
  if (!agent?.enabled) throw new Error('мастер промтов выключен');
  const key = keyStore.getSync(agent.keyRef);
  if (!key?.apiKey && !API_KEY) throw new Error('нет ключа API у мастера промтов');

  const level = toneLevel(Number(input.level ?? 5));
  const temperature = Number(input.temperature ?? agent.temperature);
  const model = makeAgentModel(agent, false);
  const task = [
    'Собери промты для этой игры. Верни только JSON:',
    '{"gmPrompt": "...", "temperature": 0.9, "artists": {"hero": "...", "npc": "...", "item": "...", "scene": "..."}}',
    '',
    'Требования:',
    '- gmPrompt: инструкция ведущему. В ней обязательны тон повествования, уровень жёсткости и температура словами.',
    '- temperature: число 0–2 под этот тон.',
    '- artists: короткие стилевые промты для иллюстраторов. Стиль карточек — один (аниме), сцена — по тону.',
    '',
    `Уровень: ${level.value}/11 — ${level.name}. ${level.directive}`,
    `Тон: ${String(input.tone ?? '').slice(0, 4000) || 'не задан'}`,
    `Мир: ${String(input.world ?? '').slice(0, 4000) || 'не задан'}`,
    `Герой: ${String(input.hero ?? '').slice(0, 2000) || 'не задан'}`,
    `Текущая температура ведущего: ${temperature}`,
  ].join('\n');

  const reply = await model.complete([
    {
      role: 'system',
      content: `${agent.prompt}\n\nТы также пишешь промты для ведущего и иллюстраторов. Отвечай только JSON.`,
    },
    { role: 'user', content: task },
  ]);
  const parsed = parseJsonObject(reply.text);
  if (!parsed || typeof parsed.gmPrompt !== 'string') throw new Error('мастер промтов вернул не JSON');
  return {
    gm: String(parsed.gmPrompt),
    temperature: Number(parsed.temperature ?? temperature),
    artists: (parsed.artists ?? {}) as Record<string, string>,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Технический снимок чисел до и после хода: для строки «было → стало». */
interface NumericSnapshot {
  health: number;
  time: { day: number; hour: number; minute: number; second: number };
  place: string;
  money: { gold: number; silver: number; copper: number };
  currencies: Record<string, { name: string; amount: number }>;
  resources: Record<string, { value: number; max?: number; unit?: string }>;
  items: Record<string, number>;
  rank: string;
  rankPoints: number;
  actors: Record<string, {
    name: string;
    currencies: Record<string, { name: string; amount: number }>;
    resources: Record<string, { value: number; max?: number; unit?: string }>;
    money?: { gold: number; silver: number; copper: number };
  }>;
}

function currencyMap(currencies?: { name: string; amount: number }[]): Record<string, { name: string; amount: number }> {
  const map: Record<string, { name: string; amount: number }> = {};
  for (const currency of currencies ?? []) {
    map[currency.name.toLowerCase()] = { name: currency.name, amount: currency.amount };
  }
  return map;
}

function resourceMap(resources?: Resource[]): Record<string, { value: number; max?: number; unit?: string }> {
  const map: Record<string, { value: number; max?: number; unit?: string }> = {};
  for (const resource of resources ?? []) {
    map[resource.name.toLowerCase()] = { value: resource.value, max: resource.max, unit: resource.unit };
  }
  return map;
}

function numericSnapshot(state: GameState): NumericSnapshot {
  const actors: NumericSnapshot['actors'] = {};
  for (const actor of [...state.party, ...state.npcs.filter((item) => !item.archived)]) {
    actors[actor.name.toLowerCase()] = {
      name: actor.name,
      currencies: currencyMap(actor.currencies),
      resources: resourceMap(actor.resources),
      money: actor.money,
    };
  }
  return {
    health: state.hero.health,
    time: {
      day: state.time.day,
      hour: state.time.hour ?? 0,
      minute: state.time.minute ?? 0,
      second: state.time.second ?? 0,
    },
    place: state.place,
    money: { ...state.money },
    currencies: currencyMap(state.currencies),
    resources: resourceMap(state.hero.resources),
    items: Object.fromEntries(state.items.map((item) => [item.name.toLowerCase(), item.qty])),
    rank: state.hero.rank ?? 'F',
    rankPoints: state.hero.rankPoints ?? 0,
    actors,
  };
}

function coinText(money: { gold: number; silver: number; copper: number }): string {
  const parts: string[] = [];
  if (money.gold) parts.push(`${money.gold}з`);
  if (money.silver) parts.push(`${money.silver}с`);
  if (money.copper) parts.push(`${money.copper}м`);
  return parts.join(' ') || '0';
}

function coinDelta(before: NumericSnapshot['money'], after: NumericSnapshot['money']): string {
  const parts: string[] = [];
  for (const [key, suffix] of [['gold', 'з'], ['silver', 'с'], ['copper', 'м']] as const) {
    const diff = after[key] - before[key];
    if (diff) parts.push(`${diff > 0 ? '+' : ''}${diff}${suffix}`);
  }
  return parts.join(' ');
}

function resText(resource: { value: number; max?: number; unit?: string }): string {
  return `${resource.value}${resource.max != null ? `/${resource.max}` : ''}${resource.unit ? ` ${resource.unit}` : ''}`;
}

function timeText(time: NumericSnapshot['time']): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:${String(time.second).padStart(2, '0')}`;
}

function timeSeconds(time: NumericSnapshot['time']): number {
  return ((time.day * 24 + time.hour) * 60 + time.minute) * 60 + time.second;
}

function secondsText(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  const value = Math.abs(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return `${sign}${hours} ч ${minutes} мин`;
  if (minutes) return `${sign}${minutes} мин`;
  return `${sign}${rest} с`;
}

function addTime(time: NumericSnapshot['time'], seconds: number): NumericSnapshot['time'] {
  const total = Math.max(0, timeSeconds(time) + Math.round(seconds));
  return {
    day: Math.floor(total / 86400),
    hour: Math.floor((total % 86400) / 3600),
    minute: Math.floor((total % 3600) / 60),
    second: total % 60,
  };
}

/** Защита от «дошёл за минуту»: дорога не бывает мгновенной. */
function travelFloorSeconds(
  input: string,
  prose: string,
  before: NumericSnapshot,
  after: { time: NumericSnapshot['time']; place: string },
): number {
  const text = `${input} ${prose}`.toLowerCase();
  const inputText = input.toLowerCase();
  const moved = before.place !== after.place;
  const explicitTravel = /(иду|идём|идти|пошёл|пошла|пошли|еду|едем|ехать|дорог|путь|через дворы|до дома|домой|подъезд|вошл|пришл|добрал|бегу|бежит|метро|трамвай|автобус|такси|поезд)/i.test(inputText);
  if (!moved && !explicitTravel) return 0;
  const context = moved ? text : inputText;
  if (/(метро|трамвай|автобус|поезд|такси|дорог|путь|ехать|ехали)/i.test(context)) return 20 * 60;
  if (/(через дворы|до дома|домой|подъезд|вошл|пришл|добрал)/i.test(context)) return 15 * 60;
  return 5 * 60;
}

function numberChange(label: string, before: string, after: string, delta?: string, reason?: string): NumberChange {
  return { label, before, after, ...(delta ? { delta } : {}), ...(reason ? { reason } : {}) };
}

function diffNumbers(
  before: NumericSnapshot,
  after: NumericSnapshot,
  reasons: Record<string, string> = {},
): NumberChange[] {
  const rows: NumberChange[] = [];
  if (timeText(before.time) !== timeText(after.time)) {
    rows.push(numberChange(
      'Время',
      timeText(before.time),
      timeText(after.time),
      secondsText(timeSeconds(after.time) - timeSeconds(before.time)),
      reasons.time,
    ));
  }
  if (before.health !== after.health) {
    const diff = after.health - before.health;
    rows.push(numberChange('Здоровье', String(before.health), String(after.health), `${diff > 0 ? '+' : ''}${diff}`, reasons.health));
  }
  const coins = ['gold', 'silver', 'copper'] as const;
  const hasCurrencies = Object.keys(before.currencies).length > 0 || Object.keys(after.currencies).length > 0;
  if (hasCurrencies) {
    for (const key of new Set([...Object.keys(before.currencies), ...Object.keys(after.currencies)])) {
      const oldValue = before.currencies[key] ?? { name: key, amount: 0 };
      const newValue = after.currencies[key] ?? { name: oldValue.name, amount: 0 };
      if (oldValue.amount === newValue.amount) continue;
      rows.push(numberChange(
        newValue.name,
        String(oldValue.amount),
        String(newValue.amount),
        `${newValue.amount > oldValue.amount ? '+' : ''}${newValue.amount - oldValue.amount}`,
        reasons[`currency:${key}`],
      ));
    }
  } else if (coins.some((key) => before.money[key] !== after.money[key])) {
    rows.push(numberChange('Деньги', coinText(before.money), coinText(after.money), coinDelta(before.money, after.money), reasons.money));
  }
  const resourceKeys = new Set([...Object.keys(before.resources), ...Object.keys(after.resources)]);
  for (const key of resourceKeys) {
    const old = before.resources[key] ?? { value: 0 };
    const now = after.resources[key] ?? { value: 0 };
    if (old.value === now.value && old.max === now.max) continue;
    const name = after.resources[key] ? key : key;
    rows.push(numberChange(name.charAt(0).toUpperCase() + name.slice(1), resText(old), resText(now), undefined, reasons[`hero:${key}`]));
  }
  const itemKeys = new Set([...Object.keys(before.items), ...Object.keys(after.items)]);
  for (const key of itemKeys) {
    const oldQty = before.items[key] ?? 0;
    const newQty = after.items[key] ?? 0;
    if (oldQty === newQty) continue;
    rows.push(numberChange(key, String(oldQty), String(newQty), `${newQty > oldQty ? '+' : ''}${newQty - oldQty}`, reasons[`item:${key}`]));
  }
  if (before.rank !== after.rank || before.rankPoints !== after.rankPoints) {
    rows.push(numberChange('Ранг', `${before.rank} · ${before.rankPoints}/100`, `${after.rank} · ${after.rankPoints}/100`, undefined, reasons.rank));
  }
  const actorKeys = new Set([...Object.keys(before.actors), ...Object.keys(after.actors)]);
  for (const key of actorKeys) {
    const oldActor = before.actors[key];
    const newActor = after.actors[key];
    if (!oldActor || !newActor) continue;
    for (const resKey of new Set([...Object.keys(oldActor.resources), ...Object.keys(newActor.resources)])) {
      const oldRes = oldActor.resources[resKey] ?? { value: 0 };
      const newRes = newActor.resources[resKey] ?? { value: 0 };
      if (oldRes.value === newRes.value && oldRes.max === newRes.max) continue;
      const name = newActor.resources[resKey] ? resKey : resKey;
      rows.push(numberChange(
        `${newActor.name} · ${name}`,
        resText(oldRes),
        resText(newRes),
        undefined,
        reasons[`actor:${key}:${resKey}`],
      ));
    }
    for (const currencyKey of new Set([...Object.keys(oldActor.currencies), ...Object.keys(newActor.currencies)])) {
      const oldCurrency = oldActor.currencies[currencyKey] ?? { name: currencyKey, amount: 0 };
      const newCurrency = newActor.currencies[currencyKey] ?? { name: oldCurrency.name, amount: 0 };
      if (oldCurrency.amount === newCurrency.amount) continue;
      rows.push(numberChange(
        `${newActor.name} · ${newCurrency.name}`,
        String(oldCurrency.amount),
        String(newCurrency.amount),
        `${newCurrency.amount > oldCurrency.amount ? '+' : ''}${newCurrency.amount - oldCurrency.amount}`,
        reasons[`actor-currency:${key}:${currencyKey}`],
      ));
    }
    if (oldActor.money && newActor.money && coins.some((coin) => oldActor.money![coin] !== newActor.money![coin])) {
      rows.push(numberChange(
        `${newActor.name} · деньги`,
        coinText(oldActor.money),
        coinText(newActor.money),
        coinDelta(oldActor.money, newActor.money),
        reasons[`actor-money:${key}`],
      ));
    }
  }
  return rows.slice(0, 14);
}

/** Хранитель сохранения: добирает то, что ведущий мог не внести в стейт. */
async function runStateAgent(
  session: Session,
  prose: string,
): Promise<{
  changes: string[];
  cost: number;
  tokensIn: number;
  tokensOut: number;
  rankGain: number;
  rankReason: string;
  reasons: Record<string, string>;
}> {
  const agent = session.agents?.state ?? agents.state;
  if (!agent.enabled) {
    return { changes: [], cost: 0, tokensIn: 0, tokensOut: 0, rankGain: 1, rankReason: 'ход', reasons: {} };
  }

  const model = makeAgentModel(agent);
  const reply = await model.complete([
    { role: 'system', content: agent.prompt },
    {
      role: 'user',
      content: `СОСТОЯНИЕ:\n${renderState(session.state)}\n\nПОСЛЕДНИЙ ХОД:\n${prose.slice(0, 4000)}\n\nВремя: секунды — advanceSeconds, минуты — advanceMinutes, часы — advanceHours; не округляй секунды до часа. Валюты: меняй currencies (name, amount или delta, reason), а не старый money. Ресурсы: heroResources (герой) или resources (NPC/пати) с name, value или delta, max и reason. Навыки: временные штрафы — heroSkillMods / skillMods с skill, delta, reason. Не выдумывай без сцены.`,
    },
  ]);

  const tokensIn = reply.inputTokens ?? 0;
  const tokensOut = reply.outputTokens;
  const cost = costOf(tokensIn, tokensOut);
  addUsage(session, 'state', tokensIn, tokensOut, cost);

  const delta = parseJsonObject(reply.text);
  const changes = delta ? applyDelta(session.state, delta as Delta) : [];
  const reasons: Record<string, string> = {};
  const short = (value: unknown): string => String(value ?? '').trim().slice(0, 80);
  if (delta) {
    if (short(delta.healthReason)) reasons.health = short(delta.healthReason);
    if (short(delta.moneyReason)) reasons.money = short(delta.moneyReason);
    for (const patch of (delta.heroResources as Delta['heroResources']) ?? []) {
      const name = short(patch.name).toLowerCase();
      if (name && short(patch.reason)) reasons[`hero:${name}`] = short(patch.reason);
    }
    for (const patch of (delta.currencies as Delta['currencies']) ?? []) {
      const name = short(patch.name).toLowerCase();
      if (name && short(patch.reason)) reasons[`currency:${name}`] = short(patch.reason);
    }
    for (const patch of (delta.party as Delta['party']) ?? []) {
      const actor = short(patch.name).toLowerCase();
      for (const resource of patch.resources ?? []) {
        const name = short(resource.name).toLowerCase();
        if (actor && name && short(resource.reason)) reasons[`actor:${actor}:${name}`] = short(resource.reason);
      }
      for (const currency of patch.currencies ?? []) {
        const name = short(currency.name).toLowerCase();
        if (actor && name && short(currency.reason)) reasons[`actor-currency:${actor}:${name}`] = short(currency.reason);
      }
      if (patch.money && short((patch as { moneyReason?: unknown }).moneyReason)) {
        reasons[`actor-money:${actor}`] = short((patch as { moneyReason?: unknown }).moneyReason);
      }
    }
    for (const patch of (delta.npcs as Delta['npcs']) ?? []) {
      const actor = short(patch.name).toLowerCase();
      for (const resource of patch.resources ?? []) {
        const name = short(resource.name).toLowerCase();
        if (actor && name && short(resource.reason)) reasons[`actor:${actor}:${name}`] = short(resource.reason);
      }
      for (const currency of patch.currencies ?? []) {
        const name = short(currency.name).toLowerCase();
        if (actor && name && short(currency.reason)) reasons[`actor-currency:${actor}:${name}`] = short(currency.reason);
      }
    }
    for (const add of (delta.addItems as Delta['addItems']) ?? []) {
      if (short(add.reason)) reasons[`item:${short(add.name).toLowerCase()}`] = short(add.reason);
    }
    for (const remove of (delta.removeItems as Delta['removeItems']) ?? []) {
      if (short(remove.reason)) reasons[`item:${short(remove.name).toLowerCase()}`] = short(remove.reason);
    }
  }
  return {
    changes,
    cost,
    tokensIn,
    tokensOut,
    rankGain: Math.max(0, Math.min(10, Number(delta?.rankGain ?? 1))),
    rankReason: String(delta?.rankReason ?? 'значимый ход').slice(0, 200),
    reasons,
  };
}

/** Распределить опыт ранга по выбранному в новой игре режиму. */
function awardRankXp(
  id: string,
  session: Session,
  gain: number,
  reason: string,
): string[] {
  const changes: string[] = [];
  const mode = metas.get(id)?.xpMode ?? 'dynamic';
  const active = session.state.party.filter((actor) => actor.present && actor.status === 'alive');
  const turn = session.state.turn;
  const amount = Math.max(0, Math.min(10, Math.round(gain)));
  if (!amount) return changes;

  let heroGain = amount;
  const partyGains = new Map<string, number>();
  if (mode === 'own') {
    // Каждый растёт сам; опыт героя не перетекает в пати.
  } else if (mode === 'heroParty') {
    // Герой забирает часть темпа пати.
    heroGain = amount + active.length;
  } else if (mode === 'even') {
    const share = Math.max(1, Math.floor(amount / (active.length + 1)));
    heroGain = share;
    for (const actor of active) partyGains.set(actor.name, share);
  } else if (active.length) {
    heroGain = Math.max(1, Math.round(amount * 0.6));
    const rest = Math.max(0, amount - heroGain);
    const weight = active.reduce((sum, actor) => sum + Math.max(1, actor.bond ?? 0), 0);
    for (const actor of active) {
      partyGains.set(actor.name, Math.max(0, Math.round((rest * Math.max(1, actor.bond ?? 0)) / weight)));
    }
  }

  const heroRanks = addRankPoints(session.state.hero, heroGain, turn, reason);
  for (const change of heroRanks) {
    changes.push(`ранг героя: ${change.from} → ${change.to} (${change.reason})`);
  }
  for (const actor of session.state.party) {
    const partyGain = partyGains.get(actor.name) ?? 0;
    if (!partyGain) continue;
    const partyRanks = addRankPoints(actor, partyGain, turn, reason);
    for (const change of partyRanks) {
      changes.push(`ранг ${actor.name}: ${change.from} → ${change.to}`);
    }
  }
  return changes;
}

/**
 * Конспектировщик — скользящий.
 *
 * Каждый ход получает прошлый конспект и новый ход, возвращает обновлённый.
 * Всё, что старше окна последних 30 ходов, живёт только здесь, поэтому
 * контекст не растёт с длиной истории.
 */
/** Старые конспекты могли содержать несколько блоков «Арка N»: оставляем последний. */
function dedupeArcs(summary: string): string {
  if (!summary) return summary;
  const head: string[] = [];
  const blocks: { arc: number; from: number; to: number; lines: string[] }[] = [];
  let current: { arc: number; from: number; to: number; lines: string[] } | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const line of summary.split('\n')) {
    const match = /^## Арка (\d+) · ходы (\d+)–(\d+)/.exec(line);
    if (match) {
      flush();
      current = { arc: Number(match[1]), from: Number(match[2]), to: Number(match[3]), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      head.push(line);
    }
  }
  flush();
  // Ранний блок той же арки отбрасываем, только если поздний полностью его покрывает.
  const kept = blocks.filter(
    (block, index) =>
      !blocks.some(
        (later, laterIndex) =>
          laterIndex > index &&
          later.arc === block.arc &&
          later.from <= block.from &&
          later.to >= block.to,
      ),
  );
  return [...head, ...kept.flatMap((block) => block.lines)].join('\n').trim();
}
interface SummaryArc {
  from: number;
  to: number;
  text: string;
}

/** Разобрать конспект на шапку и целые блоки арок. */
function splitSummaryArcs(text: string): { head: string; arcs: SummaryArc[] } {
  const head: string[] = [];
  const arcs: SummaryArc[] = [];
  let current: { from: number; to: number; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    arcs.push({ from: current.from, to: current.to, text: current.lines.join('\n').trim() });
    current = null;
  };
  for (const line of text.split('\n')) {
    if (line.includes('[...середина хроники сокращена...]')) continue;
    const match = /^## Арка (\d+) · ходы (\d+)–(\d+)/.exec(line);
    if (match) {
      flush();
      current = { from: Number(match[2]), to: Number(match[3]), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      head.push(line);
    }
  }
  flush();
  return { head: head.join('\n').trim(), arcs };
}

/** Обрезать конспект целыми арками: завязка и свежие арки остаются. */
function trimSummary(text: string, limit = 65000): string {
  if (text.length <= limit) return text;
  const { head, arcs } = splitSummaryArcs(text);
  if (!arcs.length) return text.slice(0, limit);
  const marker = '[...середина хроники сокращена...]';
  const first = arcs[0];
  const tail: SummaryArc[] = [];
  let size = head.length + first.text.length + marker.length;
  for (let i = arcs.length - 1; i >= 1; i -= 1) {
    const block = arcs[i];
    if (size + block.text.length > limit) break;
    tail.unshift(block);
    size += block.text.length;
  }
  return [head, first.text, marker, ...tail.map((block) => block.text)]
    .filter(Boolean)
    .join('\n\n');
}

/** Восстановить потерянные при старом обрезании арки из снимков ходов. */
/** Убрать повторяющиеся служебные заголовки старых фрагментов конспекта. */
/** Есть ли разрыв в диапазонах арок — след старого обрезания. */
function hasArcGap(text: string): boolean {
  const arcs = splitSummaryArcs(text).arcs;
  for (let i = 1; i < arcs.length; i += 1) {
    if (arcs[i].from > arcs[i - 1].to + 1) return true;
  }
  return false;
}

function stripSummaryHeadings(text: string): string {
  return text
    .replace(/^#\s*(АРКИ|ТОЧКА ВХОДА[^\n]*|КРЮЧКИ[^\n]*|ДОЛГИ[^\n]*)$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergeSummaryArcs(summary: string, snapshots: string[]): string {
  const primary = splitSummaryArcs(summary);
  const byRange = new Map<string, SummaryArc>();
  for (const source of [...snapshots, summary]) {
    for (const arc of splitSummaryArcs(source).arcs) {
      byRange.set(`${arc.from}:${arc.to}`, arc);
    }
  }
  const arcs = [...byRange.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  if (!arcs.length) return summary;
  return [primary.head, ...arcs.map((arc) => arc.text)].filter(Boolean).join('\n\n').trim();
}

async function runSummary(
  session: Session,
  _input: string,
  _prose: string,
): Promise<{ ok: boolean; cost: number; tokensIn: number; tokensOut: number }> {
  const agent = session.agents?.summarizer ?? agents.summarizer;
  if (!agent.enabled) return { ok: false, cost: 0, tokensIn: 0, tokensOut: 0 };

  const from = (session.lastSummaryTurn ?? 0) + 1;
  const to = session.state.turn;
  const fragment = session.state.log
    .filter((entry) => entry.turn >= from && entry.turn <= to)
    .map((entry) => `${entry.role === 'player' ? 'Игрок' : 'Ведущий'}: ${entry.text}`)
    .join('\n\n');
  if (!fragment.trim()) return { ok: false, cost: 0, tokensIn: 0, tokensOut: 0 };

  const model = makeAgentModel({ ...agent, maxTokens: Math.max(agent.maxTokens, 1600) });
  const reply = await model.complete([
    { role: 'system', content: agent.prompt },
    { role: 'user', content: `Ходы ${from}–${to}:\n${fragment.slice(-12000)}` },
  ]);

  const tokensIn = reply.inputTokens ?? 0;
  const tokensOut = reply.outputTokens;
  const cost = costOf(tokensIn, tokensOut);
  addUsage(session, 'summarizer', tokensIn, tokensOut, cost);

  const cleaned = reply.text
    .replace(/^\s*КОНСПЕКТ:\s*/i, '')
    .replace(/^#\s*(АРКИ|ТОЧКА ВХОДА.*|КРЮЧКИ.*|ДОЛГИ.*)$/gim, '')
    .trim();
  if (cleaned) {
    const arc = Math.floor((to - 1) / 10) + 1;
    const header = `\n\n## Арка ${arc} · ходы ${from}–${to}\n`;
    const prev = session.summary ?? '';
    // Старый конспект не переписываем: только добавляем новую арку/фрагмент.
    const before = `${prev}${header}${cleaned}`;
    const trimmed = trimSummary(before);
    if (trimmed !== before) {
      // Вытесненные из summary арки не теряем, а складываем в архив.
      const kept = new Set(splitSummaryArcs(trimmed).arcs.map((item) => `${item.from}:${item.to}`));
      const lost = splitSummaryArcs(before).arcs.filter((item) => !kept.has(`${item.from}:${item.to}`));
      const archive = session.arcArchive ?? [];
      const known = new Set(splitSummaryArcs(archive.join('\n\n')).arcs.map((item) => `${item.from}:${item.to}`));
      for (const block of lost) {
        if (!known.has(`${block.from}:${block.to}`)) {
          archive.push(block.text);
          known.add(`${block.from}:${block.to}`);
        }
      }
      session.arcArchive = archive.slice(-100);
    }
    session.summary = stripSummaryHeadings(trimmed);
  }
  session.lastSummaryTurn = to;
  return { ok: true, cost, tokensIn, tokensOut };
}

interface StoredBranch {
  id: string;
  name: string;
  createdAt: string;
  turn: number;
  state: GameState;
  summary: string;
  memory: string;
  lastSummaryTurn: number;
  conspect: unknown;
}

async function loadBranches(campaignId: string): Promise<StoredBranch[]> {
  try {
    const parsed = JSON.parse(await readFile(join(BRANCH_DIR, `${campaignId}.json`), 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredBranch[]).filter((item) => item?.id && item?.state) : [];
  } catch {
    return [];
  }
}

async function saveBranches(campaignId: string, branches: StoredBranch[]): Promise<void> {
  await mkdir(BRANCH_DIR, { recursive: true });
  await writeFile(join(BRANCH_DIR, `${campaignId}.json`), `${JSON.stringify(branches, null, 2)}\n`, 'utf8');
}

async function loadVectors(campaignId: string): Promise<VectorEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(join(VECTOR_DIR, `${campaignId}.json`), 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as VectorEntry[]) : [];
  } catch {
    return [];
  }
}

async function indexVectors(campaignId: string, session: Session): Promise<void> {
  const gm = [...session.state.log].reverse().find((entry) => entry.role === 'gm');
  if (!gm?.text?.trim()) return;
  const entries = await loadVectors(campaignId);
  if (entries.some((entry) => entry.turn === gm.turn)) return;
  entries.push({ turn: gm.turn, text: gm.text.slice(0, 4000), vector: hashVector(gm.text) });
  await mkdir(VECTOR_DIR, { recursive: true });
  await writeFile(join(VECTOR_DIR, `${campaignId}.json`), `${JSON.stringify(entries.slice(-240))}\n`, 'utf8');
}

/** Простой рынок: ассортимент зависит от места, цена — от формулы. */
function ensureMarket(state: GameState, seed: number): NonNullable<GameState['market']> {
  const place = state.place || 'неизвестно';
  if (state.market && state.market.place === place && state.market.goods.length) return state.market;
  const goodsNames = ['хлеб', 'похлёбка', 'вода', 'зелье', 'плащ', 'верёвка'];
  state.market = {
    place,
    goods: goodsNames.map((name, index) => {
      const quote = estimatePrice(name, place, state.currencies, seed + index);
      return { name, price: quote.display, currency: quote.currency, qty: 2 + ((seed + index * 7) % 5) };
    }),
  };
  return state.market;
}

/** Сложить картинку в data/images и вернуть имя файла. */
async function saveImage(campaignId: string, kind: string, buffer: Buffer, mime = 'image/png'): Promise<string> {
  await mkdir(IMAGES_DIR, { recursive: true });
  // Имя файла — только ASCII: кириллица в URL ломает раздачу картинок.
  const safe = campaignId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const file = `${safe}-${Date.now()}-${kind}.${ext}`;
  await writeFile(join(IMAGES_DIR, file), buffer);
  return file;
}

/** Лор под текущую сцену: совпадение ключей в вводе, месте и прошлом ответе. */
function pickLore(session: Session, input: string): string {
  const state = session.state;
  const lastGm = [...state.log]
    .filter((e) => e.role === 'gm')
    .slice(-3)
    .map((e) => e.text)
    .join(' ');
  const text = [
    input,
    state.place,
    state.weather,
    ...(state.party ?? []).map((a) => a.name),
    ...(state.locations ?? []).map((l) => l.name),
    lastGm.slice(-1200),
  ].join(' ');

  // Автолор из состояния + ручные записи из лор-книги.
  const auto: LoreEntry[] = (state.lore ?? []).map((entry, index) => ({
    id: `auto-${index}`,
    keys: entry.keys,
    content: entry.content,
    priority: 1,
  }));

  if (features.advancedLore) {
    const turn = state.turn;
    const loreState = session.loreState ?? {};
    const prepared: LoreEntry[] = [...lorebook, ...auto]
      .filter((entry) => {
        const saved = loreState[entry.id];
        return !entry.cooldown || !saved || saved.cooldownUntil <= turn;
      })
      .map((entry) => {
        const saved = loreState[entry.id];
        if (saved && saved.stickyUntil > turn) {
          return { ...entry, constant: true };
        }
        return entry;
      });
    const activation = activateLore(prepared, text, { limit: 8, budgetChars: 6000 });
    for (const entry of activation.active) {
      loreState[entry.id] = {
        lastTurn: turn,
        stickyUntil: turn + (entry.sticky ?? 0),
        cooldownUntil: turn + (entry.cooldown ?? 0),
      };
    }
    session.loreState = loreState;
    session.lastLoreReport = activation.report.map((item) => ({
      id: item.entry.id,
      title: item.entry.group || item.entry.keys.slice(0, 2).join(', ') || item.entry.id,
      active: item.active,
      reason: item.reason,
      chars: item.entry.content.length,
    }));
    return renderLore(activation.active);
  }
  return renderLore(activateLore([...lorebook, ...auto], text, { limit: 3 }).active);
}

/** Сид карты места: одна сцена — один рисунок, разные игры — разные карты. */

/** Броски и скрытые проверки: то, что модель не должна выдумывать сама. */
function pickNotes(
  id: string,
  session: Session,
  dice: boolean,
  input = '',
): { text: string; roll: unknown } {
  const parts: string[] = [];
  let roll: unknown = null;
  const skills = session.state.hero.skills ?? defaultSkills(`${id}-hero`);

  if (dice) {
    const result = rollD36(`${id}-${session.state.turn}-dice`);
    const skillName = skillForAction(input, skills);
    const skillValue = skills[skillName] ?? 8;
    const outcome = resolveRoll(result.face, skillName, skillValue);
    roll = { ...result, ...outcome };
    if (outcome.fatal) {
      const soft = metas.get(id)?.permadeath === false;
      session.state.hero.health = soft ? 1 : 0;
      session.state.flags.dead = !soft;
      if (soft) {
        if (!session.state.hero.conditions.includes('без сознания')) {
          session.state.hero.conditions.push('без сознания');
        }
        parts.push(
          `КРИТИЧЕСКИЙ ПРОВАЛ (грань 1). Навык «${skillName}» = ${skillValue}: герой калечится и теряет сознание, но выживает. Смерть не постоянная — опиши тяжёлую травму и беспамятство, без гибели.`,
        );
      } else {
        if (!session.state.hero.conditions.includes('мёртв')) {
          session.state.hero.conditions.push('мёртв');
        }
        parts.push(
          `КРИТИЧЕСКИЙ ПРОВАЛ (грань 1). Навык «${skillName}» = ${skillValue}, герой не владеет им. Он спотыкается и падает на собственное оружие — смерть неизбежна. Опиши гибель прямо, без смягчения и без спасения.`,
        );
      }
    } else if (outcome.criticalFailure) {
      session.state.hero.wounds.push({ where: 'рука', severity: 2, treated: false });
      session.state.hero.health = Math.max(0, session.state.hero.health - 15);
      parts.push(
        `КРИТИЧЕСКИЙ ПРОВАЛ (грань 1). Навык «${skillName}» = ${skillValue}: герой ранит себя, но выживает. Опиши боль, кровь и последствия без цифр.`,
      );
    } else {
      parts.push(
        `Проверка «${skillName}» (навык ${skillValue}): итог ${outcome.total} против сложности ${outcome.difficulty} — ${outcome.success ? 'успех' : 'провал'}. Покажи последствия в сцене, без цифр.`,
      );
    }
  }

  const difficulty = 8 + ((session.state.turn * 7) % 7);
  const check = hiddenCheck(`${id}-${session.state.turn}-${session.state.place}`, skills, difficulty);
  parts.push(
    `Скрытая проверка (игрок её не видит): ${check.told}. Покажи только последствия, без цифр.`,
  );

  return { text: parts.join('\n'), roll };
}

/** Дополнительные блоки новых фич: память, режиссёр, групповой фокус. */
async function augmentFeatureNotes(session: Session, input: string, id: string): Promise<void> {
  const parts = [session.extraNotes ?? ''];
  if (features.vectorMemory) {
    const vectors = await loadVectors(id);
    const found = retrieve(vectors, input);
    if (found.length) {
      parts.push(
        ['Векторная память (прошлые сцены):', ...found.map((entry) => `- ход ${entry.turn}: ${entry.text.replace(/\s+/g, ' ').slice(0, 260)}`)].join('\n'),
      );
    } else {
      const recall = recallLog(session.state.log, input);
      if (recall) parts.push(recall);
    }
  }
  if (features.storyDirector) {
    const present = [...session.state.party, ...session.state.npcs].filter(
      (actor) => actor.present !== false && actor.status === 'alive',
    );
    const director = session.agents?.director ?? agents.director;
    if (director?.enabled) {
      try {
        const model = makeAgentModel(director);
        if (model) {
          const reply = await model.complete([
            { role: 'system', content: director.prompt },
            {
              role: 'user',
              content: `СЦЕНА: ${session.state.place}. Игрок: ${input}\nВ сцене: ${present.map((actor) => actor.name).join(', ') || 'только герой'}\nСОСТОЯНИЕ:\n${renderState(session.state).slice(0, 5000)}`,
            },
          ]);
          if (reply.text.trim()) parts.push(`[Режиссёр]\n${reply.text.trim().slice(0, 1200)}`);
          const tokensIn = reply.inputTokens ?? 0;
          const tokensOut = reply.outputTokens ?? 0;
          addUsage(session, 'director', tokensIn, tokensOut, costOf(tokensIn, tokensOut));
        }
      } catch (err) {
        console.error('[director]', (err as Error).message);
      }
    }
    if (!parts.some((part) => part.startsWith('[Режиссёр]'))) parts.push(directorNote(present.length));
  }
  if (features.groupScenes) {
    const present = [...session.state.party, ...session.state.npcs].filter(
      (actor) => actor.present !== false && actor.status === 'alive',
    );
    if (present.length > 1) {
      parts.push(
        `[Групповая сцена] Сейчас в сцене: ${present.map((actor) => actor.name).join(', ')}. ` +
          'Дай каждому свою реакцию; не смешивай их голоса и не заставляй всех говорить по очереди.',
      );
    }
  }
  session.extraNotes = parts.filter(Boolean).join('\n\n');
}

/** Файл картинки → data-URL: так его можно передать модели как референс. */
async function imageDataUrl(url: string): Promise<string | null> {
  try {
    const data = await readFile(join(IMAGES_DIR, basename(url)));
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Референсы для сцены: мастер-лист героя и спутников, максимум три. */
async function sceneReferences(session: Session): Promise<string[]> {
  const refs: string[] = [];

  const heroRefUrl = session.state.hero.refs?.main || session.state.hero.card;
  if (heroRefUrl) {
    const heroRef = await imageDataUrl(heroRefUrl);
    if (heroRef) refs.push(heroRef);
  }

  for (const actor of [...session.state.party, ...session.state.npcs.filter((n) => n.present !== false)]) {
    const url = actor.refs?.main || actor.card || actor.portrait;
    if (!url) continue;
    const data = await imageDataUrl(url);
    if (data) refs.push(data);
    if (refs.length >= 3) break;
  }
  return refs;
}

/** Модель сборки блоков: мастер промтов, если включён, иначе обычная. */
function compositionModel(
  maxTokens: number,
  modulePrompt: string,
): { model: ReturnType<typeof makeModel>; system: string } | null {
  const agent = agents.prompter;
  if (agent?.enabled) {
    return { model: makeAgentModel(agent), system: `${agent.prompt}\n\n${modulePrompt}` };
  }
  const model = makePlainModel(maxTokens);
  return model ? { model, system: modulePrompt } : null;
}

/** JSONL-трейс хода: что ушло в модель и что вернулось. */
async function writeTrace(
  id: string,
  session: Session,
  payload: { input: string; prose: string; stats: TurnStats },
): Promise<void> {
  if (process.env.OMIKA_TRACE === '0') return;
  try {
    const dir = TRACES_DIR;
    await mkdir(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const record = {
      ts: new Date().toISOString(),
      id,
      turn: session.state.turn,
      model: (session.model as { name?: string }).name ?? MODEL,
      stats: payload.stats,
      segments: session.lastContext?.segments ?? [],
      messages: session.lastContext?.messages ?? [],
      input: payload.input,
      prose: payload.prose,
    };
    await appendFile(join(dir, `${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (err) {
    console.error('[trace]', (err as Error).message);
  }
}

/**
 * Общая часть после хода: агент состояния и конспектировщик параллельно,
 * сохранение на диск и готовый ответ. Одинаково для обычного и потокового хода.
 */
/** Непостоянная смерть: при нуле здоровья герой приходит в себя. */
function reviveIfAllowed(id: string, session: Session): void {
  if (metas.get(id)?.permadeath !== false) return;
  const hero = session.state.hero;
  if (hero.health > 0 && !session.state.flags.dead) return;
  hero.health = Math.max(1, hero.health);
  session.state.flags.dead = false;
  hero.conditions = hero.conditions.filter((condition) => condition !== 'мёртв');
  if (!hero.conditions.includes('без сознания')) hero.conditions.push('без сознания');
}

 async function afterTurn(
  session: Session,
  id: string,
  input: string,
  prose: string,
  stats: TurnStats,
  started: number,
  variantFrom?: TurnSnapshot,
  clientTurnId?: string,
  beforeNumbers?: NumericSnapshot,
): Promise<Record<string, unknown>> {
  const [stateResult, summaryResult] = await Promise.allSettled([
    runStateAgent(session, prose),
    session.state.turn - (session.lastSummaryTurn ?? 0) >= 3
      ? runSummary(session, input, prose)
      : Promise.resolve({ ok: false, cost: 0, tokensIn: 0, tokensOut: 0 }),
  ]);

  const agentChanges = stateResult.status === 'fulfilled' ? stateResult.value.changes : [];
  if (stateResult.status === 'fulfilled') {
    agentChanges.push(
      ...awardRankXp(id, session, stateResult.value.rankGain, stateResult.value.rankReason),
    );
  }
  if (stateResult.status === 'rejected') console.error('[state agent]', stateResult.reason);
  reviveIfAllowed(id, session);

  const reasons = stateResult.status === 'fulfilled' ? { ...stateResult.value.reasons } : {};
  if (beforeNumbers) {
    const afterNow = numericSnapshot(session.state);
    const floor = travelFloorSeconds(input, prose, beforeNumbers, afterNow);
    const elapsed = timeSeconds(afterNow.time) - timeSeconds(beforeNumbers.time);
    if (floor > 0 && elapsed < floor) {
      session.state.time = addTime(beforeNumbers.time, floor);
      reasons.time = 'дорога';
      agentChanges.push(`время: не меньше ${Math.round(floor / 60)} мин (дорога)`);
    }
  }
  const numbers = beforeNumbers
    ? diffNumbers(beforeNumbers, numericSnapshot(session.state), reasons)
    : [];
  const gmEntry = [...session.state.log]
    .reverse()
    .find((entry) => entry.role === 'gm' && entry.turn === stats.turn);
  if (gmEntry && numbers.length) gmEntry.numbers = numbers;

  const summarized = summaryResult.status === 'fulfilled' && summaryResult.value.ok;
  if (summaryResult.status === 'rejected') console.error('[summarizer]', summaryResult.reason);

  // Ведущий тоже агент: его расход учитываем здесь.
  addUsage(session, 'gm', stats.tokensIn, stats.tokensOut, stats.cost);

  // Страховка: игрок явно пообещал, а агент не заметил — фиксируем сами.
  const promised = /обеща|клянусь|дам слово/i.test(input);
  if (promised && !agentChanges.some((c) => c.startsWith('обещание'))) {
    agentChanges.push(...applyDelta(session.state, { promises: [input.trim()] }));
  }

  // Снимок хода: без него не будет ни перегенерации, ни вариантов, ни откатов.
  if (clientTurnId) {
    const playerEntry = [...session.state.log]
      .reverse()
      .find((entry) => entry.role === 'player' && entry.turn === stats.turn);
    if (playerEntry) playerEntry.clientTurnId = clientTurnId;
  }
  saveSnapshot(
    id,
    {
      turn: stats.turn,
      input,
      clientTurnId,
      prose,
      state: snapshotState(session.state),
      summary: session.summary ?? '',
      numbers,
      lastSummaryTurn: session.lastSummaryTurn ?? 0,
      variant: 1,
    },
    variantFrom,
  );

  await writeTrace(id, session, { input, prose, stats });
  await indexVectors(id, session);
  await persist(id, session);

  return {
    prose,
    changes: [...stats.changes, ...agentChanges],
    agentChanges,
    numbers,
    summarized,
    problems: stats.problems,
    state: session.state,
    summary: session.summary ?? '',
    memory: session.memory ?? '',
    totals: session.totals,
    usage: session.usage,
    // Сколько записей лор-книги попало в этот ход — видно в отладке.
    lore: session.extraLore
      ? { entries: (session.extraLore.match(/^- /gm) ?? []).length }
      : { entries: 0 },
    roll: session.lastRoll ?? null,
    stats: {
      turn: stats.turn,
      tokensIn: stats.tokensIn,
      cachedTokens: stats.cachedTokens,
      outputTokens: stats.tokensOut,
      cost: stats.cost,
      ms: Date.now() - started,
    },
  };
}

/** Ответ на повторную отправку того же clientTurnId: ход уже сохранён. */
function replayTurn(session: Session, snap: TurnSnapshot): Record<string, unknown> {
  return {
    prose: snap.prose,
    changes: [],
    agentChanges: [],
    numbers: snap.numbers ?? [...snap.state.log].reverse().find((entry) => entry.role === 'gm' && entry.turn === snap.turn)?.numbers ?? [],
    summarized: false,
    problems: [],
    state: snap.turn === session.state.turn ? session.state : snap.state,
    summary: snap.summary ?? '',
    memory: session.memory ?? '',
    totals: session.totals,
    usage: session.usage,
    lore: { entries: 0 },
    roll: null,
    duplicate: true,
    stats: { turn: snap.turn, tokensIn: 0, cachedTokens: 0, outputTokens: 0, cost: 0, ms: 0 },
  };
}

interface Catalog {
  tone: { groups: { group: string; subgroups: { subgroup: string; fields: { id: number; name: string; description: string; type: string }[] }[] }[] };
  worlds: { presets: WorldPreset[] };
}

let catalog: Catalog = { tone: { groups: [] }, worlds: { presets: [] } };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function makeModel(structured = true): OpenRouterModel | null {
  if (!API_KEY) return null;
  return new OpenRouterModel({ apiKey: API_KEY, model: MODEL, temperature: 1, maxTokens: 1200, structured });
}

/** Модель без схемы: для генерации длинных документов (тон, мир). */
function makePlainModel(maxTokens: number): OpenRouterModel | null {
  if (!API_KEY) return null;
  return new OpenRouterModel({
    apiKey: API_KEY,
    model: MODEL,
    temperature: 0.9,
    maxTokens,
    structured: false,
    // Документ длинный: важна пропускная способность, а не минимальная цена.
    sort: 'throughput',
  });
}

function costOf(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output;
}

function gameRulesFor(meta: CampaignMeta): string[] {
  const xpModeLabel: Record<string, string> = {
    own: 'каждый растит свой опыт',
    heroParty: 'герой получает опыт от пати',
    even: 'опыт делится равномерно',
    dynamic: 'опыт делится по участию',
  };
  return [
    `- Пол героя: ${meta.gender === 'female' ? 'женский' : 'мужской'}`,
    `- Смерть: ${
      meta.permadeath === false
        ? 'не постоянная — при нуле здоровья герой может очнуться, а не исчезнуть'
        : 'постоянная — при нуле здоровья герой погибает окончательно'
    }`,
    '- Ранги: FFF→FF→F→EEE→EE→E→DDD→DD→D→CCC→CC→C→BBB→BB→B→AAA→AA→A→S→SS→SSR. Обычный NPC — F, герой стартует FFF–F. Ранг босса/глобального злодея закреплён карточкой и не меняется от ходов.',
    `- Опыт пати: ${xpModeLabel[meta.xpMode ?? 'dynamic'] ?? 'по динамике'}.`,
    `- Летоисчисление: ${meta.altTime ? (meta.eraLabel || 'своё, вне обычного года') : `${meta.epochYear ?? 2000} год`}.`,
  ];
}

/** Герой хранится без служебных настроек и повторного тона. */
function heroBaseText(value: string): string {
  return String(value ?? '')
    .split(/\n# (?:НАСТРОЙКИ ИГРЫ|ТОН)\s*/)[0]
    .trim();
}

async function getSession(id: string): Promise<Session | null> {
  const cached = sessions.get(id);
  if (cached) return cached;

  const saved = await loadCampaign(DATA_DIR, id);
  if (!saved) return null;
  saved.state = normalizeState(saved.state);
  const legacyProfileSeed = `${saved.meta?.title ?? ''}\n${saved.meta?.eraLabel ?? ''}`;
  if (!saved.state.calendar) {
    saved.state.calendar = makeWorldProfile(
      legacyProfileSeed,
      { epochYear: saved.meta?.epochYear, altTime: saved.meta?.altTime, eraLabel: saved.meta?.eraLabel, title: saved.meta?.title },
    ).calendar;
  }
  if (!saved.state.currencies?.length) {
    const profile = makeWorldProfile(
      legacyProfileSeed,
      { epochYear: saved.meta?.epochYear, altTime: saved.meta?.altTime, eraLabel: saved.meta?.eraLabel, title: saved.meta?.title },
    );
    const legacy = [saved.state.money?.gold ?? 0, saved.state.money?.silver ?? 0, saved.state.money?.copper ?? 0];
    saved.state.currencies = profile.currencies.map((currency, index) => ({
      ...currency,
      amount: legacy[index] ?? 0,
    }));
  }

  // У каждой игры свои агенты; старые кампании берут глобальные.
  const gameAgents = (saved.agents as unknown as AgentSet) ?? structuredClone(agents);
  // Новый агент-наполнитель появляется и в старых кампаниях.
  if (!gameAgents.filler) gameAgents.filler = structuredClone(DEFAULT_AGENTS.filler);

  const gmKey = keyStore.getSync(gameAgents.gm.keyRef);
  if (!gmKey?.apiKey && !API_KEY) throw new Error('нет ключа API для ведущего');
  let model = makeAgentModel(gameAgents.gm, !gameAgents.state.enabled);

  // Ядро не хранится в кампании: подставляем неизменяемый файл.
  // Сверху — промт ведущего из настроек агентов.
  const coreFile = saved.text.core || (await loadCore());
  const basePrompt = gameAgents.gm.enabled ? gameAgents.gm.prompt : DEFAULT_AGENTS.gm.prompt;
  const gmPrompt = saved.meta?.prompts?.gm || `${basePrompt}\n\n${saved.text.tone ?? ''}`;
  if (typeof saved.meta?.prompts?.temperature === 'number') {
    model = makeAgentModel({ ...gameAgents.gm, temperature: saved.meta.prompts.temperature }, !gameAgents.state.enabled);
  }
  const settingsList = saved.meta?.aiSettings ?? [];
  const gameRules = gameRulesFor(saved.meta ?? {});
  const settingsLine = `\n\n# НАСТРОЙКИ ИГРЫ\n${gameRules.join('\n')}${
    settingsList.length ? `\n\n# НАСТРОЙКИ ИИ\n${settingsList.map((s) => `- ${s}`).join('\n')}` : ''
  }`;

  // Новая сборка: ПРАВИЛА, затем GM+ТОН, сразу МИР, затем ГЕРОЙ.
  const assembly2 = saved.meta?.prompts?.assembly === 2;
  const toneMatch = /(?:^|\n)# ТОН\s*\n([\s\S]*?)(?=\n# |$)/.exec(gmPrompt);
  const toneAnchor = toneMatch ? `# ТОН\n${toneMatch[1].trim()}` : '';
  let staticText: { core: string; world: string; tone: string; hero: string };
  if (assembly2) {
    const heroText = heroBaseText(saved.text.hero ?? '');
    const heroWithSettings = `${heroText}${settingsLine}`;
    staticText = {
      core: saved.text.core || `# ПРАВИЛА\n${coreFile}\n\n${gmPrompt}`,
      world: saved.text.world ?? '',
      // Тон дублируем в конце статики: он ближе к ходу и не тонет в 112k ядра.
      hero: `${heroWithSettings}${toneAnchor ? `\n\n${toneAnchor}` : ''}`,
      tone: saved.text.tone ?? '',
    };
  } else {
    const core = gmPrompt ? `${gmPrompt}${settingsLine}\n\n${coreFile}` : `${coreFile}${settingsLine}`;
    staticText = {
      core,
      world: saved.text.world ?? '',
      tone: saved.text.tone ?? '',
      hero: saved.text.hero ?? '',
    };
  }

  const session = createSession({
    text: staticText,
    state: normalizeState(saved.state),
    model,
    prices,
    windowTurns: 24,
    summarizeEvery: 10,
  });
  const actorsDeduped = dedupeActorLists(session.state);
  session.agents = gameAgents;
  session.conspect = conspectFrom(saved);
  const originalSummary = saved.summary ?? '';
  // Восстанавливаем потерянные арки только у старых сейвов без архива.
  // Если архив уже есть, summary обрезан осознанно — не раздуваем его обратно.
  const needsArcMerge =
    !(saved.arcArchive ?? []).length &&
    (originalSummary.includes('[...середина хроники сокращена...]') || hasArcGap(originalSummary));
  const mergedSummary = stripSummaryHeadings(
    needsArcMerge
      ? dedupeArcs(
          mergeSummaryArcs(
            originalSummary,
            (saved.turns ?? []).map((snap) => snap.summary ?? ''),
          ),
        )
      : originalSummary,
  );
  let cleanedSnapshots = actorsDeduped;
  if (mergedSummary !== originalSummary) cleanedSnapshots = true;
  session.summary = mergedSummary;
  session.arcArchive = saved.arcArchive ?? [];
  session.lastSummaryTurn = Math.min(saved.lastSummaryTurn ?? 0, session.state.turn);
  // Старые сейвы без счётчика: берём последнюю арку из конспекта.
  if (!session.lastSummaryTurn && session.summary) {
    const arcs = [...session.summary.matchAll(/ходы (\d+)–(\d+)/g)];
    const last = arcs.at(-1);
    if (last) session.lastSummaryTurn = Number(last[2]);
  }
  session.memory = saved.memory ?? '';
  session.usage = saved.usage ?? {};
  session.totals = saved.totals;
  session.quietConspect = gameAgents.summarizer.enabled;
  session.expectDelta = !gameAgents.state.enabled;
  session.antiSlop = features.antiSlop;
  if (saved.meta) metas.set(id, saved.meta);
  if (saved.turns) {
    // Старые снимки хранили полный лог и могли копиться сотнями — чистим и режем.
    const keptTurns = saved.turns.slice(-24);
    if (keptTurns.length !== saved.turns.length) cleanedSnapshots = true;
    for (const snap of keptTurns) {
      if (snap.state.log?.length) cleanedSnapshots = true;
      snap.state.log = [];
      for (const variant of snap.variants ?? []) {
        if (variant.state.log?.length) cleanedSnapshots = true;
        variant.state.log = [];
      }
    }
    snapshots.set(id, keptTurns);
  }
  if (saved.initial) initials.set(id, saved.initial);
  sessions.set(id, session);
  if (cleanedSnapshots) await persist(id, session);
  return session;
}

async function persist(id: string, session: Session): Promise<void> {
  if (session.lastContext) {
    try {
      await mkdir(INSPECTOR_DIR, { recursive: true });
      await writeFile(
        join(INSPECTOR_DIR, `${id}.json`),
        `${JSON.stringify({
          turn: session.state.turn,
          totalTokens: session.lastContext.totalTokens,
          segments: session.lastContext.segments,
          messages: session.lastContext.messages,
          lore: session.lastLoreReport ?? [],
        }, null, 2)}\n`,
        'utf8',
      );
    } catch {
      /* инспектор не критичен для хода */
    }
  }
  // Большое ядро в файл кампании не кладём — оно подставляется при загрузке.
  const core = session.text.core.length > 50000 ? '' : session.text.core;
  await saveCampaign(DATA_DIR, id, {
    text: { ...session.text, core },
    state: session.state,
    conspect: session.conspect.toJSON(),
    summary: session.summary,
    arcArchive: session.arcArchive ?? [],
    lastSummaryTurn: session.lastSummaryTurn ?? 0,
    memory: session.memory,
    usage: session.usage,
    totals: session.totals,
    initial: initials.get(id),
    turns: snapshots.get(id) ?? [],
    agents: session.agents as unknown as Record<string, unknown>,
    meta: metas.get(id),
  });
}

/**
 * Вернуть состояние к моменту «после хода N».
 * N = 0 — исходное состояние до первого хода.
 */
function restoreTo(session: Session, id: string, turn: number): boolean {
  const list = snapshots.get(id) ?? [];
  const source = turn <= 0 ? initials.get(id) : list.find((s) => s.turn === turn);

  if (!source) {
    // Для старых кампаний снимков нет: можно откатить только к пустому старту.
    if (turn <= 0) return false;
    return false;
  }

  const currentLog = session.state.log;
  const restored = structuredClone(source.state);
  // В снимках лог не хранится: история берётся из живого состояния и обрезается по ходу.
  restored.log = currentLog.filter((e) => e.turn <= turn);
  restored.turn = turn;
  session.state = restored;
  session.summary = source.summary;
  session.lastSummaryTurn = Math.min(source.lastSummaryTurn ?? turn, turn);
  return true;
}

/** Копия состояния без лога: лог хранится один раз, в самой кампании. */
function snapshotState(state: GameState): GameState {
  const copy = structuredClone(state);
  copy.log = [];
  return copy;
}

/** Записать снимок хода: новый ответ заменяет прежний, старый уходит в варианты. */
function saveSnapshot(
  id: string,
  snapshot: TurnSnapshot,
  variantFrom?: TurnSnapshot,
): void {
  const list = snapshots.get(id) ?? [];
  const index = list.findIndex((s) => s.turn === snapshot.turn);

  if (variantFrom) {
    const existing = variantFrom.variants ?? [];
    snapshot.variants = [
      { prose: variantFrom.prose, state: variantFrom.state, summary: variantFrom.summary },
      ...existing,
    ].slice(0, 4);
  }

  if (index >= 0) list[index] = snapshot;
  else list.push(snapshot);

  list.sort((a, b) => a.turn - b.turn);
  // Держим последние 24 хода: снимки по 20–50 КБ иначе раздувают файл.
  snapshots.set(id, list.slice(-24));
}

interface CampaignRow {
  id: string;
  title: string;
  preset: string;
  turn: number;
  place: string;
  savedAt: string | null;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  cached: number;
}

async function listCampaigns(): Promise<CampaignRow[]> {
  try {
    const files = await readdir(DATA_DIR);
    const items: CampaignRow[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as {
          state?: { turn?: number; place?: string };
          savedAt?: string;
          totals?: { cost?: number; tokensIn?: number; tokensOut?: number; cached?: number };
          meta?: { title?: string; presetTitle?: string; frozen?: boolean };
        };
        items.push({
          id: file.replace(/\.json$/, ''),
          title: raw.meta?.title ?? file.replace(/\.json$/, ''),
          preset: raw.meta?.presetTitle ?? '',
          turn: raw.state?.turn ?? 0,
          place: raw.state?.place ?? '—',
          savedAt: raw.savedAt ?? null,
          cost: raw.totals?.cost ?? 0,
          tokensIn: raw.totals?.tokensIn ?? 0,
          tokensOut: raw.totals?.tokensOut ?? 0,
          cached: raw.totals?.cached ?? 0,
        });
      } catch {
        /* битый файл пропускаем */
      }
    }
    return items.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  } catch {
    return [];
  }
}

interface TrashRow {
  file: string;
  id: string;
  title: string;
  turn: number;
  place: string;
  savedAt: string | null;
}

async function listTrash(): Promise<TrashRow[]> {
  try {
    const files = await readdir(TRASH_DIR);
    const rows: TrashRow[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const match = /^(.*)-\d+\.json$/.exec(file);
      if (!match) continue;
      try {
        const raw = JSON.parse(await readFile(join(TRASH_DIR, file), 'utf8')) as {
          state?: { turn?: number; place?: string };
          savedAt?: string;
          meta?: { title?: string };
        };
        rows.push({
          file,
          id: match[1],
          title: raw.meta?.title ?? match[1],
          turn: raw.state?.turn ?? 0,
          place: raw.state?.place ?? '—',
          savedAt: raw.savedAt ?? null,
        });
      } catch {
        /* битый файл пропускаем */
      }
    }
    return rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  } catch {
    return [];
  }
}

async function buildStats(): Promise<unknown> {
  const campaigns = await listCampaigns();
  const sum = { campaigns: campaigns.length, turns: 0, cost: 0, tokensIn: 0, tokensOut: 0, cached: 0 };
  for (const c of campaigns) {
    sum.turns += c.turn;
    sum.cost += c.cost;
    sum.tokensIn += c.tokensIn;
    sum.tokensOut += c.tokensOut;
    sum.cached += c.cached;
  }

  // Расход по агентам — отдельно: видно, кто съедает бюджет.
  const agents: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }> = {};
  let images = 0;
  try {
    const files = await readdir(DATA_DIR);
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as {
          usage?: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>;
          state?: {
            illustrations?: unknown[];
            party?: { portrait?: string }[];
            npcs?: { portrait?: string }[];
          };
        };
        images += raw.state?.illustrations?.length ?? 0;
        images += (raw.state?.party ?? []).filter((a) => a.portrait).length;
        images += (raw.state?.npcs ?? []).filter((a) => a.portrait).length;
        for (const [agent, data] of Object.entries(raw.usage ?? {})) {
          const row = (agents[agent] ??= { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
          row.calls += data.calls ?? 0;
          row.tokensIn += data.tokensIn ?? 0;
          row.tokensOut += data.tokensOut ?? 0;
          row.cost += data.cost ?? 0;
        }
      } catch {
        /* битый файл пропускаем */
      }
    }
  } catch {
    /* каталога нет */
  }

  return {
    campaigns,
    agents,
    images,
    totals: {
      ...sum,
      avgCostPerTurn: sum.turns > 0 ? sum.cost / sum.turns : 0,
      cacheHitRate: sum.tokensIn > 0 ? sum.cached / sum.tokensIn : 0,
      avgTokensPerTurn: sum.turns > 0 ? Math.round(sum.tokensIn / sum.turns) : 0,
    },
  };
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = normalize(join(WEB_DIR, rel));
  if (!full.startsWith(WEB_DIR + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      // Кэш выключен: правки интерфейса должны видны сразу после обновления.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/auth' && req.method === 'GET') {
      return sendJson(res, { enabled: authEnabled() });
    }

    // PWA-оболочка публична: манифест, service worker и иконки.
    // Доступ к игре всё равно закрыт сессионной cookie.
    if (
      req.method === 'GET' &&
      (path === '/manifest.webmanifest' || path === '/sw.js' || path.startsWith('/icons/'))
    ) {
      return serveStatic(path, res);
    }

    if (authEnabled()) {
      if (path === '/login' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://challenges.cloudflare.com https://*.challenges.cloudflare.com; frame-src https://challenges.cloudflare.com https://*.challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com https://*.challenges.cloudflare.com",
        });
        res.end(loginPage(createCaptcha()));
        return;
      }

      if (path === '/api/login' && req.method === 'POST') {
        const body = await readBody(req);
        const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local')
          .split(',')[0]
          .trim();
        if (!allowLogin(ip)) {
          return sendJson(res, { error: 'слишком много попыток, подожди 15 минут' }, 429);
        }
        const turnstile = turnstileConfigured();
        const turnstileOk =
          turnstile &&
          Boolean(body.turnstileToken) &&
          (await verifyTurnstile(String(body.turnstileToken ?? ''), ip));
        if (!turnstileOk) {
          if (!verifyCaptcha(String(body.captchaId ?? ''), String(body.captchaAnswer ?? ''))) {
            return sendJson(
              res,
              { error: 'проверь капчу или Cloudflare', captcha: createCaptcha() },
              400,
            );
          }
        }
        if (!checkPassword(String(body.password ?? ''))) {
          return sendJson(res, { error: 'неверный пароль', captcha: createCaptcha() }, 401);
        }
        const proto = String(req.headers['x-forwarded-proto'] ?? '');
        const secure =
          proto === 'https' ||
          Boolean((req.socket as { encrypted?: boolean }).encrypted) ||
          process.env.OMIKA_SECURE_COOKIE === 'true';
        clearLoginAttempts(ip);
        res.setHeader('Set-Cookie', sessionCookie(createSessionToken(), secure));
        return sendJson(res, { ok: true });
      }

      if (path === '/api/logout') {
        res.setHeader('Set-Cookie', clearCookie());
        return sendJson(res, { ok: true });
      }

      if (!verifySessionToken(requestSession(req))) {
        if (path.startsWith('/api/')) {
          return sendJson(res, { error: 'нужен вход' }, 401);
        }
        res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    }

    if (path === '/api/campaigns' && req.method === 'GET') {
      return sendJson(res, await listCampaigns());
    }

    if (path === '/api/features' && req.method === 'GET') {
      return sendJson(res, { features });
    }

    if (path === '/api/admin/features' && (req.method === 'GET' || req.method === 'PUT')) {
      if (req.method === 'GET') return sendJson(res, { features, imageProfile });
      const body = await readBody(req);
      features = normalizeFeatures(body.features ?? body);
      await mkdir(join(import.meta.dirname, '..', 'data'), { recursive: true });
      await writeFile(FEATURES_PATH, `${JSON.stringify(features, null, 2)}\n`, 'utf8');
      return sendJson(res, { ok: true, features });
    }

    if (path === '/api/admin/image-profile' && (req.method === 'GET' || req.method === 'PUT')) {
      if (req.method === 'GET') return sendJson(res, { profile: imageProfile });
      const body = await readBody(req);
      imageProfile = {
        style: body.style === 'booru' ? 'booru' : 'natural',
        negative: String(body.negative ?? '').slice(0, 500),
        references: body.references === 'off' ? 'off' : 'auto',
      };
      await writeFile(IMAGE_PROFILE_PATH, `${JSON.stringify(imageProfile, null, 2)}\n`, 'utf8');
      return sendJson(res, { ok: true, profile: imageProfile });
    }

    if (path === '/api/admin/sessions' && req.method === 'GET') {
      return sendJson(res, {
        active: await listCampaigns(),
        trash: await listTrash(),
      });
    }

    if (path.startsWith('/api/admin/sessions/') && path.endsWith('/freeze') && req.method === 'POST') {
      const sessionId = decodeURIComponent(
        path.slice('/api/admin/sessions/'.length, -'/freeze'.length),
      );
      const session = await getSession(sessionId);
      if (!session) return sendJson(res, { error: 'кампания не найдена' }, 404);
      const body = await readBody(req);
      const meta = metas.get(sessionId) ?? {};
      meta.frozen = Boolean(body.frozen);
      metas.set(sessionId, meta);
      await persist(sessionId, session);
      return sendJson(res, { ok: true, frozen: meta.frozen });
    }

    if (path.startsWith('/api/admin/trash/') && path.endsWith('/restore') && req.method === 'POST') {
      const file = decodeURIComponent(path.slice('/api/admin/trash/'.length, -'/restore'.length));
      if (basename(file) !== file || !/^[^/\\]+\.json$/.test(file)) {
        return sendJson(res, { error: 'недопустимый файл' }, 400);
      }
      const id = file.replace(/-\d+\.json$/, '');
      if (!id || (await loadCampaign(DATA_DIR, id))) {
        return sendJson(res, { error: 'кампания с таким id уже есть' }, 409);
      }
      await rename(join(TRASH_DIR, file), join(DATA_DIR, `${id}.json`));
      return sendJson(res, { ok: true, id });
    }

    if (path.startsWith('/api/admin/trash/') && req.method === 'DELETE') {
      const file = decodeURIComponent(path.slice('/api/admin/trash/'.length));
      if (basename(file) !== file || !/^[^/\\]+\.json$/.test(file)) {
        return sendJson(res, { error: 'недопустимый файл' }, 400);
      }
      await unlink(join(TRASH_DIR, file)).catch(() => undefined);
      return sendJson(res, { ok: true });
    }

    if (path === '/api/stats' && req.method === 'GET') {
      return sendJson(res, await buildStats());
    }

    if (path === '/api/catalog' && req.method === 'GET') {
      return sendJson(res, catalog);
    }

    // --- Ключи API: список, создание, правка, удаление, модели ---
    if (path === '/api/keys' && req.method === 'GET') {
      return sendJson(res, { keys: await keyStore.list() });
    }

    if (path === '/api/keys' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const saved = await keyStore.save({
          name: String(body.name ?? ''),
          provider: body.provider === 'custom' ? 'custom' : 'openrouter',
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        });
        return sendJson(res, { key: saved });
      } catch (err) {
        return sendJson(res, { error: (err as Error).message }, 400);
      }
    }

    if (path.startsWith('/api/keys/') && req.method === 'PUT') {
      const id = decodeURIComponent(path.slice('/api/keys/'.length));
      const body = await readBody(req);
      try {
        const saved = await keyStore.save({
          id,
          name: String(body.name ?? ''),
          provider: body.provider === 'custom' ? 'custom' : 'openrouter',
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        });
        return sendJson(res, { key: saved });
      } catch (err) {
        return sendJson(res, { error: (err as Error).message }, 400);
      }
    }

    if (path.startsWith('/api/keys/') && req.method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/api/keys/'.length));
      const removed = await keyStore.remove(id);
      return sendJson(res, { removed });
    }

    if (path.startsWith('/api/keys/') && path.endsWith('/models') && req.method === 'GET') {
      const id = decodeURIComponent(path.slice('/api/keys/'.length, -'/models'.length));
      const key = await keyStore.get(id);
      if (!key) return sendJson(res, { error: 'ключ не найден' }, 404);
      try {
        const models = await fetchKeyModels(key);
        return sendJson(res, { models });
      } catch (err) {
        return sendJson(res, { error: (err as Error).message }, 502);
      }
    }

    if (path === '/api/keys/test' && req.method === 'POST') {
      const body = await readBody(req);
      const baseUrl = normalizeBaseUrl(typeof body.baseUrl === 'string' ? body.baseUrl : undefined);
      const apiKey = String(body.apiKey ?? '').trim();
      try {
        const models = await fetchKeyModels({ baseUrl, apiKey });
        return sendJson(res, { ok: true, baseUrl, count: models.length, models: models.slice(0, 20) });
      } catch (err) {
        return sendJson(res, { ok: false, error: (err as Error).message }, 502);
      }
    }

    // --- Ядро и глобальные шаблоны генерации ---
    if (path === '/api/blocks' && req.method === 'GET') {
      return sendJson(res, {
        core: await loadCore(),
        tone: await loadTonePrompt(),
        world: await loadWorldPrompt(),
        hero: await loadHeroPrompt(),
        locked: { core: true },
        agents: Object.fromEntries(
          Object.entries(agents).map(([id, agent]) => [
            id,
            { title: agent.title, model: agent.model, keyRef: agent.keyRef ?? '' },
          ]),
        ),
      });
    }

    if (path === '/api/blocks' && req.method === 'PUT') {
      const body = await readBody(req);
      if (typeof body.core === 'string' && body.core.trim()) {
        return sendJson(res, { error: 'ядро не изменяется' }, 403);
      }
      if (typeof body.tone === 'string') await saveSource('tone-prompt.md', body.tone);
      if (typeof body.world === 'string') await saveSource('world-prompt.md', body.world);
      if (typeof body.hero === 'string') await saveSource('hero-prompt.md', body.hero);
      return sendJson(res, { ok: true });
    }

    // --- Теги иллюстратора и промты внутри игры ---
    const gameBlockMatch = /^\/api\/campaign\/([^/]+)\/(art|prompts)$/.exec(path);
    if (gameBlockMatch) {
      const campaign = decodeURIComponent(gameBlockMatch[1]);
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(campaign) || campaign.includes('..')) {
        return sendJson(res, { error: 'недопустимый id кампании' }, 400);
      }
      const kind = gameBlockMatch[2];
      const saved = await loadCampaign(DATA_DIR, campaign);
      if (!saved) return sendJson(res, { error: 'кампания не найдена' }, 404);

      if (req.method === 'GET') {
        if (kind === 'art') {
          return sendJson(res, {
            groups: artTags.groups,
            aiGroups: aiSettingsCatalog.groups,
            art: saved.meta?.art ?? { include: [], exclude: [] },
            settings: saved.meta?.aiSettings ?? [],
          });
        }
        return sendJson(res, { prompts: saved.meta?.prompts ?? {} });
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const clean = (value: unknown): string[] =>
          Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean).slice(0, 200) : [];
        const nextMeta = { ...(saved.meta ?? {}) };
        if (kind === 'art') {
          nextMeta.art = { include: clean(body.include), exclude: clean(body.exclude) };
          nextMeta.aiSettings = clean(body.settings);
        } else {
          nextMeta.prompts = {
            ...(nextMeta.prompts ?? {}),
            gm: typeof body.gm === 'string' ? body.gm : nextMeta.prompts?.gm,
            temperature: typeof body.temperature === 'number' ? body.temperature : nextMeta.prompts?.temperature,
            artists: {
              ...(nextMeta.prompts?.artists ?? {}),
              ...((body.artists ?? {}) as Record<string, string>),
            },
          };
        }
        const { version: _v, savedAt: _s, ...rest } = saved as unknown as Record<string, unknown>;
        await saveCampaign(DATA_DIR, campaign, { ...(rest as object), meta: nextMeta } as never);
        sessions.delete(campaign);
        return sendJson(res, { ok: true, meta: nextMeta });
      }
    }

    // --- Мастер промтов: собрать промты ведущего и иллюстраторов ---
    if (path === '/api/compose' && req.method === 'POST') {
      const body = await readBody(req);
      const agent = agents.prompter;
      if (!agent?.enabled) return sendJson(res, { error: 'мастер промтов выключен' }, 400);
      const key = keyStore.getSync(agent.keyRef);
      if (!key?.apiKey && !API_KEY) return sendJson(res, { error: 'нет ключа API у мастера промтов' }, 500);

      const level = toneLevel(Number(body.level ?? 5));
      const temperature = Number(body.temperature ?? agent.temperature);
      const model = makeAgentModel(agent, false);
      const lines = [
        'Собери промты для этой игры. Верни только JSON:',
        '{"gmPrompt": "...", "temperature": 0.9, "artists": {"hero": "...", "npc": "...", "item": "...", "scene": "..."}}',
        '',
        'Требования:',
        '- gmPrompt: инструкция ведущему. В ней обязательны тон повествования, уровень жёсткости и температура словами.',
        '- temperature: число 0–2 под этот тон (сказка — ниже, тёмное — выше).',
        '- artists: короткие стилевые промты для четырёх иллюстраторов. Стиль карточек один (аниме), сцена — по тону.',
        '',
        `Уровень: ${level.value}/11 — ${level.name}. ${level.directive}`,
        `Тон: ${String(body.tone ?? '').slice(0, 4000) || 'не задан'}`,
        `Мир: ${String(body.world ?? '').slice(0, 4000) || 'не задан'}`,
        `Герой: ${String(body.hero ?? '').slice(0, 2000) || 'не задан'}`,
        `Текущая температура ведущего: ${temperature}`,
      ].join('\n');

      const started = Date.now();
      const reply = await model.complete([
        {
          role: 'system',
          content: `${agent.prompt}\n\nТы также пишешь промты для ведущего и иллюстраторов. Отвечай только JSON.`,
        },
        { role: 'user', content: lines },
      ]);
      const parsed = parseJsonObject(reply.text);
      if (!parsed || typeof parsed.gmPrompt !== 'string') {
        return sendJson(res, { error: 'мастер промтов вернул не JSON', raw: reply.text.slice(0, 500) }, 502);
      }

      const prompts = {
        gm: String(parsed.gmPrompt),
        temperature: Number(parsed.temperature ?? temperature),
        artists: (parsed.artists ?? {}) as Record<string, string>,
      };

      const campaign = String(body.campaign ?? '').trim();
      if (campaign) {
        const saved = await loadCampaign(DATA_DIR, campaign);
        if (saved) {
          const { version: _v, savedAt: _s, ...rest } = saved as unknown as Record<string, unknown>;
          await saveCampaign(DATA_DIR, campaign, {
            ...(rest as object),
            meta: { ...(saved.meta ?? {}), prompts },
          } as never);
          sessions.delete(campaign);
        }
      }

      return sendJson(res, {
        prompts,
        ms: Date.now() - started,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
        model: agent.model,
      });
    }

    if (path === '/api/agents' && req.method === 'GET') {
      const campaign = String(url.searchParams.get('id') ?? '').trim();
      if (campaign) {
        const session = await getSession(campaign);
        if (!session) return sendJson(res, { error: 'кампания не найдена' }, 404);
        return sendJson(res, session.agents ?? agents);
      }
      return sendJson(res, agents);
    }

    // Обращения из Telegram: задачи и скриншоты.
    if (path === '/api/feedback' && req.method === 'GET') {
      const rows: unknown[] = [];
      const dirs = await readdir(FEEDBACK_DIR, { withFileTypes: true }).catch(() => []);
      for (const dir of dirs.filter((entry) => entry.isDirectory()).slice(-100)) {
        try {
          const ticket = JSON.parse(await readFile(join(FEEDBACK_DIR, dir.name, 'message.json'), 'utf8'));
          const meta = await readFile(join(FEEDBACK_DIR, dir.name, 'meta.json'), 'utf8')
            .then((text) => JSON.parse(text))
            .catch(() => ({}));
          rows.push({
            ...ticket,
            status: meta.status ?? 'new',
            files: (ticket.files ?? []).map((file: string) => ({
              name: file,
              url: `/api/feedback/${encodeURIComponent(dir.name)}/file/${encodeURIComponent(file)}`,
            })),
          });
        } catch {
          /* битый тикет пропускаем */
        }
      }
      rows.sort((a, b) => String((b as { createdAt?: string }).createdAt).localeCompare(String((a as { createdAt?: string }).createdAt)));
      return sendJson(res, { tickets: rows });
    }

    if (path.startsWith('/api/feedback/') && req.method === 'GET') {
      const match = /^\/api\/feedback\/([^/]+)\/file\/([^/]+)$/.exec(path);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const file = basename(decodeURIComponent(match[2]));
        if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..') || !/^[A-Za-z0-9_.-]+$/.test(file) || file.includes('..')) {
          return sendJson(res, { error: 'плохой файл' }, 400);
        }
        try {
          const data = await readFile(join(FEEDBACK_DIR, id, file));
          res.writeHead(200, {
            'Content-Type': file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream',
            'Cache-Control': 'private, max-age=3600',
          });
          return res.end(data);
        } catch {
          return sendJson(res, { error: 'файл не найден' }, 404);
        }
      }
    }

    if (path.startsWith('/api/feedback/') && req.method === 'POST') {
      const id = decodeURIComponent(path.slice('/api/feedback/'.length));
      if (!/^[A-Za-z0-9_.-]+$/.test(id) || id.includes('..')) {
        return sendJson(res, { error: 'плохой тикет' }, 400);
      }
      const body = await readBody(req);
      const status = ['new', 'in_progress', 'done'].includes(String(body.status)) ? body.status : 'new';
      await writeFile(join(FEEDBACK_DIR, id, 'meta.json'), JSON.stringify({ status, updatedAt: new Date().toISOString() }, null, 2));
      return sendJson(res, { ok: true, status });
    }

    // Библиотека карточек: один JSON на карточку в data/cards.
    if (path === '/api/cards' && req.method === 'GET') {
      return sendJson(res, { cards: await listCards(CARDS_DIR) });
    }

    if (path === '/api/cards' && req.method === 'POST') {
      const body = await readBody(req);
      const cards = await listCards(CARDS_DIR);
      const type = String(body.type ?? '') as CardType;
      if (!['hero', 'npc', 'item', 'location', 'faction', 'quest', 'creature'].includes(type)) {
        return sendJson(res, { error: 'неизвестный тип карточки' }, 400);
      }
      const card = await saveCard(CARDS_DIR, {
        ...(body as unknown as GameCard),
        schema: 1,
        id: String(body.id ?? '') || nextCardId(cards, type),
        type,
        name: String(body.name ?? '').trim(),
      } as GameCard);
      return sendJson(res, { ok: true, card });
    }

    // Пресеты новой игры: настройки мастера для повторного старта.
    if (path === '/api/presets' && req.method === 'GET') {
      return sendJson(res, { presets: await listPresets(PRESETS_DIR) });
    }

    if (path === '/api/presets' && req.method === 'POST') {
      const body = await readBody(req);
      const presets = await listPresets(PRESETS_DIR);
      const existing = String(body.id ?? '').match(/^game_\d{9}$/) ? String(body.id) : '';
      const preset = await savePreset(PRESETS_DIR, {
        ...(body as unknown as GamePreset),
        schema: 1,
        id: existing || nextPresetId(presets),
        name: String(body.name ?? '').trim(),
      } as GamePreset);
      return sendJson(res, { ok: true, preset });
    }

    if (path.startsWith('/api/presets/') && req.method === 'DELETE') {
      const presetId = decodeURIComponent(path.slice('/api/presets/'.length));
      const removed = await deletePreset(PRESETS_DIR, presetId);
      return sendJson(res, { ok: removed }, removed ? 200 : 404);
    }

    // Теги иллюстратора: каталог и текущий выбор.
    if (path === '/api/art-tags' && req.method === 'GET') {
      return sendJson(res, { groups: artTags.groups, selection: artSelection });
    }

    if (path === '/api/art-tags' && req.method === 'PUT') {
      const body = await readBody(req);
      const clean = (value: unknown): string[] =>
        Array.isArray(value)
          ? [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].slice(0, 40)
          : [];
      artSelection = { include: clean(body.include), exclude: clean(body.exclude) };
      await writeFile(ART_SELECTION_PATH, `${JSON.stringify(artSelection, null, 2)}\n`, 'utf8');
      return sendJson(res, artSelection);
    }

    // Лор-книга: список записей с ключами.
    if (path === '/api/lorebook' && req.method === 'GET') {
      return sendJson(res, { entries: lorebook });
    }

    if (path === '/api/lorebook' && req.method === 'PUT') {
      const body = await readBody(req);
      const entries = Array.isArray(body.entries) ? body.entries.filter(isLoreEntry) : [];
      lorebook = entries.slice(0, 300);
      await writeFile(LOREBOOK_PATH, `${JSON.stringify(lorebook, null, 2)}\n`, 'utf8');
      return sendJson(res, { entries: lorebook });
    }

    const agentMatch = /^\/api\/agents\/([a-z]+)(?:\/(test|reset))?$/.exec(path);
    if (agentMatch) {
      const id = agentMatch[1] as AgentId;
      if (!(id in agents)) return sendJson(res, { error: 'нет такого агента' }, 404);

      if (req.method === 'PUT' && !agentMatch[2]) {
        const body = await readBody(req);
        const campaign = String(body.campaign ?? '').trim();

        // Правка агента внутри конкретной игры не трогает глобальные настройки.
        if (campaign) {
          const session = await getSession(campaign);
          if (!session || !session.agents) return sendJson(res, { error: 'кампания не найдена' }, 404);
          session.agents[id] = { ...session.agents[id], ...(body as Partial<AgentConfig>) } as AgentConfig;
          // Ползунок температуры ведущего должен победить значение мастера промтов.
          if (id === 'gm' && typeof body.temperature === 'number') {
            const meta = metas.get(campaign) ?? ({} as CampaignMeta);
            const temperature = Math.max(0, Math.min(2, body.temperature));
            meta.prompts = { ...(meta.prompts ?? {}), temperature };
            metas.set(campaign, meta);
            sessions.delete(campaign);
          }
          await persist(campaign, session);
          return sendJson(res, session.agents[id]);
        }

        agents = await saveAgents(AGENTS_DIR, { [id]: body } as Partial<AgentSet>);
        sessions.clear();
        return sendJson(res, agents[id]);
      }

      if (req.method === 'POST' && agentMatch[2] === 'reset') {
        const body = await readBody(req);
        const campaign = String(body.campaign ?? '').trim();

        if (campaign) {
          const session = await getSession(campaign);
          if (!session || !session.agents) return sendJson(res, { error: 'кампания не найдена' }, 404);
          session.agents[id] = resetAgent(id);
          await persist(campaign, session);
          return sendJson(res, session.agents[id]);
        }

        agents = await saveAgents(AGENTS_DIR, { [id]: resetAgent(id) } as Partial<AgentSet>);
        sessions.clear();
        return sendJson(res, agents[id]);
      }

      if (req.method === 'POST' && agentMatch[2] === 'test') {
        if (!API_KEY) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);
        const body = await readBody(req);
        const input = String(body.input ?? 'Проверка связи. Ответь одной короткой фразой.');
        const agent = agents[id];
        const model = makeAgentModel(agent);
        const started = Date.now();
        const reply = await model.complete([
          { role: 'system', content: agent.prompt },
          { role: 'user', content: input },
        ]);
        return sendJson(res, {
          text: reply.text,
          ms: Date.now() - started,
          tokensOut: reply.outputTokens,
          model: agent.model,
          temperature: agent.temperature,
          cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
        });
      }
    }

    if (path === '/api/generate/tone' && req.method === 'POST') {
      const body = await readBody(req);
      const selections = Array.isArray(body.selections) ? (body.selections as ToneSelection[]) : [];
      const level = Number(body.toneLevel);
      const pack = compositionModel(4000, await loadTonePrompt());
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      const t0 = Date.now();
      const epochRaw = Number(body.epochYear);
      const epochText = Number.isFinite(epochRaw)
        ? `Эпоха: ${epochRaw <= 0 ? `${1 - epochRaw} до н.э.` : epochRaw}.`
        : '';
      const userPrompt = [
        toneUserPrompt(selections),
        epochText ? `\n\n${epochText}` : '',
        Number.isFinite(level) ? `\n\n${toneDirective(level)}` : '',
      ].join('');
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        { role: 'user', content: userPrompt },
      ]);
      return sendJson(res, {
        text: reply.text,
        ms: Date.now() - t0,
        tokensOut: reply.outputTokens,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
      });
    }

    // Уровни повествования: интерфейсу нужны подписи шкалы.
    if (path === '/api/tone-levels' && req.method === 'GET') {
      return sendJson(res, { levels: TONE_LEVELS });
    }

    // Мастер промтов подбирает теги под описание мира и уровень.
    if (path === '/api/tags/suggest' && req.method === 'POST') {
      const body = await readBody(req);
      const description = String(body.description ?? '').trim();
      const level = Number(body.level ?? 5);
      const limit = Math.max(6, Math.min(400, Number(body.limit ?? 60)));
      if (!description) return sendJson(res, { error: 'нет описания мира' }, 400);

      const agent = agents.prompter;
      const model = agent?.enabled ? makeAgentModel(agent) : makePlainModel(2500);
      if (!model) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      // Компактный список: группа → названия, без описаний.
      const index: string[] = [];
      for (const group of catalog.tone.groups) {
        const names: string[] = [];
        for (const sg of group.subgroups) {
          for (const field of sg.fields) names.push(field.name);
        }
        index.push(`${group.group}: ${names.join(', ')}`);
      }

      const rules = toneLevel(level);
      const t0 = Date.now();
      const reply = await model.complete([
        {
          role: 'system',
          content: `${agent?.enabled ? `${agent.prompt}\n\n` : ''}Ты подбираешь теги для текстовой RPG.
Верни только JSON: {"tags": ["Название", "Название"]}. Выбери ВСЕ подходящие теги — до ${limit} штук.
Бери теги из предоставленного списка, ровно как они написаны.
Фраза игрока описывает игру: «романтическая комедия» → романтика, комедия, романтическая комедия, эмоции, сёдзё; «максимально жёсткое фэнтези» → тёмное фэнтези, насилие, пытки, смерть, мрачное, ангст.
Бери и жанровые, и контентные теги, если они подходят смыслу.
Не ограничивайся парой тегов: бери все жанры, эмоции, направления, формы, миры и контентные теги, которые действительно подходят фразе.
Уровень повествования: ${level}/11 (${rules.name}). ${rules.directive}
Если уровень ≤ 4 — не бери теги про насилие, кровь, смерть, 18+.
Если уровень ≥ 9 — наоборот, добавь мрачные и жёсткие темы.`,
        },
        {
          role: 'user',
          content: `Фраза: ${description.slice(0, 2000)}\n\nДоступные теги:\n${index.join('\n')}`,
        },
      ]);

      const parsed = parseJsonObject(reply.text) ?? {};
      const raw = Array.isArray(parsed.tags) ? (parsed.tags as unknown[]) : [];
      const modelTags = raw
        .map((name) => String(name ?? '').trim())
        .filter((name) => name.length > 0);
      // Локальная страховка: даже если модель промолчала, «фэнтези» и
      // «боевик» находят теги по названию, а не только сложная фраза.
      const norm = (text: string): string =>
        String(text).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const query = norm(description);
      const localTags: string[] = [];
      if (query.length >= 3) {
        for (const group of catalog.tone.groups) {
          for (const sg of group.subgroups) {
            for (const field of sg.fields) {
              const name = norm(field.name);
              if (!name) continue;
              if (name === query || name.includes(query) || query.includes(name)) {
                localTags.push(field.name);
              }
            }
          }
        }
      }
      const tags = [...new Set([...localTags, ...modelTags])].slice(0, limit);

      return sendJson(res, {
        tags,
        level,
        ms: Date.now() - t0,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
        model: agent?.enabled ? agent.model : undefined,
      });
    }

    if (path === '/api/generate/world-brief' && req.method === 'POST') {
      const body = await readBody(req);
      const description = String(body.description ?? '').trim().slice(0, 2000);
      const tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 40) : [];
      const level = Number(body.toneLevel);
      const pack = compositionModel(
        700,
        'Ты кратко формулируешь мир текстовой RPG. Верни 5–7 тезисов, каждый с новой строки через «— »: устройство мира, силы, экономика, угрозы, тон. Без вступления и markdown-заголовков.',
      );
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);
      const t0 = Date.now();
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        {
          role: 'user',
          content: [
            description ? `Описание мира: ${description}` : '',
            tags.length ? `Теги: ${tags.join(', ')}` : '',
            Number.isFinite(level) ? toneDirective(level) : '',
            'Сформулируй коротко, тезисно, без воды.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ]);
      const text = reply.text
        .replace(/^```[\s\S]*?```$/g, '')
        .replace(/^#+\s*/gm, '')
        .trim()
        .slice(0, 1800);
      return sendJson(res, {
        text,
        ms: Date.now() - t0,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
      });
    }

    if (path === '/api/generate/world' && req.method === 'POST') {
      const body = await readBody(req);
      const presetId = String(body.presetId ?? '');
      const tagList = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean).slice(0, 40) : [];
      const descriptionText = String(body.description ?? '').trim();
      const eraLabel = String(body.eraLabel ?? '').trim().slice(0, 200);
      const brief = String(body.brief ?? '').trim().slice(0, 1800);
      // Мир собирается из описания, тегов, тезисов и летоисчисления.
      const custom = [
        descriptionText,
        brief ? `Тезисы мира:\n${brief}` : '',
        tagList.length ? `Теги: ${tagList.join(', ')}` : '',
        eraLabel ? `Летоисчисление: ${eraLabel}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      let preset = catalog.worlds.presets.find((p) => p.id === presetId);
      // Свой мир: описание игрока важнее пресета.
      if (custom) {
        preset = {
          id: 'custom',
          title: String(body.title ?? '').trim() || 'Свой мир',
          genre: '',
          description: custom,
          atmosphere: '',
          action: '',
        };
      }
      if (!preset) return sendJson(res, { error: 'пресет не найден' }, 404);

      const pack = compositionModel(8000, await loadWorldPrompt());
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      const level = Number(body.toneLevel);
      const t0 = Date.now();
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        {
          role: 'user',
          content: [
            worldUserPrompt(preset),
            Number.isFinite(level) ? `\n\n${toneDirective(level)}` : '',
          ].join(''),
        },
      ]);
      return sendJson(res, {
        text: reply.text,
        ms: Date.now() - t0,
        tokensOut: reply.outputTokens,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
      });
    }

    // Мастер промтов собирает героя из формы и возвращает готовый блок.
    if (path === '/api/generate/era' && req.method === 'POST') {
      const body = await readBody(req);
      const tone = String(body.tone ?? '').trim().slice(0, 1200);
      const world = String(body.world ?? '').trim().slice(0, 1200);
      const level = Number(body.toneLevel);
      const pack = compositionModel(
        500,
        'Ты придумываешь название эпохи и летоисчисления для мира текстовой RPG. Верни только одну короткую строку без markdown и кавычек: например «Третий век Пепла, 12-й год после Разлома».',
      );
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);
      const t0 = Date.now();
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        {
          role: 'user',
          content: [
            tone ? `Тон игры: ${tone}` : '',
            world ? `Мир: ${world}` : '',
            Number.isFinite(level) ? toneDirective(level) : '',
            'Придумай своё летоисчисление: название эпохи и год/отсчёт, одной строкой.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ]);
      const parsed = parseJsonObject(reply.text) ?? {};
      const era =
        (typeof parsed.era === 'string' && parsed.era.trim()) ||
        reply.text
          .replace(/^```[\s\S]*?```$/g, '')
          .split('\n')
          .map((line) => line.replace(/^[-*#\s]+/, '').trim())
          .find(Boolean) ||
        '';
      return sendJson(res, {
        era: era.slice(0, 160),
        ms: Date.now() - t0,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
      });
    }

    if (path === '/api/generate/hero' && req.method === 'POST') {
      const body = await readBody(req);
      const form = (body.form ?? {}) as Record<string, string>;
      const level = Number(body.toneLevel);
      const world = String(body.world ?? '').trim().slice(0, 2000);
      const gender = body.gender === 'female' ? 'женский' : 'мужской';
      const pack = compositionModel(2000, await loadHeroPrompt());
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      const t0 = Date.now();
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        {
          role: 'user',
          content: [
            'Заполни карточку героя для текстовой RPG. Сохрани имя и все конкретные',
            'детали формы: шрамы, привычки, странности, способности. Пустые поля',
            'дополни в духе уже написанного, мира и тона. Не пересказывай мир.',
            '',
            'Форма героя:',
            ...Object.entries(form)
              .filter(([, value]) => String(value ?? '').trim())
              .map(([key, value]) => `- ${key}: ${String(value).trim()}`),
            '',
            `Пол: ${gender}`,
            world ? `Мир (контекст): ${world}` : '',
            '',
            'Верни только JSON с ключами:',
            '{"essence":"","appearance":"","bodyAttitude":"","origin":"","quirks":"","abilities":"","start":""}',
            'Каждое поле — 2–4 конкретных предложения, без пафоса и без markdown.',
            '«abilities» — только проявления уже заявленных способностей, не новые силы.',
            '«start» — где герой просыпается и что происходит в первых сценах.',
            Number.isFinite(level) ? toneDirective(level) : '',
          ].join('\n'),
        },
      ]);

      const parsed = parseJsonObject(reply.text) ?? {};
      const hero: Record<string, string> = {};
      for (const key of ['essence', 'appearance', 'bodyAttitude', 'origin', 'quirks', 'abilities', 'start']) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) hero[key] = value.trim();
      }

      return sendJson(res, {
        hero,
        raw: reply.text.slice(0, 800),
        ms: Date.now() - t0,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
      });
    }

    if (path === '/api/campaigns' && req.method === 'POST') {
      const body = await readBody(req);
      const id = String(body.id ?? '').trim() || `camp-${Date.now()}`;
      // Id становится именем файла — не пускаем слэши и переходы вверх.
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(id) || id.includes('..')) {
        return sendJson(res, { error: 'недопустимый id кампании' }, 400);
      }

      if (await loadCampaign(DATA_DIR, id)) {
        return sendJson(res, { error: 'кампания с таким именем уже есть' }, 409);
      }

      // Каждая игра получает своих агентов — снимок текущих настроек.
      const gameAgents = structuredClone(agents);
      const model = makeAgentModel(gameAgents.gm, !gameAgents.state.enabled);
      if (!model) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);
      const rawTemperature = Number(gameAgents.gm.temperature);
      const requestedTemperature = Number.isFinite(rawTemperature)
        ? Math.max(0, Math.min(2, rawTemperature))
        : 1;

      const toneText = typeof body.tone === 'string' && body.tone.length > 200 ? body.tone : TONE;
      const worldText = typeof body.world === 'string' && body.world.length > 200 ? body.world : WORLD;
      const heroText = typeof body.hero === 'string' ? body.hero : '';
      const meta = (typeof body.meta === 'object' && body.meta ? body.meta : {}) as CampaignMeta;
      meta.createdAt = new Date().toISOString();
      meta.gender = body.gender === 'female' ? 'female' : 'male';
      meta.permadeath = body.permadeath !== false;
      meta.altTime = body.altTime === true;
      meta.eraLabel = String(body.eraLabel ?? '').trim().slice(0, 200);
      const xpModeRaw = String(body.xpMode ?? meta.xpMode ?? 'dynamic');
      meta.xpMode = ['own', 'heroParty', 'even', 'dynamic'].includes(xpModeRaw)
        ? (xpModeRaw as CampaignMeta['xpMode'])
        : 'dynamic';

      // Уровень повествования: 0 — детская сказка, 11 — предел жестокости.
      const levelRaw = Number(body.toneLevel ?? (meta as { toneLevel?: number }).toneLevel);
      const level = Number.isFinite(levelRaw) ? toneLevel(levelRaw) : null;
      if (level) {
        meta.toneLevel = level.value;
        meta.toneLevelName = level.name;
      }
      const levelBlock = level ? `\n\n${toneDirective(level.value)}` : '';
      const gmRole = gameAgents.gm.enabled ? gameAgents.gm.prompt : DEFAULT_AGENTS.gm.prompt;
      const toneSection = toneText.replace(/^\s*#\s*ТОН\s*/i, '').trim();
      const gmSection = `# ВЕДУЩИЙ\n${gmRole}\n\n# ТОН\n${toneSection}${levelBlock}`;

      // Каждая новая игра получает своих ведущего и иллюстратора под тон и мир.
      if (body.generatePrompts !== false && agents.prompter?.enabled) {
        try {
          const composed = await composePrompts({
            tone: `${toneText}${levelBlock}`,
            world: worldText,
            hero: heroText,
            level: level?.value ?? 5,
            temperature: requestedTemperature,
          });
          // Тон не переписываем: он уже лежит в gmSection отдельной секцией.
          // Мастер промтов отвечает только за промты иллюстратора.
          gameAgents.gm.prompt = gmRole;
          // Ползунок важнее вкуса мастера промтов: температура ведущего
          // ровно такая, какую выставили перед созданием игры.
          gameAgents.gm.temperature = requestedTemperature;
          const artistMap: Record<string, keyof AgentSet> = {
            hero: 'artistHero',
            npc: 'artistNpc',
            item: 'artistItem',
            scene: 'artistScene',
          };
          for (const [kind, agentId] of Object.entries(artistMap)) {
            const prompt = composed.artists?.[kind];
            if (prompt) gameAgents[agentId] = { ...gameAgents[agentId], prompt, enabled: true };
          }
          meta.prompts = {
            ...composed,
            gm: gmSection,
            assembly: 2,
            temperature: requestedTemperature,
          };
        } catch (err) {
          console.error('[compose]', (err as Error).message);
        }
      }
      if (!meta.prompts?.gm) {
        meta.prompts = { ...(meta.prompts ?? {}), gm: gmSection, assembly: 2 };
      }

      const heroName =
        typeof body.heroName === 'string' && body.heroName.trim() ? body.heroName.trim() : HERO_NAME;
      // Стартовую локацию не подставляем: её определяет ведущий по ядру
      // (генератор стартовой сцены) в первом ходе. До этого — нейтрально.
      const place = 'неизвестно';

      const state = createState(heroName, place);
      // Стартовый ранг — случайно FFF/FF/F, развитие идёт через rankPoints.
      state.hero.rank = randomStartRank();
      state.hero.rankPoints = 0;
      state.hero.rankHistory = [];
      // Все поля формы героя сохраняем в карточку, а не только в промт.
      state.hero.gender = meta.gender;
      const heroField = (key: keyof typeof state.hero, bodyKey: string, limit = 2000): void => {
        const value = body[bodyKey];
        if (typeof value === 'string' && value.trim()) {
          (state.hero as unknown as Record<string, unknown>)[key] = value.trim().slice(0, limit);
        }
      };
      heroField('essence', 'heroEssence', 500);
      heroField('appearance', 'heroAppearance');
      heroField('bodyAttitude', 'heroBodyAttitude', 500);
      heroField('origin', 'heroOrigin');
      heroField('quirks', 'heroQuirks');
      heroField('start', 'heroStart');
      // Карточка героя из шаблона: история и способности видны в контейнере.
      if (typeof body.heroBio === 'string' && body.heroBio.trim()) state.hero.bio = body.heroBio.trim();
      if (typeof body.heroAbilities === 'string' && body.heroAbilities.trim()) {
        state.hero.abilities = body.heroAbilities.trim();
      }

      // Скиллы из шаблона героя, если игрок выбрал готовый архетип.
      if (body.heroSkills && typeof body.heroSkills === 'object') {
        const chosen: Record<string, number> = {};
        for (const [skill, value] of Object.entries(body.heroSkills as Record<string, unknown>)) {
          const score = Math.max(0, Math.min(20, Number(value)));
          if (Number.isFinite(score)) chosen[String(skill)] = score;
        }
        if (Object.keys(chosen).length) state.hero.skills = chosen;
      }
      const createSettings = `\n\n# НАСТРОЙКИ ИГРЫ\n${gameRulesFor(meta).join('\n')}`;
      const rules = await loadCore();
      const gmForSession = meta.prompts?.gm ?? gmSection;
      const worldBlock = worldText.trimStart().startsWith('#')
        ? worldText
        : `# МИР\n${worldText}`;
      const heroBlock = heroText.trimStart().startsWith('#')
        ? heroText
        : `# ГЕРОЙ\n${heroText}`;
      // Валюты и календарь рождаются один раз вместе с миром.
      const worldProfile = makeWorldProfile(
        `${String(body.world ?? '')}\n${String(body.tone ?? '')}\n${toneSection}\n${worldBlock}\n${heroBlock}\n${String(body.description ?? body.title ?? '')}`,
        {
          eraLabel: meta.eraLabel,
          epochYear: meta.epochYear,
          altTime: meta.altTime,
          title: meta.title,
        },
      );
      state.currencies = worldProfile.currencies;
      state.calendar = worldProfile.calendar;
      // Новые миры живут на своих валютах; старый money остаётся пустым.
      state.money = { gold: 0, silver: 0, copper: 0 };
      // Модель пересобираем после мастера: температура уже могла измениться.
      const sessionModel = makeAgentModel(gameAgents.gm, !gameAgents.state.enabled) ?? model;
      const session: Session = createSession({
        text: {
          core: `# ПРАВИЛА\n${rules}\n\n${gmForSession}`,
          world: worldBlock,
          // Повторяем тон в конце статики: ведущий видит его перед ходом,
          // а не только в начале 112k-ядра.
          hero: `${heroBlock}${createSettings}\n\n# ТОН\n${toneSection}${levelBlock}`,
          tone: '',
        },
        state,
        model: sessionModel,
        prices,
        windowTurns: 24,
        summarizeEvery: 10,
      });
      session.agents = gameAgents;
      session.quietConspect = gameAgents.summarizer.enabled;
      session.expectDelta = !gameAgents.state.enabled;
  session.antiSlop = features.antiSlop;

      metas.set(id, meta);
      sessions.set(id, session);
      // Точка полного отката — состояние до первого хода.
      initials.set(id, { prose: '', state: structuredClone(state), summary: '' });
      snapshots.set(id, []);
      await persist(id, session);
      return sendJson(res, { id, state, history: [], totals: session.totals, meta });
    }

    const branchMatch = /^\/api\/campaign\/([^/]+)\/branches(?:\/([^/]+))?(?:\/(load))?$/.exec(path);
    if (branchMatch) {
      const campaignId = decodeURIComponent(branchMatch[1]);
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(campaignId) || campaignId.includes('..')) {
        return sendJson(res, { error: 'недопустимый id кампании' }, 400);
      }
      const session = await getSession(campaignId);
      if (!session) return sendJson(res, { error: 'кампания не найдена' }, 404);
      const branchId = branchMatch[2] ? decodeURIComponent(branchMatch[2]) : '';
      const branches = await loadBranches(campaignId);
      if (req.method === 'GET') {
        return sendJson(res, {
          branches: branches.map((branch) => ({
            id: branch.id,
            name: branch.name,
            turn: branch.turn,
            createdAt: branch.createdAt,
          })),
        });
      }
      if (req.method === 'POST' && !branchId) {
        if (!features.branches) return sendJson(res, { error: 'ветки выключены в админке' }, 409);
        const body = await readBody(req);
        const id = `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const branch: StoredBranch = {
          id,
          name: String(body.name ?? '').trim().slice(0, 120) || `Ветка хода ${session.state.turn}`,
          createdAt: new Date().toISOString(),
          turn: session.state.turn,
          state: structuredClone(session.state),
          summary: session.summary ?? '',
          memory: session.memory ?? '',
          lastSummaryTurn: session.lastSummaryTurn ?? 0,
          conspect: session.conspect.toJSON(),
        };
        branches.push(branch);
        await saveBranches(campaignId, branches.slice(-40));
        return sendJson(res, { ok: true, branch: { id, name: branch.name, turn: branch.turn, createdAt: branch.createdAt } });
      }
      if (req.method === 'POST' && branchId && branchMatch[3] === 'load') {
        if (!features.branches) return sendJson(res, { error: 'ветки выключены в админке' }, 409);
        const branch = branches.find((item) => item.id === branchId);
        if (!branch) return sendJson(res, { error: 'ветка не найдена' }, 404);
        session.state = normalizeState(structuredClone(branch.state));
        session.summary = branch.summary ?? '';
        session.memory = branch.memory ?? '';
        session.lastSummaryTurn = branch.lastSummaryTurn ?? 0;
        if (branch.conspect) session.conspect = Conspect.fromJSON(branch.conspect as Arc[], '# Конспект кампании');
        await persist(campaignId, session);
        return sendJson(res, { ok: true, state: session.state, branch: { id: branch.id, name: branch.name, turn: branch.turn } });
      }
      if (req.method === 'DELETE' && branchId) {
        await saveBranches(campaignId, branches.filter((item) => item.id !== branchId));
        return sendJson(res, { ok: true });
      }
    }

    const campaignMatch = /^\/api\/campaign\/([^/]+)(?:\/(turn|stream|drop|quest|image|regenerate|edit|variant|card|memory|context|container|npc|forget|blocks|fill-card|inspector|price|market|undo|branches|branch|reset|restart|save-card))?$/.exec(path);
    if (campaignMatch) {
      const id = decodeURIComponent(campaignMatch[1]);
      // Id — это имя файла кампании: никаких слэшей и переходов вверх.
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(id) || id.includes('..')) {
        return sendJson(res, { error: 'недопустимый id кампании' }, 400);
      }
      const action = campaignMatch[2] ?? '';
      const isTurn = action === 'turn';

      if (req.method === 'DELETE' && !action) {
        sessions.delete(id);
        snapshots.delete(id);
        initials.delete(id);
        metas.delete(id);
        await mkdir(TRASH_DIR, { recursive: true });
        const file = join(DATA_DIR, `${id}.json`);
        await rename(file, join(TRASH_DIR, `${id}-${Date.now()}.json`)).catch(async () => {
          await unlink(file).catch(() => undefined);
        });
        return sendJson(res, { ok: true });
      }

      const session = await getSession(id);
      if (!session) return sendJson(res, { error: 'кампания не найдена' }, 404);

      // Оценка стоимости вещи в текущем месте.
      if (action === 'price' && req.method === 'GET') {
        const item = String(url.searchParams.get('item') ?? '').trim();
        if (!item) return sendJson(res, { error: 'не указана вещь' }, 400);
        return sendJson(res, {
          quote: estimatePrice(item, session.state.place, session.state.currencies, session.state.turn),
          place: session.state.place,
        });
      }

      // Отмена хода: полный откат состояния, а не только текста.
      if (action === 'undo' && req.method === 'POST') {
        if (!features.branches) return sendJson(res, { error: 'ветки выключены в админке' }, 409);
        if (session.busy) return sendJson(res, { error: 'ход уже идёт' }, 409);
        const body = await readBody(req);
        const turn = Number.isFinite(Number(body.turn)) ? Math.max(1, Math.round(Number(body.turn))) : session.state.turn;
        if (!restoreTo(session, id, turn - 1)) {
          return sendJson(res, { error: 'нет снимка предыдущего хода' }, 400);
        }
        await persist(id, session);
        return sendJson(res, { ok: true, turn: session.state.turn, state: session.state });
      }

      // Простой рынок: купить/продать без отдельного торговца.
      if (action === 'market' && (req.method === 'GET' || req.method === 'POST')) {
        if (!features.shops) return sendJson(res, { error: 'магазины выключены в админке' }, 409);
        const market = ensureMarket(session.state, session.state.turn);
        const wallet = session.state.currencies?.find((currency) => currency.name === market.goods[0]?.currency) ?? session.state.currencies?.[0];
        if (req.method === 'GET') {
          return sendJson(res, { market, wallet: wallet ?? null, currencies: session.state.currencies ?? [] });
        }
        if (!wallet) return sendJson(res, { error: 'у мира нет валюты' }, 409);
        const body = await readBody(req);
        const mode = body.mode === 'sell' ? 'sell' : 'buy';
        const name = String(body.name ?? '').trim().toLowerCase();
        const good = market.goods.find((entry) => entry.name.toLowerCase() === name);
        if (!good) return sendJson(res, { error: 'такого товара нет' }, 404);
        const payCurrency = session.state.currencies?.find((currency) => currency.name === good.currency) ?? wallet;
        if (!payCurrency) return sendJson(res, { error: 'нет подходящей валюты' }, 409);
        const item = session.state.items.find((entry) => entry.name.toLowerCase() === name);
        if (mode === 'buy') {
          if (good.qty <= 0) return sendJson(res, { error: 'товар кончился' }, 409);
          if (payCurrency.amount < good.price) return sendJson(res, { error: 'не хватает денег' }, 409);
          payCurrency.amount -= good.price;
          good.qty -= 1;
          if (item) item.qty += 1;
          else session.state.items.push({ name: good.name, qty: 1, where: 'inventory' });
        } else {
          if (!item) return sendJson(res, { error: 'у героя нет такого предмета' }, 409);
          item.qty -= 1;
          if (item.qty <= 0) session.state.items = session.state.items.filter((entry) => entry !== item);
          good.qty += 1;
          payCurrency.amount += Math.max(1, Math.floor(good.price / 2));
        }
        await persist(id, session);
        return sendJson(res, { ok: true, market, wallet: payCurrency, currencies: session.state.currencies ?? [], items: session.state.items });
      }

      // Контекстный инспектор: что реально ушло в модель.
      if (action === 'inspector' && req.method === 'GET') {
        let savedInspector: { totalTokens?: number; segments?: unknown[]; messages?: unknown[]; lore?: unknown[] } | null = null;
        if (!session.lastContext) {
          try {
            savedInspector = JSON.parse(await readFile(join(INSPECTOR_DIR, `${id}.json`), 'utf8')) as typeof savedInspector;
          } catch {
            savedInspector = null;
          }
        }
        return sendJson(res, {
          enabled: features.contextInspector,
          totalTokens: session.lastContext?.totalTokens ?? savedInspector?.totalTokens ?? 0,
          segments: session.lastContext?.segments ?? savedInspector?.segments ?? [],
          messages: session.lastContext?.messages ?? savedInspector?.messages ?? [],
          lore: session.lastLoreReport ?? savedInspector?.lore ?? [],
          features,
        });
      }

      // Контейнер игры: агенты с промтами, предметы, конспект, галерея.
      if (action === 'container' && req.method === 'GET') {
        const meta = metas.get(id) ?? {};
        const savedFile = await loadCampaign(DATA_DIR, id);
        const gameAgents = (session.agents ?? agents) as unknown as Record<string, unknown>;
        return sendJson(res, {
          id,
          title: (meta as { title?: string }).title || id,
          turn: session.state.turn,
          place: session.state.place,
          time: session.state.time,
          savedAt: savedFile?.savedAt,
          agents: Object.fromEntries(
            Object.entries(gameAgents).map(([agentId, value]) => {
              const agent = value as { title?: string; model?: string; temperature?: number; maxTokens?: number; enabled?: boolean; prompt?: string; keyRef?: string };
              return [agentId, {
                title: agent.title ?? agentId,
                model: agent.model ?? '',
                temperature: agent.temperature ?? 0,
                maxTokens: agent.maxTokens ?? 0,
                enabled: Boolean(agent.enabled),
                prompt: agent.prompt ?? '',
                keyRef: agent.keyRef ?? '',
              }];
            }),
          ),
          meta: {
            prompts: (meta as { prompts?: unknown }).prompts ?? {},
            toneLevel: (meta as { toneLevel?: number }).toneLevel,
            epochYear: (meta as { epochYear?: number }).epochYear,
            tags: (meta as { tags?: unknown }).tags ?? [],
            art: (meta as { art?: unknown }).art ?? {},
            aiSettings: (meta as { aiSettings?: unknown }).aiSettings ?? [],
          },
          items: session.state.items ?? [],
          hero: session.state.hero,
          money: session.state.money,
          currencies: session.state.currencies ?? [],
          calendar: session.state.calendar,
          npcs: session.state.npcs ?? [],
          party: session.state.party ?? [],
          factions: session.state.factions ?? [],
          quests: session.state.quests ?? [],
          locations: session.state.locations ?? [],
          summary: session.summary ?? '',
          memory: session.memory ?? '',
          conspect: session.conspect.renderFrozen(),
          arcs: session.arcArchive ?? [],
          illustrations: session.state.illustrations ?? [],
        });
      }

      if (!isTurn && req.method === 'GET' && !action) {
        return sendJson(res, {
          id,
          state: session.state,
          history: session.state.log,
          totals: session.totals,
          model: MODEL,
          summary: session.summary ?? '',
          memory: session.memory ?? '',
          arcs: session.arcArchive ?? [],
          conspect: session.conspect.renderFrozen(),
          conspectRecent: session.conspect.renderRecent(),
          turns: (snapshots.get(id) ?? []).map((s) => ({
            turn: s.turn,
            input: s.input,
            clientTurnId: s.clientTurnId,
            variant: s.variant ?? 1,
            variants: 1 + (s.variants?.length ?? 0),
          })),
        });
      }

      // Отладочный снимок последнего контекста: что именно ушло в модель.
      if (action === 'context' && req.method === 'GET') {
        if (!session.lastContext) {
          return sendJson(
            res,
            { error: 'контекст последнего хода живёт в памяти; после перезапуска сделайте новый ход' },
            409,
          );
        }
        return sendJson(res, { id, turn: session.state.turn, ...session.lastContext });
      }

      // Перегенерация хода: откат к предыдущему снимку и повтор того же ввода.
      if (action === 'regenerate' && req.method === 'POST') {
        const body = await readBody(req);
        const turn = Number(body.turn ?? 0);
        const list = snapshots.get(id) ?? [];
        const target = list.find((s) => s.turn === turn);
        if (!target) return sendJson(res, { error: 'нет снимка этого хода' }, 404);
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        if (!restoreTo(session, id, turn - 1)) {
          return sendJson(res, { error: 'нет снимка предыдущего хода' }, 400);
        }

        session.busy = true;
        try {
          const started = Date.now();
          session.extraLore = pickLore(session, target.input);
          const notes = pickNotes(id, session, false, target.input);
          session.extraNotes = notes.text;
          await augmentFeatureNotes(session, target.input, id);
          session.lastRoll = notes.roll;
          const beforeNumbers = numericSnapshot(session.state);
          const stats = await runTurn(session, target.input);
          const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
          const payload = await afterTurn(session, id, target.input, prose, stats, started, target, undefined, beforeNumbers);
          return sendJson(res, payload);
        } catch (err) {
          restoreTo(session, id, turn);
          await persist(id, session);
          return sendJson(res, { error: (err as Error).message }, 500);
        } finally {
          session.busy = false;
        }
      }

      // Правка реплики игрока: откат назад и новый ход с другим текстом.
      if (action === 'edit' && req.method === 'POST') {
        const body = await readBody(req);
        const turn = Number(body.turn ?? 0);
        const input = String(body.input ?? '').trim();
        if (!input) return sendJson(res, { error: 'пустой текст' }, 400);

        const list = snapshots.get(id) ?? [];
        const target = list.find((s) => s.turn === turn);
        if (!target) return sendJson(res, { error: 'нет снимка этого хода' }, 404);
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        if (!restoreTo(session, id, turn - 1)) {
          return sendJson(res, { error: 'нет снимка предыдущего хода' }, 400);
        }

        session.busy = true;
        try {
          const started = Date.now();
          session.extraLore = pickLore(session, input);
          const notes = pickNotes(id, session, Boolean(body.dice), input);
          session.extraNotes = notes.text;
          await augmentFeatureNotes(session, input, id);
          session.lastRoll = notes.roll;
          const beforeNumbers = numericSnapshot(session.state);
          const stats = await runTurn(session, input);
          const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
          const payload = await afterTurn(session, id, input, prose, stats, started, target, undefined, beforeNumbers);
          return sendJson(res, payload);
        } catch (err) {
          restoreTo(session, id, turn);
          await persist(id, session);
          return sendJson(res, { error: (err as Error).message }, 500);
        } finally {
          session.busy = false;
        }
      }

      // Переключение варианта ответа на ход.
      if (action === 'variant' && req.method === 'POST') {
        const body = await readBody(req);
        const turn = Number(body.turn ?? 0);
        const index = Number(body.index ?? 0);
        const list = snapshots.get(id) ?? [];
        const snap = list.find((s) => s.turn === turn);
        if (!snap) return sendJson(res, { error: 'нет снимка этого хода' }, 404);
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        // Вариант более раннего хода обрезал бы историю: только последний ход.
        if (turn !== session.state.turn) {
          return sendJson(
            res,
            { error: 'варианты можно переключать только у последнего хода' },
            409,
          );
        }

        if (index >= 0) {
          // 0 — вернуться к исходному варианту, который лежит в variants[0].
          const slot = index === 0 ? 0 : index - 1;
          const variant = snap.variants?.[slot];
          if (!variant) return sendJson(res, { error: 'нет такого варианта' }, 404);

          const currentLog = session.state.log;
          // Меняемся местами: текущий уходит в варианты, выбранный — в игру.
          snap.variants![slot] = {
            prose: snap.prose,
            state: snapshotState(snap.state),
            summary: snap.summary,
            lastSummaryTurn: snap.lastSummaryTurn,
          };
          session.state = structuredClone(variant.state);
          session.state.log = currentLog.filter((e) => e.turn < turn);
          session.summary = variant.summary;
          session.lastSummaryTurn = variant.lastSummaryTurn ?? Math.max(0, turn - 1);
          snap.prose = variant.prose;
          snap.state = snapshotState(variant.state);
          snap.summary = variant.summary;
          snap.lastSummaryTurn = session.lastSummaryTurn;
          // 1 — исходный ответ, 2..N — альтернативы.
          snap.variant = index === 0 ? 1 : index + 1;

          session.state.log.push({ turn, role: 'player', text: snap.input });
          session.state.log.push({ turn, role: 'gm', text: variant.prose });
        }

        await persist(id, session);
        return sendJson(res, {
          ok: true,
          prose: snap.prose,
          state: session.state,
          variant: snap.variant ?? 1,
          variants: 1 + (snap.variants?.length ?? 0),
        });
      }

      // Карточка персонажа в формате SillyTavern V2 — для переноса и обмена.
      if (action === 'card' && req.method === 'GET') {
        const name = String(url.searchParams.get('name') ?? '').trim();
        const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === name);
        if (!actor) return sendJson(res, { error: 'персонаж не найден' }, 404);

        const card = {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            name: actor.name,
            description: [actor.appearance, actor.clothes].filter(Boolean).join(' '),
            personality: actor.character ?? '',
            scenario: actor.bio ?? '',
            first_mes: '',
            mes_example: '',
            creator_notes: actor.role ?? '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: actor.role ? [actor.role] : [],
            creator: 'Omika',
            character_version: '1.0',
            extensions: {
              omika: {
                role: actor.role,
                attitude: actor.attitude,
                bond: actor.bond,
                relations: actor.relations ?? [],
                present: actor.present,
                skills: actor.skills ?? {},
              },
            },
          },
        };

        // PNG-карточка: JSON прячется в tEXt-чанок «chara», как в SillyTavern.
        if (String(url.searchParams.get('format') ?? '') === 'png') {
          const imageUrl = actor.card || actor.portrait;
          if (!imageUrl) {
            return sendJson(res, { error: 'у персонажа ещё нет изображения для PNG-карточки' }, 409);
          }
          const file = basename(imageUrl);
          try {
            const png = await readFile(join(IMAGES_DIR, file));
            if (!isPng(png)) {
              return sendJson(
                res,
                { error: 'картинка не в PNG — PNG-карточка недоступна, скачай JSON' },
                409,
              );
            }
            const encoded = Buffer.from(JSON.stringify(card)).toString('base64');
            const withCard = embedPngText(png, 'chara', encoded);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${encodeURIComponent(actor.name)}.png"`,
            });
            return res.end(withCard);
          } catch {
            return sendJson(res, { error: 'не удалось прочитать изображение' }, 500);
          }
        }

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(actor.name)}.json"`,
        });
        return res.end(JSON.stringify(card, null, 2));
      }

      // Импорт карточки V2: файл → персонаж в игре.
      if (action === 'card' && req.method === 'POST') {
        const body = await readBody(req);
        const raw = (body.card ?? body) as {
          spec?: string;
          data?: Record<string, unknown>;
        };
        const data = (raw.data ?? raw) as Record<string, unknown>;

        const name = String(data.name ?? '').trim();
        if (!name) return sendJson(res, { error: 'в карточке нет имени' }, 400);

        const omika = (data.extensions as { omika?: Record<string, unknown> } | undefined)?.omika ?? {};
        const skills = (data.skills ?? omika.skills) as Record<string, number> | undefined;

        const patch: ActorPatch = {
          name: name.slice(0, 60),
          role: String(data.creator_notes ?? data.role ?? omika.role ?? 'из карточки').slice(0, 60),
          appearance: String(data.description ?? '').slice(0, 800) || undefined,
          character: String(data.personality ?? '').slice(0, 800) || undefined,
          bio: String(data.scenario ?? '').slice(0, 1200) || undefined,
          attitude: typeof omika.attitude === 'number' ? omika.attitude : undefined,
          bond: typeof omika.bond === 'number' ? omika.bond : undefined,
          skills,
        };

        const changes =
          String(body.mode ?? '') === 'hero'
            ? applyDelta(session.state, { party: [patch] })
            : applyDelta(session.state, { npcs: [patch] });
        await persist(id, session);
        return sendJson(res, {
          ok: true,
          name: patch.name,
          changes,
          state: session.state,
        });
      }

      // Выбросить предмет.
      // Память истории: игрок закрепляет важные факты.
      if (action === 'memory' && req.method === 'POST') {
        const body = await readBody(req);
        session.memory = String(body.text ?? '').slice(0, 4000);
        await persist(id, session);
        return sendJson(res, { memory: session.memory });
      }

      // Редактирование блоков тона, мира и героя внутри контейнера.
      if (action === 'blocks' && (req.method === 'GET' || req.method === 'PUT')) {
        const meta = metas.get(id) ?? ({} as CampaignMeta);
        const gmPrompt = String(meta.prompts?.gm ?? '');
        const toneFromGm =
          /(?:^|\n)# ТОН\s*\n([\s\S]*?)(?=\n# |$)/.exec(gmPrompt)?.[1]?.trim() ?? '';
        if (req.method === 'GET') {
          return sendJson(res, {
            tone: session.text.tone || toneFromGm,
            world: session.text.world ?? '',
            hero: heroBaseText(session.text.hero ?? ''),
          });
        }
        const body = await readBody(req);
        if (typeof body.tone === 'string') {
          const tone = body.tone.slice(0, 12000);
          session.text.tone = tone;
          const cut = gmPrompt.search(/(?:^|\n)# ТОН\b/);
          meta.prompts = {
            ...(meta.prompts ?? {}),
            gm:
              cut >= 0
                ? `${gmPrompt.slice(0, cut).trimEnd()}\n\n# ТОН\n${tone}`
                : `${gmPrompt}${gmPrompt ? '\n\n' : ''}# ТОН\n${tone}`,
          };
        }
        if (typeof body.world === 'string') session.text.world = body.world.slice(0, 20000);
        if (typeof body.hero === 'string') session.text.hero = heroBaseText(body.hero).slice(0, 12000);
        metas.set(id, meta);
        await persist(id, session);
        sessions.delete(id);
        return sendJson(res, { ok: true });
      }

      // Агент-наполнитель: дописывает только пустые поля карточки.
      if (action === 'fill-card' && req.method === 'POST') {
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        const body = await readBody(req);
        const name = String(body.name ?? '').trim();
        const actor = [...session.state.party, ...session.state.npcs].find(
          (item) => item.name.trim().toLowerCase() === name.toLowerCase(),
        );
        if (!actor) return sendJson(res, { error: 'персонаж не найден' }, 404);
        const filler = session.agents?.filler ?? agents.filler;
        if (!filler?.enabled) return sendJson(res, { error: 'наполнитель карточек выключен' }, 409);
        const model = makeAgentModel(filler);
        if (!model) return sendJson(res, { error: 'нет ключа у наполнителя' }, 500);
        const reply = await model.complete([
          { role: 'system', content: filler.prompt },
          {
            role: 'user',
            content: [
              `КАРТОЧКА:\n${JSON.stringify(actor, null, 2).slice(0, 6000)}`,
              `МИР:\n${String(session.text.world ?? '').slice(0, 3000)}`,
              'Дополни пустые поля. Верни только JSON.',
            ].join('\n\n'),
          },
        ]);
        const parsed = parseJsonObject(reply.text) ?? {};
        const fields = [
          'appearance',
          'character',
          'clothes',
          'bio',
          'habits',
          'wants',
          'abilities',
          'description',
          'note',
        ];
        const overwrite = body.overwrite === true;
        const changed: string[] = [];
        for (const field of fields) {
          const value = parsed[field];
          if (typeof value !== 'string' || !value.trim()) continue;
          if (!overwrite && String((actor as unknown as Record<string, unknown>)[field] ?? '').trim()) continue;
          (actor as unknown as Record<string, unknown>)[field] = value.trim().slice(0, 3000);
          changed.push(field);
        }
        await persist(id, session);
        return sendJson(res, { ok: true, actor, changed });
      }

      // Забыть NPC: не удаляем, а убираем в корзину контейнера.
      if (action === 'forget' && req.method === 'POST') {
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        const body = await readBody(req);
        const name = String(body.name ?? '').trim().toLowerCase();
        const actor = session.state.npcs.find((npc) => npc.name.trim().toLowerCase() === name);
        if (!actor) return sendJson(res, { error: 'NPC не найден' }, 404);
        if (body.purge === true) {
          session.state.npcs = session.state.npcs.filter((npc) => npc !== actor);
        } else if (body.restore === true) {
          actor.archived = false;
          actor.archivedAt = undefined;
        } else {
          actor.archived = true;
          actor.archivedAt = new Date().toISOString();
        }
        await persist(id, session);
        return sendJson(res, { ok: true, state: session.state });
      }

      // Добавить NPC из шаблона в текущую игру.
      if (action === 'npc' && req.method === 'POST') {
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        const body = await readBody(req);
        const name = String(body.name ?? '').trim();
        if (!name) return sendJson(res, { error: 'не указано имя NPC' }, 400);
        if (name.length > 80) return sendJson(res, { error: 'имя NPC слишком длинное' }, 400);
        const taken = new Set(
          [...session.state.npcs, ...session.state.party].map((n) => n.name.trim().toLowerCase()),
        );
        if (taken.has(name.toLowerCase())) {
          return sendJson(res, { error: 'персонаж с таким именем уже есть' }, 409);
        }
        if (body.skills != null && (typeof body.skills !== 'object' || Array.isArray(body.skills))) {
          return sendJson(res, { error: 'навыки должны быть объектом' }, 400);
        }
        const clamp = (value: unknown, min: number, max: number): number => {
          const num = Number(value);
          return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : 0;
        };
        const text = (value: unknown, limit = 2000): string =>
          typeof value === 'string' ? value.slice(0, limit) : '';
        const skills: Record<string, number> = {};
        for (const [rawKey, value] of Object.entries(
          (body.skills ?? {}) as Record<string, unknown>,
        )) {
          const key = rawKey.trim().slice(0, 40);
          if (!key || !Number.isFinite(Number(value))) continue;
          skills[key] = clamp(value, 0, 20);
          if (Object.keys(skills).length >= 12) break;
        }
        const npc: Actor = {
          name,
          role: text(body.role, 120).trim() || 'знакомый',
          status: 'alive',
          bond: clamp(body.bond, 0, 100),
          attitude: clamp(body.attitude, -100, 100),
          present: true,
          skills,
          rank: normalizeRank(body.rank, 'F'),
          rankPoints: clamp(body.rankPoints, 0, 99),
          rankHistory: [],
          wounds: [],
          appearance: text(body.appearance),
          character: text(body.character),
          clothes: text(body.clothes),
          bio: text(body.bio),
          description: text(body.description ?? body.bio),
          abilities: text(body.abilities),
          note: text(body.note),
        };
        session.state.npcs.push(npc);
        if (session.state.npcs.length > 60) session.state.npcs = session.state.npcs.slice(-60);
        await persist(id, session);
        return sendJson(res, { ok: true, npc });
      }

      // Сброс настроек текущей игры к глобальным (агенты, арт, промты).
      if (action === 'reset' && req.method === 'POST') {
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        session.agents = structuredClone(agents);
        const fresh = makeAgentModel(session.agents.gm, !session.agents.state.enabled);
        if (fresh) session.model = fresh;
        const meta = (metas.get(id) ?? {}) as Record<string, unknown>;
        delete meta.prompts;
        delete meta.art;
        meta.aiSettings = [];
        metas.set(id, meta as never);
        session.text.core = '';
        await persist(id, session);
        // Следующий запрос перечитает сейв: core и флаги агентов соберутся заново.
        sessions.delete(id);
        return sendJson(res, { ok: true, agents: session.agents });
      }

      // Начать прохождение заново: состояние к ходу 0, история и конспект очищены.
      if (action === 'restart' && req.method === 'POST') {
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        if (!restoreTo(session, id, 0)) {
          return sendJson(res, { error: 'нет исходного снимка этой игры' }, 400);
        }
        session.summary = '';
        session.lastSummaryTurn = 0;
        session.arcArchive = [];
        session.memory = '';
        session.conspect.clear();
        snapshots.set(id, []);
        await persist(id, session);
        return sendJson(res, { ok: true, state: session.state });
      }

      // Сохранить карточку из игры в библиотеку data/cards.
      if (action === 'save-card' && req.method === 'POST') {
        const body = await readBody(req);
        const type = String(body.type ?? '') as CardType;
        const allowed: CardType[] = ['hero', 'npc', 'item', 'location', 'faction', 'quest', 'creature'];
        if (!allowed.includes(type)) return sendJson(res, { error: 'неизвестный тип карточки' }, 400);
        const cards = await listCards(CARDS_DIR);
        const now = new Date().toISOString();
        const title = metas.get(id)?.title || id;
        const common = {
          schema: 1 as const,
          id: nextCardId(cards, type),
          type,
          origin: { campaignId: id, turn: session.state.turn, title },
          createdAt: now,
          updatedAt: now,
          tags: [] as string[],
        };
        let card: GameCard;
        if (type === 'hero') {
          const hero = session.state.hero;
          card = {
            ...common,
            name: hero.name,
            subtitle: 'герой',
            description: hero.essence ?? '',
            image: hero.card ?? '',
            gender: hero.gender,
            role: 'герой',
            status: session.state.flags.dead ? 'dead' : 'alive',
            appearance: hero.appearance,
            character: hero.essence,
            biography: hero.origin ?? hero.bio,
            habits: hero.quirks,
            abilities: hero.abilities,
            attributes: {},
            skills: hero.skills ?? {},
            relations: [],
            equipment: session.state.items.map((item) => ({ name: item.name, qty: item.qty, where: item.where })),
            data: {
              level: 0,
              bodyAttitude: hero.bodyAttitude,
              start: hero.start,
              quote: hero.intuition,
              resources: hero.resources ?? [],
              currencies: session.state.currencies ?? [],
              money: session.state.money,
            },
          };
        } else if (type === 'npc') {
          const name = String(body.name ?? '').trim();
          const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === name);
          if (!actor) return sendJson(res, { error: 'персонаж не найден' }, 404);
          card = {
            ...common,
            name: actor.name,
            subtitle: actor.role,
            description: actor.description ?? actor.character ?? '',
            image: actor.card || actor.portrait || '',
            role: actor.role,
            status: actor.status,
            appearance: actor.appearance,
            character: actor.character,
            biography: actor.bio,
            abilities: actor.abilities,
            attributes: {},
            skills: actor.skills ?? {},
            relations: actor.relations ?? [],
            equipment: [],
            data: {
              attitude: actor.attitude ?? 0,
              bond: actor.bond ?? 0,
              clothes: actor.clothes,
              note: actor.note,
              resources: actor.resources ?? [],
              currencies: actor.currencies ?? [],
              money: actor.money,
              present: actor.present,
            },
          };
        } else if (type === 'item') {
          const name = String(body.name ?? '').trim();
          const item = session.state.items.find((entry) => entry.name === name);
          if (!item) return sendJson(res, { error: 'предмет не найден' }, 404);
          card = {
            ...common,
            name: item.name,
            subtitle: item.where,
            description: item.note ?? '',
            image: item.card ?? '',
            data: {
              category: /меч|клин|нож|топор|лук|копь|кинжал/i.test(item.name) ? 'weapon' : 'item',
              qty: item.qty,
              where: item.where,
            },
          };
        } else if (type === 'location') {
          const name = String(body.name ?? '').trim();
          const place = session.state.locations.find((entry) => entry.name === name);
          if (!place) return sendJson(res, { error: 'локация не найдена' }, 404);
          card = {
            ...common,
            name: place.name,
            subtitle: 'локация',
            description: place.note ?? '',
            data: { note: place.note },
          };
        } else if (type === 'faction') {
          const name = String(body.name ?? '').trim();
          const faction = session.state.factions.find((entry) => entry.name === name);
          if (!faction) return sendJson(res, { error: 'фракция не найдена' }, 404);
          card = {
            ...common,
            name: faction.name,
            subtitle: 'фракция',
            description: faction.note ?? '',
            data: {
              attitude: faction.attitude,
              leader: faction.leader,
              shadow: faction.shadow,
              roster: faction.roster,
            },
          };
        } else if (type === 'quest') {
          const name = String(body.name ?? '').trim();
          const quest = session.state.quests.find((entry) => entry.title === name);
          if (!quest) return sendJson(res, { error: 'задание не найдено' }, 404);
          card = {
            ...common,
            name: quest.title,
            subtitle: 'задание',
            description: quest.steps?.join('; ') ?? '',
            data: {
              status: quest.status,
              steps: quest.steps,
              turnsLimit: quest.turnsLimit,
            },
          };
        } else {
          const name = String(body.name ?? '').trim();
          const beast = session.state.bestiary.find((entry) => entry.name === name);
          if (!beast) return sendJson(res, { error: 'тварь не найдена' }, 404);
          card = {
            ...common,
            name: beast.name,
            subtitle: 'тварь',
            description: beast.note ?? '',
            data: { danger: beast.danger },
          };
        }
        const saved = await saveCard(CARDS_DIR, card);
        return sendJson(res, { ok: true, card: saved });
      }

      if (action === 'drop' && req.method === 'POST') {
        const body = await readBody(req);
        const name = String(body.name ?? '').trim().toLowerCase();
        if (!name) return sendJson(res, { error: 'не указан предмет' }, 400);

        const before = session.state.items.length;
        const dropped = session.state.items.find((i) => i.name.toLowerCase() === name);
        session.state.items = session.state.items.filter((i) => i.name.toLowerCase() !== name);
        if (session.state.items.length === before) {
          return sendJson(res, { error: 'такого предмета нет' }, 404);
        }
        // Выброшенная вещь не исчезает из мира: она попадёт в архив
        // и может всплыть позже у кого-то другого.
        session.state.archive.push({
          kind: 'item',
          text: `выброшено: ${dropped?.name ?? name}`,
          turn: session.state.turn,
          reason: 'может всплыть позже',
        });
        await persist(id, session);
        return sendJson(res, { ok: true, state: session.state });
      }

      // Отказ от задачи или её закрытие.
      if (action === 'quest' && req.method === 'POST') {
        const body = await readBody(req);
        const title = String(body.title ?? '').trim();
        const status = body.action === 'done' ? 'done' : 'failed';
        const quest = session.state.quests.find((q) => q.title.toLowerCase() === title.toLowerCase());
        if (!quest) return sendJson(res, { error: 'задача не найдена' }, 404);

        quest.status = status;

        if (status === 'failed') {
          // Цена отказа: мир это запомнит.
          session.state.archive.push({
            kind: 'quest',
            text: quest.title,
            turn: session.state.turn,
            reason: 'брошено',
          });
          const hook = `Брошено: «${quest.title}». Кто-то этого не забудет.`;
          if (!session.state.hooks.includes(hook)) session.state.hooks.push(hook);
          session.state.hero.statuses = session.state.hero.statuses.filter((s) => s.name !== 'Репутация под вопросом');
          session.state.hero.statuses.push({
            name: 'Репутация под вопросом',
            kind: 'debuff',
            note: 'за брошенное дело',
          });
        } else if (status === 'done') {
          session.state.archive.push({
            kind: 'quest',
            text: quest.title,
            turn: session.state.turn,
            reason: 'выполнено',
          });
        }

        await persist(id, session);
        return sendJson(res, { ok: true, state: session.state });
      }

      // Иллюстрация сцены или портрет персонажа.
      if (action === 'image' && req.method === 'POST') {
        if (!API_KEY) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

        const body = await readBody(req);
        const rawMode = String(body.mode ?? 'scene');
        const mode = ['scene', 'portrait', 'card', 'sheet', 'item', 'hero'].includes(rawMode) ? rawMode : 'scene';

        // У каждого вида изображения свой агент: промт сцены не равен промту карточки.
        const artist =
          mode === 'hero'
            ? agents.artistHero
            : mode === 'item'
              ? agents.artistItem
              : mode === 'scene'
                ? agents.artistScene
                : agents.artistNpc;

        // Стиль из мастера промтов для этой игры важнее дефолтного промта.
        const artistMeta = (await loadCampaign(DATA_DIR, id))?.meta;
        const artistKeyName = mode === 'scene' ? 'scene' : mode === 'item' ? 'item' : mode === 'hero' ? 'hero' : 'npc';
        const style = artistMeta?.prompts?.artists?.[artistKeyName] || artist.prompt;
        // Локальный Qwen-Image через Unsloth Studio, если он настроен.
        const localImage = Boolean(LOCAL_IMAGE_KEY && LOCAL_IMAGE_BASE && LOCAL_IMAGE_MODEL);
        // Иллюстратор переведён на Seedream 5.0 Flash; env может переопределить.
        const model = localImage
          ? LOCAL_IMAGE_MODEL
          : process.env.OMIKA_IMAGE_MODEL || IMAGE_MODEL;

        let prompt = '';
        let actorName = '';
        let itemName = '';
        let references: string[] = [];
        let sceneTurn = session.state.turn;

        if (mode === 'hero') {
          // Мастер-лист героя: описание берём из четвёртого блока кампании.
          const heroBlockText = (session.text.hero || '')
            .replace(/^#+\s*/gm, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 500);
          prompt = masterCardPrompt({
            style,
            name: session.state.hero.name,
            appearance: heroBlockText || 'герой в тёмном фэнтези',
          });
          if (session.state.hero.card) {
            const ref = await imageDataUrl(session.state.hero.card);
            if (ref) references = [ref];
          }
        } else if (mode === 'sheet') {
          // Лист персонажа: спереди, сзади и портрет — одним кадром.
          actorName = String(body.name ?? '').trim();
          const heroSheet = body.hero === true || actorName === session.state.hero.name;
          if (heroSheet) {
            actorName = session.state.hero.name;
            prompt = characterSheetPrompt({
              style,
              name: session.state.hero.name,
              role: 'главный герой',
              appearance: (session.text.hero || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').slice(0, 600),
            });
            const ref = session.state.hero.card ? await imageDataUrl(session.state.hero.card) : null;
            if (ref) references = [ref];
          } else {
            const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === actorName);
            if (!actor) return sendJson(res, { error: 'персонаж не найден' }, 404);
            prompt = characterSheetPrompt({
              style,
              name: actor.name,
              role: actor.role,
              appearance: actor.appearance,
              clothes: actor.clothes,
              character: actor.character,
            });
            const ref = actor.card ? await imageDataUrl(actor.card) : null;
            if (ref) references = [ref];
          }
        } else if (mode === 'portrait' || mode === 'card') {
          actorName = String(body.name ?? '').trim();
          const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === actorName);
          if (!actor) return sendJson(res, { error: 'персонаж не найден' }, 404);

          if (mode === 'card') {
            prompt = masterCardPrompt({
              style,
              name: actor.name,
              role: actor.role,
              appearance: actor.appearance,
              clothes: actor.clothes,
              character: actor.character,
            });
            // Если уже есть портрет — держим лицо по нему.
            const ref = actor.portrait ? await imageDataUrl(actor.portrait) : null;
            if (ref) references = [ref];
          } else {
            prompt = portraitPrompt({
              style,
              name: actor.name,
              role: actor.role,
              appearance: actor.appearance,
              clothes: actor.clothes,
              character: actor.character,
            });
            // Портрет рисуем по мастер-листу, чтобы лицо не менялось.
            const ref = actor.card ? await imageDataUrl(actor.card) : null;
            if (ref) references = [ref];
          }
        } else if (mode === 'item') {
          itemName = String(body.name ?? '').trim();
          const item = session.state.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
          if (!item) return sendJson(res, { error: 'предмет не найден' }, 404);
          prompt = itemCardPrompt({ style, name: item.name, note: item.note });
        } else {
          // Кадр именно выбранного хода, а не всегда последнего.
          const requestedTurn = Number(body.turn);
          sceneTurn = Number.isFinite(requestedTurn) && requestedTurn > 0
            ? Math.min(session.state.turn, Math.round(requestedTurn))
            : session.state.turn;
          const sceneEntry = [...session.state.log]
            .reverse()
            .find((e) => e.role === 'gm' && e.turn === sceneTurn);
          const lastGm = sceneEntry ?? [...session.state.log].reverse().find((e) => e.role === 'gm');
          const present = [...session.state.party, ...session.state.npcs].filter(
            (actor) => actor.present !== false && actor.status === 'alive',
          );
          const hero = session.state.hero;
          const heroDescription = [
            hero.appearance,
            hero.essence,
            hero.bodyAttitude,
            hero.origin,
            hero.quirks,
          ]
            .filter(Boolean)
            .join('; ')
            .slice(0, 320);
          const heroFallback = String(session.text.hero ?? '')
            .replace(/#[^\n]*/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 260);
          prompt = scenePrompt({
            style,
            place: session.state.place,
            location:
              session.state.locations.find((location) => location.name === session.state.place)?.note ?? '',
            time: `день ${session.state.time.day}, ${String(session.state.time.hour).padStart(2, '0')}:00`,
            weather: session.state.weather,
            hero: {
              name: hero.name,
              gender: metas.get(id)?.gender === 'female' ? 'девушка' : 'мужчина',
              description: heroDescription || heroFallback,
            },
            characters: present.map(
              (actor) =>
                `${actor.name} — ${actor.role}; ${actor.appearance ?? 'без описания внешности'}; одет: ${actor.clothes ?? 'не описано'}`,
            ),
            action: (lastGm?.text ?? '').replace(/\s+/g, ' ').slice(0, 900),
          });
          references = await sceneReferences(session);
        }

        // Ключ и база — у агента-художника; без своего ключа берём глобальный.
        const artistKey = keyStore.getSync(artist.keyRef);
        const apiKey = localImage ? LOCAL_IMAGE_KEY : artistKey?.apiKey || API_KEY;
        const baseUrl = localImage ? LOCAL_IMAGE_BASE : artistKey?.baseUrl;
        if (!apiKey) return sendJson(res, { error: 'нет ключа у иллюстратора и нет OPENROUTER_API_KEY' }, 500);

        // Сначала выбор этой игры, потом глобальный из настроек иллюстратора.
        const savedArt = (await loadCampaign(DATA_DIR, id))?.meta?.art;
        const art =
          savedArt && (savedArt.include.length > 0 || savedArt.exclude.length > 0) ? savedArt : artSelection;

        // Выбранные теги иллюстратора дополняют промт.
        const extra = art.include.slice(0, 12).join(', ');
        const avoid = art.exclude.slice(0, 12).join(', ');
        // Выбранный стиль — в начало промта, иначе модель его почти не слышит.
        if (extra) prompt = `${extra}. ${prompt}`;
        if (avoid) prompt += ` Не изображать: ${avoid}.`;
        const imageSize = localImage ? '512x768' : undefined;
        const imageController = new AbortController();
        imageAbortControllers.add(imageController);
        if (features.imageProfiles) {
          if (imageProfile.style === 'booru') {
            prompt = `${prompt}, masterpiece, best quality, highly detailed`;
          } else {
            prompt = `${prompt} Кинематографичный свет, естественные пропорции, единый стиль.`;
          }
          if (imageProfile.negative) prompt += ` Не изображать: ${imageProfile.negative}.`;
          if (imageProfile.references === 'off') references = [];
          // Первый кадр без мастер-листа героя даёт «другого человека».
          // Делаем мастер-лист один раз и дальше держим его как референс.
          if (mode === 'scene' && imageProfile.references === 'auto' && !session.state.hero.card) {
            try {
              const heroPrompt = masterCardPrompt({
                style,
                name: session.state.hero.name,
                role: 'главный герой',
                appearance: [session.state.hero.appearance, session.state.hero.essence].filter(Boolean).join('; '),
                clothes: 'одежда по сцене',
                character: session.state.hero.essence,
              });
              const heroResult = await withImageQueue(() => generateImage({
                apiKey, baseUrl, model, prompt: heroPrompt, references: [], size: imageSize,
                signal: imageController.signal,
              }));
              const heroFile = await saveImage(id, 'sheet', heroResult.buffer, heroResult.mime);
              const heroUrl = `/api/images/${heroFile}`;
              session.state.hero.card = heroUrl;
              session.state.hero.refs = { ...(session.state.hero.refs ?? {}), main: heroUrl };
              const heroRef = await imageDataUrl(heroUrl);
              if (heroRef) references = [heroRef, ...references];
            } catch (err) {
              console.error('[hero-reference]', (err as Error).message);
            }
          }
        }

        // Seedream может быть недоступен у провайдера — тогда честно откатываемся.
        // Локальный Qwen не откатываем в облако: ошибка должна быть видна.
        let usedModel = model;
        let result = await withImageQueue(() => generateImage({
          apiKey,
          baseUrl,
          model,
          prompt,
          references,
          size: imageSize,
          signal: imageController.signal,
        }).catch(async (err: Error) => {
          if (localImage || model === IMAGE_FALLBACK_MODEL) throw err;
          console.error('[artist]', err.message, '→ откат на', IMAGE_FALLBACK_MODEL);
          usedModel = IMAGE_FALLBACK_MODEL;
          return generateImage({
            apiKey,
            baseUrl,
            model: IMAGE_FALLBACK_MODEL,
            prompt,
            references,
            signal: imageController.signal,
          });
        }));

        addUsage(session, 'artist', 0, 0, result.cost);
        const file = await saveImage(id, mode, result.buffer, result.mime);
        const url = `/api/images/${file}`;
        imageAbortControllers.delete(imageController);

        if (mode === 'hero') {
          session.state.hero.card = url;
          session.state.hero.refs = { ...(session.state.hero.refs ?? {}), main: url };
        } else if (mode === 'portrait' || mode === 'card' || mode === 'sheet') {
          if (mode === 'sheet' && actorName === session.state.hero.name) {
            session.state.hero.card = url;
            session.state.hero.refs = { ...(session.state.hero.refs ?? {}), main: url };
          } else {
            const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === actorName);
            if (actor) {
              if (mode === 'portrait') actor.portrait = url;
              else actor.card = url;
              if (mode === 'sheet' || mode === 'card') {
                actor.refs = { ...(actor.refs ?? {}), main: url };
              }
            }
          }
        } else if (mode === 'item') {
          const item = session.state.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
          if (item) item.card = url;
        } else {
          session.state.illustrations.push({ turn: sceneTurn, url, caption: session.state.place });
        }

        await persist(id, session);
        return sendJson(res, {
          url,
          mode,
          cost: result.cost,
          ms: result.ms,
          model: usedModel,
          requestedModel: model,
          fallback: usedModel !== model,
          prompt,
          references: references.length,
        });
      }

      if ((isTurn || action === 'stream') && req.method === 'POST') {
        if (metas.get(id)?.frozen) {
          return sendJson(res, { error: 'кампания заморожена в админке' }, 409);
        }
        const body = await readBody(req);
        const input = String(body.input ?? '').trim();
        if (!input) return sendJson(res, { error: 'пустой ход' }, 400);
        if (input.length > 1200) return sendJson(res, { error: 'ход слишком длинный' }, 400);
        const clientTurnId = String(body.clientTurnId ?? '').trim().slice(0, 80);
        const dedupe =
          /^[A-Za-z0-9_-]{8,80}$/.test(clientTurnId) &&
          (snapshots.get(id) ?? []).find((snap) => snap.clientTurnId === clientTurnId);
        if (dedupe) {
          const payload = replayTurn(session, dedupe);
          if (action === 'stream') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });
            res.write(`event: delta\ndata: ${JSON.stringify({ type: 'delta', text: '' })}\n\n`);
            res.write(`event: done\ndata: ${JSON.stringify({ type: 'done', payload })}\n\n`);
            res.end();
            return;
          }
          return sendJson(res, payload);
        }
        // Один ход на кампанию: две вкладки не должны писать в одно состояние.
        if (session.busy) return sendJson(res, { error: 'ход уже идёт, дождитесь ответа' }, 409);
        session.busy = true;

        const started = Date.now();

        try {
          // Потоковый ход: текст идёт кусками, финал приходит событием done.
          if (action === 'stream') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            });

            const send = (event: string, data: unknown): void => {
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            };

            // Пустой delta сразу: клиент понимает, что ход уже принят сервером,
            // и при обрыве позже не отправляет тот же ввод повторно.
            send('delta', { type: 'delta', text: '' });

            try {
              session.extraLore = pickLore(session, input);
              const notes = pickNotes(id, session, Boolean(body.dice), input);
              session.extraNotes = notes.text;
              await augmentFeatureNotes(session, input, id);
              session.lastRoll = notes.roll;
              const beforeNumbers = numericSnapshot(session.state);
              const stats = await runTurn(session, input, (delta) =>
                send('delta', { type: 'delta', text: delta }),
              );
              const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
              const payload = await afterTurn(session, id, input, prose, stats, started, undefined, clientTurnId, beforeNumbers);
              send('done', { type: 'done', payload });
            } catch (err) {
              send('error', {
                type: 'error',
                error: err instanceof Error ? err.message : String(err),
              });
            }

            res.end();
            return;
          }

          session.extraLore = pickLore(session, input);
          const notes = pickNotes(id, session, Boolean(body.dice), input);
          session.extraNotes = notes.text;
          await augmentFeatureNotes(session, input, id);
          session.lastRoll = notes.roll;
          const beforeNumbers = numericSnapshot(session.state);
          const stats = await runTurn(session, input);
          const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
          const payload = await afterTurn(session, id, input, prose, stats, started, undefined, clientTurnId, beforeNumbers);
          return sendJson(res, payload);
        } finally {
          session.busy = false;
        }
      }
    }

    if (path === '/api/images/queue' && req.method === 'GET') {
      return sendJson(res, {
        enabled: features.imageQueue,
        running: imageQueueRunning,
        waiting: imageQueueWaiting,
        cancellable: imageAbortControllers.size,
      });
    }

    if (path === '/api/images/cancel' && req.method === 'POST') {
      for (const controller of imageAbortControllers) controller.abort();
      imageAbortControllers.clear();
      return sendJson(res, { ok: true });
    }

    if (path.startsWith('/api/images/') && req.method === 'GET') {
      // Сначала декодируем, потом берём basename: иначе %2F может увести из папки.
      let file = '';
      try {
        file = basename(decodeURIComponent(path.slice('/api/images/'.length)));
      } catch {
        return sendJson(res, { error: 'плохое имя файла' }, 400);
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(file) || file.includes('..')) {
        return sendJson(res, { error: 'плохое имя файла' }, 400);
      }
      try {
        const data = await readFile(join(IMAGES_DIR, file));
        res.writeHead(200, {
          'Content-Type': file.endsWith('.png')
            ? 'image/png'
            : file.endsWith('.jpg') || file.endsWith('.jpeg')
              ? 'image/jpeg'
              : file.endsWith('.webp')
                ? 'image/webp'
                : 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400',
        });
        return res.end(data);
      } catch {
        return sendJson(res, { error: 'картинка не найдена' }, 404);
      }
    }

    if (path.startsWith('/api/')) return sendJson(res, { error: 'нет такого метода' }, 404);

    return await serveStatic(path, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[server]', message);
    return sendJson(res, { error: message }, 500);
  }
});

const pricing = await fetchPricing(MODEL);
if (pricing) prices = { input: pricing.input, output: pricing.output, cachedInput: pricing.cachedInput };

try {
  catalog = JSON.parse(await readFile(join(import.meta.dirname, '..', 'data', 'catalog.json'), 'utf8')) as Catalog;
} catch {
  console.error('[catalog] не найден data/catalog.json — запусти node scripts/build-catalog.mjs');
}

agents = await loadAgents(AGENTS_DIR);
// Файл настроек создаём сразу, чтобы его можно было править руками.
await saveAgents(AGENTS_DIR, agents);

server.listen(PORT, HOST, () => {
  console.log(`OMIKA · http://${HOST}:${PORT}`);
  console.log(`модель: ${MODEL}${API_KEY ? '' : ' (нет ключа — ходы не пройдут)'}`);
  console.log(`цена: $${prices.input.toFixed(4)}/M вход · $${prices.output.toFixed(4)}/M выход · $${prices.cachedInput.toFixed(4)}/M из кэша`);
});
