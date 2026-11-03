/**
 * Экономика без огромной таблицы: базовая стоимость по типу вещи,
 * множитель места и детерминированная вариация.
 *
 * Внутри — медные монеты (1 медь = 1). Для современных валют 1 рубль = 100,
 * для кредитов 1 кредит = 10, чтобы цены не были абсурдными.
 */
export interface PriceQuote {
  copper: number;
  multiplier: number;
  display: number;
  currency: string;
}

const BASE: [RegExp, number][] = [
  [/(хлеб|булк|пирож|еда|похлёб|суп|каша|бутерброд)/i, 4],
  [/(эль|пиво|вино|лимонад|вода|чай|кофе)/i, 3],
  [/(мясо|рыба|сыр|колбас)/i, 9],
  [/(комната|ночлег|постой|кровать)/i, 30],
  [/(кинжал|нож|стилет)/i, 90],
  [/(меч|топор|копьё|лук|арбалет)/i, 220],
  [/(плащ|куртка|рубаха|одежд|форма)/i, 45],
  [/(сапог|обувь|ботин)/i, 35],
  [/(зелье|эликсир|лекарств)/i, 55],
  [/(верёвк|фонар|спичк|свеч|масл)/i, 12],
  [/(книга|тетрад|карта|свиток)/i, 25],
  [/(телефон|смартфон|ноутбук|компьютер)/i, 3500],
  [/(билет|проезд|подорожник|метро)/i, 8],
  [/(украшение|кольцо|амулет|ожерель)/i, 160],
];
const DEFAULT_BASE = 20;

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function locationMultiplier(place: string): number {
  const value = place.toLowerCase();
  if (/(дворец|храм|элит|столиц|центр|академ|универ)/.test(value)) return 2.4;
  if (/(город|рынок|улиц|площад|магазин|школ)/.test(value)) return 1.5;
  if (/(деревн|село|хутор|пригород|двор)/.test(value)) return 0.8;
  if (/(дорог|тракт|пустош|лес|горы)/.test(value)) return 1.1;
  if (/(таверн|трактир|постоял)/.test(value)) return 1.2;
  if (/(тюрьм|трущоб|подзем|шахт)/.test(value)) return 0.9;
  return 1;
}

function currencyScale(currencies: { name: string }[] | undefined, copper: number): { scale: number; currency: string } {
  const names = (currencies ?? []).map((item) => item.name.toLowerCase());
  if (names.some((name) => /руб|доллар|долл|фунт|евро/.test(name))) return { scale: 100, currency: 'руб.' };
  if (names.some((name) => /кредит|чип|пиксел/.test(name))) return { scale: 10, currency: 'кр.' };
  if (names.some((name) => /мед|copper/.test(name)) && copper < 100) return { scale: 1, currency: 'медь' };
  if (names.some((name) => /сереб|silver/.test(name)) && copper < 10000) return { scale: 100, currency: 'серебро' };
  if (names.some((name) => /золот|gold/.test(name))) return { scale: 10000, currency: 'золото' };
  return { scale: 1, currency: 'ед.' };
}

export function estimatePrice(
  item: string,
  place: string,
  currencies?: { name: string }[],
  seed = 0,
): PriceQuote {
  const found = BASE.find(([pattern]) => pattern.test(item));
  const base = found?.[1] ?? DEFAULT_BASE;
  const multiplier = locationMultiplier(place);
  const variation = 0.9 + ((hash(`${item}|${place}|${seed}`) % 21) / 100);
  const copper = Math.max(1, Math.round(base * multiplier * variation));
  const { scale, currency } = currencyScale(currencies, copper);
  return {
    copper,
    multiplier,
    display: Math.max(1, Math.round(copper / scale)),
    currency,
  };
}
