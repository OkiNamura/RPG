/**
 * Проверка мировой карты.
 *
 *   node scripts/worldmap-test.mjs
 */

import { mapSnapshot, renderWorldMap } from '../src/core/worldmap.ts';

let failed = 0;

function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function gridLines(text, height) {
  return text.split('\n').slice(1, 1 + height);
}

function legendBlock(text) {
  const index = text.indexOf('\n\n');
  return index === -1 ? '' : text.slice(index + 2);
}

/** Связность суши по четырём сторонам. */
function landIsConnected(terrain) {
  const height = terrain.length;
  const width = terrain[0].length;
  let start = null;
  let total = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (terrain[y][x] === '~') continue;
      total += 1;
      if (!start) start = [x, y];
    }
  }
  if (!start) return false;

  const seen = new Set([`${start[0]},${start[1]}`]);
  const stack = [start];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (terrain[ny][nx] === '~') continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push([nx, ny]);
    }
  }
  return seen.size === total;
}

const WORLD = 'Хроники Семи Ветров';
const OTHER_WORLD = 'Ледяные Пустоши';
const PIN_CHARS = new Set(['@', 'o', 'x', '#', '!']);
const TERRAIN_CHARS = new Set(['~', '.', '♣', '^', 'A', ',']);

const LOCATIONS = [
  { name: 'Кристальный порт', x: 10, y: 8, kind: 'city' },
  { name: 'Тихая заводь', kind: 'village' },
  { name: 'Пепельный бастион', kind: 'ruin' },
  { name: 'Лагерь Вольных', kind: 'camp' },
  { name: 'Обелиск Луны', kind: 'landmark' },
  { name: 'Медный брод', kind: 'village' },
  { name: 'Затонувший маяк', x: 0, y: 0, kind: 'ruin' },
  { name: 'Вторая столица', x: 10, y: 8, kind: 'city' },
  { name: 'Старый тракт' },
];

console.log('мировая карта');

// --- детерминированность ---------------------------------------------------
const map = renderWorldMap(WORLD, LOCATIONS, { width: 61, height: 23 });
const again = renderWorldMap(WORLD, LOCATIONS, { width: 61, height: 23 });
check('два вызова — одна карта', map === again);

const snapshot = mapSnapshot(WORLD, LOCATIONS);
const snapshotAgain = mapSnapshot(WORLD, LOCATIONS);
check('снимок детерминирован', JSON.stringify(snapshot) === JSON.stringify(snapshotAgain));
check('размер снимка по умолчанию 41x17', snapshot.width === 41 && snapshot.height === 17);

// --- разные миры -----------------------------------------------------------
const other = renderWorldMap(OTHER_WORLD, LOCATIONS, { width: 61, height: 23 });
check('другие названия — другие карты', map !== other);
const otherTerrain = mapSnapshot(OTHER_WORLD, LOCATIONS).terrain.join('\n');
check('другие названия — другой рельеф', otherTerrain !== snapshot.terrain.join('\n'));

const longPrefix = 'Очень длинное имя мира, '.repeat(3);
const longA = `${longPrefix}вариант А`;
const longB = `${longPrefix}вариант Б`;
check(
  'длинные названия различаются по концу',
  mapSnapshot(longA, []).terrain.join('\n') !== mapSnapshot(longB, []).terrain.join('\n'),
);

// --- размеры сетки ---------------------------------------------------------
const defaultMap = renderWorldMap(WORLD, LOCATIONS);
const defaultRows = gridLines(defaultMap, 17);
check(
  'по умолчанию сетка 41x17',
  defaultRows.length === 17 && defaultRows.every((row) => row.length === 41),
  `(${defaultRows.length}×${defaultRows[0]?.length})`,
);

const customRows = gridLines(map, 23);
check(
  'ширина из options',
  customRows.length === 23 && customRows.every((row) => row.length === 61),
  `(${customRows.length}×${customRows[0]?.length})`,
);

const small = renderWorldMap(WORLD, LOCATIONS.slice(0, 3), { width: 23, height: 9 });
const smallRows = gridLines(small, 9);
check(
  'маленькая сетка из options',
  smallRows.length === 9 && smallRows.every((row) => row.length === 23),
  `(${smallRows.length}×${smallRows[0]?.length})`,
);

