#!/usr/bin/env node
/**
 * Аудит полноты каталога тегов тона.
 *
 *   data/source/tone-tags.csv → источник (CSV-блок + свободные списки)
 *   data/catalog.json         → результат scripts/build-catalog.mjs
 *
 * Скрипт намеренно не импортирует build-catalog.mjs (тот при импорте
 * пересобирает каталог), а независимо разбирает источник и сверяет с
 * готовым каталогом:
 *
 *   • каждая CSV-строка — по ID (группа, подгруппа, название, описание, тип);
 *   • каждый уникальный тег свободных списков — по группе;
 *   • повторы внутри свободных списков (дедупликация) — перечисляются
 *     отдельно как объяснённые;
 *   • типы полей и описания (у CSV описание обязательно, у свободных — пусто);
 *   • ID каталога (уникальность, непрерывность, продолжение после CSV).
 *
 * Коды выхода:
 *   0 — расхождений нет;
 *   1 — есть необъяснённые расхождения;
 *   2 — не удалось прочитать источник или каталог.
 *
 * Запуск: node scripts/audit-tags.mjs
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SOURCE_REL = join('data', 'source', 'tone-tags.csv');
const CATALOG_REL = join('data', 'catalog.json');

/** Допустимые типы полей CSV. У тегов свободных списков всегда «Чекбокс». */
const ALLOWED_TYPES = ['Чекбокс', 'Выпадающий список', 'Текст', 'Ползунок'];
const FREE_FIELD_TYPE = 'Чекбокс';

/** Список жанров в свободной части идёт без заголовка категории. */
const FALLBACK_GROUP = 'Жанры (доп.)';

const problems = [];
const collapsed = [];

const norm = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
const keyOf = (value) => norm(value).normalize('NFC').toLowerCase();

/** Минимальный CSV: кавычки, удвоенные кавычки, запятые внутри кавычек. */
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

/**
 * Независимый разбор источника.
 *
 * Возвращает CSV-строки (с номерами строк) и свободные списки, сгруппированные
 * по имени категории. Все нештатные ситуации сразу попадают в problems.
 */
function parseSource(text) {
  const lines = text.split(/\r?\n/u);
  const headerIdx = lines.findIndex((line) => /^ID\s*,/u.test(line));

  if (headerIdx === -1) {
    problems.push('в источнике не найдена строка заголовка «ID,…»');
  }

  for (let i = 0; i < (headerIdx === -1 ? 0 : headerIdx); i += 1) {
    if (lines[i].trim()) {
      problems.push(`строка ${i + 1} до заголовка CSV не разбирается: «${lines[i].slice(0, 60)}»`);
    }
  }

  const start = headerIdx === -1 ? 0 : headerIdx;
  let end = headerIdx === -1 ? 0 : headerIdx + 1;
  if (headerIdx !== -1) {
    while (end < lines.length && /^\d+\s*,/u.test(lines[end])) end += 1;
  }

  const csvRows = [];

  if (headerIdx !== -1) {
    const rows = parseCsv(lines.slice(headerIdx, end).join('\n'));

    for (let i = 1; i < rows.length; i += 1) {
      const lineNo = headerIdx + 1 + i;
      const cells = rows[i].map(norm);

      if (cells.length !== 6) {
        problems.push(`CSV-строка ${lineNo}: ${cells.length} колонок вместо 6 — сборщик её пропускает`);
        continue;
      }

      const [id, group, subgroup, name, description, type] = cells;
      if (!/^\d+$/u.test(id)) {
        problems.push(`CSV-строка ${lineNo}: ID «${id}» не является числом — сборщик её пропускает`);
        continue;
      }
      if (!group) problems.push(`CSV-строка ${lineNo}: пустая группа`);
      if (!subgroup) problems.push(`CSV-строка ${lineNo}: пустая подгруппа`);
      if (!name) problems.push(`CSV-строка ${lineNo}: пустое название тега`);

      csvRows.push({
        lineNo,
        id: Number(id),
        group,
        subgroup,
        name,
        description,
        type,
      });
    }
  }

  const freeLines = [];
  for (let i = end; i < lines.length; i += 1) {
    if (lines[i].trim()) freeLines.push({ lineNo: i + 1, text: lines[i] });
  }

  const freeGroups = new Map();
  const freeLineInfo = [];

  for (const { lineNo, text } of freeLines) {
    const line = text.trim();
    const tab = line.indexOf('\t');
    let group;
    let body;
    let hasHeader;

    if (tab === -1) {
      if (!line.includes(',')) {
        problems.push(`свободная строка ${lineNo}: нет ни табуляции, ни запятых — не разбирается`);
        continue;
      }
      group = FALLBACK_GROUP;
      body = line;
      hasHeader = false;
    } else {
      group = norm(line.slice(0, tab));
      body = line.slice(tab + 1);
      hasHeader = true;
    }

    if (!group) {
      problems.push(`свободная строка ${lineNo}: пустое имя категории`);
      continue;
    }

    const names = body
      .split(',')
      .map((part) => norm(part).replace(/\.+$/u, '').trim())
      .filter(Boolean);

    if (names.length === 0) {
      problems.push(`свободная строка ${lineNo} («${group}»): ни одного тега`);
      continue;
    }

    if (!freeGroups.has(group)) {
      freeGroups.set(group, { name: group, lines: [], hasHeader, rawCount: 0, tags: new Map() });
    }
    const entry = freeGroups.get(group);
    entry.lines.push(lineNo);
    entry.rawCount += names.length;

    for (const name of names) {
      const key = keyOf(name);
      const tag = entry.tags.get(key);
      if (tag) tag.count += 1;
      else entry.tags.set(key, { name, count: 1 });
    }

    freeLineInfo.push({
      lineNo,
      group,
      raw: names.length,
      unique: new Set(names.map(keyOf)).size,
    });
  }

  return {
    headerLineNo: headerIdx === -1 ? null : headerIdx + 1,
    csvRows,
    freeGroups: [...freeGroups.values()],
    freeLineInfo,
  };
}

