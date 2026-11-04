#!/usr/bin/env node
/**
 * Индексирует JSONL-трейсы в SQLite.
 *
 *   node scripts/index-traces.mjs
 *   node scripts/index-traces.mjs --query "рынок"
 *
 * JSONL остаются на месте; это только поисковый/аналитический индекс.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const DATA = join(process.cwd(), 'data');
const TRACES = join(DATA, 'traces');
const DB_PATH = join(DATA, 'traces.db');
const queryAt = process.argv.indexOf('--query');
const query = queryAt >= 0 ? String(process.argv[queryAt + 1] ?? '').trim() : '';

if (!existsSync(TRACES)) {
  console.error('нет data/traces');
  process.exit(2);
}
if (query) {
  if (!existsSync(DB_PATH)) {
    console.error('сначала: node scripts/index-traces.mjs');
    process.exit(2);
  }
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const prefix = query
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
  const rows = db
    .prepare('SELECT campaign_id, turn, role, substr(text,1,280) snippet FROM traces_fts WHERE traces_fts MATCH ? ORDER BY rank LIMIT 20')
    .all(prefix);
  for (const row of rows) console.log(`[${row.campaign_id} · ход ${row.turn} · ${row.role}] ${String(row.snippet).replace(/\s+/g, ' ')}`);
  console.log(`найдено: ${rows.length}`);
  db.close();
  process.exit(0);
}

for (const suffix of ['', '-wal', '-shm']) {
  try {
    unlinkSync(DB_PATH + suffix);
  } catch {
    /* нет */
  }
}
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec(`
  CREATE TABLE traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT, campaign_id TEXT, turn INTEGER, role TEXT,
    model TEXT, tokens_in INTEGER, tokens_out INTEGER, cost REAL,
    text TEXT
  );
  CREATE VIRTUAL TABLE traces_fts USING fts5(campaign_id, turn, role, text);
`);
const insert = db.prepare('INSERT INTO traces(ts,campaign_id,turn,role,model,tokens_in,tokens_out,cost,text) VALUES(?,?,?,?,?,?,?,?,?)');
const fts = db.prepare('INSERT INTO traces_fts(campaign_id,turn,role,text) VALUES(?,?,?,?)');
let count = 0;
const started = performance.now();
db.exec('BEGIN');
try {
  for (const file of readdirSync(TRACES).filter((name) => name.endsWith('.jsonl'))) {
    const lines = readFileSync(join(TRACES, file), 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const stats = record.stats ?? {};
      const text = [record.prose, record.input].filter(Boolean).join('\n\n');
      insert.run(
        record.ts ?? '',
        record.id ?? '',
        Number(record.turn ?? 0),
        'turn',
        record.model ?? '',
        Number(stats.tokensIn ?? 0),
        Number(stats.tokensOut ?? 0),
        Number(stats.cost ?? 0),
        text,
      );
      fts.run(record.id ?? '', String(record.turn ?? 0), 'turn', text);
      count += 1;
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
const size = statSync(DB_PATH).size;
db.close();
console.log({ traces: count, ms: Math.round(performance.now() - started), dbKB: Math.round(size / 1024), db: DB_PATH });
