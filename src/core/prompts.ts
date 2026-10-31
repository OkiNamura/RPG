/**
 * Четыре блока контекста:
 *
 *   1. ЯДРО   — неизменяемое, одно на все игры        (data/source/core.md)
 *   2. ТОН    — генерируется по тегам при старте      (data/source/tone-prompt.md)
 *   3. МИР    — генерируется по пресету               (data/source/world-prompt.md)
 *   4. ГЕРОЙ  — собирается из формы                   (этот файл)
 *
 * Ядро хранится один раз и подставляется в каждую кампанию при загрузке:
 * кампании не таскают 193 КБ текста в своём JSON.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', '..', 'data', 'source');


const cache = new Map<string, string>();

async function load(name: string): Promise<string> {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const text = await readFile(join(SRC, name), 'utf8');
  cache.set(name, text);
  return text;
}

export const loadCore = (): Promise<string> => load('core.md');

export const loadHeroPrompt = (): Promise<string> => load('hero-prompt.md');

/** Записать шаблон в data/source и обновить кэш. */
export async function saveSource(name: string, text: string): Promise<void> {
  const path = join(SRC, name);
  // Браузер отдаёт textarea с LF, файл может быть с CRLF. Если смысл не
  // изменился — не перезаписываем файл и не трогаем переводы строк.
  try {
    const current = await readFile(path, 'utf8');
    const flat = (value: string) => value.replace(/\r\n/g, '\n');
    if (flat(current) === flat(text)) {
      cache.set(name, current);
      return;
    }
  } catch {
    /* файла ещё нет — просто запишем */
  }
  await writeFile(path, text, 'utf8');
  cache.set(name, text);
}

/** Сохранить ядро и обновить кэш, чтобы правки подхватились сразу. */
export async function saveCore(text: string): Promise<void> {
  await writeFile(join(SRC, 'core.md'), text, 'utf8');
  cache.set('core.md', text);
}
export const loadTonePrompt = (): Promise<string> => load('tone-prompt.md');
export const loadWorldPrompt = (): Promise<string> => load('world-prompt.md');

export interface ToneSelection {
  group: string;
  field: string;
  value: string;
}

/** Вход для генератора тона: только выбранные теги, без пустых. */
export function toneUserPrompt(selections: ToneSelection[]): string {
  // Теги рисования — не про тон истории, их в этот промт не берём.
  const story = selections.filter((s) => !/^Рисование$/i.test(String(s.group ?? '').trim()));
  const include = story.filter((s) => s.value && s.value.trim() && !/^исключ/i.test(s.value));
  const exclude = story.filter((s) => /^исключ/i.test(s.value ?? ''));

  if (include.length === 0 && exclude.length === 0) {
    return 'Вход: теги не заданы. Собери тон по умолчанию — мрачное тёмное фэнтези, средняя жёсткость.';
  }

  const lines: string[] = [];
  if (include.length) {
    lines.push('Включить:', ...include.map((s) => `- ${s.group} / ${s.field}: ${s.value.trim()}`));
  }
  if (exclude.length) {
    lines.push('', 'Не включать ни при каких условиях:', ...exclude.map((s) => `- ${s.group} / ${s.field}`));
  }

  return [
    'Вход — теги, выбранные игроком при создании истории:',
    '',
    ...lines,
    '',
    'Разверни их в Модуль 2. ТОН строго по структуре из системного промта.',
    'Не задавай вопросов, только утверждения.',
  ].join('\n');
}

export interface WorldPreset {
  id: string;
  title: string;
  genre: string;
  description: string;
  atmosphere: string;
  action: string;
}

/** Вход для генератора мира: пресет из каталога. */
export function worldUserPrompt(preset: WorldPreset): string {
  return [
    'Вход:',
    '',
    `1. Тип мира: ${preset.genre || 'приключенческий'}.`,
    `2. Идея мира: ${preset.title}.`,
    '3. Свободное описание:',
    preset.description || '(не задано)',
    '',
    `Атмосфера: ${preset.atmosphere || '(не задано)'}`,
    `Что делать: ${preset.action || '(не задано)'}`,
    '',
    'Разверни это в Модуль 1. МИР строго по структуре из системного промта.',
    'Не задавай вопросов, только утверждения.',
  ].join('\n');
}

export interface HeroForm {
  name: string;
  gender: string;
  essence: string;
  appearance: string;
  bodyAttitude: string;
  origin: string;
  quirks: string;
  abilities: string;
  start: string;
}

export const EMPTY_HERO: HeroForm = {
  name: '',
  gender: 'мужчина',
  essence: '',
  appearance: '',
  bodyAttitude: '',
  origin: '',
  quirks: '',
  abilities: '',
  start: '',
};

/** Четвёртый блок: герой из формы. Пустые поля не выдумываем — оставляем пусто. */
export function heroBlock(hero: HeroForm): string {
  const rows: [string, string][] = [
    ['Имя', hero.name],
    ['Пол', hero.gender],
    ['Суть', hero.essence],
    ['Внешность и тело', hero.appearance],
    ['Отношение к телу', hero.bodyAttitude],
    ['Прошлое', hero.origin],
    ['Привычки и особенности', hero.quirks],
    ['Способности', hero.abilities],
    ['Начало истории', hero.start],
  ];

  const filled = rows.filter(([, value]) => value && value.trim());
  if (filled.length === 0) return '';

  const body = filled.map(([key, value]) => `- **${key}:** ${value.trim()}`).join('\n');
  return `# ГЕРОЙ\n${body}`;
}
