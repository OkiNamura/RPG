/**
 * Один раз на мир: валюты и календарь.
 *
 * Это не ИИ-генерация, а детерминированный профиль мира: одинаковый текст
 * мира всегда даёт одинаковые деньги и календарь, а разные миры — разные.
 */

import type { Currency, WorldCalendar } from './state.ts';

export interface WorldProfile {
  currencies: Currency[];
  calendar: WorldCalendar;
}

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function pick<T>(list: T[], seed: number, salt: number): T {
  return list[(seed + salt) % list.length];
}

function coins(names: [string, number][], seed: number): Currency[] {
  const forms: Record<string, [string, string, string]> = {
    кредиты: ['кредит', 'кредита', 'кредитов'],
    чипы: ['чип', 'чипа', 'чипов'],
    доллары: ['доллар', 'доллара', 'долларов'],
    центы: ['цент', 'цента', 'центов'],
    крышки: ['крышка', 'крышки', 'крышек'],
    патроны: ['патрон', 'патрона', 'патронов'],
    ракушки: ['ракушка', 'ракушки', 'ракушек'],
    'светящиеся камни': ['светящийся камень', 'светящихся камня', 'светящихся камней'],
    фантики: ['фантик', 'фантика', 'фантиков'],
    бусины: ['бусина', 'бусины', 'бусин'],
    золото: ['золотой', 'золотых', 'золотых'],
    серебро: ['серебряный', 'серебряных', 'серебряных'],
    медь: ['медный', 'медных', 'медных'],
    марки: ['марка', 'марки', 'марок'],
    шестерёнки: ['шестерёнка', 'шестерёнки', 'шестерёнок'],
  };
  return names.map(([name, base], index) => ({
    name,
    amount: base + ((seed + index * 17) % 5),
    forms: forms[name],
    primary: index === 0,
  }));
}

function fantasyCalendar(seed: number, era: string): WorldCalendar {
  const modes = [
    {
      months: Array.from({ length: 12 }, (_, index) => ({ name: `месяц ${index + 1}`, days: 30 })),
      seasons: ['весна', 'лето', 'осень', 'зима'],
    },
    {
      months: Array.from({ length: 8 }, (_, index) => ({ name: `луна ${index + 1}`, days: 16 })),
      seasons: ['пробуждение', 'жара', 'дожди', 'стужа'],
    },
    {
      months: Array.from({ length: 5 }, (_, index) => ({ name: `печать ${index + 1}`, days: 40 })),
      seasons: ['пепел', 'пыль', 'холод'],
    },
  ];
  const mode = pick(modes, seed, 3);
  return {
    era,
    startYear: 1 + (seed % 400),
    months: mode.months,
    seasons: mode.seasons,
    moons: [
      { name: 'Луна', period: 29 + (seed % 4), phases: ['новая', 'растущая', 'полная', 'убывающая'] },
    ],
    hasNight: true,
    hoursPerDay: 24,
    note: 'Календарь этого мира. Месяцы и сезоны не совпадают с земными.',
  };
}

