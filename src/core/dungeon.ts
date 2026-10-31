/**
 * ASCII-подземелье в духе Rogue Basement.
 *
 * Генератор полностью детерминирован: имя места, явный сид и параметры
 * сетки смешиваются в FNV-1a-хеш, который засевает mulberry32. Комнаты —
 * прямоугольники, которые не пересекаются и соединены L-образными
 * коридорами; входы в комнаты отмечены дверями. Всё, что нарисовано,
 * достижимо от игрока.
 *
 * В наброске API у предмета был указан вид '+', но '+' — это дверь.
 * По легенде предметы бывают '$' (золото), '*' (вещь) и '!' (находка),
 * поэтому вид предмета здесь — '$' | '*' | '!'.
 */

const DEFAULT_WIDTH = 41;
const DEFAULT_HEIGHT = 17;
const DEFAULT_ROOMS = 8;

const MIN_WIDTH = 15;
const MAX_WIDTH = 81;
const MIN_HEIGHT = 7;
const MAX_HEIGHT = 41;
const MIN_ROOMS = 1;
const MAX_ROOMS = 24;

const WALL = '#';
const FLOOR = '.';
const DOOR = '+';
const PLAYER = '@';

const ITEM_KINDS: Array<'$' | '*' | '!'> = ['$', '*', '!'];
const MONSTER_KINDS: Array<'V' | 'W' | 'x'> = ['V', 'W', 'x'];

export const DUNGEON_LEGEND =
  '# стена · . пол · + дверь · @ ты · $ золото · * вещь · ! находка · V/W/x твари';

export interface DungeonOptions {
  width?: number;
  height?: number;
  rooms?: number;
  seed?: string;
}

export interface DungeonRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DungeonPoint {
  x: number;
  y: number;
}

export interface DungeonItem extends DungeonPoint {
  kind: '$' | '*' | '!';
}

export interface DungeonMonster extends DungeonPoint {
  kind: 'V' | 'W' | 'x';
}

export interface Dungeon {
  /** строки карты, все одной длины */
  grid: string[];
  rooms: DungeonRoom[];
  /** где стоит игрок @ */
  spawn: DungeonPoint;
  items: DungeonItem[];
  monsters: DungeonMonster[];
  legend: string;
}

