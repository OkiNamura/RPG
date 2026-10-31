/**
 * Мировая карта для текстовой RPG.
 *
 * Карта генерируется детерминированно: сид — название мира, поэтому один и
 * тот же мир всегда даёт один и тот же континент, берега и локации.
 * Под картой идёт компактная легенда: символы рельефа, типы локаций и их
 * список.
 *
 * Никаких внешних зависимостей — только стандартный JS/TS.
 */

const DEFAULT_WIDTH = 41;
const DEFAULT_HEIGHT = 17;
const MIN_WIDTH = 5;
const MAX_WIDTH = 201;
const MIN_HEIGHT = 3;
const MAX_HEIGHT = 81;
const LEGEND_MAX_LINES = 12;

/** Вода и рельеф суши. */
const WATER = '~';
const GROUND = '.';
const FOREST = '♣';
const HILL = '^';
const MOUNTAIN = 'A';
const SWAMP = ',';

/** Маркеры локаций. */
const PIN_SYMBOL = {
  city: '@',
  village: 'o',
  ruin: 'x',
  camp: '#',
  landmark: '!',
};

const KIND_LABEL = {
  city: 'город',
  village: 'деревня',
  ruin: 'руины',
  camp: 'лагерь',
  landmark: 'ориентир',
};

const TAU = Math.PI * 2;
const DIRS4: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIRS8: Array<[number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

type LocationKind = 'city' | 'village' | 'ruin' | 'camp' | 'landmark';

export interface WorldLocation {
  name: string;
  x?: number;
  y?: number;
  kind?: 'city' | 'village' | 'ruin' | 'camp' | 'landmark';
}

interface Cell {
  x: number;
  y: number;
}

interface PlacedPin extends Cell {
  name: string;
  kind: LocationKind;
}

interface BuiltWorld {
  width: number;
  height: number;
  /** Рельеф без маркеров локаций. */
  grid: string[][];
  pins: PlacedPin[];
}

/** Простой PRNG (mulberry32): карта стабильна для одного и того же сида. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: сид из названия мира. */
function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const integer = Math.floor(value);
  if (integer < min) return min;
  if (integer > max) return max;
  return integer;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function cleanTitle(worldTitle: unknown): string {
  const text = String(worldTitle ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : 'Безымянный мир';
}

/** Полное название — сид; для заголовка карты оно укорачивается. */
function displayTitle(title: string): string {
  return title.length > 60 ? `${title.slice(0, 59)}…` : title;
}

function normalizeName(name: unknown): string {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : 'безымянное место';
}

function normalizeKind(kind: unknown): LocationKind {
  if (kind === 'city' || kind === 'village' || kind === 'ruin' || kind === 'camp' || kind === 'landmark') {
    return kind;
  }
  return 'landmark';
}

function isWater(grid: string[][], x: number, y: number): boolean {
  return grid[y][x] === WATER;
}

/**
 * Континент: неровный «звёздный» островок вокруг центра, вокруг — вода.
 * Угловые края всегда остаются водой.
 */
function generateCoastline(random: () => number, width: number, height: number): string[][] {
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(WATER));
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusX = Math.max(1.2, width / 2 - 1.4);
  const radiusY = Math.max(0.9, height / 2 - 1.1);
  const phaseA = random() * TAU;
  const phaseB = random() * TAU;
  const phaseC = random() * TAU;
  const phaseD = random() * TAU;
  const baseRadius = 0.82;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = (x - centerX) / radiusX;
      const ny = (y - centerY) / radiusY;
      const radius = Math.sqrt(nx * nx + ny * ny);
      const angle = Math.atan2(ny, nx);
      const edge =
        baseRadius +
        0.085 * Math.sin(3 * angle + phaseA) +
        0.055 * Math.sin(5 * angle + phaseB) +
        0.04 * Math.sin(2 * angle + phaseC) +
        0.028 * Math.sin(7 * angle + phaseD) +
        // мелкая дрожь береговой линии
        (random() - 0.5) * 0.05;
      if (radius <= edge) grid[y][x] = GROUND;
    }
  }

  keepMainContinent(grid, width, height);
  return grid;
}

