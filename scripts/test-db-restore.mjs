#!/usr/bin/env node
/** Проверка: бэкап → повреждение → восстановление snapshots.db. */
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupDatabase, checkIntegrity, ensureDatabase } from '../src/core/db-maintenance.ts';

const root = mkdtempSync(join(tmpdir(), 'omika-db-test-'));
const dbPath = join(root, 'snapshots.db');
const backupDir = join(root, 'backups');
try {
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE snapshots(campaign_id TEXT, turn INTEGER, json TEXT)');
  db.prepare('INSERT INTO snapshots VALUES (?,?,?)').run('test', 1, '{"ok":true}');
  db.close();
  const backup = backupDatabase(dbPath, backupDir, 'snapshots', 3);
  if (!backup) throw new Error('бэкап не создан');
  writeFileSync(dbPath, 'это не sqlite', 'utf8');
  if (checkIntegrity(dbPath).ok) throw new Error('повреждение не обнаружено');
  const restored = ensureDatabase(dbPath, backupDir, 'snapshots', 3);
  if (!restored.ok) throw new Error(`не восстановлено: ${restored.detail}`);
  if (!checkIntegrity(dbPath).ok) throw new Error('восстановленная база битая');
  const db2 = new DatabaseSync(dbPath, { readOnly: true });
  const row = db2.prepare('SELECT json FROM snapshots WHERE campaign_id=?').get('test');
  db2.close();
  if (!row?.json.includes('ok')) throw new Error('данные не восстановились');
  console.log('✓ бэкап, повреждение, восстановление и данные — ок');
  console.log('✓ restoredFrom:', restored.restoredFrom ? 'backup' : '—');
} finally {
  rmSync(root, { recursive: true, force: true });
}