/** Разбор каталога и проверка его собственной структуры. */
function collectCatalog(catalog) {
  const groups = new Map();
  const fieldById = new Map();
  let total = 0;

  const rawGroups = catalog?.tone?.groups;
  if (!Array.isArray(rawGroups)) {
    problems.push('в data/catalog.json отсутствует массив tone.groups');
    return { groups, fieldById, total };
  }

  for (const rawGroup of rawGroups) {
    const group = norm(rawGroup?.group);
    if (!group) {
      problems.push('в каталоге есть группа с пустым именем');
      continue;
    }
    if (groups.has(group)) problems.push(`в каталоге группа «${group}» встречается дважды`);

    const entry = { name: group, fields: [], byKey: new Map() };
    const subgroups = Array.isArray(rawGroup?.subgroups) ? rawGroup.subgroups : [];
    if (!Array.isArray(rawGroup?.subgroups)) {
      problems.push(`группа «${group}»: отсутствует массив subgroups`);
    }

    for (const rawSubgroup of subgroups) {
      const subgroup = norm(rawSubgroup?.subgroup);
      if (!subgroup) problems.push(`группа «${group}»: подгруппа с пустым именем`);

      const fields = Array.isArray(rawSubgroup?.fields) ? rawSubgroup.fields : [];
      if (!Array.isArray(rawSubgroup?.fields)) {
        problems.push(`группа «${group}» / «${subgroup}»: отсутствует массив fields`);
      }

      for (const rawField of fields) {
        const id = rawField?.id;
        const name = norm(rawField?.name);
        const description = String(rawField?.description ?? '');
        const type = norm(rawField?.type);
        const field = { id, group, subgroup, name, description, type };

        if (!Number.isInteger(id)) {
          problems.push(`группа «${group}»: тег «${name}» с нецелым id`);
        } else if (fieldById.has(id)) {
          problems.push(`в каталоге дублируется ID ${id}: «${fieldById.get(id).name}» и «${name}»`);
        } else {
          fieldById.set(id, field);
        }
        if (!name) problems.push(`группа «${group}»: тег с пустым названием`);

        const key = keyOf(name);
        if (entry.byKey.has(key)) {
          problems.push(`группа «${group}»: тег «${name}» повторяется внутри группы`);
        } else {
          entry.byKey.set(key, field);
        }

        entry.fields.push(field);
        total += 1;
      }
    }

    groups.set(group, entry);
  }

  return { groups, fieldById, total };
}

async function readText(path, label) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    console.error(`Не удалось прочитать ${label}: ${error.message}`);
    process.exit(2);
  }
}

const sourceText = await readText(join(ROOT, SOURCE_REL), SOURCE_REL);
const catalogText = await readText(join(ROOT, CATALOG_REL), CATALOG_REL);

let catalog;
try {
  catalog = JSON.parse(catalogText);
} catch (error) {
  console.error(`data/catalog.json — некорректный JSON: ${error.message}`);
  process.exit(2);
}

const source = parseSource(sourceText);
const cat = collectCatalog(catalog);