/** Оставляем только один связный (по сторонам) массив суши. */
function keepMainContinent(grid: string[][], width: number, height: number): void {
  let startX = Math.floor((width - 1) / 2);
  let startY = Math.floor((height - 1) / 2);

  if (grid[startY][startX] !== GROUND) {
    let found: Cell | null = null;
    for (let y = 0; y < height && !found; y += 1) {
      for (let x = 0; x < width && !found; x += 1) {
        if (grid[y][x] === GROUND) found = { x, y };
      }
    }
    if (found) {
      startX = found.x;
      startY = found.y;
    } else {
      // Совсем маленькая сетка: хотя бы одна клетка суши должна быть.
      grid[startY][startX] = GROUND;
    }
  }

  const reachable = new Set<number>();
  const queue: Cell[] = [{ x: startX, y: startY }];
  reachable.add(startY * width + startX);

  while (queue.length > 0) {
    const cell = queue.pop();
    if (!cell) break;
    for (const [dx, dy] of DIRS4) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid[ny][nx] !== GROUND) continue;
      const key = ny * width + nx;
      if (reachable.has(key)) continue;
      reachable.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x] === GROUND && !reachable.has(y * width + x)) {
        grid[y][x] = WATER;
      }
    }
  }
}

/** Случайное блуждание, которое кладёт рельеф только на сушу. */
function paintBlobs(
  random: () => number,
  grid: string[][],
  starts: Cell[],
  char: string,
  target: number,
  minSteps: number,
  maxSteps: number,
): void {
  if (starts.length === 0 || target <= 0) return;
  const height = grid.length;
  const width = grid[0].length;
  let painted = 0;
  let attempts = 0;
  const maxAttempts = target * 10 + 40;

  while (painted < target && attempts < maxAttempts) {
    attempts += 1;
    const start = starts[Math.floor(random() * starts.length)];
    let x = start.x;
    let y = start.y;
    const steps = minSteps + Math.floor(random() * (maxSteps - minSteps + 1));

    for (let step = 0; step < steps && painted < target; step += 1) {
      if (grid[y][x] === GROUND) {
        grid[y][x] = char;
        painted += 1;
      }
      const move = DIRS8[Math.floor(random() * DIRS8.length)];
      const nx = x + move[0];
      const ny = y + move[1];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid[ny][nx] === WATER) continue;
      x = nx;
      y = ny;
    }
  }
}

/** Леса, горы, холмы и болота — доля от площади суши. */
function decorateTerrain(random: () => number, grid: string[][], width: number, height: number): void {
  const land: Cell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x] === GROUND) land.push({ x, y });
    }
  }
  if (land.length === 0) return;

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radiusX = Math.max(1.2, width / 2 - 1.4);
  const radiusY = Math.max(0.9, height / 2 - 1.1);
  const interior = land.filter((cell) => {
    const nx = (cell.x - centerX) / radiusX;
    const ny = (cell.y - centerY) / radiusY;
    return Math.sqrt(nx * nx + ny * ny) <= 0.66;
  });
  const mountainStarts = interior.length >= 4 ? interior : land;
  const area = land.length;

  paintBlobs(random, grid, mountainStarts, MOUNTAIN, Math.max(2, Math.round(area * 0.1)), 2, 5);
  paintBlobs(random, grid, land, HILL, Math.max(1, Math.round(area * 0.07)), 2, 4);
  paintBlobs(random, grid, land, FOREST, Math.max(2, Math.round(area * 0.16)), 2, 5);
  paintBlobs(random, grid, land, SWAMP, Math.max(1, Math.round(area * 0.05)), 1, 3);
}

/** Ближайшая свободная клетка суши; null — если свободной суши не осталось. */
function nearestFreeLand(
  grid: string[][],
  width: number,
  height: number,
  occupied: Set<number>,
  targetX: number,
  targetY: number,
): Cell | null {
  let best: Cell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x] === WATER) continue;
      if (occupied.has(y * width + x)) continue;
      const dx = x - targetX;
      const dy = y - targetY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }

  return best;
}

