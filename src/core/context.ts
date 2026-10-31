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
 *   [state]       цифры текущего хода        — меняется каждый ход, но мал
 *   [turn]        ввод игрока                — меняется каждый ход
 *
 * История отдаётся настоящими сообщениями (user/assistant), а не одним
 * блоком текста: так префикс остаётся байт-в-байт тем же и кэш живёт.
 */

import { createHash } from 'node:crypto';
import type { GameState } from './state.ts';

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

export function renderState(s: GameState): string {
  const hh = String(s.time.hour).padStart(2, '0');
  const lines: string[] = [];

  lines.push(`ТЕКУЩЕЕ СОСТОЯНИЕ (ход ${s.turn})`);
  lines.push(`Время: день ${s.time.day}, ${hh}:00`);
  lines.push(`Место: ${s.place}`);
  lines.push(`Погода: ${s.weather}`);

  const wounds = s.hero.wounds.length
    ? s.hero.wounds.map((w) => `${w.where} (${w.severity}${w.treated ? ', обработано' : ''})`).join('; ')
    : 'нет';
  lines.push(`Раны: ${wounds}`);
  lines.push(`Состояния: ${s.hero.conditions.join(', ') || 'нет'}`);
  lines.push(`Здоровье: ${s.hero.health ?? 100}`);

  if (s.hero.statuses?.length) {
    lines.push(
      `Эффекты: ${s.hero.statuses
        .map((x) => `${x.name} (${x.kind === 'debuff' ? 'минус' : 'плюс'}${x.note ? `, ${x.note}` : ''})`)
        .join('; ')}`,
    );
  }
  lines.push(`Деньги: ${s.money.gold} золота, ${s.money.silver} серебра, ${s.money.copper} меди`);

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
    lines.push(`Пати: ${s.party.map((a) => `${a.name} (${a.status}, связь ${a.bond})`).join('; ')}`);
  }
  if (s.npcs?.length) {
    lines.push(
      `NPC: ${s.npcs.map((a) => `${a.name}${a.role ? ` — ${a.role}` : ''} (${a.status})`).join('; ')}`,
    );
  }
  if (s.quests.length) {
    lines.push(
      `Задачи: ${s.quests
        .map((q) => `${q.title} [${q.status}${q.deadline ? `, срок: ${q.deadline}` : ''}]`)
        .join('; ')}`,
    );
  }
  if (s.promises.length) {
    lines.push(`Обещания: ${s.promises.join('; ')}`);
  }
  if (s.hooks?.length) {
    // В контекст — только свежие: полный список живёт в панели.
    lines.push(`Открытые крючки: ${s.hooks.slice(-12).join('; ')}`);
  }
  if (s.factions?.length) {
    lines.push(
      `Фракции: ${s.factions
        .map((f) => {
          const head = f.leader ? `, глава: ${f.leader}` : '';
          const shadow = f.shadow ? `, тень: ${f.shadow}` : '';
          const roster = f.roster?.length
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
  const staticBlock = [input.core, input.world, input.tone, input.hero].filter(Boolean).join('\n\n');
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
    const block = `КОНСПЕКТ ПРОШЛОГО:\n${input.conspectSummary}`;
    messages.push({ role: 'system', content: block });
    segments.push(seg('conspect', block));
  }

  // 4. Цифры этого хода. Маленький и меняется всегда — поэтому в самом конце,
  //    перед ходом игрока, а не перед историей.
  const stateBlock = renderState(input.state);
  messages.push({ role: 'system', content: stateBlock });
  segments.push(seg('state', stateBlock));

  // 4.1. Лор-книга: только записи, чьи ключи встретились в этой сцене.
  if (input.lore) {
    messages.push({ role: 'system', content: input.lore });
    segments.push(seg('lore', input.lore));
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
