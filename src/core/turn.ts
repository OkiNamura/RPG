/**
 * Цикл одного хода.
 *
 * Контекст собирается ДО изменения стейта — так кэш считается по тому,
 * что реально ушло в модель.
 */

import { buildContext, cachedPrefix, type Segment } from './context.ts';
import { Conspect } from './conspect.ts';
import { applyDelta, parseDelta, type Delta, type ParsedReply } from './delta.ts';
import { critique } from './critic.ts';
import type { Model } from './model.ts';
import type { AgentSet } from './agents.ts';
import type { GameState } from './state.ts';
import { cleanProse } from './anti-slop.ts';

/** Насколько новый текст похож на предыдущий ответ ведущего. */
function proseSimilarity(a: string, b: string): number {
  const words = (text: string): Set<string> =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 2),
    );
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const word of left) if (right.has(word)) common += 1;
  return common / Math.max(left.size, right.size);
}

/** Цены за 1M токенов. Пока — заглушка, реальные подставим после M1. */
export interface Prices {
  input: number;
  output: number;
  cachedInput: number;
}

export interface CampaignText {
  core: string;
  world: string;
  tone: string;
  hero?: string;
}

export interface Totals {
  tokensIn: number;
  tokensOut: number;
  cached: number;
  cost: number;
}

export interface SegmentReport extends Segment {
  cached: boolean;
}

export interface AgentUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface Session {
  text: CampaignText;
  state: GameState;
  conspect: Conspect;
  /** агенты именно этой игры */
  agents?: AgentSet;
  /** лор-книга, подобранная под текущий ход */
  extraLore?: string;
  extraLoreTop?: string;
  extraLoreHistory?: string;
  extraLoreAfter?: string;
  extraLoreDepth?: string;
  /** отчёт активации World Info для инспектора */
  lastLoreReport?: { id: string; title: string; active: boolean; reason: string; chars: number }[];
  /** sticky/cooldown для World Info */
  loreState?: Record<string, { lastTurn: number; stickyUntil: number; cooldownUntil: number }>;
  /** имена NPC, на которых сфокусирована сцена */
  groupFocus?: string[];
  /** броски и скрытые проверки этого хода */
  extraNotes?: string;
  /** результат кубика за текущий ход */
  lastRoll?: unknown;
  /** закреплённая память истории */
  memory?: string;
  model: Model;
  prices: Prices;
  totals: Totals;
  /** расход по агентам: gm, state, summarizer, artist */
  usage: Record<string, AgentUsage>;
  windowTurns: number;
  summarizeEvery: number;
  /** сегменты прошлого хода — для расчёта кэша */
  lastSegments: Segment[];
  /** ход, на котором конспект в последний раз обновлялся агентом */
  lastSummaryTurn?: number;
  /** старые арки, вытесненные из summary, но не потерянные */
  arcArchive?: string[];
  /** конспектом владеет агент — механические строки не пишем */
  quietConspect?: boolean;
  /** состоянием владеет агент — от ведущего JSON не требуем */
  expectDelta?: boolean;
  /** включён ли мягкий anti-slop */
  antiSlop?: boolean;
  /** идёт ход: второй параллельный запрос не пускаем */
  busy?: boolean;
  /** скользящий конспект: всё, что старше окна последних ходов */
  summary?: string;
  /** последний собранный контекст — для отладки и анализа */
  lastContext?: {
    messages: { role: string; content: string }[];
    totalTokens: number;
    segments: { name: string; chars: number; tokens?: number }[];
  };
  /** время последнего вызова режиссёра */
  lastDirectorMs?: number;
}

export interface TurnStats {
  turn: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cost: number;
  problems: string[];
  changes: string[];
  segments: SegmentReport[];
  /** сцена топталась: повтор действия или повтор ответа */
  stalled?: boolean;
  /** максимальное совпадение с недавними действиями игрока */
  actionRepeat?: number;
  /** миллисекунды по этапам */
  timings?: Record<string, number>;
}

export function createSession(params: {
  text: CampaignText;
  state: GameState;
  model: Model;
  prices: Prices;
  conspectHeader?: string;
  windowTurns?: number;
  summarizeEvery?: number;
}): Session {
  return {
    text: params.text,
    state: params.state,
    conspect: new Conspect(params.conspectHeader ?? '# Конспект кампании'),
    model: params.model,
    prices: params.prices,
    totals: { tokensIn: 0, tokensOut: 0, cached: 0, cost: 0 },
    usage: {},
    windowTurns: params.windowTurns ?? 24,
    summarizeEvery: params.summarizeEvery ?? 10,
    lastSegments: [],
  };
}

