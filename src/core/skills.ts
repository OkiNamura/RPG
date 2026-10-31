/**
 * Скиллы героя и скрытые проверки.
 *
 * Проверка скрытая: игрок видит только следствие в тексте, а ведущий
 * (контекст) получает короткую строку `told`. Бросок детерминирован
 * seed'ом сцены — одна и та же сцена не даёт разных результатов при
 * повторной сборке контекста.
 */

import { JOKER_FATE, rollCheck, seededRandom } from './dice.ts';

/** Восемь базовых скиллов и их смысл. */
export const SKILLS = {
  'Сила': 'тело и напор: поднять, сломать, удержать',
  'Ловкость': 'точность и скорость: схватить, уйти, попасть',
  'Скрытность': 'тишина и невидимость: пройти мимо, спрятаться, не выдать себя',
  'Воля': 'выдержка и сопротивление: не сломаться под давлением',
  'Восприятие': 'внимание: заметить деталь, услышать шаг, прочитать обстановку',
  'Красноречие': 'слово: убедить, соврать, торговаться, удержать разговор',
  'Знание': 'память и эрудиция: вспомнить, понять, разобраться в устройстве',
  'Выживание': 'дорога и ресурсы: ориентироваться, найти воду, пережить ночь',
} as const;

export type SkillName = keyof typeof SKILLS;

/** Канонический порядок скиллов. */
export const SKILL_NAMES: readonly SkillName[] = Object.keys(SKILLS) as SkillName[];

/** Значения скиллов: 0..20. */
export interface SkillSet {
  [skill: string]: number;
}

export interface HiddenCheckOptions {
  skill?: string;
}

export interface HiddenCheckResult {
  skill: string;
  success: boolean;
  margin: number;
  roll: number;
  total: number;
  told: string;
}

const MIN_SKILL = 0;
const MAX_SKILL = 20;

/** Стартовые значения: 4..14, сумма 70. */
const START_MIN = 4;
const START_MAX = 14;
const START_SUM = 70;
const START_SPREAD = START_MAX - START_MIN + 1;

function clampSkill(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MIN_SKILL;
  return Math.min(MAX_SKILL, Math.max(MIN_SKILL, value));
}

/**
 * Стартовый набор: восемь скиллов со значениями 4..14 и суммой 70.
 * Детерминирован seed'ом — у одного героя всегда один и тот же набор.
 */
export function defaultSkills(seedText: string): SkillSet {
  const random = seededRandom(seedText);
  const values = SKILL_NAMES.map(
    () => START_MIN + Math.floor(random() * START_SPREAD),
  );
  let sum = values.reduce((acc, value) => acc + value, 0);

  // Подтягиваем сумму к 70, не выходя из 4..14.
  while (sum > START_SUM) {
    const index = Math.floor(random() * values.length);
    if (values[index] > START_MIN) {
      values[index] -= 1;
      sum -= 1;
    }
  }
  while (sum < START_SUM) {
    const index = Math.floor(random() * values.length);
    if (values[index] < START_MAX) {
      values[index] += 1;
      sum += 1;
    }
  }

  const result: SkillSet = {};
  SKILL_NAMES.forEach((name, index) => {
    result[name] = values[index];
  });
  return result;
}

/**
 * Скрытая проверка скилла.
 *
 * Скилл выбирается явно (`options.skill`) или детерминированно из
 * доступных. Модификатор — значение скилла. «Джокер судьбы» — не
 * провал, а переброс: функция бросает ещё раз с производным seed'ом.
 *
 * `told` — короткая строка для скрытого блока контекста, игроку не
 * показывается.
 */
export function hiddenCheck(
  seedText: string,
  skills: SkillSet,
  difficulty: number,
  options: HiddenCheckOptions = {},
): HiddenCheckResult {
  if (!Number.isFinite(difficulty)) {
    throw new RangeError(`hiddenCheck: сложность должна быть числом (${difficulty})`);
  }

  const available = Object.keys(skills);
  let skill: string;

  if (options.skill !== undefined) {
    skill = options.skill;
  } else {
    if (available.length === 0) {
      throw new Error('hiddenCheck: нет доступных скиллов');
    }
    const random = seededRandom(`${seedText}:скилл`);
    skill = available[Math.floor(random() * available.length)];
  }

  const modifier = clampSkill(skills[skill]);

  // «Переброс судьбы»: 35 — сигнал бросить снова, а не итог 0.
  let check = rollCheck(seedText, skill, modifier);
  let rerolls = 0;
  while (check.roll === JOKER_FATE && rerolls < 12) {
    rerolls += 1;
    check = rollCheck(`${seedText}:переброс:${rerolls}`, skill, modifier);
  }

  const success = check.total >= difficulty;
  const margin = check.total - difficulty;
  const told = `Скрытая проверка: ${skill} ${check.total} против ${difficulty} — ${
    success ? 'успех' : 'провал'
  } (запас ${margin})`;

  return {
    skill,
    success,
    margin,
    roll: check.roll,
    total: check.total,
    told,
  };
}

/** Строка для промпта: «Сила 8 · Ловкость 12 · …». */
export function describeSkills(skills: SkillSet): string {
  const parts: string[] = [];

  for (const name of SKILL_NAMES) {
    parts.push(`${name} ${name in skills ? skills[name] : 0}`);
  }

  // Незнакомые скиллы из расширенного набора не теряем.
  for (const name of Object.keys(skills)) {
    if (!(name in SKILLS)) parts.push(`${name} ${skills[name]}`);
  }

  return parts.join(' · ');
}
