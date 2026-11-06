/**
 * Сборка контекста по слоям.
 *
 * Порядок продиктован кэшем токенов, а не красотой: провайдер кэширует
 * ПРЕФИКС запроса. Всё, что меняется, должно стоять как можно позже,
 * иначе каждый ход платится полная цена.
 *
 *   [static]      правила + мир + тон        — не меняется никогда
 *   [conspect]    закрытые арки              — меняется раз в арку
 *   [history]     последние ходы сообщениями — только дописывается в конец
 *   [lore]        динамический лор           — после истории, чтобы не жечь кэш
 *   [state]       цифры текущего хода        — меняется каждый ход, но мал
 *   [turn]        ввод игрока                — меняется каждый ход
 *
 * История отдаётся настоящими сообщениями (user/assistant), а не одним
 * блоком текста: так префикс остаётся байт-в-байт тем же и кэш живёт.
 */

import { createHash } from 'node:crypto';
import type { GameState } from './state.ts';
import { formatWorldDate } from './calendar.ts';

export interface Segment {
  name: string;
  chars: number;
  tokens: number;
  hash: string;
}

export interface BuiltContext {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  segments: Segment[];
  totalTokens: number;
}

export interface ContextInput {
  core: string;
  world: string;
  tone: string;
  hero?: string;
  conspectFrozen: string;
  /** скользящий конспект: всё, что старше окна последних ходов */
  conspectSummary?: string;
  state: GameState;
  windowTurns: number;
  playerInput: string;
  /** лор-книга: только совпавшие по ключам записи */
  lore?: string;
  /** точные позиции World Info */
  loreTop?: string;
  loreHistory?: string;
  loreAfter?: string;
  loreDepth?: string;
  /** броски, проверки и прочие заметки на этот ход */
  notes?: string;
  /** память истории: игрок закрепляет важные факты */
  memory?: string;
}

/** Грубо: в русском на токен приходится ~3.2 символа. */
const CHARS_PER_TOKEN = 3.2;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

function formatResources(resources?: { name: string; value: number; max?: number; unit?: string }[]): string {
  return (resources ?? [])
    .map((r) => `${r.name} ${r.value}${r.max != null ? `/${r.max}` : ''}${r.unit ? ` ${r.unit}` : ''}`)
    .join(', ');
}

function formatCoins(money?: { gold: number; silver: number; copper: number }): string {
  return money ? `${money.gold}з ${money.silver}с ${money.copper}м` : '';
}

function formatCurrencies(currencies?: { name: string; amount: number }[]): string {
  return (currencies ?? []).map((currency) => `${currency.amount} ${currency.name}`).join(', ');
}

/** Бюджет и лимит конспекта — общие для контекста и инспектора. */
export const CONTEXT_BUDGET_TOKENS = 25000;
export const CONTEXT_SUMMARY_LIMIT = 24000;

export interface RenderStateOptions {
  /** gm — компактный контекст ведущего; agent — полная картина для агента состояния */
  mode?: 'gm' | 'agent';
}

