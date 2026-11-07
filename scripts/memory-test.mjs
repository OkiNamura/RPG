#!/usr/bin/env node
import { buildMemoryBlock, normalizeMemories } from '../src/core/memory.ts';

const entries = [
  { id: 'a', kind: 'fact', text: 'Долг гильдии', keys: ['гильдия'], importance: 3, pinned: true, createdTurn: 1, source: 'player' },
  { id: 'b', kind: 'journal', text: 'Кольцо у колодца', keys: ['кольцо'], importance: 2, pinned: false, createdTurn: 2, source: 'player' },
  { id: 'c', kind: 'journal', text: 'Усвоенный факт', keys: [], importance: 3, pinned: false, createdTurn: 3, source: 'player' },
];
const block = buildMemoryBlock(entries, '', 'беру кольца у колодца');
if (!block.pinned.includes('Долг гильдии')) throw new Error('pinned не попал в контекст');
if (!block.learned.includes('Усвоенный факт')) throw new Error('learned не собрался из важной journal-записи');
if (block.learned.includes('Долг гильдии')) throw new Error('learned дублирует pinned');
const keyed = [
  ...entries,
  { id: 'd', kind: 'journal', text: 'Слух о гильдии', keys: ['гильдия'], importance: 3, pinned: false, createdTurn: 4, source: 'player' },
];
const calm = buildMemoryBlock(keyed, '', 'иду домой');
const guild = buildMemoryBlock(keyed, '', 'говорю о гильдии');
if (calm.learned !== guild.learned) throw new Error('learned зависит от recall — сожжёт кэш истории');
if (guild.recall.includes('Слух о гильдии')) throw new Error('learned-запись продублирована в recall');
const factOnly = buildMemoryBlock([
  { id: 'f', kind: 'fact', text: 'Факт важности 3', keys: [], importance: 3, pinned: false, createdTurn: 1, source: 'player' },
], '', '');
if (factOnly.learned.includes('Факт важности 3')) throw new Error('fact попал в learned');
if (!block.recall.includes('Кольцо')) throw new Error('recall по стеммингу не сработал');
if (block.usedPinned[0] !== 'a' || block.usedRecall[0] !== 'b') throw new Error('неверный отчёт памяти');
const noMatch = buildMemoryBlock(entries, '', 'иду спать');
if (noMatch.recall) throw new Error('recall без ключа');
const normalized = normalizeMemories([{ text: 'старая запись' }]);
if (normalized.length !== 1 || normalized[0].pinned !== false) throw new Error('нормализация старых записей');
const eight = Array.from({ length: 8 }, (_, index) => ({
  id: `big-${index}`,
  kind: 'fact',
  text: 'x'.repeat(500),
  keys: [],
  importance: 2,
  pinned: true,
  createdTurn: index,
  source: 'player',
}));
const bigBlock = buildMemoryBlock(eight, '', '');
if (bigBlock.usedPinned.length !== 8) throw new Error(`восьмая закреплённая потерялась: ${bigBlock.usedPinned.length}`);
const nine = [...eight, { ...eight[0], id: 'big-8', text: 'девятая' }];
const nineBlock = buildMemoryBlock(nine, '', '');
if (nineBlock.usedPinned.length !== 8 || nineBlock.dropped.length !== 1) throw new Error('девятая pinned не попала в dropped');
console.log('✓ pinned и recall памяти');
console.log('✓ восемь закреплённых по 500 символов попадают в контекст');
console.log('✓ девятая закреплённая видна как вытесненная');