/** Свободная клетка суши, максимально далёкая от уже поставленных пинов. */
function spreadLandCell(
  random: () => number,
  grid: string[][],
  width: number,
  height: number,
  occupied: Set<number>,
  pins: PlacedPin[],
): Cell | null {
  const free: Cell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y][x] === WATER) continue;
      if (occupied.has(y * width + x)) continue;
      free.push({ x, y });
    }
  }
  if (free.length === 0) return null;

  let best = free[Math.floor(random() * free.length)];
  if (pins.length === 0) return best;

  let bestScore = -1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = free[Math.floor(random() * free.length)];
    let nearest = Number.POSITIVE_INFINITY;
    for (const pin of pins) {
      const dx = pin.x - candidate.x;
      const dy = pin.y - candidate.y;
      const distance = dx * dx + dy * dy;
      if (distance < nearest) nearest = distance;
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = candidate;
    }
  }
  return best;
}

/** Ставит пины: явные координаты — как просили (с поправкой на сушу), остальные — по суше. */
function placePins(
  random: () => number,
  grid: string[][],
  width: number,
  height: number,
  locations: WorldLocation[],
): PlacedPin[] {
  const pins: PlacedPin[] = [];
  const occupied = new Set<number>();

  for (const location of locations) {
    const name = normalizeName(location.name);
    const kind = normalizeKind(location.kind);
    const hasPoint =
      typeof location.x === 'number' &&
      Number.isFinite(location.x) &&
      typeof location.y === 'number' &&
      Number.isFinite(location.y);

    let cell: Cell | null = null;

    if (hasPoint) {
      const targetX = clamp(Math.round(location.x as number), 0, width - 1);
      const targetY = clamp(Math.round(location.y as number), 0, height - 1);
      if (!isWater(grid, targetX, targetY) && !occupied.has(targetY * width + targetX)) {
        cell = { x: targetX, y: targetY };
      } else {
        cell = nearestFreeLand(grid, width, height, occupied, targetX, targetY);
      }
      if (!cell) {
        // Свободной суши не осталось — ставим на любую сушу, даже занятую.
        for (let y = 0; y < height && !cell; y += 1) {
          for (let x = 0; x < width && !cell; x += 1) {
            if (grid[y][x] !== WATER) cell = { x, y };
          }
        }
      }
      if (!cell) {
        // Суши на карте нет вовсе — создаём её под пином.
        grid[targetY][targetX] = GROUND;
        cell = { x: targetX, y: targetY };
      }
    } else {
      cell = spreadLandCell(random, grid, width, height, occupied, pins);
      if (!cell) {
        // Вся суша занята: разрешаем наложение, лишь бы пин остался на суше.
        for (let y = 0; y < height && !cell; y += 1) {
          for (let x = 0; x < width && !cell; x += 1) {
            if (grid[y][x] !== WATER) cell = { x, y };
          }
        }
      }
      if (!cell) {
        const targetX = Math.floor((width - 1) / 2);
        const targetY = Math.floor((height - 1) / 2);
        grid[targetY][targetX] = GROUND;
        cell = { x: targetX, y: targetY };
      }
    }

    occupied.add(cell.y * width + cell.x);
    pins.push({ name, kind, x: cell.x, y: cell.y });
  }

  return pins;
}

