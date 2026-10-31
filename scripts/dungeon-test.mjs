/**
 * Проверка генератора ASCII-подземелья.
 *
 *   node scripts/dungeon-test.mjs
 *
 * Скрипт не использует внешних зависимостей: только модуль генератора
 * и встроенные средства Node.
 */

import { isDeepStrictEqual } from 'node:util';
import {
  DUNGEON_LEGEND,
  generateDungeon,
  renderDungeon,
} from '../src/core/dungeon.ts';

const NAME = 'Забытый склеп под Ржавой горой';
const OTHER_NAME = 'Кристальная пещера';
const LEGEND =
  '# стена · . пол · + дверь · @ ты · $ золото · * вещь · ! находка · V/W/x твари';

const WALKABLE = new Set(['.', '+', '@', '$', '*', '!', 'V', 'W', 'x']);
const ALLOWED = new Set(['#', ...WALKABLE]);

const errors = [];

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
  } else {
    errors.push(detail ? `${name} — ${detail}` : name);
    console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function key(x, y) {
  return `${x},${y}`;
}

function inRoom(x, y, room) {
  return x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h;
}

function inAnyRoom(x, y, rooms) {
  return rooms.some((room) => inRoom(x, y, room));
}

function roomsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function bfs(dungeon) {
  const height = dungeon.grid.length;
  const width = dungeon.grid[0].length;
  const start = dungeon.spawn;
  const seen = new Set([key(start.x, start.y)]);
  const queue = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head];
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const [dx, dy] of steps) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
      if (!WALKABLE.has(dungeon.grid[nextY][nextX])) continue;
      const nextKey = key(nextX, nextY);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ x: nextX, y: nextY });
    }
  }

  return seen;
}

console.log('Подземелье');

const a = generateDungeon(NAME);
const b = generateDungeon(NAME);
const other = generateDungeon(OTHER_NAME);

// Детерминированность и влияние имени.
check('одинаковые name + options — одинаковая карта', isDeepStrictEqual(a, b));
check('одинаковый вызов — одинаковый рендер', renderDungeon(a) === renderDungeon(b));
check('разные имена — разные карты', a.grid.join('\n') !== other.grid.join('\n'));

// Размеры по умолчанию и все строки одной длины.
check('высота по умолчанию 17', a.grid.length === 17, `получено ${a.grid.length}`);
check(
  'ширина по умолчанию 41',
  a.grid.every((row) => row.length === 41),
  `получено ${a.grid[0]?.length}`,
);
check(
  'все строки одной длины',
  new Set(a.grid.map((row) => row.length)).size === 1,
  a.grid.map((row) => row.length).join(','),
);
check(
  'только известные символы',
  a.grid.every((row) => [...row].every((char) => ALLOWED.has(char))),
);
check('не меньше 5 комнат по умолчанию', a.rooms.length >= 5, `комнат: ${a.rooms.length}`);

// Кастомные размеры и число комнат.
const custom = generateDungeon('Проверочный зал', {
  width: 31,
  height: 13,
  rooms: 5,
  seed: 'unit-test',
});
const customAgain = generateDungeon('Проверочный зал', {
  width: 31,
  height: 13,
  rooms: 5,
  seed: 'unit-test',
});
check('кастомная высота соблюдена', custom.grid.length === 13, `получено ${custom.grid.length}`);
check(
  'кастомная ширина соблюдена',
  custom.grid.every((row) => row.length === 31),
  `получено ${custom.grid[0]?.length}`,
);
check('кастомное число комнат соблюдено', custom.rooms.length === 5, `получено ${custom.rooms.length}`);
check('явный сид детерминирован', isDeepStrictEqual(custom, customAgain));

const clamped = generateDungeon('Бездонный лабиринт', {
  width: 500,
  height: 500,
  rooms: 500,
});
check(
  'сетка ограничена сверху',
  clamped.grid.length <= 41 && clamped.grid[0].length <= 81,
  `${clamped.grid[0].length}x${clamped.grid.length}`,
);

