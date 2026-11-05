/** Универсальная рамка мира: не одна история, а структура для любой игры. */
export interface WorldStory {
  premise: string;
  centralQuestion: string;
  stakes: string;
  tone: string;
  factions: {
    name: string;
    interests?: string;
    redLines?: string;
    norms?: Record<string, number>;
  }[];
  partyRoles: { name: string; role: string; want?: string; fear?: string }[];
  npcLines: {
    name: string;
    faction?: string;
    want?: string;
    fear?: string;
    secret?: string;
    arc?: string;
  }[];
  locations: { name: string; role?: string }[];
  taboos: string[];
  beats: string[];
}

function strings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit);
}

export function normalizeWorldStory(value: unknown): WorldStory | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const premise = String(raw.premise ?? '').trim().slice(0, 2000);
  if (!premise) return null;
  const list = (key: string): Record<string, unknown>[] =>
    Array.isArray(raw[key]) ? (raw[key] as Record<string, unknown>[]).filter(Boolean).slice(0, 20) : [];
  return {
    premise,
    centralQuestion: String(raw.centralQuestion ?? '').trim().slice(0, 500),
    stakes: String(raw.stakes ?? '').trim().slice(0, 1000),
    tone: String(raw.tone ?? '').trim().slice(0, 1000),
    factions: list('factions').map((item) => ({
      name: String(item.name ?? '').trim(),
      interests: String(item.interests ?? '').trim().slice(0, 500),
      redLines: String(item.redLines ?? '').trim().slice(0, 500),
      norms: item.norms && typeof item.norms === 'object'
        ? Object.fromEntries(Object.entries(item.norms as Record<string, unknown>).map(([key, value]) => [key, Math.max(-5, Math.min(5, Number(value) || 0))]))
        : undefined,
    })).filter((item) => item.name),
    partyRoles: list('partyRoles').map((item) => ({
      name: String(item.name ?? '').trim(),
      role: String(item.role ?? '').trim(),
      want: String(item.want ?? '').trim().slice(0, 300),
      fear: String(item.fear ?? '').trim().slice(0, 300),
    })).filter((item) => item.name || item.role),
    npcLines: list('npcLines').map((item) => ({
      name: String(item.name ?? '').trim(),
      faction: String(item.faction ?? '').trim(),
      want: String(item.want ?? '').trim().slice(0, 300),
      fear: String(item.fear ?? '').trim().slice(0, 300),
      secret: String(item.secret ?? '').trim().slice(0, 500),
      arc: String(item.arc ?? '').trim().slice(0, 500),
    })).filter((item) => item.name),
    locations: list('locations').map((item) => ({
      name: String(item.name ?? '').trim(),
      role: String(item.role ?? '').trim().slice(0, 300),
    })).filter((item) => item.name),
    taboos: strings(raw.taboos),
    beats: strings(raw.beats),
  };
}
