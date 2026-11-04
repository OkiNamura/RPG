/**
 * Снимки ходов в SQLite.
 *
 * JSON кампании остаётся источником истины для state/текста,
 * а тяжёлые снимки (перегенерация, варианты, откат) живут здесь.
 * Файл можно бэкапить и проверять отдельно.
 */
import { DatabaseSync } from 'node:sqlite';
import type { TurnSnapshot } from './storage.ts';

function open(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode=WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      campaign_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      json TEXT NOT NULL,
      PRIMARY KEY (campaign_id, turn)
    );
  `);
  return database;
}

export function loadSnapshots(path: string, campaignId: string): TurnSnapshot[] {
  let database: DatabaseSync | null = null;
  try {
    database = open(path);
    const rows = database
      .prepare('SELECT json FROM snapshots WHERE campaign_id=? ORDER BY turn')
      .all(campaignId) as { json: string }[];
    const result: TurnSnapshot[] = [];
    for (const row of rows) {
      try {
        result.push(JSON.parse(row.json) as TurnSnapshot);
      } catch {
        /* битый снимок пропускаем */
      }
    }
    return result;
  } catch {
    // Битый snapshots.db не должен мешать открыть саму кампанию.
    return [];
  } finally {
    database?.close();
  }
}

export function saveSnapshots(path: string, campaignId: string, snapshots: TurnSnapshot[]): void {
  const database = open(path);
  try {
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM snapshots WHERE campaign_id=?').run(campaignId);
      const insert = database.prepare('INSERT INTO snapshots VALUES (?,?,?)');
      for (const snapshot of snapshots) {
        insert.run(campaignId, snapshot.turn, JSON.stringify(snapshot));
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

/** Инкрементально обновить только изменившиеся снимки и убрать вытесненные. */
export function syncSnapshots(path: string, campaignId: string, snapshots: TurnSnapshot[]): void {
  const database = open(path);
  try {
    const existing = new Map<number, string>();
    for (const row of database.prepare('SELECT turn, json FROM snapshots WHERE campaign_id=?').all(campaignId) as {
      turn: number;
      json: string;
    }[]) {
      existing.set(Number(row.turn), row.json);
    }
    const current = new Map<number, string>();
    for (const snapshot of snapshots) current.set(snapshot.turn, JSON.stringify(snapshot));
    database.exec('BEGIN');
    try {
      const upsert = database.prepare(
        'INSERT INTO snapshots (campaign_id,turn,json) VALUES (?,?,?) ON CONFLICT(campaign_id,turn) DO UPDATE SET json=excluded.json',
      );
      for (const [turn, json] of current) {
        if (existing.get(turn) !== json) upsert.run(campaignId, turn, json);
      }
      const remove = database.prepare('DELETE FROM snapshots WHERE campaign_id=? AND turn=?');
      for (const turn of existing.keys()) {
        if (!current.has(turn)) remove.run(campaignId, turn);
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

export function removeSnapshots(path: string, campaignId: string): void {
  const database = open(path);
  try {
    database.prepare('DELETE FROM snapshots WHERE campaign_id=?').run(campaignId);
  } finally {
    database.close();
  }
}