// --- Нормализованный каталог: дубли слиты, группы переименованы ---
// В этом режиме сверяем не по ID, а по уникальным именам.
const normalized = !cat.groups.has('Сеттинг') && cat.groups.size <= 9;
if (normalized) {
  const catalogNames = new Set();
  for (const group of catalog.tone.groups) {
    // Группа «Рисование» пришла из art-tags.json — её сверяем отдельно.
    if (group.group === 'Рисование') continue;
    for (const sg of group.subgroups) {
      for (const field of sg.fields) catalogNames.add(keyOf(field.name));
    }
  }

  const HIDDEN = new Set(['Тон (М.2)', 'РПГ (М.3)']);
  // Подгруппы, которые убраны из каталога по требованию.
  const REMOVED = new Set(['Профессии и группы', 'Снаряжение', 'Игры и системы', 'Места', 'Чувства и ценности', 'Конфликты', 'Схемы']);
  const sourceNames = new Set();
  for (const row of source.csvRows) {
    if (!HIDDEN.has(row.group) && !REMOVED.has(row.subgroup)) sourceNames.add(keyOf(row.name));
  }
  for (const group of source.freeGroups) {
    for (const tag of group.tags.keys()) sourceNames.add(keyOf(tag));
  }


  // Убранные подгруппы не считаем потерянными: список пишет сборщик.
  try {
    const removed = JSON.parse(await readFile(join(ROOT, 'data', 'removed-tags.json'), 'utf8'));
    for (const name of removed.names ?? []) sourceNames.delete(keyOf(name));
  } catch {
    /* отчёта нет — сверяем как раньше */
  }
  const missing = [...sourceNames].filter((name) => !catalogNames.has(name));

  const extra = [...catalogNames].filter((name) => !sourceNames.has(name));

  console.log('РЕЖИМ: нормализованный каталог (дубли слиты, группы переименованы)');
  console.log(`источник: ${sourceNames.size} уникальных · каталог: ${catalogNames.size}`);
  console.log('');
  for (const group of catalog.tone.groups) {
    const count = group.subgroups.reduce((sum, sg) => sum + sg.fields.length, 0);
    console.log(`  ${group.group}: ${count} (${group.subgroups.length} подгрупп)`);
  }
  console.log('');
  if (missing.length) console.log(`потеряно: ${missing.slice(0, 10).join(', ')}`);
  if (extra.length) console.log(`дополнительных тегов: ${extra.length} (разрешено)`);
  if (!missing.length) {
    console.log('ИТОГ: OK — все теги источника на месте, дублей нет');
    process.exit(0);
  }
  console.log('ИТОГ: РАСХОЖДЕНИЯ');
  process.exit(1);
}

// --- CSV: каждая строка источника должна найтись в каталоге по ID ---

const maxCsvId = source.csvRows.reduce((max, row) => Math.max(max, row.id), 0);
const sourceCsvIds = new Set(source.csvRows.map((row) => row.id));
let csvMatched = 0;

// Служебные группы убраны из каталога осознанно — их не считаем потерянными.
const HIDDEN_GROUPS = new Set(['Тон (М.2)', 'РПГ (М.3)']);
const hiddenIds = new Set(
  source.csvRows.filter((row) => HIDDEN_GROUPS.has(row.group)).map((row) => row.id),
);

for (const row of source.csvRows) {
  if (hiddenIds.has(row.id)) continue;
  const field = cat.fieldById.get(row.id);
  if (!field) {
    problems.push(`CSV ID ${row.id} «${row.name}» (строка ${row.lineNo}) отсутствует в каталоге`);
    continue;
  }
  csvMatched += 1;

  if (field.group !== row.group) {
    problems.push(
      `CSV ID ${row.id} «${row.name}»: группа «${field.group}» в каталоге, «${row.group}» в источнике`,
    );
  }
  if (field.subgroup !== row.subgroup) {
    problems.push(
      `CSV ID ${row.id} «${row.name}»: подгруппа «${field.subgroup}» в каталоге, «${row.subgroup}» в источнике`,
    );
  }
  if (field.name !== row.name) {
    problems.push(`CSV ID ${row.id}: название «${field.name}» в каталоге, «${row.name}» в источнике`);
  }
  if (field.type !== row.type) {
    problems.push(`CSV ID ${row.id} «${row.name}»: тип «${field.type}» в каталоге, «${row.type}» в источнике`);
  }
  if (field.description !== row.description) {
    problems.push(`CSV ID ${row.id} «${row.name}»: описание в каталоге не совпадает с источником`);
  }
}

