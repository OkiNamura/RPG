#!/usr/bin/env node
/**
 * Необязательный SQLite-индекс поверх JSON-кампаний.
 *
 * JSON остаётся источником истины. Индекс можно удалить и пересобрать:
 *   node scripts/build-index.mjs
 *   node scripts/build-index.mjs --query "рынок"
 *
 * Нужен для быстрого поиска по логам/локациям/персонажам и для будущего
 * FTS/векторного retrieval. Turn-state в JSON не трогаем.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DATA = join(process.cwd(), 'data');
const CAMPAIGNS = join(DATA, 'campaigns');
const DB_PATH = join(DATA, 'search.db');
const argv = process.argv.slice(2);
const queryIndex = argv.indexOf('--query');
const query = queryIndex >= 0 ? argv[queryIndex + 1] ?? '' : '';

if (!existsSync(join(DATA))) {
  console.error('нет папки data — запусти из корня проекта');
  process.exit(2);
}

if (query) {
  if (!existsSync(DB_PATH)) {
    console.error('индекс не собран: node scripts/build-index.mjs');
    process.exit(2);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const safe = query
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const clean = word.replace(/[^\p{L}\p{N}_-]+/gu, '');
      const stem = clean.length >= 5 ? clean.slice(0, -2) : clean.length >= 4 ? clean.slice(0, -1) : clean;
      return stem.length >= 2 ? `${stem}*` : '';
    })
    .filter(Boolean)
    .join(' ');
  try {
    const rows = db
      .prepare(
        `SELECT campaign_id, turn, role, text
         FROM log_fts
         WHERE log_fts MATCH ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(safe);
    for (const row of rows) {
      console.log(`[${row.campaign_id} · ход ${row.turn} · ${row.role}] ${String(row.text).replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    console.log(`найдено: ${rows.length}`);
  } finally {
    db.close();
  }
  process.exit(0);
}

for (const file of ['search.db', 'search.db-wal', 'search.db-shm']) {
  try {
    unlinkSync(join(DATA, file));
  } catch {
    /* файла нет */
  }
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec(`
  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    title TEXT,
    preset TEXT,
    turn INTEGER,
    place TEXT,
    saved_at TEXT,
    size INTEGER
  );
  CREATE TABLE actors (
    campaign_id TEXT,
    name TEXT,
    kind TEXT,
    role TEXT,
    status TEXT,
    attitude INTEGER,
    morale INTEGER,
    present INTEGER
  );
  CREATE TABLE locations (
    campaign_id TEXT,
    name TEXT,
    note TEXT,
    description TEXT,
    history TEXT
  );
  CREATE TABLE items (
    campaign_id TEXT,
    name TEXT,
    qty INTEGER,
    place TEXT
  );
  CREATE TABLE log (
    campaign_id TEXT,
    turn INTEGER,
    role TEXT,
    text TEXT
  );
  CREATE VIRTUAL TABLE log_fts USING fts5(campaign_id, text, turn, role);
  CREATE TABLE summaries (
    campaign_id TEXT,
    text TEXT
  );
`);
const insertCampaign = db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?,?,?)');
const insertActor = db.prepare('INSERT INTO actors VALUES (?,?,?,?,?,?,?,?)');
const insertLocation = db.prepare('INSERT INTO locations VALUES (?,?,?,?,?)');
const insertItem = db.prepare('INSERT INTO items VALUES (?,?,?,?)');
const insertLog = db.prepare('INSERT INTO log VALUES (?,?,?,?)');
const insertFts = db.prepare('INSERT INTO log_fts VALUES (?,?,?,?)');
const insertSummary = db.prepare('INSERT INTO summaries VALUES (?,?)');

const files = existsSync(CAMPAIGNS)
  ? readdirSync(CAMPAIGNS).filter((file) => file.endsWith('.json')).sort()
  : [];
const started = performance.now();
let logRows = 0;
db.exec('BEGIN');
try {
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const full = join(CAMPAIGNS, file);
    const campaign = JSON.parse(readFileSync(full, 'utf8'));
    const state = campaign.state ?? {};
    insertCampaign.run(
      id,
      campaign.meta?.title ?? id,
      campaign.meta?.presetTitle ?? '',
      state.turn ?? 0,
      state.place ?? '',
      campaign.savedAt ?? '',
      statSync(full).size,
    );
    for (const [kind, list] of [['party', state.party ?? []], ['npc', (state.npcs ?? []).filter((npc) => !npc.archived)]]) {
      for (const actor of list) {
        insertActor.run(
          id,
          actor.name,
          kind,
          actor.role ?? '',
          actor.status ?? '',
          Number(actor.attitude ?? 0),
          Number(actor.morale ?? 50),
          actor.present === false ? 0 : 1,
        );
      }
    }
    for (const location of state.locations ?? []) {
      insertLocation.run(id, location.name, location.note ?? '', location.description ?? '', location.history ?? '');
    }
    for (const item of state.items ?? []) {
      insertItem.run(id, item.name, Number(item.qty ?? 1), item.where ?? '');
    }
    for (const entry of state.log ?? []) {
      insertLog.run(id, entry.turn ?? 0, entry.role ?? '', entry.text ?? '');
      insertFts.run(id, entry.text ?? '', String(entry.turn ?? 0), entry.role ?? '');
      logRows += 1;
    }
    if (campaign.summary) insertSummary.run(id, campaign.summary);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const size = statSync(DB_PATH).size;
db.close();
console.log({
  campaigns: files.length,
  logRows,
  ms: Math.round(performance.now() - started),
  dbKB: Math.round(size / 1024),
  db: DB_PATH,
});
