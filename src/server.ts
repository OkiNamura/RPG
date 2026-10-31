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
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, sep } from 'node:path';
import { generateImage, itemCardPrompt, masterCardPrompt, portraitPrompt, scenePrompt } from './core/images.ts';
import { renderMap } from './core/map.ts';
import { renderWorldMap } from './core/worldmap.ts';
import { createState, normalizeState } from './core/state.ts';
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
import { applyDelta, type Delta } from './core/delta.ts';
import { renderState } from './core/context.ts';
import {
  DEFAULT_AGENTS,
  IMAGE_FALLBACK_MODEL,
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
import { HERO_NAME, START_PLACE, TONE, WORLD } from './start/texts.ts';
import { isLoreEntry, matchLore, renderLore, type LoreEntry } from './core/lore.ts';
import { rollD36 } from './core/dice.ts';
import { defaultSkills, hiddenCheck } from './core/skills.ts';
import { generateDungeon, renderDungeon } from './core/dungeon.ts';
import { TONE_LEVELS, toneDirective, toneLevel } from './core/tone-levels.ts';
import { embedPngText, isPng } from './core/png.ts';
import { KeyStore, fetchKeyModels, normalizeBaseUrl, type KeyModel } from './core/keys.ts';

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

// Лор-книга: записи, которые подмешиваются только при совпадении ключей.
const LOREBOOK_PATH = join(import.meta.dirname, '..', 'data', 'lorebook.json');
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

const PORT = Number(process.env.PORT ?? 7801);
const WEB_DIR = join(import.meta.dirname, 'web');
const DATA_DIR = join(import.meta.dirname, '..', 'data', 'campaigns');
const IMAGES_DIR = join(import.meta.dirname, '..', 'data', 'images');
const AGENTS_DIR = join(import.meta.dirname, '..', 'data');
const MODEL = process.env.OMIKA_MODEL ?? process.env.PRG_MODEL ?? 'deepseek/deepseek-v4-flash-0731';
const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
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

/** Хранитель сохранения: добирает то, что ведущий мог не внести в стейт. */
async function runStateAgent(
  session: Session,
  prose: string,
): Promise<{ changes: string[]; cost: number; tokensIn: number; tokensOut: number }> {
  const agent = session.agents?.state ?? agents.state;
  if (!agent.enabled) return { changes: [], cost: 0, tokensIn: 0, tokensOut: 0 };

  const model = makeAgentModel(agent);
  const reply = await model.complete([
    { role: 'system', content: agent.prompt },
    {
      role: 'user',
      content: `СОСТОЯНИЕ:\n${renderState(session.state)}\n\nПОСЛЕДНИЙ ХОД:\n${prose.slice(0, 4000)}`,
    },
  ]);

  const tokensIn = reply.inputTokens ?? 0;
  const tokensOut = reply.outputTokens;
  const cost = costOf(tokensIn, tokensOut);
  addUsage(session, 'state', tokensIn, tokensOut, cost);

  const delta = parseJsonObject(reply.text);
  const changes = delta ? applyDelta(session.state, delta as Delta) : [];
  return { changes, cost, tokensIn, tokensOut };
}

/**
 * Конспектировщик — скользящий.
 *
 * Каждый ход получает прошлый конспект и новый ход, возвращает обновлённый.
 * Всё, что старше окна последних 30 ходов, живёт только здесь, поэтому
 * контекст не растёт с длиной истории.
 */
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

  const cleaned = reply.text.replace(/^\s*КОНСПЕКТ:\s*/i, '').trim();
  if (cleaned) {
    const arc = Math.floor((to - 1) / 10) + 1;
    const header = `\n\n## Арка ${arc} · ходы ${from}–${to}\n`;
    const prev = session.summary ?? '';
    // Старый конспект не переписываем: только добавляем новую арку/фрагмент.
    session.summary = `${prev}${header}${cleaned}`.slice(-24000);
  }
  session.lastSummaryTurn = to;
  return { ok: true, cost, tokensIn, tokensOut };
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
  const lastGm = [...state.log].reverse().find((e) => e.role === 'gm')?.text ?? '';
  const text = [
    input,
    state.place,
    state.weather,
    ...(state.party ?? []).map((a) => a.name),
    ...(state.locations ?? []).map((l) => l.name),
    lastGm.slice(-500),
  ].join(' ');

  // Автолор из состояния + ручные записи из лор-книги.
  const auto: LoreEntry[] = (state.lore ?? []).map((entry, index) => ({
    id: `auto-${index}`,
    keys: entry.keys,
    content: entry.content,
    priority: 1,
  }));

  return renderLore(matchLore([...lorebook, ...auto], text));
}