export function renderState(s: GameState, options: RenderStateOptions = {}): string {
  const compact = options.mode === 'gm';
  const lines: string[] = [];

  lines.push(`ТЕКУЩЕЕ СОСТОЯНИЕ (ход ${s.turn})`);
  lines.push(`Время: ${formatWorldDate(s.calendar, s.time)}`);
  lines.push(`Место: ${s.place}`);
  if (s.scene) {
    lines.push(
      `Сцена: ${s.scene.place}, ход ${s.scene.startedTurn}–${s.scene.updatedTurn}; участники: ${s.scene.participants.join(', ') || 'только герой'}${s.scene.goal ? `; ${s.scene.goal}` : ''}`,
    );
  }
  lines.push(`Погода: ${s.weather}`);

  const wounds = s.hero.wounds.length
    ? s.hero.wounds.map((w) => `${w.where} (${w.severity}${w.treated ? ', обработано' : ''})`).join('; ')
    : 'нет';
  lines.push(`Раны: ${wounds}`);
  lines.push(`Состояния: ${s.hero.conditions.join(', ') || 'нет'}`);
  lines.push(`Здоровье: ${s.hero.health ?? 100}`);
  if (s.hero.rank) lines.push(`Ранг героя: ${s.hero.rank} (${s.hero.rankPoints ?? 0}/100)`);

  if (s.hero.statuses?.length) {
    lines.push(
      `Эффекты: ${s.hero.statuses
        .map((x) => `${x.name} (${x.kind === 'debuff' ? 'минус' : 'плюс'}${x.note ? `, ${x.note}` : ''}${x.source ? `, источник ${x.source}` : ''})`)
        .join('; ')}`,
    );
  }
  lines.push(`Деньги: ${s.currencies?.length ? formatCurrencies(s.currencies) : `${s.money.gold} золота, ${s.money.silver} серебра, ${s.money.copper} меди`}`);
  if (s.currencies?.length) lines.push(`Валюты мира: ${s.currencies.map((c) => c.name).join(', ')}`);
  if (s.reputation) {
    lines.push(`Репутация героя: ${s.reputation.public} (${s.reputation.label})${s.reputation.note ? ` — ${s.reputation.note}` : ''}`);
    if (s.norms?.length) {
      lines.push(`Нормы мира: ${s.norms.map((n) => `${n.label} ${n.weight}`).join(' · ')}`);
    }
  }
  if (s.fronts?.length) {
    lines.push(`Фронты мира: ${s.fronts.map((front) => `${front.name} ${front.progress}% (${front.status})`).join('; ')}`);
  }
  if (s.clocks?.length) {
    lines.push(`Часы мира: ${s.clocks.map((clock) => `${clock.name} ${clock.value}/${clock.max}`).join('; ')}`);
  }
  if (s.worldStory?.premise) {
    lines.push(`Сюжет мира: ${s.worldStory.premise}${s.worldStory.centralQuestion ? ` Вопрос: ${s.worldStory.centralQuestion}` : ''}`);
    if (s.worldStory.factions?.length) {
      lines.push(`Стороны мира: ${s.worldStory.factions.map((faction) => faction.name).join(', ')}`);
    }
    if (s.worldStory.npcLines?.length) {
      lines.push(`Линии NPC: ${s.worldStory.npcLines.map((line) => `${line.name}${line.want ? ` (${line.want})` : ''}`).join('; ')}`);
    }
  }
  if (s.hero.resources?.length) lines.push(`Ресурсы героя: ${formatResources(s.hero.resources)}`);

  if (s.hero.skills && Object.keys(s.hero.skills).length) {
    lines.push(
      `Скиллы: ${Object.entries(s.hero.skills)
        .map(([name, value]) => `${name} ${value}`)
        .join(' · ')}`,
    );
  }

  if (s.hero.intuition) {
    lines.push(`Предчувствие героя: ${s.hero.intuition}`);
  }

  lines.push(`Предметы: ${s.items.map((i) => `${i.name}×${i.qty} [${i.where}]`).join('; ') || 'пусто'}`);
  if (s.party.length) {
    lines.push(
      `Пати: ${s.party
        .map((a) => {
          const extras = [
            a.resources?.length ? formatResources(a.resources) : '',
            a.money ? formatCoins(a.money) : '',
            typeof a.attitude === 'number' ? `отношение к герою ${a.attitude}` : '',
            typeof a.morale === 'number' ? `дух ${a.morale}` : '',
            a.relations?.length
              ? `связи: ${a.relations.map((rel) => `${rel.with}${rel.attitude != null ? ` ${rel.attitude}` : ''}`).join(', ')}`
              : '',
          ].filter(Boolean).join(', ');
          return `${a.name} (${a.status}, связь ${a.bond}, ранг ${a.rank ?? 'F'}${extras ? `, ${extras}` : ''})`;
        })
        .join('; ')}`,
    );
  }
  const activeNpcs = (s.npcs ?? []).filter((a) => !a.archived);
  const presentNpcs = activeNpcs.filter((a) => a.present === true);
  const absentNpcs = activeNpcs.filter((a) => a.present !== true).slice(-8);
  const shownNpcs = compact ? [...presentNpcs, ...absentNpcs] : activeNpcs;
  if (shownNpcs.length) {
    lines.push(
      `NPC: ${shownNpcs
        .map((a) => {
          const inScene = !compact || a.present === true;
          const extras = [
            inScene && a.resources?.length ? formatResources(a.resources) : '',
            inScene && a.money ? formatCoins(a.money) : '',
            typeof a.attitude === 'number' ? `отношение к герою ${a.attitude}` : '',
            inScene && a.relations?.length
              ? `связи: ${a.relations.map((rel) => `${rel.with}${rel.attitude != null ? ` ${rel.attitude}` : ''}`).join(', ')}`
              : '',
            inScene && a.mind
              ? [
                  a.mind.goals?.length ? `цели: ${a.mind.goals.join(', ')}` : '',
                  a.mind.secrets?.length ? `секреты (не раскрывать): ${a.mind.secrets.join(', ')}` : '',
                  a.mind.knows?.length ? `знает: ${a.mind.knows.join(', ')}` : '',
                  a.mind.notKnows?.length ? `не знает: ${a.mind.notKnows.join(', ')}` : '',
                  a.mind.mood ? `настроение: ${a.mind.mood}` : '',
                ].filter(Boolean).join('; ')
              : '',
          ].filter(Boolean).join(', ');
          return `${a.name}${a.role ? ` — ${a.role}` : ''} (${a.status}${extras ? `, ${extras}` : ''})`;
        })
        .join('; ')}`,
    );
    if (compact && activeNpcs.length > shownNpcs.length) {
      lines.push(`Ещё NPC: ${activeNpcs.length - shownNpcs.length}`);
    }
  }
  const shownQuests = compact
    ? [
        ...s.quests.filter((q) => q.status === 'active' || q.status === 'frozen'),
        ...s.quests.filter((q) => q.status === 'done' || q.status === 'failed').slice(-3),
      ]
    : s.quests;
  if (shownQuests.length) {
    lines.push(
      `Задачи: ${shownQuests
        .map((q) => `${q.title} [${q.status}${q.deadline ? `, срок: ${q.deadline}` : ''}${q.clock ? `, часы: ${q.clock.value}/${q.clock.max}` : ''}]`)
        .join('; ')}`,
    );
  }
  if (s.promises.length) {
    const shown = compact ? s.promises.slice(-8) : s.promises;
    lines.push(`Обещания: ${shown.join('; ')}${compact && s.promises.length > shown.length ? `; ещё ${s.promises.length - shown.length}` : ''}`);
  }
  if (s.hooks?.length) {
    // В контекст — только свежие: полный список живёт в панели.
    lines.push(`Открытые крючки: ${s.hooks.slice(-12).join('; ')}`);
  }
  if (s.hiddenFacts?.length) {
    const shown = compact ? s.hiddenFacts.slice(-12) : s.hiddenFacts;
    lines.push(
      `Скрытые факты (знать, но не раскрывать без повода): ${shown
        .map((f) => f.content)
        .join('; ')}${compact && s.hiddenFacts.length > shown.length ? `; ещё ${s.hiddenFacts.length - shown.length} скрытых фактов` : ''}`,
    );
  }
  if (s.factions?.length) {
    lines.push(
      `Фракции: ${s.factions
        .map((f) => {
          const head = f.leader ? `, глава: ${f.leader}` : '';
          const shadow = f.shadow ? `, тень: ${f.shadow}` : '';
          const inScene = f.roster?.some((r) =>
            [...s.npcs, ...s.party].some((a) => a.name === r.name && a.present === true),
          ) ?? false;
          const roster = (!compact || inScene) && f.roster?.length
            ? `, состав: ${f.roster
                .slice(0, 6)
                .map((r) => `${r.name}${r.hidden ? ' (скрыт)' : ''} — ${r.role}`)
                .join('; ')}`
            : '';
          return `${f.name} (${f.attitude > 0 ? '+' : ''}${f.attitude}${head}${shadow}${roster})`;
        })
        .join('; ')}`,
    );
  }
  if (s.locations?.length) {
    lines.push(`Места: ${s.locations.slice(-8).map((l) => l.name).join('; ')}`);
  }
  if (s.bestiary?.length) {
    lines.push(`Бестиарий: ${s.bestiary.slice(-8).map((b) => b.name).join('; ')}`);
  }
  if (s.archive?.length) {
    lines.push(
      `Архив: ${s.archive
        .slice(-12)
        .map((a) => `${a.kind}: ${a.text} (${a.reason})`)
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}

function seg(name: string, text: string): Segment {
  return { name, chars: text.length, tokens: estimateTokens(text), hash: hash(text) };
}

export function buildContext(input: ContextInput): BuiltContext {
  const messages: BuiltContext['messages'] = [];
  const segments: Segment[] = [];

  // 1. Статика: ядро + мир + тон + герой. Не меняется после старта кампании.
  //    Блок должен быть байт-стабильным, иначе кэш провайдера не сработает.
  // Тон уже внутри промта ведущего (input.core); отдельным блоком не дублируем.
  const staticBlock = [input.core, input.world, input.hero].filter(Boolean).join('\n\n');
  if (staticBlock) {
    messages.push({ role: 'system', content: staticBlock });
    segments.push(seg('static', staticBlock));
  }

  // 1.5. Память истории: то, что игрок закрепил сам. Маленький блок,
  //      но меняется редко — кэш статики не страдает.
  if (input.memory) {
    messages.push({ role: 'system', content: `Память истории:\n${input.memory}` });
    segments.push(seg('memory', input.memory));
  }

  // 2. Медленный слой: закрытые арки. Меняется раз в арку — и каждый раз  //    ломает кэш на один ход. Это цена, которую платим редко и осознанно.
  if (input.conspectFrozen) {
    messages.push({ role: 'system', content: input.conspectFrozen });
    segments.push(seg('conspect.frozen', input.conspectFrozen));
  }

  // 3. История — настоящими сообщениями, только дописывается в конец.
  //
  // ВАЖНО: окно сдвигаем блоками, а не по одному сообщению.
  // Если срезать по одному, первый элемент меняется каждый ход,
  // префикс рассыпается и кэш перестаёт работать ровно тогда, когда
  // история стала длинной. Блок в 20 сообщений = 10 ходов стабильности.
  const all = input.state.log;
  const windowSize = input.windowTurns * 2;
  const BLOCK = 20;
  const start =
    all.length <= windowSize
      ? 0
      : Math.max(0, Math.floor((all.length - windowSize) / BLOCK) * BLOCK);
  const window = all.slice(start);

  for (const entry of window) {
    messages.push({
      role: entry.role === 'player' ? 'user' : 'assistant',
      content: entry.text,
    });
    segments.push(seg(`log:${entry.turn}:${entry.role}`, entry.text));
  }

  // 3.5. Конспект прошлого: всё, что старше окна последних ходов.
  //      Стоит после истории, чтобы не ломать кэш статики и окна.
  if (input.conspectSummary) {
    const source = input.conspectSummary;
    const summary = source.length > CONTEXT_SUMMARY_LIMIT
      ? `${source.slice(0, 4000)}\n\n[...часть конспекта сокращена в контексте; полный текст остаётся в кампании...]\n\n${source.slice(-(CONTEXT_SUMMARY_LIMIT - 4000))}`
      : source;
    const block = `КОНСПЕКТ ПРОШЛОГО:\n${summary}`;
    messages.push({ role: 'system', content: block });
    segments.push(seg('conspect', block));
  }
  // 3.6. Динамический лор — после истории: смена набора записей не должна
  //      сжигать кэш самого большого блока.
  if (input.loreTop) {
    messages.push({ role: 'system', content: input.loreTop });
    segments.push(seg('lore.top', input.loreTop));
  }
  if (input.loreHistory) {
    messages.push({ role: 'system', content: input.loreHistory });
    segments.push(seg('lore.history', input.loreHistory));
  }
  if (input.loreAfter) {
    messages.push({ role: 'system', content: input.loreAfter });
    segments.push(seg('lore.after', input.loreAfter));
  }

  // 4. Цифры этого хода. Маленький и меняется всегда — поэтому в самом конце,
  //    перед ходом игрока, а не перед историей.
  const stateBlock = renderState(input.state, { mode: 'gm' });
  messages.push({ role: 'system', content: stateBlock });
  segments.push(seg('state', stateBlock));

  // 4.1. Лор-книга: только записи, чьи ключи встретились в этой сцене.
  //      input.lore уже разложен по top/history/after; не дублируем его здесь.
  if (input.loreDepth) {
    const lore = input.loreDepth;
    messages.push({ role: 'system', content: lore });
    segments.push(seg('lore.depth', lore));
  }

  // 4.2. Броски и скрытые проверки этого хода.
  if (input.notes) {
    messages.push({ role: 'system', content: input.notes });
    segments.push(seg('notes', input.notes));
  }

  // 5. Ход игрока.
  messages.push({ role: 'user', content: input.playerInput });
  segments.push(seg('turn', input.playerInput));

  const totalTokens = segments.reduce((sum, s) => sum + s.tokens, 0);
  return { messages, segments, totalTokens };
}

/**
 * Сколько токенов реально придёт из кэша: считаем совпадающий префикс
 * с прошлым ходом. Как только сегмент разошёлся — дальше всё новое.
 */
export function cachedPrefix(prev: Segment[], next: Segment[]): number {
  let tokens = 0;
  for (let i = 0; i < next.length; i += 1) {
    const before = prev[i];
    if (!before || before.hash !== next[i].hash) break;
    tokens += next[i].tokens;
  }
  return tokens;
}