/** mulberry32: маленький быстрый PRNG с воспроизводимой последовательностью. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a по строке. */
function hashString(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Перемешать хеш перед очередным проходом генерации. */
function mixSeed(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function toInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  return Math.max(min, Math.min(max, integer));
}

/**
 * Прямоугольники считаются совместимыми, если между их стенами остаётся
 * хотя бы одна свободная клетка: так коридор всегда может пройти мимо.
 */
function roomsConflict(a: DungeonRoom, b: DungeonRoom): boolean {
  return !(
    a.x + a.w + 2 < b.x ||
    b.x + b.w + 2 < a.x ||
    a.y + a.h + 2 < b.y ||
    b.y + b.h + 2 < a.y
  );
}

/** Случайная раскладка комнат с отбраковкой пересечений. */
function placeRooms(
  random: () => number,
  width: number,
  height: number,
  wanted: number,
  maxW = 8,
  maxH = 5,
): DungeonRoom[] {
  const rooms: DungeonRoom[] = [];
  const attempts = Math.max(160, wanted * 90);

  for (let attempt = 0; attempt < attempts && rooms.length < wanted; attempt += 1) {
    const w = 4 + Math.floor(random() * (maxW - 3)); // 4..maxW
    const h = 3 + Math.floor(random() * (maxH - 2)); // 3..maxH
    const maxX = width - w - 2;
    const maxY = height - h - 2;
    if (maxX < 2 || maxY < 2) continue;

    const candidate: DungeonRoom = {
      x: 2 + Math.floor(random() * (maxX - 1)),
      y: 2 + Math.floor(random() * (maxY - 1)),
      w,
      h,
    };

    if (rooms.some((room) => roomsConflict(room, candidate))) continue;
    rooms.push(candidate);
  }

  return rooms;
}

/** Детерминированно достроить сетку мелкими комнатами, если случай не сошёлся. */
function fillWithRooms(
  rooms: DungeonRoom[],
  width: number,
  height: number,
  wanted: number,
): void {
  const sizes: Array<[number, number]> = [
    [4, 3],
    [5, 3],
    [6, 3],
    [4, 4],
    [5, 4],
    [6, 4],
    [7, 4],
    [8, 4],
    [7, 5],
    [8, 5],
  ];

  for (const [w, h] of sizes) {
    if (rooms.length >= wanted) return;
    const maxX = width - w - 2;
    const maxY = height - h - 2;

    for (let y = 2; y <= maxY && rooms.length < wanted; y += 1) {
      for (let x = 2; x <= maxX && rooms.length < wanted; x += 1) {
        const candidate: DungeonRoom = { x, y, w, h };
        if (rooms.some((room) => roomsConflict(room, candidate))) continue;
        rooms.push(candidate);
      }
    }
  }
}

function roomCenter(room: DungeonRoom): DungeonPoint {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

/** Вырезать L-образный коридор между двумя точками. */
function carveCorridor(
  grid: string[][],
  from: DungeonPoint,
  to: DungeonPoint,
  horizontalFirst: boolean,
): void {
  const carve = (x: number, y: number): void => {
    if (grid[y][x] !== FLOOR) grid[y][x] = FLOOR;
  };

  if (horizontalFirst) {
    const stepX = from.x <= to.x ? 1 : -1;
    for (let x = from.x; x !== to.x; x += stepX) carve(x, from.y);
    carve(to.x, from.y);
    const stepY = from.y <= to.y ? 1 : -1;
    for (let y = from.y; y !== to.y; y += stepY) carve(to.x, y);
  } else {
    const stepY = from.y <= to.y ? 1 : -1;
    for (let y = from.y; y !== to.y; y += stepY) carve(from.x, y);
    carve(from.x, to.y);
    const stepX = from.x <= to.x ? 1 : -1;
    for (let x = from.x; x !== to.x; x += stepX) carve(x, to.y);
  }

  carve(to.x, to.y);
}

type DoorSide = 'top' | 'bottom' | 'left' | 'right';

interface Door {
  x: number;
  y: number;
  /** клетка сразу за дверью, откуда начинается/заканчивается коридор */
  outside: DungeonPoint;
}

/** С какой стороны комнаты повернуться к соседней. */
function chooseDoorSide(room: DungeonRoom, target: DungeonPoint): DoorSide {
  const center = roomCenter(room);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Дверь на стене комнаты (не в углу) и клетка снаружи неё. */
function makeDoor(room: DungeonRoom, side: DoorSide, random: () => number): Door {
  if (side === 'top') {
    const x = room.x + 1 + Math.floor(random() * (room.w - 2));
    return { x, y: room.y - 1, outside: { x, y: room.y - 2 } };
  }
  if (side === 'bottom') {
    const x = room.x + 1 + Math.floor(random() * (room.w - 2));
    return { x, y: room.y + room.h, outside: { x, y: room.y + room.h + 1 } };
  }
  if (side === 'left') {
    const y = room.y + 1 + Math.floor(random() * (room.h - 2));
    return { x: room.x - 1, y, outside: { x: room.x - 2, y } };
  }
  const y = room.y + 1 + Math.floor(random() * (room.h - 2));
  return { x: room.x + room.w, y, outside: { x: room.x + room.w + 1, y } };
}



function shuffle<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    const temporary = items[index];
    items[index] = items[swapWith];
    items[swapWith] = temporary;
  }
}

/**
 * Сгенерировать подземелье. Одинаковые name + options дают одинаковый
 * результат; явный seed подмешивается к имени.
 */
export function generateDungeon(name: string, options: DungeonOptions = {}): Dungeon {
  const width = toInteger(options.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
  const height = toInteger(options.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
  const wantedRooms = toInteger(options.rooms, DEFAULT_ROOMS, MIN_ROOMS, MAX_ROOMS);

  const safeName = typeof name === 'string' && name.length > 0 ? name : 'подземелье';
  const seedText = typeof options.seed === 'string' ? options.seed : '';
  const baseSeed = hashString(
    `${safeName}\u0000${seedText}\u0000${width}x${height}x${wantedRooms}`,
  );

  const rooms = (() => {
    let best: DungeonRoom[] = [];
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const random = mulberry32(mixSeed(baseSeed, attempt + 1));
      const candidate = placeRooms(random, width, height, wantedRooms);
      if (candidate.length > best.length) best = candidate;
      if (best.length >= wantedRooms) break;
    }
    // Тесная сетка: иногда крупные комнаты слишком быстро фрагментируют карту.
    if (best.length < wantedRooms) {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const random = mulberry32(mixSeed(baseSeed, 1000 + attempt));
        const candidate = placeRooms(random, width, height, wantedRooms, 6, 4);
        if (candidate.length > best.length) best = candidate;
        if (best.length >= wantedRooms) break;
      }
    }
    if (best.length < wantedRooms) fillWithRooms(best, width, height, wantedRooms);
    if (best.length < wantedRooms) {
      // Последний шанс: ровная упаковка мелкими комнатами с нуля.
      const packed: DungeonRoom[] = [];
      fillWithRooms(packed, width, height, wantedRooms);
      if (packed.length > best.length) best = packed;
    }
    return best;
  })();

  // Пустая сетка из стен.
  const grid: string[][] = Array.from({ length: height }, () =>
    Array<string>(width).fill(WALL),
  );

  // Пол комнат.
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) grid[y][x] = FLOOR;
    }
  }

  // Коридоры и двери. Цепочка комнат гарантирует связность, а двери
  // ставятся на обращённых друг к другу стенах соседних комнат.
  const random = mulberry32(mixSeed(baseSeed, 0x51ed270b));
  const doors: DungeonPoint[] = [];
  for (let index = 1; index < rooms.length; index += 1) {
    const previous = rooms[index - 1];
    const current = rooms[index];
    const doorA = makeDoor(
      previous,
      chooseDoorSide(previous, roomCenter(current)),
      random,
    );
    const doorB = makeDoor(
      current,
      chooseDoorSide(current, roomCenter(previous)),
      random,
    );
    carveCorridor(grid, doorA.outside, doorB.outside, random() < 0.5);
    doors.push({ x: doorA.x, y: doorA.y }, { x: doorB.x, y: doorB.y });
  }
  // Двери ставим после всех коридоров, чтобы поздние проходы их не затёрли.
  for (const door of doors) grid[door.y][door.x] = DOOR;

  const firstRoom = rooms[0];
  const spawn: DungeonPoint = {
    x: firstRoom.x + Math.floor(firstRoom.w / 2),
    y: firstRoom.y + Math.floor(firstRoom.h / 2),
  };

  // Свободные клетки пола внутри комнат; на них встанут предметы и монстры.
  const floorCells: DungeonPoint[] = [];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        if (grid[y][x] === FLOOR) floorCells.push({ x, y });
      }
    }
  }

  const candidates = floorCells.filter(
    (cell) => cell.x !== spawn.x || cell.y !== spawn.y,
  );
  shuffle(candidates, random);

  const desiredItems = 3 + Math.floor(random() * 3); // 3..5
  const desiredMonsters = 3 + Math.floor(random() * 3); // 3..5

  let itemCount = Math.min(desiredItems, candidates.length);
  let monsterCount = Math.min(desiredMonsters, Math.max(0, candidates.length - itemCount));
  if (candidates.length >= 2) {
    if (itemCount === 0) itemCount = 1;
    if (monsterCount === 0) monsterCount = Math.min(1, candidates.length - itemCount);
  }

  const items: DungeonItem[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const cell = candidates[index];
    items.push({ x: cell.x, y: cell.y, kind: ITEM_KINDS[index % ITEM_KINDS.length] });
  }

  const monsters: DungeonMonster[] = [];
  for (let index = 0; index < monsterCount; index += 1) {
    const cell = candidates[itemCount + index];
    monsters.push({ x: cell.x, y: cell.y, kind: MONSTER_KINDS[index % MONSTER_KINDS.length] });
  }

  // Сначала всё содержимое, потом глифы на карте.
  grid[spawn.y][spawn.x] = PLAYER;
  for (const item of items) grid[item.y][item.x] = item.kind;
  for (const monster of monsters) grid[monster.y][monster.x] = monster.kind;

  return {
    grid: grid.map((row) => row.join('')),
    rooms,
    spawn,
    items,
    monsters,
    legend: DUNGEON_LEGEND,
  };
}

/** Карта, пустая строка, легенда. */
export function renderDungeon(dungeon: Dungeon): string {
  return `${dungeon.grid.join('\n')}\n\n${dungeon.legend}`;
}
