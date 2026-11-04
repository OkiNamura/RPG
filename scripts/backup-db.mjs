#!/usr/bin/env node
/**
 * Бэкап SQLite-баз Omika.
 *
 *   node scripts/backup-db.mjs
 *
 * Создаёт консистентные копии через VACUUM INTO в data/backups.
 * JSON-кампании тоже стоит бэкапить отдельно; этот скрипт — про БД.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(process.cwd(), 'data');
const BACKUPS = join(DATA, 'backups');
mkdirSync(BACKUPS, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dbs = ['snapshots.db', 'search.db', 'traces.db'];
for (const name of dbs) {
  const source = join(DATA, name);
  if (!existsSync(source)) continue;
  const target = join(BACKUPS, `${name.replace(/\.db$/, '')}-${stamp}.db`);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    console.log(`backup: ${target}`);
  } finally {
    db.close();
  }
}