// Геометрия комнат.
let roomsInside = true;
let roomsOverlapFound = false;
for (let index = 0; index < a.rooms.length; index += 1) {
  const room = a.rooms[index];
  if (
    room.x < 1 ||
    room.y < 1 ||
    room.w < 3 ||
    room.h < 3 ||
    room.x + room.w > a.grid[0].length - 1 ||
    room.y + room.h > a.grid.length - 1
  ) {
    roomsInside = false;
  }
  for (let next = index + 1; next < a.rooms.length; next += 1) {
    if (roomsOverlap(room, a.rooms[next])) roomsOverlapFound = true;
  }
}
check('комнаты внутри сетки', roomsInside);
check('комнаты не пересекаются', !roomsOverlapFound);

// Игрок.
let playerCount = 0;
for (const row of a.grid) {
  for (const char of row) if (char === '@') playerCount += 1;
}
check('ровно один @', playerCount === 1, `найдено ${playerCount}`);
check('@ стоит на клетке спавна', a.grid[a.spawn.y][a.spawn.x] === '@');
check('спавн в первой комнате на полу', inRoom(a.spawn.x, a.spawn.y, a.rooms[0]));
check('на карте есть двери', a.grid.some((row) => row.includes('+')));

// Предметы и монстры.
check('в подземелье есть предметы', a.items.length > 0);
check('в подземелье есть монстры', a.monsters.length > 0);
check(
  'предметы на полу комнат',
  a.items.every(
    (item) =>
      inAnyRoom(item.x, item.y, a.rooms) &&
      a.grid[item.y][item.x] === item.kind &&
      item.kind !== '#' &&
      item.kind !== '+',
  ),
);
check(
  'монстры на полу комнат',
  a.monsters.every(
    (monster) =>
      inAnyRoom(monster.x, monster.y, a.rooms) &&
      a.grid[monster.y][monster.x] === monster.kind,
  ),
);
check(
  'виды предметов допустимы',
  a.items.every((item) => ['$', '*', '!'].includes(item.kind)),
);
check(
  'виды монстров допустимы',
  a.monsters.every((monster) => ['V', 'W', 'x'].includes(monster.kind)),
);
check(
  'встречаются все виды предметов',
  new Set(a.items.map((item) => item.kind)).size === 3,
);
check(
  'встречаются все виды монстров',
  new Set(a.monsters.map((monster) => monster.kind)).size === 3,
);

const occupied = new Set([key(a.spawn.x, a.spawn.y)]);
let collisions = 0;
for (const entity of [...a.items, ...a.monsters]) {
  const entityKey = key(entity.x, entity.y);
  if (occupied.has(entityKey)) collisions += 1;
  occupied.add(entityKey);
}
check('никто не наложен на @ или друг на друга', collisions === 0, `наложений: ${collisions}`);

// Связность: BFS от игрока.
const reachable = bfs(a);

const walkableCount = a.grid.reduce(
  (total, row) => total + [...row].filter((char) => WALKABLE.has(char)).length,
  0,
);
check(
  'каждый пол и дверь достижимы от @',
  reachable.size === walkableCount,
  `${reachable.size} из ${walkableCount}`,
);
check(
  'все комнаты достижимы от @',
  a.rooms.every((room) => {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        if (reachable.has(key(x, y))) return true;
      }
    }
    return false;
  }),
);
check(
  'все предметы достижимы от @',
  a.items.every((item) => reachable.has(key(item.x, item.y))),
);
check(
  'все монстры достижимы от @',
  a.monsters.every((monster) => reachable.has(key(monster.x, monster.y))),
);

// Легенда и рендер.
const rendered = renderDungeon(a);
check('легенда соответствует требованиям', a.legend === LEGEND && DUNGEON_LEGEND === LEGEND);
check('рендер начинается с сетки', rendered.startsWith(a.grid.join('\n')));
check('между картой и легендой пустая строка', rendered.includes(`\n\n${a.legend}`));
check('рендер заканчивается легендой', rendered.endsWith(a.legend));
check('рендер содержит все строки карты', a.grid.every((row) => rendered.includes(row)));

console.log('');
if (errors.length > 0) {
  console.log(`провалено: ${errors.length}`);
  for (const error of errors) console.log(`  • ${error}`);
  process.exitCode = 1;
} else {
  console.log('карта-рогалик в порядке');
}