/** Броски и скрытые проверки: то, что модель не должна выдумывать сама. */
function pickNotes(id: string, session: Session, dice: boolean): { text: string; roll: unknown } {
  const parts: string[] = [];
  let roll: unknown = null;

  if (dice) {
    const result = rollD36(`${id}-${session.state.turn}-dice`);
    roll = result;
    parts.push(
      `Бросок d36: ${result.face}${result.joker ? ` — ${result.label}` : ''}. Исход броска учти в сцене.`,
    );
  }

  const skills = session.state.hero.skills ?? defaultSkills(`${id}-hero`);
  const difficulty = 8 + ((session.state.turn * 7) % 7);
  const check = hiddenCheck(`${id}-${session.state.turn}-${session.state.place}`, skills, difficulty);
  parts.push(
    `Скрытая проверка (игрок её не видит): ${check.told}. Покажи только последствия, без цифр.`,
  );

  return { text: parts.join('\n'), roll };
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

  if (session.state.hero.card) {
    const heroRef = await imageDataUrl(session.state.hero.card);
    if (heroRef) refs.push(heroRef);
  }

  for (const actor of session.state.party) {
    const url = actor.card || actor.portrait;
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

/**
 * Общая часть после хода: агент состояния и конспектировщик параллельно,
 * сохранение на диск и готовый ответ. Одинаково для обычного и потокового хода.
 */async function afterTurn(
  session: Session,
  id: string,
  input: string,
  prose: string,
  stats: TurnStats,
  started: number,
  variantFrom?: TurnSnapshot,
): Promise<Record<string, unknown>> {
  const [stateResult, summaryResult] = await Promise.allSettled([
    runStateAgent(session, prose),
    session.state.turn - (session.lastSummaryTurn ?? 0) >= 3
      ? runSummary(session, input, prose)
      : Promise.resolve({ ok: false, cost: 0, tokensIn: 0, tokensOut: 0 }),
  ]);

  const agentChanges = stateResult.status === 'fulfilled' ? stateResult.value.changes : [];
  if (stateResult.status === 'rejected') console.error('[state agent]', stateResult.reason);

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
  saveSnapshot(
    id,
    {
      turn: stats.turn,
      input,
      prose,
      state: structuredClone(session.state),
      summary: session.summary ?? '',
    },
    variantFrom,
  );

  await persist(id, session);

  return {
    prose,
    changes: [...stats.changes, ...agentChanges],
    agentChanges,
    summarized,
    problems: stats.problems,
    state: session.state,
    map: renderDungeon(generateDungeon(session.state.place, { width: 31, height: 14 })),
    worldMap: renderWorldMap(
      metas.get(id)?.presetTitle || metas.get(id)?.title || id,
      (session.state.locations?.length ? session.state.locations : [{ name: session.state.place }]).map((l) => ({ name: l.name })),
      { height: 15, unknown: 3 },
    ),
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

async function getSession(id: string): Promise<Session | null> {
  const cached = sessions.get(id);
  if (cached) return cached;

  const saved = await loadCampaign(DATA_DIR, id);
  if (!saved) return null;

  // У каждой игры свои агенты; старые кампании берут глобальные.
  const gameAgents = (saved.agents as unknown as AgentSet) ?? structuredClone(agents);

  const gmKey = keyStore.getSync(gameAgents.gm.keyRef);
  if (!gmKey?.apiKey && !API_KEY) throw new Error('нет ключа API для ведущего');
  let model = makeAgentModel(gameAgents.gm, !gameAgents.state.enabled);

  // Ядро не хранится в кампании: подставляем неизменяемый файл.
  // Сверху — промт ведущего из настроек агентов.
  const coreFile = saved.text.core || (await loadCore());
  const gmPrompt =
    saved.meta?.prompts?.gm ||
    (gameAgents.gm.enabled ? gameAgents.gm.prompt : DEFAULT_AGENTS.gm.prompt);
  if (typeof saved.meta?.prompts?.temperature === 'number') {
    model = makeAgentModel({ ...gameAgents.gm, temperature: saved.meta.prompts.temperature }, !gameAgents.state.enabled);
  }
  const settingsList = saved.meta?.aiSettings ?? [];
  const settingsLine = settingsList.length
    ? `\n\n# НАСТРОЙКИ ИИ\n${settingsList.map((s) => `- ${s}`).join('\n')}`
    : '';
  const core = gmPrompt ? `${gmPrompt}${settingsLine}\n\n${coreFile}` : `${coreFile}${settingsLine}`;

  const session = createSession({
    text: { ...saved.text, core },
    state: normalizeState(saved.state),
    model,
    prices,
    windowTurns: 30,
    summarizeEvery: 10,
  });
  session.agents = gameAgents;
  session.conspect = conspectFrom(saved);
  session.summary = saved.summary ?? '';
  session.memory = saved.memory ?? '';
  session.usage = saved.usage ?? {};
  session.totals = saved.totals;
  session.quietConspect = gameAgents.summarizer.enabled;
  session.expectDelta = !gameAgents.state.enabled;
  if (saved.meta) metas.set(id, saved.meta);
  if (saved.turns) snapshots.set(id, saved.turns);
  if (saved.initial) initials.set(id, saved.initial);
  sessions.set(id, session);
  return session;
}

async function persist(id: string, session: Session): Promise<void> {
  // Большое ядро в файл кампании не кладём — оно подставляется при загрузке.
  const core = session.text.core.length > 50000 ? '' : session.text.core;
  await saveCampaign(DATA_DIR, id, {
    text: { ...session.text, core },
    state: session.state,
    conspect: session.conspect.toJSON(),
    summary: session.summary,
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

  session.state = structuredClone(source.state);
  session.summary = source.summary;
  session.state.log = session.state.log.filter((e) => e.turn <= turn);
  session.state.turn = turn;
  return true;
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
  // Держим последние 120 ходов — этого хватает для откатов.
  snapshots.set(id, list.slice(-120));
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
          meta?: { title?: string; presetTitle?: string };
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
    if (path === '/api/campaigns' && req.method === 'GET') {
      return sendJson(res, await listCampaigns());
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
          name: body.name,
          provider: body.provider,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
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
          name: body.name,
          provider: body.provider,
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
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
      const baseUrl = normalizeBaseUrl(body.baseUrl);
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
            artists: { ...(nextMeta.prompts?.artists ?? {}), ...(body.artists ?? {}) },
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
      const tags = raw
        .map((name) => String(name ?? '').trim())
        .filter((name) => name.length > 0)
        .slice(0, limit);

      return sendJson(res, {
        tags,
        level,
        ms: Date.now() - t0,
        cost: costOf(reply.inputTokens ?? 0, reply.outputTokens),
        model: agent?.enabled ? agent.model : undefined,
      });
    }

    if (path === '/api/generate/world' && req.method === 'POST') {
      const body = await readBody(req);
      const presetId = String(body.presetId ?? '');
      const custom = String(body.description ?? '').trim();

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
    if (path === '/api/generate/hero' && req.method === 'POST') {
      const body = await readBody(req);
      const form = (body.form ?? {}) as Record<string, string>;
      const level = Number(body.toneLevel);
      const pack = compositionModel(2000, await loadHeroPrompt());
      if (!pack) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      const t0 = Date.now();
      const reply = await pack.model.complete([
        { role: 'system', content: pack.system },
        {
          role: 'user',
          content: [
            'Форма героя:',
            ...Object.entries(form)
              .filter(([, value]) => String(value ?? '').trim())
              .map(([key, value]) => `- ${key}: ${String(value).trim()}`),
            '',
            'Верни только JSON: {"essence":"","appearance":"","bodyAttitude":"",',
            '"origin":"","quirks":"","abilities":"","start":""} — по одному-два предложения.',
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

      if (await loadCampaign(DATA_DIR, id)) {
        return sendJson(res, { error: 'кампания с таким именем уже есть' }, 409);
      }

      // Каждая игра получает своих агентов — снимок текущих настроек.
      const gameAgents = structuredClone(agents);
      const model = makeAgentModel(gameAgents.gm, !gameAgents.state.enabled);
      if (!model) return sendJson(res, { error: 'нет OPENROUTER_API_KEY в .env' }, 500);

      const toneText = typeof body.tone === 'string' && body.tone.length > 200 ? body.tone : TONE;
      const worldText = typeof body.world === 'string' && body.world.length > 200 ? body.world : WORLD;
      const heroText = typeof body.hero === 'string' ? body.hero : '';
      const meta = (typeof body.meta === 'object' && body.meta ? body.meta : {}) as CampaignMeta;
      meta.createdAt = new Date().toISOString();

      // Уровень повествования: 0 — детская сказка, 11 — предел жестокости.
      const levelRaw = Number(body.toneLevel ?? (meta as { toneLevel?: number }).toneLevel);
      const level = Number.isFinite(levelRaw) ? toneLevel(levelRaw) : null;
      if (level) {
        meta.toneLevel = level.value;
        meta.toneLevelName = level.name;
      }
      const levelBlock = level ? `\n\n${toneDirective(level.value)}` : '';

      // Каждая новая игра получает своих ведущего и иллюстратора под тон и мир.
      if (body.generatePrompts !== false && agents.prompter?.enabled) {
        try {
          const composed = await composePrompts({
            tone: `${toneText}${levelBlock}`,
            world: worldText,
            hero: heroText,
            level: level?.value ?? 5,
            temperature: gameAgents.gm.temperature,
          });
          gameAgents.gm.prompt = composed.gm;
          gameAgents.gm.temperature = composed.temperature;
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
          meta.prompts = composed;
        } catch (err) {
          console.error('[compose]', (err as Error).message);
        }
      }

      const heroName =
        typeof body.heroName === 'string' && body.heroName.trim() ? body.heroName.trim() : HERO_NAME;
      const place = meta.presetTitle ? `Начало: ${meta.presetTitle}` : START_PLACE;

      const state = createState(heroName, place);

      // Скиллы из шаблона героя, если игрок выбрал готовый архетип.
      if (body.heroSkills && typeof body.heroSkills === 'object') {
        const chosen: Record<string, number> = {};
        for (const [skill, value] of Object.entries(body.heroSkills as Record<string, unknown>)) {
          const score = Math.max(0, Math.min(20, Number(value)));
          if (Number.isFinite(score)) chosen[String(skill)] = score;
        }
        if (Object.keys(chosen).length) state.hero.skills = chosen;
      }
      const gmPrompt =
        meta.prompts?.gm ||
    (gameAgents.gm.enabled ? gameAgents.gm.prompt : DEFAULT_AGENTS.gm.prompt);
      const session: Session = createSession({
        text: { core: `${gmPrompt}\n\n${await loadCore()}`, world: worldText, tone: `${toneText}${levelBlock}`, hero: heroText },
        state,
        model,
        prices,
        windowTurns: 30,
        summarizeEvery: 10,
      });
      session.agents = gameAgents;
      session.quietConspect = gameAgents.summarizer.enabled;
      session.expectDelta = !gameAgents.state.enabled;

      metas.set(id, meta);
      sessions.set(id, session);
      // Точка полного отката — состояние до первого хода.
      initials.set(id, { prose: '', state: structuredClone(state), summary: '' });
      snapshots.set(id, []);
      await persist(id, session);
      return sendJson(res, { id, state, history: [], totals: session.totals, meta });
    }

    const campaignMatch = /^\/api\/campaign\/([^/]+)(?:\/(turn|stream|drop|quest|image|regenerate|edit|variant|card|memory|context|container))?$/.exec(path);
    if (campaignMatch) {
      const id = decodeURIComponent(campaignMatch[1]);
      const action = campaignMatch[2] ?? '';
      const isTurn = action === 'turn';

      if (req.method === 'DELETE' && !action) {
        sessions.delete(id);
        await unlink(join(DATA_DIR, `${id}.json`)).catch(() => undefined);
        return sendJson(res, { ok: true });
      }

      const session = await getSession(id);
      if (!session) return sendJson(res, { error: 'кампания не найдена' }, 404);

      // Контейнер игры: агенты с промтами, предметы, конспект, галерея.
      if (action === 'container' && req.method === 'GET') {
        const meta = metas.get(id) ?? {};
        const gameAgents = (session.agents ?? agents) as unknown as Record<string, unknown>;
        return sendJson(res, {
          id,
          title: (meta as { title?: string }).title || id,
          turn: session.state.turn,
          place: session.state.place,
          time: session.state.time,
          savedAt: (meta as { savedAt?: string }).savedAt,
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
          npcs: session.state.npcs ?? [],
          party: session.state.party ?? [],
          factions: session.state.factions ?? [],
          quests: session.state.quests ?? [],
          summary: session.summary ?? '',
          memory: session.memory ?? '',
          conspect: session.conspect.renderFrozen(),
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
          map: renderDungeon(generateDungeon(session.state.place, { width: 31, height: 14 })),
          worldMap: renderWorldMap(
            metas.get(id)?.presetTitle || metas.get(id)?.title || id,
            (session.state.locations?.length ? session.state.locations : [{ name: session.state.place }]).map((l) => ({ name: l.name })),
            { height: 15, unknown: 3 },
          ),
          conspect: session.conspect.renderFrozen(),
          conspectRecent: session.conspect.renderRecent(),
          turns: (snapshots.get(id) ?? []).map((s) => ({
            turn: s.turn,
            input: s.input,
            variants: 1 + (s.variants?.length ?? 0),
          })),
        });
      }

      // Отладочный снимок последнего контекста: что именно ушло в модель.
      if (action === 'context' && req.method === 'GET') {
        if (!session.lastContext) return sendJson(res, { error: 'ещё не было ходов' }, 404);
        return sendJson(res, { id, turn: session.state.turn, ...session.lastContext });
      }

      // Перегенерация хода: откат к предыдущему снимку и повтор того же ввода.
      if (action === 'regenerate' && req.method === 'POST') {
        const body = await readBody(req);
        const turn = Number(body.turn ?? 0);
        const list = snapshots.get(id) ?? [];
        const target = list.find((s) => s.turn === turn);
        if (!target) return sendJson(res, { error: 'нет снимка этого хода' }, 404);
        if (!restoreTo(session, id, turn - 1)) {
          return sendJson(res, { error: 'нет снимка предыдущего хода' }, 400);
        }

        const started = Date.now();
        session.extraLore = pickLore(session, target.input);
        const notes = pickNotes(id, session, false);
        session.extraNotes = notes.text;
        session.lastRoll = notes.roll;
        const stats = await runTurn(session, target.input);
        const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
        const payload = await afterTurn(session, id, target.input, prose, stats, started, target);
        return sendJson(res, payload);
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
        if (!restoreTo(session, id, turn - 1)) {
          return sendJson(res, { error: 'нет снимка предыдущего хода' }, 400);
        }

        const started = Date.now();
        session.extraLore = pickLore(session, input);
        const notes = pickNotes(id, session, Boolean(body.dice));
        session.extraNotes = notes.text;
        session.lastRoll = notes.roll;
        const stats = await runTurn(session, input);
        const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
        const payload = await afterTurn(session, id, input, prose, stats, started, target);
        return sendJson(res, payload);
      }

      // Переключение варианта ответа на ход.
      if (action === 'variant' && req.method === 'POST') {
        const body = await readBody(req);
        const turn = Number(body.turn ?? 0);
        const index = Number(body.index ?? 0);
        const list = snapshots.get(id) ?? [];
        const snap = list.find((s) => s.turn === turn);
        if (!snap) return sendJson(res, { error: 'нет снимка этого хода' }, 404);

        if (index > 0) {
          const variant = snap.variants?.[index - 1];
          if (!variant) return sendJson(res, { error: 'нет такого варианта' }, 404);

          // Меняемся местами: текущий уходит в варианты, выбранный — в игру.
          snap.variants![index - 1] = {
            prose: snap.prose,
            state: snap.state,
            summary: snap.summary,
          };
          session.state = structuredClone(variant.state);
          session.summary = variant.summary;
          snap.prose = variant.prose;
          snap.state = structuredClone(variant.state);
          snap.summary = variant.summary;

          session.state.log = session.state.log.filter((e) => e.turn !== turn);
          session.state.log.push({ turn, role: 'player', text: snap.input });
          session.state.log.push({ turn, role: 'gm', text: variant.prose });
        }

        await persist(id, session);
        return sendJson(res, { ok: true, prose: snap.prose, state: session.state });
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
          map: renderDungeon(generateDungeon(session.state.place, { width: 31, height: 14 })),
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
        const mode = ['scene', 'portrait', 'card', 'item', 'hero'].includes(rawMode) ? rawMode : 'scene';

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
        const model = artist.model || IMAGE_FALLBACK_MODEL;

        let prompt = '';
        let actorName = '';
        let itemName = '';
        let references: string[] = [];

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
          const lastGm = [...session.state.log].reverse().find((e) => e.role === 'gm');
          prompt = scenePrompt({
            style,
            place: session.state.place,
            time: `день ${session.state.time.day}, ${String(session.state.time.hour).padStart(2, '0')}:00`,
            weather: session.state.weather,
            characters: session.state.party.map((a) => a.name),
            action: (lastGm?.text ?? '').replace(/\s+/g, ' ').slice(0, 400),
          });
          references = await sceneReferences(session);
        }

        // Ключ и база — у агента-художника; без своего ключа берём глобальный.
        const artistKey = keyStore.getSync(artist.keyRef);
        const apiKey = artistKey?.apiKey || API_KEY;
        const baseUrl = artistKey?.baseUrl;
        if (!apiKey) return sendJson(res, { error: 'нет ключа у иллюстратора и нет OPENROUTER_API_KEY' }, 500);

        // Сначала выбор этой игры, потом глобальный из настроек иллюстратора.
        const savedArt = (await loadCampaign(DATA_DIR, id))?.meta?.art;
        const art =
          savedArt && (savedArt.include.length > 0 || savedArt.exclude.length > 0) ? savedArt : artSelection;

        // Выбранные теги иллюстратора дополняют промт.
        const extra = art.include.slice(0, 12).join(', ');
        const avoid = art.exclude.slice(0, 12).join(', ');
        if (avoid) prompt += ` Не изображать: ${avoid}.`;

        // Seedream может быть недоступен у провайдера — тогда честно откатываемся.
        let usedModel = model;
        let result = await generateImage({ apiKey, baseUrl, model, prompt, references }).catch(
          async (err: Error) => {
            if (model === IMAGE_FALLBACK_MODEL) throw err;
            console.error('[artist]', err.message, '→ откат на', IMAGE_FALLBACK_MODEL);
            usedModel = IMAGE_FALLBACK_MODEL;
            return generateImage({
              apiKey,
              baseUrl,
              model: IMAGE_FALLBACK_MODEL,
              prompt,
              references,
            });
          },
        );

        addUsage(session, 'artist', 0, 0, result.cost);
        const file = await saveImage(id, mode, result.buffer, result.mime);
        const url = `/api/images/${file}`;

        if (mode === 'hero') {
          session.state.hero.card = url;
        } else if (mode === 'portrait' || mode === 'card') {
          const actor = [...session.state.party, ...session.state.npcs].find((a) => a.name === actorName);
          if (actor) {
            if (mode === 'card') actor.card = url;
            else actor.portrait = url;
          }
        } else if (mode === 'item') {
          const item = session.state.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
          if (item) item.card = url;
        } else {
          session.state.illustrations.push({ turn: session.state.turn, url, caption: session.state.place });
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
        const body = await readBody(req);
        const input = String(body.input ?? '').trim();
        if (!input) return sendJson(res, { error: 'пустой ход' }, 400);
        if (input.length > 1200) return sendJson(res, { error: 'ход слишком длинный' }, 400);

        const started = Date.now();

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

          try {
        session.extraLore = pickLore(session, input);
        const notes = pickNotes(id, session, Boolean(body.dice));
        session.extraNotes = notes.text;
        session.lastRoll = notes.roll;
            const stats = await runTurn(session, input, (delta) => send('delta', { text: delta }));
            const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
            const payload = await afterTurn(session, id, input, prose, stats, started);
            send('done', payload);
          } catch (err) {
            send('error', { message: err instanceof Error ? err.message : String(err) });
          }

          res.end();
          return;
        }

        session.extraLore = pickLore(session, input);
        const notes = pickNotes(id, session, Boolean(body.dice));
        session.extraNotes = notes.text;
        session.lastRoll = notes.roll;
        const stats = await runTurn(session, input);
        const prose = session.state.log[session.state.log.length - 1]?.text ?? '';
        const payload = await afterTurn(session, id, input, prose, stats, started);
        return sendJson(res, payload);
      }
    }

    if (path.startsWith('/api/images/') && req.method === 'GET') {
      // Путь приходит закодированным — файл ищем по декодированному имени.
      let file = basename(path);
      try {
        file = decodeURIComponent(file);
      } catch {
        /* оставляем как есть */
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OMIKA · http://127.0.0.1:${PORT}`);
  console.log(`модель: ${MODEL}${API_KEY ? '' : ' (нет ключа — ходы не пройдут)'}`);
  console.log(`цена: $${prices.input.toFixed(4)}/M вход · $${prices.output.toFixed(4)}/M выход · $${prices.cachedInput.toFixed(4)}/M из кэша`);
});
