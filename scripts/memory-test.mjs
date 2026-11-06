#!/usr/bin/env node
import { buildMemoryBlock, normalizeMemories } from '../src/core/memory.ts';

const entries = [
  { id: 'a', kind: 'fact', text: 'Долг гильдии', keys: ['гильдия'], importance: 3, pinned: true, createdTurn: 1, source: 'player' },
  { id: 'b', kind: 'journal', text: 'Кольцо у колодца', keys: ['кольцо'], importance: 2, pinned: false, createdTurn: 2, source: 'player' },
];
const block = buildMemoryBlock(entries, '', 'беру кольца у колодца');
if (!block.pinned.includes('Долг гильдии')) throw new Error('pinned не попал в контекст');
if (!block.recall.includes('Кольцо')) throw new Error('recall по стеммингу не сработал');
if (block.usedPinned[0] !== 'a' || block.usedRecall[0] !== 'b') throw new Error('неверный отчёт памяти');
const noMatch = buildMemoryBlock(entries, '', 'иду спать');
if (noMatch.recall) throw new Error('recall без ключа');
const normalized = normalizeMemories([{ text: 'старая запись' }]);
if (normalized.length !== 1 || normalized[0].pinned !== false) throw new Error('нормализация старых записей');
console.log('✓ pinned и recall памяти');
console.log('✓ старые записи нормализуются');