export function makeWorldProfile(
  seedText: string,
  options: { eraLabel?: string; epochYear?: number; altTime?: boolean; title?: string } = {},
): WorldProfile {
  const text = `${seedText} ${options.title ?? ''}`.toLowerCase();
  const seed = hash(`${seedText}|${options.title ?? ''}|${options.epochYear ?? 0}`);
  const era =
    options.eraLabel?.trim() ||
    (options.altTime && options.epochYear == null
      ? `эпоха ${seed % 900 + 100}`
      : options.epochYear && options.epochYear > 0
        ? `${options.epochYear} год`
        : `эпоха ${seed % 900 + 100}`);

  if (/(косм|звезд|планет|орбит|sci|science|скайфай|sci-fi|будущ|кибер|нейро|корабл|станци|робот)/i.test(text)) {
    return {
      currencies: coins([
        ['кредиты', 120],
        ['чипы', 4],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'Стандартный цикл',
        startYear: seed % 900 + 100,
        months: Array.from({ length: 10 }, (_, index) => ({ name: `цикл ${index + 1}`, days: 10 })),
        seasons: ['вакуум'],
        moons: [
          { name: 'Станция', period: 20, phases: ['тень', 'свет'] },
          { name: 'Пояс', period: 47, phases: ['близко', 'далеко'] },
        ],
        hasNight: false,
        hoursPerDay: 24,
        note: 'В космосе нет привычной ночи и земных месяцев.',
      },
    };
  }

  if (/(школ|детектив|real|офис|доллар|автомоб|телефон|интернет|метро|банк|современ.{0,30}(детск|истор|жизн|город|школ))/i.test(text)) {
    return {
      currencies: coins([
        ['доллары', 120],
        ['центы', 40],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'Наша эра',
        startYear: options.epochYear && options.epochYear > 0 ? options.epochYear : 2000 + (seed % 30),
        months: [
          'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
          'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
        ].map((name, index) => ({ name, days: index === 1 ? 28 : 30 })),
        seasons: ['весна', 'лето', 'осень', 'зима'],
        moons: [{ name: 'Луна', period: 29, phases: ['новая', 'растущая', 'полная', 'убывающая'] }],
        hasNight: true,
        hoursPerDay: 24,
        note: 'Земной календарь, но деньги и эпоха принадлежат этому миру.',
      },
    };
  }

  if (/(постап|апокал|радиац|mad max|безумн|крышк|патрон)/i.test(text)) {
    return {
      currencies: coins([
        ['крышки', 42],
        ['патроны', 6],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'После Разлома',
        startYear: seed % 9000 + 400,
        months: Array.from({ length: 6 }, (_, index) => ({ name: `сезон ${index + 1}`, days: 40 })),
        seasons: ['сухость', 'пыль', 'ядовитый дождь'],
        moons: [{ name: 'Осколок', period: 33, phases: ['тёмный', 'кровавый', 'белый'] }],
        hasNight: true,
        hoursPerDay: 24,
        note: 'Время считают от Разлома, а не от земного года.',
      },
    };
  }

  if (/(подзем|пещер|шахт| subterr)/i.test(text)) {
    return {
      currencies: coins([
        ['ракушки', 30],
        ['светящиеся камни', 7],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'Глубина',
        startYear: seed % 900 + 100,
        months: Array.from({ length: 6 }, (_, index) => ({ name: `ярус ${index + 1}`, days: 20 })),
        seasons: ['глубина'],
        moons: [],
        hasNight: false,
        hoursPerDay: 24,
        note: 'Ночи нет: только свет и темнота тоннелей.',
      },
    };
  }

  if (/(сказк|детск|феи|волшеб|игруш|чудо)/i.test(text)) {
    return {
      currencies: coins([
        ['фантики', 18],
        ['ракушки', 9],
        ['бусины', 3],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'Сказочный год',
        startYear: seed % 90 + 1,
        months: Array.from({ length: 7 }, (_, index) => ({ name: `сказка ${index + 1}`, days: 21 })),
        seasons: ['цветение', 'золотая пора', 'сон'],
        moons: [{ name: 'Луна-фонарик', period: 21, phases: ['спит', 'улыбается', 'сияет'] }],
        hasNight: true,
        hoursPerDay: 24,
        note: 'Время здесь считают сказками, а не неделями.',
      },
    };
  }

  if (/(стимпанк|пар|шестер|виктор|clock)/i.test(text)) {
    return {
      currencies: coins([
        ['марки', 60],
        ['шестерёнки', 12],
      ], seed),
      calendar: {
        era: options.eraLabel?.trim() || 'Век Пара',
        startYear: seed % 90 + 1,
        months: Array.from({ length: 10 }, (_, index) => ({ name: `такт ${index + 1}`, days: 36 })),
        seasons: ['разогрев', 'работа', 'остывание', 'ремонт'],
        moons: [{ name: 'Шестерня', period: 36, phases: ['завод', 'ход', 'остановка'] }],
        hasNight: true,
        hoursPerDay: 24,
        note: 'Календарь мастерской: месяцы называются тактами.',
      },
    };
  }

  return {
    currencies: coins([
      ['золото', 0],
      ['серебро', 12],
      ['медь', 40],
    ], seed),
    calendar: fantasyCalendar(seed, era),
  };
}
