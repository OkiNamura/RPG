#!/usr/bin/env node
import { buildContext, cachedPrefix } from '../src/core/context.ts';
import { createState } from '../src/core/state.ts';

const state = createState('Аня', 'Дом');
state.log.push({ turn: 1, role: 'player', text: 'Первый' });
state.log.push({ turn: 1, role: 'gm', text: 'Ответ' });
state.log.push({ turn: 2, role: 'player', text: 'Второй' });
state.log.push({ turn: 2, role: 'gm', text: 'Ответ второй' });

const built = buildContext({
  core: 'core',
  world: 'world',
  tone: '',
  hero: 'hero',
  conspectFrozen: 'frozen',
  conspectSummary: 'summary',
  state,
  windowTurns: 24,
  playerInput: 'Новый ход',
  memory: 'memory',
  loreTop: 'lore-top',
  loreHistory: 'lore-history',
  loreAfter: 'lore-after',
  loreDepth: 'lore-depth',
  notes: 'notes',
});
const names = built.segments.map((segment) => segment.name);
const index = (name) => {
  const at = names.findIndex((item) => item === name || item.startsWith(`${name}:`));
  if (at < 0) throw new Error(`нет сегмента ${name}`);
  return at;
};
if (index('lore.top') < index('log')) throw new Error('lore.top стоит до истории');
if (index('lore.history') < index('log')) throw new Error('lore.history стоит до истории');
if (index('lore.after') < index('log')) throw new Error('lore.after стоит до истории');
if (index('memory') > index('log')) throw new Error('memory должна быть до истории');
if (index('notes') < index('state')) throw new Error('notes должны быть после state');
const changedLore = buildContext({
  core: 'core',
  world: 'world',
  tone: '',
  hero: 'hero',
  conspectFrozen: 'frozen',
  conspectSummary: 'summary',
  state,
  windowTurns: 24,
  playerInput: 'Новый ход',
  memory: 'memory',
  loreTop: 'другой лор',
  loreHistory: 'другой исторический лор',
  loreAfter: 'другой лор после',
  loreDepth: 'глубина',
  notes: 'notes',
});
const lastHistory = names.findLastIndex((name) => name.startsWith('log:'));
if (cachedPrefix(built.segments, changedLore.segments) <= lastHistory) {
  throw new Error('смена лора сожгла кэш истории');
}
const longSummary = `${'старая арка. '.repeat(5000)}${'свежая арка. '.repeat(1000)}`;
const longBuilt = buildContext({
  core: 'core', world: 'world', tone: '', hero: 'hero',
  conspectFrozen: 'frozen', conspectSummary: longSummary, state,
  windowTurns: 24, playerInput: 'Новый ход', memory: 'memory',
});
const summarySegment = longBuilt.segments.find((segment) => segment.name === 'conspect');
if (!summarySegment || summarySegment.chars > 25000) throw new Error('конспект не ограничен в контексте');
if (longSummary.length !== `${'старая арка. '.repeat(5000)}${'свежая арка. '.repeat(1000)}`.length) throw new Error('исходный конспект изменён');
console.log('✓ динамический лор после истории');
console.log('✓ смена лора не сжигает префикс истории');
console.log('✓ конспект ограничен только в контексте');
console.log('✓ порядок памяти и заметок');
