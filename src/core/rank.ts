/**
 * Ранги: медленная лестница от FFF до SSR.
 * Три ступени на букву, затем легендарные S/SS/SSR.
 */
export const RANKS = [
  'FFF', 'FF', 'F',
  'EEE', 'EE', 'E',
  'DDD', 'DD', 'D',
  'CCC', 'CC', 'C',
  'BBB', 'BB', 'B',
  'AAA', 'AA', 'A',
  'S', 'SS', 'SSR',
] as const;

export type Rank = (typeof RANKS)[number];

export const START_RANKS: Rank[] = ['FFF', 'FF', 'F'];

export interface RankChange {
  from: Rank;
  to: Rank;
  turn: number;
  reason: string;
}

export interface Rankable {
  rank?: Rank;
  rankPoints?: number;
  rankHistory?: RankChange[];
  rankLocked?: boolean;
}

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

export function normalizeRank(value: unknown, fallback: Rank = 'F'): Rank {
  return isRank(value) ? value : fallback;
}

export function nextRank(rank: Rank): Rank | null {
  const index = RANKS.indexOf(rank);
  return index >= 0 && index + 1 < RANKS.length ? RANKS[index + 1] : null;
}

export function randomStartRank(): Rank {
  return START_RANKS[Math.floor(Math.random() * START_RANKS.length)];
}

/**
 * Начислить очки ранга. На 100 — повышение; у locked ранга очки копятся,
 * но повышения нет. Возвращает список повышений за этот вызов.
 */
export function addRankPoints(
  actor: Rankable,
  gain: number,
  turn: number,
  reason: string,
): RankChange[] {
  const changes: RankChange[] = [];
  actor.rank = normalizeRank(actor.rank);
  actor.rankPoints = Math.max(0, Math.min(99, Number(actor.rankPoints ?? 0)));
  actor.rankHistory = Array.isArray(actor.rankHistory) ? actor.rankHistory : [];
  const amount = Math.max(0, Math.min(100, Math.round(gain)));
  if (!amount) return changes;
  actor.rankPoints += amount;
  while (actor.rankPoints >= 100) {
    const from = actor.rank;
    const to = nextRank(from);
    if (!to) {
      actor.rankPoints = 99;
      break;
    }
    if (actor.rankLocked) {
      actor.rankPoints = 100;
      break;
    }
    actor.rank = to;
    actor.rankPoints -= 100;
    const change: RankChange = { from, to, turn, reason: reason.slice(0, 200) };
    actor.rankHistory.push(change);
    changes.push(change);
    if (actor.rankHistory.length > 30) actor.rankHistory.shift();
  }
  return changes;
}
