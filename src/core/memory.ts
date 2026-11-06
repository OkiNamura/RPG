import { hitsKey } from './lore.ts';

export interface MemoryEntry {
  id: string;
  kind: 'fact' | 'journal';
  text: string;
  keys: string[];
  importance: 1 | 2 | 3;
  pinned: boolean;
  createdTurn: number;
  source: 'player';
}

export interface MemoryBlock {
  pinned: string;
  recall: string;
  usedPinned: string[];
  usedRecall: string[];
  dropped: string[];
  chars: number;
}

const PINNED_LIMIT = 8;
const PINNED_CHARS = 4000;
const RECALL_LIMIT = 6;
const RECALL_CHARS = 3000;
const TOTAL_CHARS = 9000;

export const MEMORY_LIMITS = { pinnedEntries: PINNED_LIMIT, pinnedChars: PINNED_CHARS, recallEntries: RECALL_LIMIT, recallChars: RECALL_CHARS, totalChars: TOTAL_CHARS };

export function normalizeMemories(value: unknown): MemoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: String(item.id ?? `mem-${index + 1}`),
      kind: item.kind === 'fact' ? 'fact' as const : 'journal' as const,
      text: String(item.text ?? '').slice(0, 500),
      keys: Array.isArray(item.keys) ? item.keys.map(String).map((key) => key.trim()).filter(Boolean).slice(0, 8) : [],
      importance: (item.importance === 1 || item.importance === 3 ? item.importance : 2) as 1 | 2 | 3,
      pinned: item.pinned === true,
      createdTurn: Number.isFinite(Number(item.createdTurn)) ? Number(item.createdTurn) : 0,
      source: 'player' as const,
    }))
    .filter((entry) => entry.text.length > 0)
    .filter((entry, index, list) => list.findIndex((item) => item.id === entry.id) === index)
    .slice(0, 50);
}

/** Постоянные записи стабильны; recall меняется и идёт после истории. */
export function buildMemoryBlock(entries: MemoryEntry[], legacy: string, searchText: string): MemoryBlock {
  const pinned = entries
    .filter((entry) => entry.pinned)
    .sort((a, b) => b.importance - a.importance || a.createdTurn - b.createdTurn || a.id.localeCompare(b.id))
    .slice(0, PINNED_LIMIT);
  const usedPinned: string[] = [];
  const pinnedLines: string[] = [];
  const dropped: string[] = [];
  let pinnedChars = 0;
  for (const entry of pinned) {
    const line = `- ${entry.text}`;
    if (pinnedChars + entry.text.length > PINNED_CHARS) {
      dropped.push(entry.id);
      continue;
    }
    pinnedLines.push(line);
    usedPinned.push(entry.id);
    pinnedChars += entry.text.length;
  }

  const legacyChars = legacy.length;
  const recallBudget = Math.max(0, Math.min(RECALL_CHARS, TOTAL_CHARS - legacyChars - pinnedChars));
  const usedRecall: string[] = [];
  const recallLines: string[] = [];
  let recallChars = 0;
  const candidates = entries
    .filter((entry) => !entry.pinned && entry.keys.length > 0 && entry.keys.some((key) => hitsKey(searchText, key)))
    .sort((a, b) => b.importance - a.importance || b.createdTurn - a.createdTurn);
  for (const entry of candidates) {
    const line = `- ${entry.text}`;
    if (usedRecall.length >= RECALL_LIMIT || recallChars + entry.text.length > recallBudget) {
      dropped.push(entry.id);
      continue;
    }
    recallLines.push(line);
    usedRecall.push(entry.id);
    recallChars += entry.text.length;
  }

  const pinnedText = pinnedLines.length ? `Память (важно):\n${pinnedLines.join('\n')}` : '';
  const recallText = recallLines.length ? `Память по сцене:\n${recallLines.join('\n')}` : '';
  return {
    pinned: pinnedText,
    recall: recallText,
    usedPinned,
    usedRecall,
    dropped,
    chars: pinnedText.length + recallText.length,
  };
}
