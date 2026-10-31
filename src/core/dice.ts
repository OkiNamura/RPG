/**
 * Кубик d36 с джокерами.
 *
 * 36 граней: 1..33 — обычные, 34 — «джокер удачи» (+10),
 * 35 — «джокер судьбы» (переброс, итог 0), 36 — «джокер бездны» (−10).
 *
 * Бросок без seed — настоящая случайность (Math.random). Бросок с seed —
 * детерминированный: один и тот же текст всегда даёт одну и ту же грань.
 * Это нужно скрытым проверкам: результат зависит от сцены, а не от момента
 * вызова, и его можно воспроизвести при разборе.
 */

export interface Roll {
  face: number;
  joker: boolean;
  label: string;
}

export interface CheckResult {
  /** выпавшая грань d36 (1..36), без бонусов */
  roll: number;
  joker: boolean;
  /** итог проверки: грань + модификатор + бонус джокера */
  total: number;
  skill: string;
}

/** Число граней. */
export const D36_FACES = 36;

/** Грани-джокеры. */
export const JOKER_LUCK = 34;
export const JOKER_FATE = 35;
export const JOKER_ABYSS = 36;

const JOKER_LABELS: Record<number, string> = {
  [JOKER_LUCK]: 'джокер удачи',
  [JOKER_FATE]: 'джокер судьбы',
  [JOKER_ABYSS]: 'джокер бездны',
};

const JOKER_BONUSES: Record<number, number> = {
  [JOKER_LUCK]: 10,
  [JOKER_FATE]: 0,
  [JOKER_ABYSS]: -10,
};

/** FNV-1a: короткий стабильный хеш строки. */
function hashCode(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: быстрый детерминированный PRNG. */
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

/** PRNG, привязанный к тексту: одинаковый текст — одинаковая последовательность. */
export function seededRandom(seedText: string): () => number {
  return mulberry32(hashCode(seedText));
}

/** Джокер ли грань. */
export function isJokerFace(face: number): boolean {
  return face === JOKER_LUCK || face === JOKER_FATE || face === JOKER_ABYSS;
}

/** Название джокера; для обычной грани — пустая строка. */
export function jokerLabel(face: number): string {
  return JOKER_LABELS[face] ?? '';
}

/** Бонус джокера к итогу; для обычной грани — 0. */
export function jokerBonus(face: number): number {
  return JOKER_BONUSES[face] ?? 0;
}

function faceFrom(random: () => number): number {
  const index = Math.floor(random() * D36_FACES);
  return Math.min(D36_FACES, Math.max(1, index + 1));
}

function makeRoll(face: number): Roll {
  const joker = isJokerFace(face);
  return {
    face,
    joker,
    label: joker ? jokerLabel(face) : `грань ${face}`,
  };
}

/**
 * Бросок d36.
 *
 * Без seed — Math.random. С seed (в том числе с пустой строкой) —
 * детерминированный хеш + mulberry32.
 */
export function rollD36(seedText?: string): Roll {
  const random = seedText === undefined ? Math.random : seededRandom(seedText);
  return makeRoll(faceFrom(random));
}

/**
 * Проверка: d36 + модификатор скилла.
 *
 * `roll` — сырая грань, `total` — итог. Джокер удачи даёт +10,
 * бездны — −10. Джокер судьбы возвращает total 0 и joker=true:
 * это сигнал «перебросить» (hiddenCheck перебрасывает сам).
 */
export function rollCheck(seedText: string, skill: string, modifier = 0): CheckResult {
  const roll = rollD36(seedText);
  const fate = roll.face === JOKER_FATE;
  const total = fate ? 0 : roll.face + modifier + jokerBonus(roll.face);
  return { roll: roll.face, joker: roll.joker, total, skill };
}