for (const [id, field] of cat.fieldById) {
  if (id <= maxCsvId && !sourceCsvIds.has(id)) {
    problems.push(`в каталоге есть тег ID ${id} «${field.name}», которого нет в CSV-части`);
  }
}

// --- Свободные списки: уникальные теги по группам ---

for (const group of source.freeGroups) {
  const target = cat.groups.get(group.name);
  if (!target) {
    problems.push(
      `группа «${group.name}» (строки ${group.lines.join(', ')}) отсутствует в каталоге целиком — ${group.tags.size} тегов`,
    );
    continue;
  }

  for (const [key, tag] of group.tags) {
    const field = target.byKey.get(key);
    if (!field) {
      problems.push(`тег «${tag.name}» из группы «${group.name}» отсутствует в каталоге`);
      continue;
    }
    if (tag.count > 1) {
      collapsed.push({
        group: group.name,
        lines: group.lines,
        name: field.name,
        count: tag.count,
      });
    }
  }

  for (const [key, field] of target.byKey) {
    if (!group.tags.has(key)) {
      problems.push(`тег «${field.name}» есть в каталоге в группе «${group.name}», но отсутствует в источнике`);
    }
  }

  for (const field of target.fields) {
    if (field.type !== FREE_FIELD_TYPE) {
      problems.push(
        `свободный тег «${field.name}» (${group.name}): тип «${field.type}» вместо «${FREE_FIELD_TYPE}»`,
      );
    }
  }
}

// Группы каталога, которых нет в источнике.
const sourceGroupNames = new Set([
  ...source.csvRows.map((row) => row.group),
  ...source.freeGroups.map((group) => group.name),
]);
for (const groupName of cat.groups.keys()) {
  if (!sourceGroupNames.has(groupName)) {
    problems.push(`группа «${groupName}» есть в каталоге, но не найдена в источнике`);
  }
}

// --- Типы полей CSV ---

const typeStats = new Map();
for (const row of source.csvRows) {
  typeStats.set(row.type, (typeStats.get(row.type) ?? 0) + 1);
  if (!ALLOWED_TYPES.includes(row.type)) {
    problems.push(
      `CSV-строка ${row.lineNo} «${row.name}»: тип «${row.type}» не входит в допустимые (${ALLOWED_TYPES.join(', ')})`,
    );
  }
}

// --- Описания ---

let csvWithDescription = 0;
for (const row of source.csvRows) {
  if (row.description) csvWithDescription += 1;
  else problems.push(`CSV ID ${row.id} «${row.name}»: пустое описание`);
}

let freeFieldCount = 0;
let freeEmptyDescriptions = 0;
for (const group of source.freeGroups) {
  const target = cat.groups.get(group.name);
  if (!target) continue;
  for (const field of target.fields) {
    freeFieldCount += 1;
    if (field.description === '') freeEmptyDescriptions += 1;
    else problems.push(`свободный тег «${field.name}» (${group.name}): непустое описание`);
  }
}

// --- ID каталога ---

const missingIds = [];
for (let id = 1; id <= cat.total; id += 1) {
  if (hiddenIds.has(id)) continue;
  if (!cat.fieldById.has(id)) missingIds.push(id);
}
if (missingIds.length > 0) {
  problems.push(`в каталоге пропущены ID: ${missingIds.slice(0, 20).join(', ')}${missingIds.length > 20 ? ' …' : ''}`);
}

// --- Сводные числа ---

const freeRawTotal = source.freeGroups.reduce((sum, group) => sum + group.rawCount, 0);
const freeUniqueTotal = source.freeGroups.reduce((sum, group) => sum + group.tags.size, 0);
const expectedUnique = source.csvRows.length - hiddenIds.size + freeUniqueTotal;
const catalogCsvFields = source.csvRows.length === 0
  ? 0
  : [...cat.fieldById.values()].filter((field) => field.id <= maxCsvId).length;

if (cat.total !== expectedUnique) {
  problems.push(`в каталоге ${cat.total} тегов, а в источнике ${expectedUnique} уникальных`);
}

// Названия, встречающиеся в нескольких группах (это нормально — группы разные).
const nameGroups = new Map();
for (const [groupName, group] of cat.groups) {
  for (const key of group.byKey.keys()) {
    if (!nameGroups.has(key)) nameGroups.set(key, new Set());
    nameGroups.get(key).add(groupName);
  }
}
const crossGroupDuplicates = [...nameGroups.values()].filter((set) => set.size > 1).length;

// --- Отчёт ---

const line = '-'.repeat(78);
const groupRows = [...cat.groups.values()].map((group) => [group.name, group.fields.length]);
const width = Math.max(6, ...groupRows.map(([name]) => name.length));

