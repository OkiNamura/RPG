/**
 * Бюджет времени на одно действие.
 *
 * Никаких жёстких категорий «сон = 8 ч, машина = 4 ч»: явно названная
 * длительность (4 часа сна, 12 часов в машине, полчаса разговора) имеет
 * приоритет. Если длительность не названа, формула складывает базовое
 * действие, дорогу и сон и добавляет запас.
 */
export interface Clock {
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

const WORD_NUMBERS: Record<string, number> = {
  пол: 0.5,
  один: 1,
  одна: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
};

function secondsUntil(now: Clock, targetHour: number): number {
  const current = now.hour * 3600 + now.minute * 60 + (now.second ?? 0);
  let target = targetHour * 3600;
  if (target <= current) target += 24 * 3600;
  return target - current;
}

/** Намерение ехать/лететь, а не «покупаю еду». */
export function hasTravelIntent(text: string): boolean {
  const value = text.toLowerCase().replace(/ё/g, 'е');
  if (/(покупаю|куплю|беру|заказываю|готовлю|съел|ем)\s+(еду|пищу|обед|ужин)/.test(value)) return false;
  return (
    /(^|\s)(я\s+)?(еду|лечу|плыву)\s*(в|на|к|до|из|через|по|домой|обратно|\d|$)/.test(value) ||
    /(^|\s)(отправляюсь|отправляюсь в путь|в путь)\b/.test(value) ||
    /(^|\s)(еду|лечу|плыву)\s*$/.test(value)
  );
}

/** Явно названная длительность в секундах; null, если её нет. */
export function parseDurationSeconds(text: string): number | null {
  const value = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  let best: number | null = null;
  const take = (seconds: number) => {
    best = Math.max(best ?? 0, seconds);
  };

  for (const match of value.matchAll(/(\d+(?:[.,]\d+)?)\s*(час(?:а|ов)?|ч|мин(?:ут(?:а|ы)?)?|дн(?:я|ей)?|сут(?:ки|ок)?)/g)) {
    const amount = Number((match[1] ?? '0').replace(',', '.'));
    const unit = match[2] ?? '';
    if (!Number.isFinite(amount)) continue;
    if (unit.startsWith('час') || unit === 'ч') take(amount * 3600);
    else if (unit.startsWith('мин')) take(amount * 60);
    else if (unit.startsWith('дн') || unit.startsWith('сут')) take(amount * 86400);
  }
  for (const match of value.matchAll(/(пол|один|одна|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)\s*(час(?:а|ов)?|мин(?:ут(?:а|ы)?)?)/g)) {
    const amount = WORD_NUMBERS[match[1] ?? ''] ?? 0;
    if ((match[2] ?? '').startsWith('час')) take(amount * 3600);
    else take(amount * 60);
  }
  if (/(полчас|пол часа)/.test(value)) take(30 * 60);
  if (/(^|[^а-я])час([^а-я]|$)/.test(value)) take(3600);
  return best;
}

/**
 * Верхняя граница времени за один ход.
 * floor — минимальная длительность перехода, уже вычисленная по месту.
 */
export function maxSceneAdvanceSeconds(
  input: string,
  prose: string,
  now: Clock,
  floor = 0,
): number {
  void prose;
  const spoken = input.toLowerCase().replace(/ё/g, 'е');
  const explicit = parseDurationSeconds(input) ?? 0;

  // Явно сказанное игроком «4 часа» / «12 часов» / «до утра» важнее эвристик.
  let explicitWithBuffer = explicit;
  if (!explicit) {
    if (/(до утра|к утру|до рассвета)/.test(spoken)) explicitWithBuffer = secondsUntil(now, 7);
    else if (/(до вечера|к вечеру)/.test(spoken)) explicitWithBuffer = secondsUntil(now, 18);
    else if (/(весь день|целый день)/.test(spoken)) explicitWithBuffer = 12 * 3600;
  }
  if (explicitWithBuffer > 0) return Math.max(floor, explicitWithBuffer + 15 * 60);

  const base = 30 * 60;
  const travel = hasTravelIntent(spoken) ? 60 * 60 : 0;
  const sleep = /(сплю|спать|усну|ночую|ночлег|ночь)/.test(spoken) ? 8 * 3600 : 0;
  return Math.max(floor, base + travel + sleep + 15 * 60);
}