// --- легенда ---------------------------------------------------------------
const legend = legendBlock(map);
check('легенда есть', map.includes('Легенда') && legend.length > 0);
check('легенда не длиннее 12 строк', legend.split('\n').length <= 12, `(${legend.split('\n').length})`);
check('в легенде есть символы рельефа', map.includes('~ вода') && map.includes('♣ лес') && map.includes('A горы'));

for (const location of LOCATIONS) {
  check(`в легенде есть «${location.name}»`, legend.includes(location.name));
}

const bare = renderWorldMap(WORLD, LOCATIONS, { legend: false });
check('legend: false убирает легенду', !bare.includes('Легенда'));
check('без легенды остаются заголовок и сетка', bare.split('\n').length === 1 + 17);

const manyLocations = Array.from({ length: 20 }, (_, index) => ({
  name: `Поселение ${index + 1}`,
  kind: 'village',
}));
const manyLegend = legendBlock(renderWorldMap(WORLD, manyLocations, { width: 61, height: 23 }));
check('20 локаций — легенда не длиннее 12 строк', manyLegend.split('\n').length <= 12, `(${manyLegend.split('\n').length})`);
check(
  '20 локаций все перечислены в легенде',
  manyLocations.every((location) => manyLegend.includes(location.name)),
);

// --- символы типов ---------------------------------------------------------
const KIND_GLYPHS = { city: '@', village: 'o', ruin: 'x', camp: '#', landmark: '!' };
for (const [kind, glyph] of Object.entries(KIND_GLYPHS)) {
  const singleMap = renderWorldMap(WORLD, [{ name: 'Одинокая точка', kind }], { width: 23, height: 9 });
  const cells = gridLines(singleMap, 9).join('');
  check(`тип ${kind} рисуется символом ${glyph}`, cells.includes(glyph));
}

// --- рельеф и пины ---------------------------------------------------------
const terrainChars = new Set(snapshot.terrain.join(''));
check('вода присутствует', terrainChars.has('~'));
check('суша присутствует', [...terrainChars].some((char) => char !== '~'));
check('только известные символы рельефа', [...terrainChars].every((char) => TERRAIN_CHARS.has(char)));
check('в рельефе снимка нет пинов', ![...terrainChars].some((char) => PIN_CHARS.has(char)));
check('пинов столько же, сколько локаций', snapshot.pins.length === LOCATIONS.length);
check('континент связный (41x17)', landIsConnected(snapshot.terrain));
check('континент связный (61x23)', landIsConnected(customRows));

let allOnLand = true;
let coordsOk = true;
for (const pin of snapshot.pins) {
  const inside = pin.x >= 0 && pin.x < snapshot.width && pin.y >= 0 && pin.y < snapshot.height;
  if (!inside) coordsOk = false;
  const cell = inside ? snapshot.terrain[pin.y][pin.x] : '~';
  if (!inside || cell === '~') {
    allOnLand = false;
    console.log(`    ! ${pin.name} в воде/вне карты (${pin.x},${pin.y})`);
  }
}
check('координаты пинов внутри сетки', coordsOk);
check('все пины стоят на суше', allOnLand);

const uniqueCells = new Set(snapshot.pins.map((pin) => `${pin.x},${pin.y}`));
check('пины не делят одну клетку', uniqueCells.size === snapshot.pins.length);

const port = snapshot.pins.find((pin) => pin.name === 'Кристальный порт');
const secondCapital = snapshot.pins.find((pin) => pin.name === 'Вторая столица');
check(
  'одинаковые координаты разводят пины',
  Boolean(port && secondCapital) && (port.x !== secondCapital.x || port.y !== secondCapital.y),
);

const drowned = snapshot.pins.find((pin) => pin.name === 'Затонувший маяк');
const drownedCell = drowned ? snapshot.terrain[drowned.y][drowned.x] : '~';
check('пин из воды перенесён на сушу', Boolean(drowned) && drownedCell !== '~');
check(
  'пин из угла не остался в углу',
  Boolean(drowned) && (drowned.x !== 0 || drowned.y !== 0),
);

const mapPinCount = customRows.join('').split('').filter((char) => PIN_CHARS.has(char)).length;
check('все локации отрисованы на карте', mapPinCount === LOCATIONS.length, `(${mapPinCount})`);

const renderedLegendSymbols = ['@ город', 'o деревня', 'x руины', '# лагерь', '! ориентир'];
check(
  'в легенде все типы локаций',
  renderedLegendSymbols.every((entry) => legend.includes(entry)),
);

console.log('');
console.log(failed === 0 ? 'мировая карта в порядке' : `провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
