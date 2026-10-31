/**
 * Сборка машинного каталога из исходников.
 *
 *   data/source/tone-tags.csv      → группы тегов тона
 *                                    (CSV-блок + свободные списки в конце файла)
 *   data/source/world-presets.txt  → пресеты миров
 *   → data/catalog.json
 *
 * Запуск: node scripts/build-catalog.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeToneGroups } from './normalize-tags.mjs';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'data', 'source');

/** Минимальный CSV: кавычки, удвоенные кавычки внутри, запятые в кавычках. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const FIELD_TYPES = new Set(['Чекбокс', 'Выпадающий список', 'Текст', 'Ползунок', 'Число']);

function buildToneGroups(rows) {
  const [, ...data] = rows;
  const groups = new Map();

  for (const r of data) {
    if (!r || r.length !== 6) continue;
    const [id, group, subgroup, name, description, type] = r.map((v) => (v ?? '').trim());
    if (!/^\d+$/.test(id)) continue;
    if (!FIELD_TYPES.has(type)) continue;
    if (!group || !name) continue;

    if (!groups.has(group)) groups.set(group, new Map());
    const subs = groups.get(group);
    if (!subs.has(subgroup)) subs.set(subgroup, []);
    subs.get(subgroup).push({ id: Number(id), name, description, type });
  }

  return [...groups.entries()].map(([group, subs]) => ({
    group,
    subgroups: [...subs.entries()].map(([subgroup, fields]) => ({ subgroup, fields })),
  }));
}

/**
 * Делит исходник на CSV-блок и свободную часть.
 *
 * CSV-блок: строка заголовка «ID,…» и идущие сразу за ней строки, которые
 * начинаются с числового ID. Всё после первой такой не-CSV строки — свободная
 * часть. Граница определяется по содержимому, а не по фиксированному номеру.
 */
function splitToneSource(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => /^ID\s*,/.test(line));
  const start = header === -1 ? 0 : header;

  let end = start + 1;
  while (end < lines.length && /^\d+\s*,/.test(lines[end])) end += 1;

  return {
    csv: lines.slice(start, end).join('\n'),
    free: lines.slice(end),
  };
}

/** «тег1, тег2, …» → ['тег1', 'тег2', …]. Хвостовая точка — пунктуация списка. */
function parseTagList(text) {
  const tags = [];
  const seen = new Set();

  for (const raw of text.split(',')) {
    const name = raw.replace(/\s+/g, ' ').trim().replace(/\.+$/, '').trim();
    if (!name) continue;
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }

  return tags;
}

const FREE_GENRE_GROUP = 'Жанры (доп.)';

/**
 * Свободная часть файла:
 *
 *   Категория<TAB>тег1, тег2, …
 *
 * а также необязательный список жанров без заголовка (строка без табуляции).
 * Каждая категория превращается в группу с одной подгруппой; id продолжает
 * нумерацию CSV. Повторы внутри группы отбрасываются.
 */
function buildAdditionalGroups(lines, startId) {
  const groups = new Map();
  let nextId = startId;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const tab = line.indexOf('\t');
    let group;
    let tagsText;

    if (tab === -1) {
      // Свободный список жанров без названия категории.
      if (!line.includes(',')) continue;
      group = FREE_GENRE_GROUP;
      tagsText = line;
    } else {
      group = line.slice(0, tab).trim();
      tagsText = line.slice(tab + 1);
    }
    if (!group) continue;

    const tags = parseTagList(tagsText);
    if (tags.length === 0) continue;

    if (!groups.has(group)) {
      groups.set(group, { subgroup: group, fields: [], seen: new Set() });
    }
    const entry = groups.get(group);
    for (const name of tags) {
      const key = name.normalize('NFC').toLowerCase();
      if (entry.seen.has(key)) continue;
      entry.seen.add(key);
      entry.fields.push({ id: nextId, name, description: '', type: 'Чекбокс' });
      nextId += 1;
    }
  }

  return [...groups.values()].map(({ subgroup, fields }) => ({
    group: subgroup,
    subgroups: [{ subgroup, fields }],
  }));
}

