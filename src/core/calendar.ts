/** Календарь мира: считаем дату из абсолютного дня кампании. */
import type { WorldCalendar } from './state.ts';

export interface CalendarDate {
  year: number;
  dayOfYear: number;
  monthIndex: number;
  monthName: string;
  dayOfMonth: number;
  season: string;
  moons: { name: string; phase: string }[];
}

export function calendarDate(calendar: WorldCalendar | undefined, day: number): CalendarDate {
  if (!calendar?.months?.length) {
    return {
      year: 1,
      dayOfYear: day,
      monthIndex: 0,
      monthName: '',
      dayOfMonth: day,
      season: '',
      moons: [],
    };
  }
  const absolute = Math.max(1, Math.floor(day));
  let remaining = absolute - 1;
  let year = calendar.startYear ?? 1;
  let monthIndex = Math.max(0, Math.min(calendar.months.length - 1, calendar.startMonth ?? 0));
  const startMonth = monthIndex;
  while (remaining >= Math.max(1, calendar.months[monthIndex].days)) {
    remaining -= Math.max(1, calendar.months[monthIndex].days);
    monthIndex += 1;
    if (monthIndex >= calendar.months.length) {
      monthIndex = 0;
      year += 1;
    }
  }
  const dayOfMonth = remaining + 1;
  let dayOfYear = dayOfMonth;
  for (let index = 0; index < monthIndex; index += 1) dayOfYear += Math.max(1, calendar.months[index].days);
  const monthOffset = (monthIndex - startMonth + calendar.months.length) % calendar.months.length;
  const season = calendar.seasons?.length
    ? calendar.seasons[Math.min(calendar.seasons.length - 1, Math.floor((monthOffset / calendar.months.length) * calendar.seasons.length))]
    : '';
  const moons = (calendar.moons ?? []).map((moon) => {
    const phase = moon.phases?.length
      ? moon.phases[Math.floor((absolute - 1) / Math.max(1, moon.period)) % moon.phases.length]
      : '';
    return { name: moon.name, phase };
  });
  return {
    year,
    dayOfYear,
    monthIndex,
    monthName: calendar.months[monthIndex]?.name ?? '',
    dayOfMonth,
    season,
    moons,
  };
}

export function clockText(time: { hour?: number; minute?: number; second?: number }): string {
  const hh = String(Math.max(0, Number(time.hour ?? 0))).padStart(2, '0');
  const mm = String(Math.max(0, Number(time.minute ?? 0))).padStart(2, '0');
  const ss = String(Math.max(0, Number(time.second ?? 0))).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function formatWorldDate(
  calendar: WorldCalendar | undefined,
  time: { day: number; hour?: number; minute?: number; second?: number },
  includeTime = true,
): string {
  const date = calendarDate(calendar, time.day);
  const datePart = calendar
    ? `${calendar.era}, ${date.year} год, ${date.monthName} ${date.dayOfMonth}`
    : `день ${time.day}`;
  return includeTime ? `${datePart} · ${clockText(time)}` : datePart;
}
