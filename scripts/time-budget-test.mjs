#!/usr/bin/env node
import { maxSceneAdvanceSeconds, parseDurationSeconds } from '../src/core/time-budget.ts';

const now = { day: 2, hour: 20, minute: 0, second: 0 };
const checks = [
  ['обычный разговор', 45 * 60],
  ['сплю 4 часа', 4 * 3600 + 15 * 60],
  ['еду на машине 12 часов', 12 * 3600 + 15 * 60],
  ['полчаса', 45 * 60],
  ['до утра', 11 * 3600 + 15 * 60],
];
let failed = 0;
for (const [text, expected] of checks) {
  const actual = maxSceneAdvanceSeconds(text, '', now);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${text}: ${Math.round(actual / 60)} мин (ожидалось ${Math.round(expected / 60)})`);
}
if ((parseDurationSeconds('12 часов') ?? 0) !== 12 * 3600) {
  failed += 1;
  console.log('✗ parseDurationSeconds(12 часов)');
}
if (failed) process.exit(1);
console.log('все проверки пройдены');