/** Прибавить расход агента к общей копилке. */
export function addUsage(
  session: Session,
  agent: string,
  tokensIn: number,
  tokensOut: number,
  cost: number,
): void {
  const current = session.usage[agent] ?? { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
  current.calls += 1;
  current.tokensIn += tokensIn;
  current.tokensOut += tokensOut;
  current.cost += cost;
  session.usage[agent] = current;
}

function firstSentence(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

export async function runTurn(
  session: Session,
  playerInput: string,
  onDelta?: (text: string) => void,
): Promise<TurnStats> {
  const state = session.state;
  const previousGm = [...state.log].reverse().find((entry) => entry.role === 'gm')?.text ?? '';
  const recentPlayerActions = state.log
    .filter((entry) => entry.role === 'player')
    .slice(-6)
    .map((entry) => entry.text);
  const actionRepeat = recentPlayerActions.reduce(
    (max, previous) => Math.max(max, proseSimilarity(previous, playerInput)),
    0,
  );
  if (actionRepeat > 0.72) {
    session.extraNotes = [
      session.extraNotes,
      'СЦЕНА ТОПЧЕТСЯ: игрок повторяет то же действие. Не повторяй прошлый ответ. Введи новый факт, реакцию или реплику, которые реально меняют сцену.',
    ].filter(Boolean).join('\n');
  }

  const contextStarted = Date.now();
  const ctx = buildContext({
    core: session.text.core,
    world: session.text.world,
    tone: session.text.tone,
    hero: session.text.hero,
    conspectFrozen: session.conspect.renderFrozen(),
    conspectSummary: session.summary,
    state,
    windowTurns: session.windowTurns,
    playerInput,
    lore: session.extraLore,
    loreTop: session.extraLoreTop,
    loreHistory: session.extraLoreHistory,
    loreAfter: session.extraLoreAfter,
    loreDepth: session.extraLoreDepth,
    notes: session.extraNotes,
    memory: session.memory,
  });

  const contextMs = Date.now() - contextStarted;
  const prev = session.lastSegments;
  const prefixCached = cachedPrefix(prev, ctx.segments);
  session.lastSegments = ctx.segments;

  // Снимок для анализа: ровно то, что уходит в модель.
  session.lastContext = {
    messages: ctx.messages.map((m) => ({ role: m.role, content: m.content })),
    totalTokens: ctx.totalTokens,
    segments: ctx.segments.map((s) => ({ name: s.name, chars: s.chars, tokens: s.tokens })),
  };

  // Стрим возможен, когда ведущий пишет чистую прозу (состоянием владеет агент).
  // Если включён структурный вывод, поток отдавал бы JSON — такое не показываем.
  const canStream =
    Boolean(onDelta) && session.expectDelta === false && typeof session.model.stream === 'function';

  let reply = canStream
    ? await session.model.stream!(ctx.messages, onDelta!)
    : await session.model.complete(ctx.messages);
  const gmMs = Date.now() - contextStarted - contextMs;
  // Провайдер знает точнее — берём его цифры, если они есть.
  let tokensIn = reply.inputTokens ?? ctx.totalTokens;
  let cachedTokens = reply.cachedTokens ?? prefixCached;
  let outputTokens = reply.outputTokens;

  // Структурный вывод: изменения уже отдельным полем.
  // Текстовый: выковыриваем блок из прозы.
  let parsed: ParsedReply =
    reply.delta !== undefined
      ? { prose: reply.text.trim(), delta: reply.delta }
      : parseDelta(reply.text);

  // Пустой ответ провайдера: один повтор, иначе игрок получает пузырь ни о чём.
  if (!parsed.prose.trim()) {
    const retry = await session.model.complete([
      ...ctx.messages,
      { role: 'user', content: 'Ответ пришёл пустым. Продолжи сцену обычным текстом, без JSON.' },
    ]);
    reply = retry;
    tokensIn += retry.inputTokens ?? 0;
    cachedTokens += retry.cachedTokens ?? 0;
    outputTokens += retry.outputTokens ?? 0;
    parsed =
      retry.delta !== undefined
        ? { prose: retry.text.trim(), delta: retry.delta }
        : parseDelta(retry.text);
  }

  if (!parsed.prose.trim()) {
    parsed = { ...parsed, prose: 'Сцена обрывается — ведущий молчит, и тишина становится ответом.' };
  } else {
    parsed = { ...parsed, prose: session.antiSlop === false ? parsed.prose : cleanProse(parsed.prose) };
  }

  // Защита от зацикливания: модель иногда повторяет предыдущий ответ
  // дословно, хотя игрок уже сказал новое. Один повтор с явным запретом.
  let repeatedResponse = false;
  if (previousGm && parsed.prose.trim()) {
    const similarity = proseSimilarity(previousGm, parsed.prose);
    if (similarity > 0.82) {
      repeatedResponse = true;
      try {
        const retry = await session.model.complete([
          ...ctx.messages,
          {
            role: 'user',
            content:
              'Сцена топчется. Ответь на новое действие игрока и введи новый факт: реакцию, реплику, звук или изменение положения. Не повторяй прошлый ответ и не задавай тот же вопрос.',
          },
        ]);
        tokensIn += retry.inputTokens ?? 0;
        cachedTokens += retry.cachedTokens ?? 0;
        outputTokens += retry.outputTokens ?? 0;
        const retryParsed =
          retry.delta !== undefined
            ? { prose: retry.text.trim(), delta: retry.delta }
            : parseDelta(retry.text);
        const retryProse = session.antiSlop === false ? retryParsed.prose : cleanProse(retryParsed.prose);
        if (retryProse.trim() && proseSimilarity(previousGm, retryProse) < similarity) {
          parsed = { ...retryParsed, prose: retryProse };
          repeatedResponse = false;
        }
      } catch {
        /* оставляем первый ответ */
      }
    }
  }

  state.turn += 1;
  const changes = parsed.delta ? applyDelta(state, parsed.delta) : [];

  // Время не стоит: если ведущий не сдвинул часы, сцена всё равно идёт.
  // Но когда состоянием владеет отдельный агент, +1 час — это его решение,
  // а не принудительный тик на каждом ходу.
  if (
    session.expectDelta !== false &&
    (!parsed.delta ||
      (parsed.delta.advanceHours == null &&
        parsed.delta.advanceMinutes == null &&
        parsed.delta.advanceSeconds == null) ||
      Number(parsed.delta.advanceHours ?? 0) + Number(parsed.delta.advanceMinutes ?? 0) + Number(parsed.delta.advanceSeconds ?? 0) <= 0)
  ) {
    const total = (Number(state.time.hour ?? 0) + 1) * 3600;
    state.time.day += Math.floor(total / 86400);
    state.time.hour = Math.floor((total % 86400) / 3600);
    state.time.minute = 0;
    state.time.second = 0;
    changes.push('время: +1 час');
  }
  const verdict = critique(state, parsed.prose, parsed.delta, changes, session.expectDelta !== false);

  state.log.push({ turn: state.turn, role: 'player', text: playerInput });
  state.log.push({ turn: state.turn, role: 'gm', text: parsed.prose });

  // Когда конспектом занимается агент, механические строки не пишем:
  // они дублируют его работу и раздувают контекст.
  if (!session.quietConspect) {
    session.conspect.addLine(`**Ход ${state.turn}.** ${playerInput} → ${firstSentence(parsed.prose)}`);

    if (state.turn % session.summarizeEvery === 0) {
      session.conspect.openArc(`Арка ${session.conspect.arcCount + 1}`);
    }
  }

  const fresh = Math.max(tokensIn - cachedTokens, 0);
  const cost =
    (fresh / 1_000_000) * session.prices.input +
    (cachedTokens / 1_000_000) * session.prices.cachedInput +
    (outputTokens / 1_000_000) * session.prices.output;

  session.totals.tokensIn += tokensIn;
  session.totals.tokensOut += outputTokens;
  session.totals.cached += cachedTokens;
  session.totals.cost += cost;

  const problems = parsed.error ? [...verdict.problems, parsed.error] : verdict.problems;
  if (repeatedResponse) problems.push('повтор сцены');
  const stalled = repeatedResponse || actionRepeat > 0.72;
  if (stalled && !problems.includes('повтор сцены')) problems.push('повтор сцены');

  let passed = 0;
  for (let i = 0; i < ctx.segments.length && i < prev.length; i += 1) {
    if (prev[i].hash !== ctx.segments[i].hash) break;
    passed += 1;
  }
  const segments: SegmentReport[] = ctx.segments.map((s, i) => ({ ...s, cached: i < passed }));

  return {
    turn: state.turn,
    tokensIn,
    tokensOut: outputTokens,
    cachedTokens,
    cost,
    problems,
    changes,
    segments,
    stalled,
    actionRepeat,
    timings: {
      contextMs,
      gmMs,
    },
  };
}
