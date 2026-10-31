/**
 * Проверка кубика d36 и скрытых проверок скиллов.
 *
 *   node scripts/dice-test.mjs
 */

import {
  JOKER_ABYSS,
  JOKER_FATE,
  JOKER_LUCK,
  jokerLabel,
  rollCheck,
  rollD36,
} from '../src/core/dice.ts';
import {
  SKILLS,
  SKILL_NAMES,
  defaultSkills,
  describeSkills,
  hiddenCheck,
} from '../src/core/skills.ts';

let failed = 0;

function check(name, ok, extra = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

// --- 1000 случайных бросков -------------------------------------------
const rolls = Array.from({ length: 1000 }, () => rollD36());

check(
  '1000 бросков: грани 1..36',
  rolls.every((r) => Number.isInteger(r.face) && r.face >= 1 && r.face <= 36),
);

const jokerShare = rolls.filter((r) => r.joker).length / rolls.length;
check(
  'джокеры примерно 3/36 (±3%)',
  Math.abs(jokerShare - 3 / 36) <= 0.03,
  `(${(jokerShare * 100).toFixed(1)}%)`,
);

const jokerCounts = { 34: 0, 35: 0, 36: 0 };
for (const roll of rolls) if (roll.joker) jokerCounts[roll.face] += 1;
check(
  'встретились все три джокера',
  jokerCounts[JOKER_LUCK] > 0 &&
    jokerCounts[JOKER_FATE] > 0 &&
    jokerCounts[JOKER_ABYSS] > 0,
  `(${JSON.stringify(jokerCounts)})`,
);

const expectedLabel = (face) => {
  if (face === JOKER_LUCK) return 'джокер удачи';
  if (face === JOKER_FATE) return 'джокер судьбы';
  if (face === JOKER_ABYSS) return 'джокер бездны';
  return `грань ${face}`;
};

check(
  'labels и joker согласованы с гранью',
  rolls.every(
    (r) => r.label === expectedLabel(r.face) && r.joker === (r.face >= 34),
  ),
);
check(
  'jokerLabel: три джокера',
  jokerLabel(34) === 'джокер удачи' &&
    jokerLabel(35) === 'джокер судьбы' &&
    jokerLabel(36) === 'джокер бездны',
);
check('jokerLabel: обычная грань — пусто', jokerLabel(17) === '');

// --- Детерминированность ----------------------------------------------
const seededA = rollD36('Мёртвый город у вулкана');
const seededB = rollD36('Мёртвый город у вулкана');
check(
  'seeded бросок детерминирован',
  seededA.face === seededB.face &&
    seededA.label === seededB.label &&
    seededA.joker === seededB.joker,
);

const seedFaces = [
  'Мёртвый город у вулкана',
  'Таверна «Ржавый гвоздь»',
  'Ночь на перевале',
  'Шёпот в колодце',
].map((seed) => rollD36(seed).face);
check(
  'разные seed → разные грани',
  new Set(seedFaces).size >= 3,
  `(${seedFaces.join(',')})`,
);

// --- rollCheck и джокерские бонусы ------------------------------------
function findCheck(face, modifier = 5) {
  for (let i = 0; i < 20000; i += 1) {
    const seed = `проверка:${face}:${i}`;
    const result = rollCheck(seed, 'Скрытность', modifier);
    if (result.roll === face) return { seed, ...result };
  }
  return null;
}

const luck = findCheck(JOKER_LUCK);
check('найден бросок с джокером удачи', Boolean(luck));
check(
  'джокер удачи: +10 к итогу',
  Boolean(luck) &&
    luck.joker &&
    luck.total === JOKER_LUCK + 5 + 10 &&
    luck.skill === 'Скрытность',
  `(${luck?.total})`,
);

const abyss = findCheck(JOKER_ABYSS);
check('найден бросок с джокером бездны', Boolean(abyss));
check(
  'джокер бездны: −10 к итогу',
  Boolean(abyss) &&
    abyss.joker &&
    abyss.total === JOKER_ABYSS + 5 - 10,
  `(${abyss?.total})`,
);

const fate = findCheck(JOKER_FATE);
check('найден бросок с джокером судьбы', Boolean(fate));
check(
  'джокер судьбы: итог 0 и joker',
  Boolean(fate) && fate.joker && fate.total === 0,
  `(${fate?.total})`,
);

const fateHidden = fate
  ? hiddenCheck(fate.seed, { 'Скрытность': 5 }, 10, { skill: 'Скрытность' })
  : null;
check(
  'hiddenCheck перебрасывает джокер судьбы',
  Boolean(fateHidden) &&
    fateHidden.roll !== JOKER_FATE &&
    fateHidden.total !== 0 &&
    fateHidden.skill === 'Скрытность',
  `(${fateHidden?.roll}/${fateHidden?.total})`,
);

const plain = findCheck(7);
check('найден обычный бросок', Boolean(plain));
check(
  'обычный бросок: total = roll + модификатор',
  Boolean(plain) && !plain.joker && plain.total === 7 + 5,
  `(${plain?.total})`,
);

// --- defaultSkills -----------------------------------------------------
const hero = defaultSkills('Кай');
const heroAgain = defaultSkills('Кай');
const heroSum = sum(Object.values(hero));

check('defaultSkills: ровно 8 скиллов', Object.keys(hero).length === 8);
check(
  'defaultSkills: все канонические имена',
  SKILL_NAMES.every((name) => name in hero),
);
check(
  'defaultSkills: значения 4..14',
  Object.values(hero).every(
    (value) => Number.isInteger(value) && value >= 4 && value <= 14,
  ),
  `(${JSON.stringify(hero)})`,
);
check('defaultSkills: сумма 70', heroSum === 70, `(${heroSum})`);
check(
  'defaultSkills: детерминированы',
  JSON.stringify(hero) === JSON.stringify(heroAgain),
);

const heroSets = ['Кай', 'Лира', 'Мёртвый город', 'Ночь на перевале'].map(
  (seed) => JSON.stringify(defaultSkills(seed)),
);
check(
  'defaultSkills: разные seed → разные наборы',
  new Set(heroSets).size >= 3,
);

// --- hiddenCheck -------------------------------------------------------
const hiddenA = hiddenCheck('сцена:дуэль', hero, 14, { skill: 'Воля' });
const hiddenB = hiddenCheck('сцена:дуэль', hero, 14, { skill: 'Воля' });
check(
  'hiddenCheck: детерминирован',
  JSON.stringify(hiddenA) === JSON.stringify(hiddenB),
);

const outcomes = [];
for (let i = 0; i < 240; i += 1) {
  const skills = defaultSkills(`герой:${i % 8}`);
  const difficulty = 6 + (i % 24);
  const explicit = i % 4 === 0;
  const result = hiddenCheck(
    `сцена:${i}`,
    skills,
    difficulty,
    explicit ? { skill: 'Скрытность' } : {},
  );
  outcomes.push({ skills, difficulty, result, explicit });
}

check(
  'hiddenCheck: success = (total >= difficulty)',
  outcomes.every(({ result, difficulty }) => result.success === (result.total >= difficulty)),
);
check(
  'hiddenCheck: margin = total − difficulty',
  outcomes.every(({ result, difficulty }) => result.margin === result.total - difficulty),
);
check(
  'hiddenCheck: told содержит «успех»/«провал»',
  outcomes.every(({ result }) =>
    result.told.includes(result.success ? 'успех' : 'провал'),
  ),
);
check(
  'hiddenCheck: told — формат скрытой проверки',
  outcomes.every(
    ({ result, difficulty }) =>
      result.told.startsWith('Скрытая проверка: ') &&
      result.told.includes(result.skill) &&
      result.told.includes(`против ${difficulty}`) &&
      result.told.includes(`запас ${result.margin}`),
  ),
);
check(
  'hiddenCheck: в выборке есть успехи и провалы',
  outcomes.some(({ result }) => result.success) &&
    outcomes.some(({ result }) => !result.success),
);
check(
  'hiddenCheck: скилл выбран из набора',
  outcomes.every(({ skills, result }) => result.skill in skills),
);
check(
  'hiddenCheck: явный скилл соблюдён',
  outcomes
    .filter(({ explicit }) => explicit)
    .every(({ result }) => result.skill === 'Скрытность'),
);
check(
  'hiddenCheck: roll — грань 1..36',
  outcomes.every(({ result }) => result.roll >= 1 && result.roll <= 36),
);
check(
  'hiddenCheck: total — целое',
  outcomes.every(({ result }) => Number.isInteger(result.total)),
);

// --- describeSkills ----------------------------------------------------
const description = describeSkills(hero);
check(
  'describeSkills: все 8 скиллов',
  SKILL_NAMES.every((name) => description.includes(name)),
);
check(
  'describeSkills: все значения',
  SKILL_NAMES.every((name) => description.includes(`${name} ${hero[name]}`)),
);
check(
  'describeSkills: разделитель « · »',
  description.split(' · ').length === 8,
  `(${description})`,
);
check(
  'SKILLS: восемь описаний',
  Object.keys(SKILLS).length === 8 &&
    Object.values(SKILLS).every(
      (text) => typeof text === 'string' && text.length > 0,
    ),
);

// --- Итог --------------------------------------------------------------
const sample = rollD36('пример броска');
const sampleCheck = hiddenCheck('пример проверки', hero, 12, {
  skill: 'Скрытность',
});

console.log('');
console.log(`  пример броска: d36 → ${sample.face} (${sample.label})`);
console.log(`  пример проверки: ${sampleCheck.told}`);
console.log('');
console.log(failed === 0 ? 'кубик и скиллы в порядке' : `провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
