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
  const database = open(path);
  try {
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
  } finally {
    database.close();
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

export function removeSnapshots(path: string, campaignId: string): void {
  const database = open(path);
  try {
    database.prepare('DELETE FROM snapshots WHERE campaign_id=?').run(campaignId);
  } finally {
    database.close();
  }
}
