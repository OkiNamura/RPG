/**
 * Лор-книга (World Info / Lorebook).
 *
 * Идея из SillyTavern: статический лор не грузим целиком каждый ход,
 * а подмешиваем только те записи, чьи ключи встретились в текущей сцене.
 * Так контекст остаётся маленьким, а мир — подробным.
 */

export interface LoreEntry {
  id: string;
  /** ключевые слова: место, имя, предмет, тема */
  keys: string[];
  /** что рассказать модели, если ключ сработал */
  content: string;
  /** чем выше, тем раньше в списке */
  priority?: number;
  secondaryKeys?: string[];
  constant?: boolean;
  selective?: boolean;
  logic?: 'and' | 'or' | 'not';
  scanDepth?: number;
  order?: number;
  position?: 'top' | 'history' | 'depth' | 'after';
  depth?: number;
  budget?: number;
  enabled?: boolean;
  group?: string;
  sticky?: number;
  cooldown?: number;
}

export interface LoreActivation {
  entry: LoreEntry;
  active: boolean;
  reason: string;
}

function hitsKey(text: string, key: string): boolean {
  const low = text.toLowerCase();
  const k = key.trim().toLowerCase();
  if (k.length < 2) return false;
  if (low.includes(k)) return true;
  const stem = k.length > 5 ? k.slice(0, -2) : k;
  return stem !== k && low.includes(stem);
}

/** Активация с причинами — для Context Inspector. */
export function activateLore(
  entries: LoreEntry[],
  text: string,
  options: { limit?: number; budgetChars?: number; scanText?: string } = {},
): { active: LoreEntry[]; report: LoreActivation[] } {
  const scan = options.scanText ?? text;
  const report: LoreActivation[] = [];
  const candidates: LoreEntry[] = [];
  for (const entry of entries) {
    if (entry.enabled === false) {
      report.push({ entry, active: false, reason: 'выключена' });
      continue;
    }
    if (entry.constant) {
      candidates.push(entry);
      report.push({ entry, active: true, reason: 'constant' });
      continue;
    }
    const primary = entry.keys.some((key) => hitsKey(scan, key));
    if (!primary) {
      report.push({ entry, active: false, reason: 'нет основного ключа' });
      continue;
    }
    const secondary = entry.secondaryKeys ?? [];
    const secondaryHit = secondary.some((key) => hitsKey(scan, key));
    let ok = true;
    if (entry.selective) {
      if (entry.logic === 'not') ok = !secondaryHit;
      else if (entry.logic === 'or') ok = true;
      else ok = secondaryHit;
    }
    report.push({ entry, active: ok, reason: ok ? 'ключ совпал' : 'selective не совпал' });
    if (ok) candidates.push(entry);
  }
  const positionWeight = (position: LoreEntry['position']): number =>
    position === 'top' ? 3 : position === 'history' ? 2 : position === 'after' ? 1 : 0;
  candidates.sort(
    (a, b) =>
      (b.order ?? b.priority ?? 0) - (a.order ?? a.priority ?? 0) ||
      positionWeight(b.position) - positionWeight(a.position) ||
      a.content.length - b.content.length,
  );
  const limit = options.limit ?? 8;
  const budget = options.budgetChars ?? 6000;
  const active: LoreEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    const cost = Math.min(entry.budget ?? entry.content.length, entry.content.length);
    if (active.length >= limit || used + cost > budget) continue;
    active.push(entry);
    used += cost;
  }
  return { active, report };
}

/** Записи, чьи ключи есть в тексте сцены. */
export function matchLore(entries: LoreEntry[], text: string, limit = 3): LoreEntry[] {
  return activateLore(entries, text, { limit }).active;
}

/** Текст для системного блока. Пустой, если совпадений нет. */
export function renderLore(entries: LoreEntry[]): string {
  if (entries.length === 0) return '';
  return ['Лор по сцене:', ...entries.map((entry) => `- ${entry.content}`)].join('\n');
}

/** Проверка записи: ключи есть, текст не пустой. */
export function isLoreEntry(value: unknown): value is LoreEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LoreEntry>;
  return (
    typeof entry.id === 'string' &&
    Array.isArray(entry.keys) &&
    (entry.constant === true || entry.keys.length > 0) &&
    typeof entry.content === 'string' &&
    entry.content.trim().length > 0
  );
}
