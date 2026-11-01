/**
 * Пресеты новой игры: настройки мастера, которые можно переиспользовать.
 * Один пресет — один JSON в data/presets.
 */
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface GamePreset {
  schema: 1;
  id: string;
  name: string;
  [key: string]: unknown;
}

export function nextPresetId(presets: GamePreset[]): string {
  let max = 0;
  for (const preset of presets) {
    const value = Number(preset.id.split('_').at(-1));
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  return `game_${String(max + 1).padStart(9, '0')}`;
}

export async function listPresets(dir: string): Promise<GamePreset[]> {
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith('.json'));
  const presets: GamePreset[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, file), 'utf8')) as GamePreset;
      if (parsed?.id && parsed?.name) presets.push(parsed);
    } catch {
      /* битый файл пропускаем */
    }
  }
  return presets.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

export async function savePreset(dir: string, preset: GamePreset): Promise<GamePreset> {
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const value: GamePreset = {
    ...preset,
    schema: 1,
    name: String(preset.name ?? '').trim().slice(0, 120),
    updatedAt: now,
    createdAt: preset.createdAt ?? now,
  };
  if (!value.name) throw new Error('у пресета нет имени');
  const file = join(dir, `${value.id}.json`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

export async function deletePreset(dir: string, id: string): Promise<boolean> {
  if (!/^game_\d{9}$/.test(id)) return false;
  try {
    await unlink(join(dir, `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