/** Добавляет группы из свободной части, не создавая дублей по названию группы. */
function mergeToneGroups(groups, additions) {
  const byName = new Map(groups.map((group) => [group.group, group]));

  for (const addition of additions) {
    const target = byName.get(addition.group);
    if (!target) {
      groups.push(addition);
      byName.set(addition.group, addition);
      continue;
    }

    const seen = new Set(
      target.subgroups.flatMap((sg) => sg.fields.map((f) => f.name.normalize('NFC').toLowerCase())),
    );
    for (const sg of addition.subgroups) {
      sg.fields = sg.fields.filter((f) => {
        const key = f.name.normalize('NFC').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (sg.fields.length === 0) continue;
      const same = target.subgroups.find((s) => s.subgroup === sg.subgroup);
      if (same) same.fields.push(...sg.fields);
      else target.subgroups.push(sg);
    }
  }

  return groups;
}

function buildPresets(text) {
  const lines = text.split(/\r?\n/);
  const presets = [];

  // Первый блок — пример «Спасатели» с полями без markdown-заголовка.
  const head = lines.slice(0, 30).join('\n');
  const headTitle = /МЫ СОЗДАЁМ МИР «(.+?)»/.exec(head);
  if (headTitle) {
    const genre = /Жанр:\s*(.+)/.exec(head);
    const source = /Исходное описание:\s*\n([\s\S]*?)\n\s*\n/.exec(head);
    const atmosphere = /Атмосфера:\s*(.+)/.exec(head);
    const action = /Что делать:\s*(.+)/.exec(head);
    presets.push({
      id: '0.0',
      title: headTitle[1],
      genre: genre ? genre[1].trim() : '',
      description: source ? source[1].replace(/\s+/g, ' ').trim() : '',
      atmosphere: atmosphere ? atmosphere[1].trim() : '',
      action: action ? action[1].trim() : '',
    });
  }

  let current = null;
  const flush = () => {
    if (current) presets.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    const header = /^###\s+([\d.]+)\s+«(.+?)»\s*(?:\((.+?)\))?\s*$/.exec(line);
    if (header) {
      flush();
      current = {
        // «2.3.» → «2.3»: точка в конце — часть заголовка, а не номера
        id: header[1].replace(/\.$/, ''),
        title: header[2],
        genre: header[3] ?? '',
        description: '',
        atmosphere: '',
        action: '',
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith('- **Атмосфера:**')) {
      current.atmosphere = line.replace('- **Атмосфера:**', '').trim();
    } else if (line.startsWith('- **Что делать:**')) {
      current.action = line.replace('- **Что делать:**', '').trim();
    }
  }
  flush();

  return presets;
}

const tagsText = await readFile(join(SRC, 'tone-tags.csv'), 'utf8');

const toneSource = splitToneSource(tagsText);
const toneGroups = buildToneGroups(parseCsv(toneSource.csv));

let lastCsvId = 0;
for (const g of toneGroups) {
  for (const sg of g.subgroups) {
    for (const f of sg.fields) lastCsvId = Math.max(lastCsvId, f.id);
  }
}

const additionalGroups = buildAdditionalGroups(toneSource.free, lastCsvId + 1);
mergeToneGroups(toneGroups, additionalGroups);

// Предустановленных миров больше нет: мир задаётся описанием игрока.
const presets = [];

// Служебные группы — это настройки генерации, а не теги для выбора.
const HIDDEN_GROUPS = new Set(['Тон (М.2)', 'РПГ (М.3)']);
for (let i = toneGroups.length - 1; i >= 0; i -= 1) {
  if (HIDDEN_GROUPS.has(toneGroups[i].group)) toneGroups.splice(i, 1);
}

// Дедупликация, слияние групп и разбивка на подкатегории.
const normalized = normalizeToneGroups(toneGroups);

// Механика без повествовательной нагрузки: профессии, предметы, системы,
// места, общие ценности, конфликты и схемы сюжета. Убрано по требованию.
const REMOVED_SUBGROUPS = new Set([
  'Профессии и группы',
  'Снаряжение',
  'Игры и системы',
  'Места',
  'Чувства и ценности',
  'Конфликты',
  'Сюжетные схемы',
  'Объекты и места',
  'Природа',
  'Политика и происшествия',
  'События',
  'Общество',
  'Культура',
  'Искусство и досуг',
  'ГГ: место и мир',
  'ГГ: предметы',
  'ГГ: типаж',
  'Снаряжение и предметы',
  'Тропы',
  'Силы и явления',
  'Структура',
  'Романтика',
  'Семья',
  'Связи',
  'Романтические тропы',
  'Силы и системы',
  'Существа и миры',
  'Люди и роли',
  'Культурные',
  'ГГ: сила',
  'ГГ: чувства и идеи',
  'ГГ: положение',
  'ГГ: класс',
  'Архетипы',
  'Типажи',
  'ГГ: тип и роль',
  'ГГ: раса',
  'Эпохи',
  'Технологии',
  'Эпохи и места',
  'Формат и визуал',
  'Тип контента',
  'Визуал',
  'Атмосфера',
  'Фетиши и табу',
  'Прочее',
  'Космос',
  'Системы и поджанры',
]);

let removedSubgroups = 0;
let removedFields = 0;
const removedTagNames = [];
for (const group of normalized) {
  group.subgroups = group.subgroups.filter((sg) => {
    if (!REMOVED_SUBGROUPS.has(sg.subgroup)) return true;
    removedSubgroups += 1;
    removedFields += sg.fields.length;
    for (const field of sg.fields) removedTagNames.push(field.name);
    return false;
  });
}
console.log(`подгрупп убрано: ${removedSubgroups}, тегов вместе с ними: ${removedFields}`);

// «Торговля людьми» переезжает в «Тёмное»; пустые подгруппы убираем.
for (const group of normalized) {
  group.subgroups = group.subgroups.filter((sg) => {
    sg.fields = sg.fields.filter((field) => field.name.toLowerCase() !== 'торговля людьми');
    return sg.fields.length > 0;
  });
}

// Подсказки: короткие описания «что значит и что даёт» из отдельного файла.
try {
  const hints = JSON.parse(await readFile(join(ROOT, 'data', 'tag-descriptions.json'), 'utf8'));
  let applied = 0;
  for (const group of normalized) {
    for (const sg of group.subgroups) {
      for (const field of sg.fields) {
        const key = `${group.group}: ${field.name}`.toLowerCase();
        const hint = hints[key];
        if (typeof hint === 'string' && hint.trim()) {
          field.description = hint.trim();
          applied += 1;
        }
      }
    }
  }
  console.log(`подсказок тегов: ${applied}`);
} catch {
  console.warn('подсказки тегов не найдены — подсказки будут короткими');
}


// Единый стиль названий: с заглавной буквы, без хвостовой точки.
const titled = (value) => {
  const text = String(value).trim().replace(/[.!?…]+$/u, '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
};

let maxId = 0;
const allKeys = new Set();
for (const group of normalized) {
  for (const sg of group.subgroups) {
    for (const field of sg.fields) {
      field.name = titled(field.name);
      maxId = Math.max(maxId, Number(field.id) || 0);
      allKeys.add(field.name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim());
    }
  }
}


// Дополнительные теги: литературные направления, эпохи, архетипы, схемы.
try {
  const extra = JSON.parse(await readFile(join(ROOT, 'data', 'extra-tags.json'), 'utf8'));
  let added = 0;
  let skipped = 0;
  for (const item of extra) {
    if (REMOVED_SUBGROUPS.has(item.subgroup)) continue;
    const name = titled(item.name);
    const key = name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
    if (allKeys.has(key)) {
      skipped += 1;
      continue;
    }
    // До переименования группа ещё называется «Жанры» — не плодим вторую.
    let group =
      normalized.find((g) => g.group === item.group) ??
      (item.group === 'Жанры и стиль' ? normalized.find((g) => g.group === 'Жанры') : undefined);
    if (!group) {
      group = { group: item.group, subgroups: [] };
      normalized.push(group);
    }
    let sg = group.subgroups.find((s) => s.subgroup === item.subgroup);
    if (!sg) {
      sg = { subgroup: item.subgroup, fields: [] };
      group.subgroups.push(sg);
    }
    allKeys.add(key);
    maxId += 1;
    sg.fields.push({ id: maxId, name, description: item.description, type: 'Чекбокс' });
    added += 1;
  }
  await writeFile(join(ROOT, 'data', 'removed-tags.json'), `${JSON.stringify({ names: removedTagNames }, null, 2)}` + String.fromCharCode(10), 'utf8');
  console.log(`дополнительных тегов: ${added} (дублей пропущено: ${skipped})`);
} catch {
  console.warn('data/extra-tags.json не найден — дополнительные теги не добавлены');
}

// Формат и визуал вливаются в «Жанры»: одна группа вместо двух.
{
  const target = normalized.find((group) => group.group === 'Жанры');
  if (target) {
    const formatGroups = normalized.filter((group) => group.group === 'Формат');
    for (const group of formatGroups) {
      for (const sg of group.subgroups) {
        const name = sg.subgroup === 'Формы повествования' ? 'Формы повествования' : 'Формат и визуал';
        let tsg = target.subgroups.find((s) => s.subgroup === name);
        if (!tsg) {
          tsg = { subgroup: name, fields: [] };
          target.subgroups.push(tsg);
        }
        const seen = new Set(tsg.fields.map((f) => f.name.toLowerCase()));
        for (const field of sg.fields) {
          const key = field.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          tsg.fields.push(field);
        }
      }
      normalized.splice(normalized.indexOf(group), 1);
    }
  }
}

// Итоговое имя объединённой группы.
const genres = normalized.find((group) => group.group === 'Жанры');
if (genres) genres.group = 'Жанры и стиль';

// «Миры» переезжают из сеттинга в жанры: это выбор жанра, а не атмосферы.
{
  const genres = normalized.find((group) => group.group === 'Жанры и стиль');
  const setting = normalized.find((group) => group.group === 'Сеттинг и атмосфера');
  if (genres && setting) {
    const worlds = setting.subgroups.find((sg) => sg.subgroup === 'Миры');
    if (worlds) {
      setting.subgroups = setting.subgroups.filter((sg) => sg !== worlds);
      const same = genres.subgroups.find((sg) => sg.subgroup === worlds.subgroup);
      if (same) same.fields.push(...worlds.fields);
      else genres.subgroups.push(worlds);
    }
  }
}

// Эпохи убраны: время задаётся бегунком, а не тегами.
for (const group of normalized) {
  const epochs = group.subgroups.filter((sg) => sg.subgroup === 'Исторические эпохи');
  for (const sg of epochs) {
    for (const field of sg.fields) removedTagNames.push(field.name);
  }
  group.subgroups = group.subgroups.filter((sg) => sg.subgroup !== 'Исторические эпохи');
}

// «Жанры и стиль» — авторский каталог из data/genre-catalog.json.
try {
  const raw = JSON.parse(await readFile(join(ROOT, 'data', 'genre-catalog.json'), 'utf8'));
  let nextId = maxId + 1;
  const customGroup = {
    group: raw.group,
    subgroups: raw.subgroups.map((sg) => ({
      subgroup: sg.subgroup,
      fields: sg.fields.map(([name, description]) => ({
        id: nextId++,
        name,
        description,
        type: 'Чекбокс',
      })),
    })),
  };
  const at = normalized.findIndex((group) => group.group === raw.group);
  if (at >= 0) {
    for (const sg of normalized[at].subgroups) {
      for (const field of sg.fields) removedTagNames.push(field.name);
    }
    normalized[at] = customGroup;
  }
  else normalized.push(customGroup);
  await writeFile(
    join(ROOT, 'data', 'removed-tags.json'),
    `${JSON.stringify({ names: removedTagNames }, null, 2)}\n`,
    'utf8',
  );
  const count = customGroup.subgroups.reduce((sum, sg) => sum + sg.fields.length, 0);
  console.log(`жанровый каталог: ${count} тегов, ${customGroup.subgroups.length} подгрупп`);
} catch (err) {
  console.warn('data/genre-catalog.json не прочитан:', err.message);
}

// «Контент 18+» — авторский каталог из data/content-catalog.json.
try {
  const raw = JSON.parse(await readFile(join(ROOT, 'data', 'content-catalog.json'), 'utf8'));
  let nextId = maxId + 2000;
  const customGroup = {
    group: raw.group,
    subgroups: raw.subgroups.map((sg) => ({
      subgroup: sg.subgroup,
      fields: sg.fields.map(([name, description]) => ({
        id: nextId++,
        name,
        description,
        type: 'Чекбокс',
      })),
    })),
  };
  const at = normalized.findIndex((group) => group.group === raw.group);
  if (at >= 0) {
    for (const sg of normalized[at].subgroups) {
      for (const field of sg.fields) removedTagNames.push(field.name);
    }
    normalized[at] = customGroup;
  } else normalized.push(customGroup);
  await writeFile(
    join(ROOT, 'data', 'removed-tags.json'),
    `${JSON.stringify({ names: removedTagNames }, null, 2)}\n`,
    'utf8',
  );
  const count = customGroup.subgroups.reduce((sum, sg) => sum + sg.fields.length, 0);
  console.log(`контентный каталог: ${count} тегов, ${customGroup.subgroups.length} подгрупп`);
} catch (err) {
  console.warn('data/content-catalog.json не прочитан:', err.message);
}

// «Тип повествования» — отдельный блок из data/narrative-catalog.json.
try {
  const raw = JSON.parse(await readFile(join(ROOT, 'data', 'narrative-catalog.json'), 'utf8'));
  let nextId = maxId + 4000;
  const customGroup = {
    group: raw.group,
    subgroups: raw.subgroups.map((sg) => ({
      subgroup: sg.subgroup,
      fields: sg.fields.map(([name, description]) => ({
        id: nextId++,
        name,
        description,
        type: 'Чекбокс',
      })),
    })),
  };
  const existingAt = normalized.findIndex((group) => group.group === raw.group);
  if (existingAt >= 0) normalized[existingAt] = customGroup;
  else normalized.push(customGroup);
  const count = customGroup.subgroups.reduce((sum, sg) => sum + sg.fields.length, 0);
  console.log(`тип повествования: ${count} тегов, ${customGroup.subgroups.length} подгрупп`);
} catch (err) {
  console.warn('data/narrative-catalog.json не прочитан:', err.message);
}

// Пустые группы после чистки не оставляем.
for (let i = normalized.length - 1; i >= 0; i -= 1) {
  if (normalized[i].subgroups.length === 0) normalized.splice(i, 1);
}

const catalog = {
  builtAt: new Date().toISOString(),
  tone: { groups: normalized },
  worlds: { presets },
};
await writeFile(join(ROOT, 'data', 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

const fields = normalized.reduce((sum, g) => sum + g.subgroups.reduce((s, sg) => s + sg.fields.length, 0), 0);
console.log(`групп тона: ${normalized.length}, полей: ${fields}`);
for (const g of normalized) {
  const n = g.subgroups.reduce((s, sg) => s + sg.fields.length, 0);
  console.log(`  ${g.group}: ${n}`);
}
console.log(`пресетов мира: ${presets.length}`);
console.log(presets.slice(0, 3).map((p) => `  ${p.id} ${p.title} (${p.genre})`).join('\n'));