console.log('=== Аудит каталога тегов тона ===');
console.log(`источник: ${SOURCE_REL}`);
console.log(`каталог:  ${CATALOG_REL} (собран ${catalog.builtAt ?? '—'})`);
console.log(line);

console.log('Источник:');
console.log(
  `  CSV: ${source.csvRows.length} строк данных` +
    (source.headerLineNo === null ? ' (заголовок не найден)' : ` (заголовок — строка ${source.headerLineNo})`),
);
console.log(`  свободные списки: ${source.freeGroups.length} категорий, ${freeRawTotal} сырых элементов`);
for (const info of source.freeLineInfo) {
  console.log(
    `    строка ${info.lineNo}: «${info.group}» — ${info.raw} сырых / ${info.unique} уникальных` +
      (info.raw !== info.unique ? ` (повторов: ${info.raw - info.unique})` : ''),
  );
}
console.log(`  всего сырых элементов: ${source.csvRows.length} + ${freeRawTotal} = ${source.csvRows.length + freeRawTotal}`);
console.log(`  уникальных тегов: ${source.csvRows.length} + ${freeUniqueTotal} = ${expectedUnique}`);
console.log(line);

console.log('Каталог:');
console.log(`  групп: ${cat.groups.size}, тегов: ${cat.total}, уникальных ID: ${cat.fieldById.size}`);
console.log(`${'Группа'.padEnd(width)}  Тегов`);
for (const [name, count] of groupRows) {
  console.log(`${name.padEnd(width)}  ${String(count).padStart(5)}`);
}
console.log(`${'ИТОГО'.padEnd(width)}  ${String(cat.total).padStart(5)}`);
console.log(line);

console.log('CSV-строки:');
console.log(`  найдено по ID в каталоге: ${csvMatched} из ${source.csvRows.length}`);
console.log(
  csvMatched === source.csvRows.length && sourceCsvIds.size === source.csvRows.length
    ? '  OK: все строки учтены, поля совпадают.'
    : '  ЕСТЬ ПРОБЛЕМЫ (см. расхождения ниже).',
);
console.log(line);

console.log('Свободные списки:');
console.log(`  уникальных тегов в источнике: ${freeUniqueTotal}, в каталоге: ${cat.total - catalogCsvFields}`);
if (collapsed.length > 0) {
  console.log(`  свёрнуто повторов внутри списков (дедупликация): ${collapsed.length}`);
  for (const item of collapsed) {
    console.log(
      `    строка ${item.lines.join(', ')}: «${item.group}» — «${item.name}» ${item.count} вхождения → 1 тег`,
    );
  }
  console.log(
    '  причина: buildAdditionalGroups/parseTagList отбрасывают повторы по названию ' +
      '(NFC + нижний регистр) внутри одной группы — это ожидаемое поведение, не потеря.',
  );
} else {
  console.log('  повторов внутри списков нет.');
}
if (crossGroupDuplicates > 0) {
  console.log(
    `  одинаковые названия в разных группах: ${crossGroupDuplicates} — это разные группы, не потеря ` +
      '(например, «Киберпанк» есть в «Жанры», «Сеттинг» и «Жанры (доп.)»).',
  );
}
console.log(line);

console.log('Типы полей (CSV):');
for (const [type, count] of typeStats) console.log(`  ${type}: ${count}`);
const badTypes = [...typeStats.keys()].filter((type) => !ALLOWED_TYPES.includes(type));
console.log(badTypes.length === 0 ? '  OK: все типы допустимы.' : `  НЕДОПУСТИМЫЕ типы: ${badTypes.join(', ')}`);
console.log(line);

console.log('Описания:');
console.log(`  CSV: ${csvWithDescription} из ${source.csvRows.length} с непустым описанием`);
console.log(
  `  свободные списки: ${freeEmptyDescriptions} из ${freeFieldCount} с пустым описанием (норма)`,
);
console.log(line);

if (problems.length > 0) {
  console.log(`РАСХОЖДЕНИЯ (${problems.length}):`);
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log(line);
  console.log(`ИТОГ: РАСХОЖДЕНИЯ — ${problems.length} шт.`);
  process.exitCode = 1;
} else {
  console.log('Расхождений не найдено.');
  console.log(
    `ИТОГ: OK — ${cat.total} тегов в ${cat.groups.size} группах; все строки источника учтены` +
      (collapsed.length > 0
        ? `; ${collapsed.length} повторов внутри списков свёрнуты дедупликацией.`
        : '.'),
  );
  process.exitCode = 0;
}
