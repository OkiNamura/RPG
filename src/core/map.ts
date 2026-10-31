/**
 * ASCII-карта помещения.
 *
 * Генерируется детерминированно из названия места: одно и то же место
 * всегда даёт одну и ту же схему, без обращения к модели и без затрат.
 * Это не «настоящий» план, а быстрый ориентир: стены, проход, укрытия, ты.
 */

const DEFAULT_WIDTH = 31;
const DEFAULT_HEIGHT = 12;

/** Простой PRNG, чтобы схема была стабильной для места. */
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

function hashCode(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface MapOptions {
  /** подпись под картой */
  legend?: boolean;
  width?: number;
  height?: number;
}

export function renderMap(place: string, options: MapOptions = {}): string {
  const width = Math.max(15, Math.min(61, options.width ?? DEFAULT_WIDTH));
  const height = Math.max(7, Math.min(25, options.height ?? DEFAULT_HEIGHT));

  const random = mulberry32(hashCode(place || 'место'));
  const grid: string[][] = Array.from({ length: height }, () => Array<string>(width).fill('.'));

  for (let x = 0; x < width; x += 1) {
    grid[0][x] = '#';
    grid[height - 1][x] = '#';
  }
  for (let y = 0; y < height; y += 1) {
    grid[y][0] = '#';
    grid[y][width - 1] = '#';
  }

  // Колонны и обломки внутри
  const pillars = Math.round((width * height) / 90) + Math.floor(random() * 3);
  for (let i = 0; i < pillars; i += 1) {
    const x = 3 + Math.floor(random() * (width - 6));
    const y = 2 + Math.floor(random() * (height - 4));
    grid[y][x] = '#';
  }

  // Укрытия и мелкие предметы
  const decor = ['~', ',', '^', '*'];
  const decorCount = Math.round((width * height) / 80);
  for (let i = 0; i < decorCount; i += 1) {
    const x = 2 + Math.floor(random() * (width - 4));
    const y = 1 + Math.floor(random() * (height - 2));
    if (grid[y][x] === '.') grid[y][x] = decor[Math.floor(random() * decor.length)];
  }

  // Проход: дверь в одной из стен
  const side = Math.floor(random() * 4);
  if (side === 0) grid[0][4 + Math.floor(random() * (width - 8))] = '=';
  else if (side === 1) grid[height - 1][4 + Math.floor(random() * (width - 8))] = '=';
  else if (side === 2) grid[2 + Math.floor(random() * (height - 4))][0] = '=';
  else grid[2 + Math.floor(random() * (height - 4))][width - 1] = '=';

  // Ты — в центре
  grid[Math.floor(height / 2)][Math.floor(width / 2)] = '@';

  const body = grid.map((row) => row.join('')).join('\n');
  if (options.legend === false) return body;

  return `${body}\n\n# стена · . пол · @ ты · = проход · ~ вода · ^ лестница · * вещь`;
}

/** Заголовок карты: место и время. */
export function mapTitle(place: string): string {
  return place.length > 30 ? `${place.slice(0, 29)}…` : place;
}
