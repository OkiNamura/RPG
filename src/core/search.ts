/**
 * Гибридный поисковый индекс поверх JSON-кампаний.
 *
 * JSON — источник истины. SQLite-файл можно удалить и пересобрать:
 * он нужен только для быстрого поиска и навигации.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

export interface SearchResults {
  logs: SearchLogHit[];
  actors: SearchNameHit[];
  locations: SearchNameHit[];
  items: SearchNameHit[];
  campaigns: SearchNameHit[];
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
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM actors WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM locations WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM items WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM log WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM log_fts WHERE campaign_id=?').run(id);
      database.prepare('DELETE FROM summaries WHERE campaign_id=?').run(id);
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
      const logStmt = database.prepare('INSERT INTO log VALUES (?,?,?,?)');
      const ftsStmt = database.prepare('INSERT INTO log_fts VALUES (?,?,?,?)');
      for (const entry of state.log ?? []) {
        logStmt.run(id, entry.turn ?? 0, entry.role ?? '', entry.text ?? '');
        ftsStmt.run(id, entry.text ?? '', String(entry.turn ?? 0), entry.role ?? '');
      }
      if (data.summary) database.prepare('INSERT INTO summaries VALUES (?,?)').run(id, data.summary);
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
      for (const table of ['actors', 'locations', 'items', 'log', 'log_fts', 'summaries', 'campaigns']) {
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
  table: 'actors' | 'locations' | 'items',
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
  const empty: SearchResults = { logs: [], actors: [], locations: [], items: [], campaigns: [] };
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
      campaigns: campaigns.filter((row) => row.name?.toLowerCase().includes(needle)).slice(0, limit),
    };
  } finally {
    database.close();
  }
}
