/**
 * Критик — сначала дешёвый и детерминированный.
 *
 * Это не оценка качества прозы. Это проверка на конкретные поломки,
 * из-за которых сессия «плывёт»: потерянный блок изменений, вопросы
 * игроку вместо ведения, простыни текста.
 *
 * Когда правила станут сложнее — сюда добавится вызов мелкой модели,
 * но базовые проверки останутся: они бесплатны и ловят больше всего.
 */

import type { Delta } from './delta.ts';
import type { GameState } from './state.ts';

export interface Verdict {
  ok: boolean;
  problems: string[];
}

const FORBIDDEN = [
  /что\s+(ты\s+)?(будешь|делаешь|предпримешь)\s*\?/i,
  /твой\s+ход\s*\?/i,
  /что\s+дальше\s*\?/i,
  /как\s+поступишь\s*\?/i,
];

/** Мягкое подталкивание: формально не вопрос, по сути — «решай». */
const PUSHING = [
  /тебе\s+решать/i,
  /ты\s+решаешь/i,
  /решение\s+за\s+тобой/i,
  /выбор\s+за\s+тобой/i,
  /тебе\s+выбирать/i,
];

/** Сколько скрытых фактов за ход считаем нормой. */
const HIDDEN_FACTS_LIMIT = 2;

export function critique(
  state: GameState,
  prose: string,
  delta: Delta | null,
  changes: string[],
  expectDelta = true,
): Verdict {
  const problems: string[] = [];

  if (!prose.trim()) {
    problems.push('пустой ответ');
  }

  // Когда состоянием владеет отдельный агент, ведущий не обязан отдавать JSON.
  if (expectDelta && !delta) {
    problems.push('нет блока изменений — стейт не обновится');
  }

  if (prose.length > 2500) {
    problems.push(`перебор объёма: ${prose.length} символов`);
  }

  if (prose.length > 0 && prose.length < 60) {
    problems.push('слишком короткий ответ');
  }

  for (const re of FORBIDDEN) {
    if (re.test(prose)) {
      problems.push('вопрос игроку вместо ведения — нарушена граница хода');
      break;
    }
  }

  for (const re of PUSHING) {
    if (re.test(prose)) {
      problems.push('подталкивание к решению вместо паузы');
      break;
    }
  }

  const facts = delta?.hiddenFacts?.length ?? 0;
  if (facts > HIDDEN_FACTS_LIMIT) {
    problems.push(`скрытых фактов за ход: ${facts} (норма ≤ ${HIDDEN_FACTS_LIMIT})`);
  }

  if (delta && changes.length === 0 && /\b(берёшь|поднимаешь|кладёшь|снимаешь|отдаёшь|прячешь)\b/i.test(prose)) {
    problems.push('в сцене действие с предметом, но изменений в стейте нет');
  }

  void state;
  return { ok: problems.length === 0, problems };
}