function buildWorld(
  worldTitle: string,
  locations: WorldLocation[],
  width: number,
  height: number,
): BuiltWorld {
  const random = mulberry32(hashSeed(cleanTitle(worldTitle)));
  const grid = generateCoastline(random, width, height);
  decorateTerrain(random, grid, width, height);
  const pins = placePins(random, grid, width, height, Array.isArray(locations) ? locations : []);
  return { width, height, grid, pins };
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function packEntries(
  entries: string[],
  limit: number,
): Array<{ text: string; count: number }> {
  const packed: Array<{ text: string; count: number }> = [];
  for (const entry of entries) {
    const last = packed[packed.length - 1];
    if (last && last.text.length + 2 + entry.length <= limit) {
      last.text = `${last.text}  ${entry}`;
      last.count += 1;
    } else {
      packed.push({ text: entry, count: 1 });
    }
  }
  return packed;
}

function buildLegend(pins: PlacedPin[], width: number): string[] {
  const lines = [
    `Легенда: ${WATER} вода · ${GROUND} суша · ${FOREST} лес · ${HILL} холмы · ${MOUNTAIN} горы · ${SWAMP} болото`,
    `${PIN_SYMBOL.city} город · ${PIN_SYMBOL.village} деревня · ${PIN_SYMBOL.ruin} руины · ${PIN_SYMBOL.camp} лагерь · ${PIN_SYMBOL.landmark} ориентир`,
  ];
  const capacity = LEGEND_MAX_LINES - lines.length;
  const entries = pins.map(
    (pin) => `• ${PIN_SYMBOL[pin.kind]} ${pin.name} — ${KIND_LABEL[pin.kind]}`,
  );

  if (entries.length === 0) {
    lines.push('— локации не отмечены —');
    return lines;
  }

  if (entries.length <= capacity) {
    lines.push(...entries);
    return lines;
  }

  // Много локаций: укладываем список в оставшиеся строки, начиная с
  // компактной ширины и расширяя её, пока список не поместится (или пока
  // строки не станут слишком длинными).
  const limits = [
    Math.max(52, width * 2),
    Math.max(64, Math.round(width * 2.5)),
    Math.max(80, width * 3),
  ];
  let packed: Array<{ text: string; count: number }> = [];
  for (const limit of limits) {
    packed = packEntries(entries, limit);
    if (packed.length <= capacity) break;
  }

  if (packed.length <= capacity) {
    lines.push(...packed.map((item) => item.text));
    return lines;
  }

  const shown = packed.slice(0, capacity - 1);
  const shownCount = shown.reduce((sum, item) => sum + item.count, 0);
  const rest = pins.length - shownCount;
  lines.push(
    ...shown.map((item) => item.text),
    `… и ещё ${rest} ${pluralize(rest, 'локация', 'локации', 'локаций')}`,
  );
  return lines;
}

/**
 * Карта мира текстом: заголовок, сетка и (по умолчанию) легенда.
 *
 * @param worldTitle название мира — оно же сид генерации
 * @param locations локации; без координат раскладываются по суше детерминированно
 * @param options размер сетки и включать ли легенду
 */
export function renderWorldMap(
  worldTitle: string,
  locations: WorldLocation[],
  options: { width?: number; height?: number; legend?: boolean; unknown?: number } = {},
): string {
  const width = clampInt(options.width, DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
  const height = clampInt(options.height, DEFAULT_HEIGHT, MIN_HEIGHT, MAX_HEIGHT);
  const world = buildWorld(worldTitle, locations, width, height);

  const canvas = world.grid.map((row) => row.slice());
  for (const pin of world.pins) {
    canvas[pin.y][pin.x] = PIN_SYMBOL[pin.kind];
  }

  // Туман: неизведанные точки на карте.
  const unknown = Math.max(0, Math.min(8, options.unknown ?? 0));
  let hidden = 0;
  if (unknown > 0) {
    let seed = 2166136261;
    for (const ch of worldTitle) {
      seed ^= ch.charCodeAt(0);
      seed = Math.imul(seed, 16777619);
    }
    for (let i = 0; i < width * height * 3 && hidden < unknown; i += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const x = 1 + (seed % (width - 2));
      const y = 1 + ((seed >>> 9) % (height - 2));
      if (canvas[y][x] === '.') {
        canvas[y][x] = '?';
        hidden += 1;
      }
    }
  }

  const lines = [`Карта мира · ${displayTitle(cleanTitle(worldTitle))}`, ...canvas.map((row) => row.join(''))];
  if (options.legend !== false) {
    lines.push('', ...buildLegend(world.pins, width));
    if (hidden > 0) lines.push('? неизведанное · исследуй, чтобы открыть');
  }
  return lines.join('\n');
}

/**
 * Машиночитаемый снимок карты: рельеф без пинов и координаты локаций.
 * Удобно для проверок и для игровой логики (кто где стоит).
 */
export function mapSnapshot(
  worldTitle: string,
  locations: WorldLocation[],
): { width: number; height: number; terrain: string[]; pins: { name: string; x: number; y: number }[] } {
  const world = buildWorld(worldTitle, locations, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  return {
    width: world.width,
    height: world.height,
    terrain: world.grid.map((row) => row.join('')),
    pins: world.pins.map((pin) => ({ name: pin.name, x: pin.x, y: pin.y })),
  };
}
