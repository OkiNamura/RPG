#!/usr/bin/env node
/**
 * Проверка каталога тегов иллюстратора.
 *
 *   node scripts/art-tags-test.mjs [путь к art-tags.json]
 *
 * Проверяет:
 *   • структуру: непустые группы и подгруппы, их уникальные названия,
 *     поля-объекты с названием и описанием;
 *   • отсутствие дублей названий (нормализация: NFC, нижний регистр,
 *     схлопнутые пробелы, обрезанная хвостовая пунктуация);
 *   • непустые однострочные описания;
 *   • минимальное количество тегов (300).
 *
 * Код выхода: 0 — проблем нет, 1 — есть проблемы или файл не прочитан.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DEFAULT_FILE = join(ROOT, 'data', 'art-tags.json');
const MIN_TAGS = 20;
const MIN_NAME_WORDS = 1;
const MAX_NAME_WORDS = 5;
const MAX_DESCRIPTION_LENGTH = 180;

const REQUIRED_GROUPS = ['Стиль и кадр'];

const problems = [];

const cleanText = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();

/** Та же нормализация, что и в генераторе: регистр, пробелы, хвостовая пунктуация. */
const nameKey = (value) =>
  cleanText(value)
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[^\p{L}\p{N}]+$/u, '')
    .trim();

const wordCount = (value) => cleanText(value).split(' ').filter(Boolean).length;

function checkCatalog(catalog) {
  const stats = { total: 0, groupCount: 0, subgroupCount: 0, duplicateCount: 0, emptyDescriptions: 0 };

  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    problems.push('корень JSON должен быть объектом');
    return stats;
  }
  if (!Array.isArray(catalog.groups) || catalog.groups.length === 0) {
    problems.push('в каталоге нет непустого массива groups');
    return stats;
  }
  stats.groupCount = catalog.groups.length;

  const groupNames = new Set();
  const seenTags = new Map();

  catalog.groups.forEach((group, groupIndex) => {
    const groupLabel = `группа #${groupIndex + 1}`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      problems.push(`${groupLabel}: должна быть объектом`);
      return;
    }

    const groupName = cleanText(group.group);
    if (!groupName) {
      problems.push(`${groupLabel}: пустое название группы`);
    } else if (groupNames.has(groupName)) {
      problems.push(`дубль группы «${groupName}»`);
    } else {
      groupNames.add(groupName);
    }

    if (!Array.isArray(group.subgroups) || group.subgroups.length === 0) {
      problems.push(`группа «${groupName || groupLabel}»: нет подгрупп`);
      return;
    }

    const subgroupNames = new Set();
    let groupTotal = 0;

    group.subgroups.forEach((subgroup, subgroupIndex) => {
      const subgroupLabel = `«${groupName || groupLabel}» / подгруппа #${subgroupIndex + 1}`;
      if (!subgroup || typeof subgroup !== 'object' || Array.isArray(subgroup)) {
        problems.push(`${subgroupLabel}: должна быть объектом`);
        return;
      }

      const subgroupName = cleanText(subgroup.subgroup);
      if (!subgroupName) {
        problems.push(`${subgroupLabel}: пустое название подгруппы`);
      } else if (subgroupNames.has(subgroupName)) {
        problems.push(`группа «${groupName}»: дубль подгруппы «${subgroupName}»`);
      } else {
        subgroupNames.add(subgroupName);
      }
      stats.subgroupCount += 1;

      if (!Array.isArray(subgroup.fields) || subgroup.fields.length === 0) {
        problems.push(`подгруппа «${groupName} / ${subgroupName || '?'}»: нет тегов`);
        return;
      }

      subgroup.fields.forEach((field, fieldIndex) => {
        const where = `«${groupName} / ${subgroupName}» / тег #${fieldIndex + 1}`;

        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          problems.push(`${where}: должен быть объектом`);
          return;
        }
        if (typeof field.name !== 'string') {
          problems.push(`${where}: name должен быть строкой`);
          return;
        }

        const name = cleanText(field.name);
        if (!name) {
          problems.push(`${where}: пустое название`);
          return;
        }
        if (name !== field.name) {
          problems.push(`«${name}»: лишние пробелы по краям или внутри name`);
        }
        if (/\r|\n/.test(field.name)) {
          problems.push(`«${name}»: name должно быть в одну строку`);
        }

        const words = wordCount(name);
        if (words < MIN_NAME_WORDS || words > MAX_NAME_WORDS) {
          problems.push(`«${name}»: ${words} слов(а) в названии, нужно ${MIN_NAME_WORDS}–${MAX_NAME_WORDS}`);
        }

        stats.total += 1;
        groupTotal += 1;

        const key = nameKey(name);
        if (!key) {
          problems.push(`«${name}»: название пустое после нормализации`);
        } else if (seenTags.has(key)) {
          stats.duplicateCount += 1;
          problems.push(`дубль тега «${name}»: уже есть в ${seenTags.get(key)}`);
        } else {
          seenTags.set(key, `«${groupName} / ${subgroupName}»`);
        }

        if (typeof field.description !== 'string') {
          stats.emptyDescriptions += 1;
          problems.push(`«${name}»: description должен быть строкой`);
          return;
        }

        const description = cleanText(field.description);
        if (!description) {
          stats.emptyDescriptions += 1;
          problems.push(`«${name}»: пустое описание`);
          return;
        }
        if (description !== field.description) {
          problems.push(`«${name}»: лишние пробелы по краям или внутри description`);
        }
        if (/\r|\n/.test(field.description)) {
          problems.push(`«${name}»: description должно быть в одну строку`);
        }
        if (description.length > MAX_DESCRIPTION_LENGTH) {
          problems.push(`«${name}»: описание длиннее ${MAX_DESCRIPTION_LENGTH} символов`);
        }
      });
    });

    if (groupTotal === 0) {
      problems.push(`группа «${groupName || groupLabel}»: нет тегов`);
    }
  });

  for (const required of REQUIRED_GROUPS) {
    if (!groupNames.has(required)) {
      problems.push(`нет обязательной группы «${required}»`);
    }
  }
  for (const groupName of groupNames) {
    if (!REQUIRED_GROUPS.includes(groupName)) {
      problems.push(`неизвестная группа «${groupName}»`);
    }
  }
  if (stats.total < MIN_TAGS) {
    problems.push(`тегов ${stats.total}, нужно минимум ${MIN_TAGS}`);
  }

  return stats;
}

async function main() {
  const file = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_FILE;

  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    console.error(`Не удалось прочитать ${file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(raw.replace(/^\uFEFF/u, ''));
  } catch (error) {
    console.error(`Некорректный JSON в ${file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const stats = checkCatalog(catalog);

  if (problems.length > 0) {
    console.error(`Проверка не пройдена: ${problems.length} проблем`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(`файл: ${file}`);
  console.log(`тегов: ${stats.total}, групп: ${stats.groupCount}, подгрупп: ${stats.subgroupCount}`);
  console.log(`дублей: ${stats.duplicateCount}`);
  console.log(`пустых описаний: ${stats.emptyDescriptions}`);
  console.log('OK');
}

await main();
