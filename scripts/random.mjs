/**
 * Простой генератор случайных чисел для бросков.
 *
 *   node scripts/random.mjs                  # одно число 1..36
 *   node scripts/random.mjs 20 5             # пять чисел 1..20
 *   node scripts/random.mjs 36 1 --seed бой  # детерминированно от seed
 *   node scripts/random.mjs 36 3 --skill 4   # с проверкой навыка
 *
 * Без seed — криптографический randomInt; с seed — mulberry32 из dice.ts.
 */
import { randomInt } from 'node:crypto';
import { D36_FACES, resolveRoll, seededRandom } from '../src/core/dice.ts';

const argv = process.argv.slice(2);
const positional = argv.filter((arg) => !arg.startsWith('--') && !argv[argv.indexOf(arg) - 1]?.startsWith('--'));
const faces = Math.max(2, Math.min(1_000_000, Number(positional[0] ?? D36_FACES) || D36_FACES));
const count = Math.max(1, Math.min(1000, Number(positional[1] ?? 1) || 1));
const seedIndex = argv.indexOf('--seed');
const seed = seedIndex >= 0 ? argv[seedIndex + 1] : undefined;
const skillIndex = argv.indexOf('--skill');
const skill = skillIndex >= 0 ? Number(argv[skillIndex + 1]) : null;
const random = seed === undefined ? null : seededRandom(seed);
const values = [];

for (let i = 0; i < count; i += 1) {
  const face = random ? Math.floor(random() * faces) + 1 : randomInt(1, faces + 1);
  values.push(face);
  let line = String(face);
  if (Number.isFinite(skill) && skill !== null) {
    const outcome = resolveRoll(face, 'Проверка', skill);
    const verdict = outcome.fatal
      ? 'СМЕРТЬ'
      : outcome.criticalFailure
        ? 'критический провал'
        : outcome.success
          ? 'успех'
          : 'провал';
    line += ` — итог ${outcome.total} (навык ${outcome.skillValue}), ${verdict}`;
  }
  console.log(line);
}

console.log(`\nвсего: ${values.reduce((sum, value) => sum + value, 0)} · min ${Math.min(...values)} · max ${Math.max(...values)}`);
