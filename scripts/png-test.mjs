/**
 * Проверка PNG-метаданных: вставка, чтение, целостность.
 *   node scripts/png-test.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { embedPngText, isPng, readPngText } from '../src/core/png.ts';

let failed = 0;
function check(name, ok, extra = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!ok) failed += 1;
}

// Минимальный валидный PNG 1×1 (прозрачный).
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

check('исходник — PNG', isPng(PNG_1PX));

const payload = Buffer.from(JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Тест' } })).toString('base64');
const withText = embedPngText(PNG_1PX, 'chara', payload);

check('после вставки всё ещё PNG', isPng(withText));
check('текст читается', readPngText(withText, 'chara') === payload);
check('файл вырос', withText.length > PNG_1PX.length);
check('чужих ключей нет', readPngText(withText, 'software') === null);

// Повторная вставка заменяет, а не дублирует.
const twice = embedPngText(withText, 'chara', 'new-value');
check('замена ключа', readPngText(twice, 'chara') === 'new-value');

// Файл на диске пишется и перечитывается.
await mkdir('data/tmp', { recursive: true });
const file = join('data/tmp', 'card-test.png');
await writeFile(file, twice);
const reread = await readFile(file);
check('с диска читается', readPngText(reread, 'chara') === 'new-value');

// Битый буфер отвергается.
check('не-PNG отвергается', !isPng(Buffer.from('not a png')));

console.log('');
console.log(failed === 0 ? 'PNG-метаданные в порядке' : `провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
