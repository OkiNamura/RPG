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
  const daysPerYear = calendar.months.reduce((sum, month) => sum + Math.max(1, month.days), 0);
  const absolute = Math.max(1, Math.floor(day));
  const offset = absolute - 1;
  const year = (calendar.startYear ?? 1) + Math.floor(offset / daysPerYear);
  let rest = offset % daysPerYear;
  let monthIndex = 0;
  while (monthIndex < calendar.months.length - 1 && rest >= calendar.months[monthIndex].days) {
    rest -= calendar.months[monthIndex].days;
    monthIndex += 1;
  }
  const dayOfYear = (offset % daysPerYear) + 1;
  const season = calendar.seasons?.length
    ? calendar.seasons[Math.min(calendar.seasons.length - 1, Math.floor(((dayOfYear - 1) / daysPerYear) * calendar.seasons.length))]
    : '';
  const moons = (calendar.moons ?? []).map((moon) => {
    const phase = moon.phases?.length
      ? moon.phases[Math.floor(offset / Math.max(1, moon.period)) % moon.phases.length]
      : '';
    return { name: moon.name, phase };
  });
  return {
    year,
    dayOfYear,
    monthIndex,
    monthName: calendar.months[monthIndex]?.name ?? '',
    dayOfMonth: rest + 1,
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
