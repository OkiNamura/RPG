/**
 * Обслуживание SQLite: проверка целостности, бэкапы и восстановление.
 * snapshots.db — критичная база, search/traces можно пересобрать.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export interface IntegrityResult {
  ok: boolean;
  detail: string;
}

export function checkIntegrity(path: string): IntegrityResult {
  if (!existsSync(path)) return { ok: true, detail: 'нет файла' };
  try {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = database.prepare('PRAGMA integrity_check').all() as { integrity_check?: string }[];
      const detail = rows.map((row) => Object.values(row)[0]).join('; ');
      return { ok: detail === 'ok', detail };
    } finally {
      database.close();
    }
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function backupDatabase(path: string, backupDir: string, prefix: string, keep = 7): string | null {
  if (!existsSync(path)) return null;
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `${prefix}-${stamp()}.db`);
  try {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      database.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      database.close();
    }
    const files = readdirSync(backupDir)
      .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.db'))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        unlinkSync(join(backupDir, name));
      } catch {
        /* не критично */
      }
    }
    return target;
  } catch {
    return null;
  }
}

function latestBackup(backupDir: string, prefix: string): string | null {
  if (!existsSync(backupDir)) return null;
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.db'))
    .sort()
    .reverse();
  for (const name of files) {
    const full = join(backupDir, name);
    if (checkIntegrity(full).ok) return full;
  }
  return null;
}

export interface EnsureResult {
  ok: boolean;
  restoredFrom?: string;
  backup?: string;
  detail: string;
}

/**
 * Проверить базу. Если она битая — попробовать восстановить последний бэкап.
 * Битый файл не удаляется, а переименовывается.
 */
export function ensureDatabase(path: string, backupDir: string, prefix: string, keep = 7): EnsureResult {
  if (!existsSync(path)) return { ok: true, detail: 'база ещё не создана' };
  const integrity = checkIntegrity(path);
  if (integrity.ok) {
    return { ok: true, backup: backupDatabase(path, backupDir, prefix, keep) ?? undefined, detail: 'ok' };
  }
  const backup = latestBackup(backupDir, prefix);
  if (!backup) {
    return { ok: false, detail: `integrity: ${integrity.detail}; бэкапа нет` };
  }
  try {
    renameSync(path, `${path}.corrupt-${stamp()}`);
    copyFileSync(backup, path);
    const after = checkIntegrity(path);
    return {
      ok: after.ok,
      restoredFrom: backup,
      detail: after.ok ? 'восстановлено из бэкапа' : after.detail,
    };
  } catch (error) {
    return { ok: false, detail: (error as Error).message };
  }
}

/** Размер базы в байтах; 0, если файла нет. */
export function databaseSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
