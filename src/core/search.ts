/**
 * Гибридный поисковый индекс поверх JSON-кампаний.
 *
 * JSON — источник истины. SQLite-файл можно удалить и пересобрать:
 * он нужен только для быстрого поиска и навигации.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from './state.ts';

export interface SearchLogHit {
  campaign: string;
  turn: number;
  role: string;
  text: string;
  rank: number;
}

export interface SearchNameHit {
  campaign: string;
  name: string;
  detail?: string;
}

export interface SearchTextHit {
  campaign: string;
  turn?: number;
  label: string;
  text: string;
}

export interface SearchResults {
  logs: SearchLogHit[];
  actors: SearchNameHit[];
  locations: SearchNameHit[];
  items: SearchNameHit[];
  campaigns: SearchNameHit[];
  summaries: SearchTextHit[];
  factions: SearchNameHit[];
  cards: SearchNameHit[];
  traces: SearchTextHit[];
}

function db(path: string): DatabaseSync {
  return new DatabaseSync(path);
}

function ensureSchema(database: DatabaseSync): void {
  database.exec('PRAGMA journal_mode=WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, title TEXT, preset TEXT, turn INTEGER,
      place TEXT, saved_at TEXT, size INTEGER
    );
    CREATE TABLE IF NOT EXISTS actors (
      campaign_id TEXT, name TEXT, kind TEXT, role TEXT, status TEXT,
      attitude INTEGER, morale INTEGER, present INTEGER
    );
    CREATE TABLE IF NOT EXISTS locations (
      campaign_id TEXT, name TEXT, note TEXT, description TEXT, history TEXT
    );
    CREATE TABLE IF NOT EXISTS items (
      campaign_id TEXT, name TEXT, qty INTEGER, place TEXT
    );
    CREATE TABLE IF NOT EXISTS log (
      campaign_id TEXT, turn INTEGER, role TEXT, text TEXT
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(campaign_id, text, turn, role);
    CREATE TABLE IF NOT EXISTS summaries (campaign_id TEXT, text TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(campaign_id, text);
    CREATE TABLE IF NOT EXISTS factions (
      campaign_id TEXT, name TEXT, note TEXT, leader TEXT, attitude INTEGER
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, type TEXT, name TEXT, subtitle TEXT, text TEXT
    );
    CREATE INDEX IF NOT EXISTS log_campaign_turn ON log(campaign_id, turn);
  `);
}

export type SearchCampaign = {
  state: GameState;
  summary?: string;
  meta?: { title?: string; presetTitle?: string };
  savedAt?: string;
  size?: number;
};

/** Полностью переиндексировать одну кампанию. */
export function syncCampaignIndex(path: string, id: string, data: SearchCampaign): void {
  const database = db(path);
  try {
    ensureSchema(database);
    const state = data.state;
    const entries = state.log ?? [];
    const maxTurn = entries.reduce((max, entry) => Math.max(max, Number(entry.turn ?? 0)), 0);
    const indexed = database.prepare('SELECT MAX(turn) AS turn FROM log WHERE campaign_id=?').get(id) as { turn: number | null };
    const indexedMax = indexed?.turn == null ? null : Number(indexed.turn);
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM actors WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM locations WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM items WHERE campaign_id=?').run(id);
      // Лог растёт только в конец: старые строки не переписываем.
      if (indexedMax != null) {
        database.prepare('DELETE FROM log WHERE campaign_id=? AND turn>?').run(id, maxTurn);
      }
      if (maxTurn > 0) {
        database.prepare('DELETE FROM log WHERE campaign_id=? AND turn=?').run(id, maxTurn);
      } else {
        database.prepare('DELETE FROM log WHERE campaign_id=?').run(id);
      }
      // FTS обновляем только по текущему/вытесненному ходу.
      if (indexedMax != null) {
        database.prepare('DELETE FROM log_fts WHERE campaign_id=? AND CAST(turn AS INTEGER)>?').run(id, maxTurn);
      }
      if (maxTurn > 0) {
        database.prepare('DELETE FROM log_fts WHERE campaign_id=? AND CAST(turn AS INTEGER)=?').run(id, maxTurn);
      } else {
        database.prepare('DELETE FROM log_fts WHERE campaign_id=?').run(id);
      }
      database.prepare('DELETE FROM summaries WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM summaries_fts WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM factions WHERE campaign_id=?').run(id);
      database.prepare('INSERT OR REPLACE INTO campaigns VALUES (?,?,?,?,?,?,?)').run(
        id,
        data.meta?.title ?? id,
        data.meta?.presetTitle ?? '',
        state.turn ?? 0,
        state.place ?? '',
        data.savedAt ?? '',
        data.size ?? 0,
      );
      const actor = database.prepare('INSERT INTO actors VALUES (?,?,?,?,?,?,?,?)');
      for (const [kind, list] of [
        ['party', state.party ?? []],
        ['npc', (state.npcs ?? []).filter((npc) => !npc.archived)],
      ] as const) {
        for (const item of list) {
          actor.run(
            id,
            item.name,
            kind,
            item.role ?? '',
            item.status ?? '',
            Number(item.attitude ?? 0),
            Number(item.morale ?? 50),
            item.present === false ? 0 : 1,
          );
        }
      }
      const location = database.prepare('INSERT INTO locations VALUES (?,?,?,?,?)');
      for (const item of state.locations ?? []) {
        location.run(id, item.name, item.note ?? '', item.description ?? '', item.history ?? '');
      }
      const itemStmt = database.prepare('INSERT INTO items VALUES (?,?,?,?)');
      for (const item of state.items ?? []) {
        itemStmt.run(id, item.name, Number(item.qty ?? 1), item.where ?? '');
      }
      const factionStmt = database.prepare('INSERT INTO factions VALUES (?,?,?,?,?)');
      for (const faction of state.factions ?? []) {
        factionStmt.run(id, faction.name, faction.note ?? '', faction.leader ?? '', Number(faction.attitude ?? 0));
      }
      const logStmt = database.prepare('INSERT INTO log VALUES (?,?,?,?)');
      const ftsStmt = database.prepare('INSERT INTO log_fts VALUES (?,?,?,?)');
      for (const entry of entries) {
        const turn = Number(entry.turn ?? 0);
        // При инкременте вставляем только текущий ход; при первой сборке — всё.
        if (indexedMax != null && turn < maxTurn) continue;
        logStmt.run(id, turn, entry.role ?? '', entry.text ?? '');
      }
      for (const entry of entries) {
        const turn = Number(entry.turn ?? 0);
        if (indexedMax != null && turn < maxTurn) continue;
        ftsStmt.run(id, entry.text ?? '', String(turn), entry.role ?? '');
      }
      if (data.summary) {
        database.prepare('INSERT INTO summaries VALUES (?,?)').run(id, data.summary);
        database.prepare('INSERT INTO summaries_fts VALUES (?,?)').run(id, data.summary);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

export function removeCampaignIndex(path: string, id: string): void {
  const database = db(path);
  try {
    ensureSchema(database);
    database.exec('BEGIN');
    try {
      for (const table of ['actors', 'locations', 'items', 'log', 'log_fts', 'summaries', 'summaries_fts', 'factions', 'campaigns']) {
        database.prepare(`DELETE FROM ${table} WHERE ${table === 'campaigns' ? 'id' : 'campaign_id'}=?`).run(id);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

/** Собрать индекс по всем JSON-кампаниям. */
export function rebuildSearchIndex(campaignsDir: string, path: string): number {
  let count = 0;
  for (const file of readdirSync(campaignsDir).filter((name) => name.endsWith('.json'))) {
    const full = join(campaignsDir, file);
    const campaign = JSON.parse(readFileSync(full, 'utf8')) as {
      state?: GameState;
      summary?: string;
      meta?: SearchCampaign['meta'];
      savedAt?: string;
    };
    if (!campaign.state) continue;
    syncCampaignIndex(path, file.replace(/\.json$/, ''), {
      state: campaign.state,
      summary: campaign.summary,
      meta: campaign.meta,
      savedAt: campaign.savedAt,
      size: statSync(full).size,
    });
    count += 1;
  }
  return count;
}

export function rebuildCardsIndex(cardsDir: string, path: string): number {
  const database = db(path);
  let count = 0;
  try {
    ensureSchema(database);
    database.exec('DELETE FROM cards');
    const insert = database.prepare('INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?)');
    let files: string[] = [];
    try {
      files = readdirSync(cardsDir).filter((name) => name.endsWith('.json'));
    } catch {
      return 0;
    }
    database.exec('BEGIN');
    try {
      for (const file of files) {
        let card: Record<string, unknown>;
        try {
          card = JSON.parse(readFileSync(join(cardsDir, file), 'utf8')) as Record<string, unknown>;
        } catch {
          continue;
        }
        const text = [
          card.name,
          card.subtitle,
          card.description,
          card.appearance,
          card.character,
          card.biography,
          card.habits,
          card.abilities,
        ].filter(Boolean).join('\n');
        insert.run(
          String(card.id ?? file),
          String(card.type ?? ''),
          String(card.name ?? ''),
          String(card.subtitle ?? ''),
          text,
        );
        count += 1;
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
  return count;
}

/** Поиск по отдельной базе трасс; база опциональна. */
export function searchTraces(tracePath: string, rawQuery: string, campaign = '', limit = 8): SearchTextHit[] {
  if (!existsSync(tracePath)) return [];
  const query = prefixQuery(rawQuery);
  if (!query) return [];
  const database = db(tracePath);
  try {
    const rows = (campaign
      ? database.prepare('SELECT campaign_id, turn, role, substr(text,1,500) text FROM traces_fts WHERE traces_fts MATCH ? AND campaign_id=? ORDER BY rank LIMIT ?').all(query, campaign, limit)
      : database.prepare('SELECT campaign_id, turn, role, substr(text,1,500) text FROM traces_fts WHERE traces_fts MATCH ? ORDER BY rank LIMIT ?').all(query, limit)) as {
      campaign_id: string; turn: string; role: string; text: string;
    }[];
    return rows.map((row) => ({
      campaign: row.campaign_id,
      turn: Number(row.turn),
      label: `трейс · ${row.role}`,
      text: row.text,
    }));
  } catch {
    return [];
  } finally {
    database.close();
  }
}

function prefixQuery(raw: string): string {
  return String(raw ?? '')
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .map((word) => {
      const clean = word.replace(/[^\p{L}\p{N}_-]+/gu, '');
      const stem = clean.length >= 5 ? clean.slice(0, -2) : clean.length >= 4 ? clean.slice(0, -1) : clean;
      return stem.length >= 2 ? `${stem}*` : '';
    })
    .filter(Boolean)
    .join(' ');
}

function nameHits(
  database: DatabaseSync,
  table: 'actors' | 'locations' | 'items' | 'factions',
  rawQuery: string,
  campaign: string,
  limit: number,
): SearchNameHit[] {
  const sql = campaign
    ? `SELECT campaign_id, name FROM ${table} WHERE campaign_id=?`
    : `SELECT campaign_id, name FROM ${table}`;
  const rows = (campaign
    ? database.prepare(sql).all(campaign)
    : database.prepare(sql).all()) as { campaign_id: string; name: string }[];
  const needle = rawQuery.toLowerCase();
  return rows
    .filter((row) => row.name.toLowerCase().includes(needle))
    .slice(0, limit)
    .map((row) => ({ campaign: row.campaign_id, name: row.name }));
}

export function searchIndex(path: string, rawQuery: string, campaign = '', limit = 12): SearchResults {
  const empty: SearchResults = {
    logs: [], actors: [], locations: [], items: [], campaigns: [],
    summaries: [], factions: [], cards: [], traces: [],
  };
  const query = prefixQuery(rawQuery);
  if (!query) return empty;
  const database = db(path);
  try {
    ensureSchema(database);
    const ftsSql = campaign
      ? 'SELECT campaign_id, turn, role, text, bm25(log_fts) AS rank FROM log_fts WHERE log_fts MATCH ? AND campaign_id=? ORDER BY rank LIMIT ?'
      : 'SELECT campaign_id, turn, role, text, bm25(log_fts) AS rank FROM log_fts WHERE log_fts MATCH ? ORDER BY rank LIMIT ?';
    const rows = (campaign
      ? database.prepare(ftsSql).all(query, campaign, limit)
      : database.prepare(ftsSql).all(query, limit)) as {
      campaign_id: string; turn: number; role: string; text: string; rank: number;
    }[];
    const campaigns = database
      .prepare(campaign ? 'SELECT id AS campaign, title AS name FROM campaigns WHERE id=?' : 'SELECT id AS campaign, title AS name FROM campaigns')
      .all(...(campaign ? [campaign] : [])) as { campaign: string; name: string }[];
    const needle = rawQuery.toLowerCase();
    const summarySql = campaign
      ? 'SELECT campaign_id, substring(text,1,700) AS text FROM summaries_fts WHERE summaries_fts MATCH ? AND campaign_id=? ORDER BY rank LIMIT ?'
      : 'SELECT campaign_id, substring(text,1,700) AS text FROM summaries_fts WHERE summaries_fts MATCH ? ORDER BY rank LIMIT ?';
    const summaries = (campaign
      ? database.prepare(summarySql).all(query, campaign, limit)
      : database.prepare(summarySql).all(query, limit)) as { campaign_id: string; text: string }[];
    const cardRows = database.prepare('SELECT id, type, name, subtitle, text FROM cards').all() as {
      id: string; type: string; name: string; subtitle: string; text: string;
    }[];
    return {
      logs: rows.map((row) => ({
        campaign: row.campaign_id,
        turn: Number(row.turn),
        role: row.role,
        text: String(row.text),
        rank: Number(row.rank),
      })),
      actors: nameHits(database, 'actors', rawQuery, campaign, limit),
      locations: nameHits(database, 'locations', rawQuery, campaign, limit),
      items: nameHits(database, 'items', rawQuery, campaign, limit),
      factions: nameHits(database, 'factions', rawQuery, campaign, limit),
      campaigns: campaigns.filter((row) => row.name?.toLowerCase().includes(needle)).slice(0, limit),
      summaries: summaries.map((row) => ({
        campaign: row.campaign_id,
        label: 'конспект',
        text: String(row.text),
      })),
      cards: cardRows
        .filter((row) => `${row.name} ${row.subtitle} ${row.text}`.toLowerCase().includes(needle))
        .slice(0, limit)
        .map((row) => ({ campaign: '', name: row.name, detail: [row.type, row.subtitle].filter(Boolean).join(' · ') })),
      traces: [],
    };
  } finally {
    database.close();
  }
}
