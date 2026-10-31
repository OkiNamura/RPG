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
}

/** Записи, чьи ключи есть в тексте сцены. */
export function matchLore(entries: LoreEntry[], text: string, limit = 3): LoreEntry[] {
  const low = text.toLowerCase();

  const hitsKey = (key: string): boolean => {
    const k = key.trim().toLowerCase();
    if (k.length < 2) return false;
    if (low.includes(k)) return true;
    // Грубая обработка склонений: «колодец» → «колод», «пепел» → «пеп».
    const stem = k.length > 5 ? k.slice(0, -2) : k;
    return stem !== k && low.includes(stem);
  };

  const hits = entries.filter((entry) => entry.keys.some(hitsKey));

  hits.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.content.length - b.content.length);
  return hits.slice(0, limit);
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
    entry.keys.length > 0 &&
    typeof entry.content === 'string' &&
    entry.content.trim().length > 0
  );
}
