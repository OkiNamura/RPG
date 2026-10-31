/**
 * Проверка карты: детерминированность и рамка.
 *
 *   node scripts/map-test.mjs
 */

import { renderMap } from '../src/core/map.ts';

let failed = 0;

function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

const a = renderMap('Мёртвый город у вулкана');
const b = renderMap('Мёртвый город у вулкана');
const c = renderMap('Таверна «Ржавый гвоздь»');

check('одно место — одна карта', a === b);
check('разные места — разные карты', a !== c);

const rows = a.split('\n\n')[0].split('\n');
check('двенадцать строк по умолчанию', rows.length === 12, `(${rows.length})`);
check('одинаковая ширина', new Set(rows.map((r) => r.length)).size === 1, `(${rows.map((r) => r.length).join(',')})`);
check('рамка по краям', rows[0].startsWith('#') && rows[0].endsWith('#') && rows.at(-1).startsWith('#'));
check('герой на карте', a.includes('@'));
check('есть проход', a.includes('='));
check('легенда есть', a.includes('стена'));

// Размер настраивается
const small = renderMap('Тест', { width: 21, height: 7, legend: false });
const smallRows = small.split('\n');
check('кастомная высота', smallRows.length === 7, `(${smallRows.length})`);
check('кастомная ширина', smallRows[0].length === 21, `(${smallRows[0].length})`);
check('легенду можно выключить', !small.includes('стена'));
check('большой размер детальнее', renderMap('Мёртвый город').split('\n')[0].length === 31);

console.log('');
console.log(failed === 0 ? 'карта в порядке' : `провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
