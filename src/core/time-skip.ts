/**
 * Планировщик монотонного скачка времени.
 *
 * Событие прерывает скачок не потому, что оно «интересное», а потому что
 * требует ответа, блокирует действие или прямо обращено к герою.
 */

export type InterruptPolicy = 'important' | 'choices' | 'all' | 'none';
export type EventImportance = 'critical' | 'meaningful' | 'ambient' | 'silent';

export interface CalendarEvent {
  id: string;
  /** абсолютная минута мира */
  at: number;
  title: string;
  importance: EventImportance;
  /** герой может воспринять событие */
  perceived?: boolean;
  /** требует ответа игрока */
  requiresResponse?: boolean;
  /** блокирует заявленное действие */
  blocksAction?: boolean;
  /** прямо обращено к герою */
  directAddress?: boolean;
  place?: string;
}

export interface SkipPlan {
  end: number;
  interrupt: CalendarEvent | null;
  summary: CalendarEvent[];
  skipped: CalendarEvent[];
}

export function shouldInterrupt(event: CalendarEvent, policy: InterruptPolicy): boolean {
  if (policy === 'none') return false;
  if (event.perceived === false) return false;
  if (event.importance === 'silent') return false;
  if (event.importance === 'critical') return true;
  const agency = Boolean(event.requiresResponse || event.blocksAction || event.directAddress);
  if (!agency) return false;
  if (policy === 'all') return true;
  if (policy === 'choices') return Boolean(event.requiresResponse || event.blocksAction);
  return event.importance === 'meaningful';
}

/** Найти ближайшее прерывание и собрать всё, что случится по пути. */
export function planTimeSkip(
  start: number,
  end: number,
  events: CalendarEvent[],
  policy: InterruptPolicy = 'important',
): SkipPlan {
  const until = Math.max(start, end);
  const relevant = events
    .filter((event) => event.at > start && event.at <= until)
    .sort((a, b) => a.at - b.at);
  const interrupt = relevant.find((event) => shouldInterrupt(event, policy)) ?? null;
  const stop = interrupt ? interrupt.at : until;
  const between = relevant.filter((event) => event.at <= stop && event.id !== interrupt?.id);
  return {
    end: stop,
    interrupt,
    summary: between.filter((event) => event.importance !== 'silent'),
    skipped: between.filter((event) => event.importance === 'silent'),
  };
}
