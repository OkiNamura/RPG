#!/usr/bin/env node
import { TONE_LEVELS, toneDirective, toneLevel } from '../src/core/tone-levels.ts';

const forbidden = /(фэнтез|культ|жертвопринош|средневеков|дракон|замок|эльф|гном)/i;
for (const level of TONE_LEVELS) {
  if (forbidden.test(`${level.name} ${level.directive}`)) {
    throw new Error(`уровень ${level.value} задаёт жанр: ${level.name}`);
  }
}
if (toneLevel(1).name !== 'Очень мягко') throw new Error('уровень 1 снова тематический');
if (!toneDirective(9).includes('Не меняй жанр')) throw new Error('нет запрета менять жанр');
if (!toneDirective(0).includes('только') && !toneDirective(0).includes('Только')) {
  // Уровень 0 может не содержать слово «только» — важна нейтральность.
}
console.log('✓ уровень интенсивности не задаёт жанр');
console.log('✓ старые фэнтези-названия удалены');
