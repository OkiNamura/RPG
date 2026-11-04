#!/usr/bin/env node
import { planTimeSkip } from '../src/core/time-skip.ts';

const start = 8 * 60;
const end = 8 * 60 + 4 * 24 * 60;
const events = [
  { id: 'meal', at: start + 60, title: 'обед', importance: 'ambient' },
  { id: 'talk', at: start + 120, title: 'разговор экипажа', importance: 'ambient' },
  { id: 'leak', at: start + 2 * 24 * 60, title: 'утечка', importance: 'critical', requiresResponse: true },
  { id: 'arrival', at: end, title: 'прибытие', importance: 'critical' },
];
const plan = planTimeSkip(start, end, events, 'important');
if (!plan.interrupt || plan.interrupt.id !== 'leak') throw new Error('поломка не прервала скачок');
if (plan.end !== start + 2 * 24 * 60) throw new Error('скачок остановился не на событии');
if (!plan.summary.some((event) => event.id === 'meal')) throw new Error('пассивное событие потеряно');

const quiet = planTimeSkip(start, end, events.filter((event) => event.importance === 'ambient'), 'important');
if (quiet.interrupt) throw new Error('пассивное событие прервало скачок');
if (quiet.end !== end) throw new Error('скачок не дошёл до цели');

const car = planTimeSkip(start, start + 12 * 60, [
  { id: 'pit', at: start + 180, title: 'пит-стоп', importance: 'ambient' },
  { id: 'crash', at: start + 300, title: 'авария', importance: 'critical', blocksAction: true },
]);
if (car.interrupt?.id !== 'crash') throw new Error('авария не прервала дорогу');
if (!car.summary.some((event) => event.id === 'pit')) throw new Error('пит-стоп потерян из отчёта');
if (car.end === start + 180) throw new Error('пит-стоп стал сценой');

console.log('✓ 4 дня: монтаж, поломка прерывает');
console.log('✓ тихий полёт не прерывается');
console.log('✓ 12 часов: авария — сцена, пит-стоп — отчёт');
