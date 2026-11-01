/**
 * Состояние кампании — единственный источник правды о цифрах.
 *
 * Проза живёт отдельно: она для игрока. Если проза и стейт расходятся,
 * прав стейт — и это надо чинить, а не «дописывать красиво».
 */

export type Role = 'player' | 'gm' | 'system';

import { defaultSkills } from './skills.ts';

export interface Wound {
  where: string;
  severity: 1 | 2 | 3;
  treated: boolean;
}

export interface Item {
  name: string;
  qty: number;
  where: 'equipped' | 'inventory' | 'vault' | 'lost';
  note?: string;
  /** карточка предмета, если нарисована */
  card?: string;
}

export interface Actor {
  name: string;
  role: string;
  status: 'alive' | 'dead' | 'gone';
  /** 0..100, только для пати: насколько близко подпускает */
  bond: number;
  /** -100..100, отношение к герою */
  attitude?: number;
  /** находится ли в текущей сцене */
  present?: boolean;
  /** скиллы персонажа: 0..20, используются в скрытых проверках */
  skills?: Record<string, number>;
  wounds: Wound[];
  note?: string;
  /** карточка: внешность, характер, одежда, прошлое */
  appearance?: string;
  character?: string;
  clothes?: string;
  bio?: string;
  /** что носит при себе (для пати и важных NPC) */
  inventory?: Item[];
  /** портрет, если нарисован */
  portrait?: string;
  /** мастер-лист: референс для всех дальнейших кадров */
  card?: string;
  /** короткое описание для карточки */
  description?: string;
  /** способности из шаблона NPC */
  abilities?: string;
  /** чувства внутри пати: ревность, любовь, зависть */
  relations?: { with: string; feeling: string }[];
}

/** Временный эффект: баф или дебаф, живёт до снятия. */
export interface Status {
  name: string;
  kind: 'buff' | 'debuff';
  note?: string;
}

export interface Faction {
  name: string;
  /** -100..100 */
  attitude: number;
  note?: string;
  /** кто стоит во главе: «глава гильдии», «серый кардинал» */
  leader?: string;
  /** тайный вдохновитель, если он есть */
  shadow?: string;
  /** состав: кто входит */
  roster?: { name: string; role: string; note?: string; hidden?: boolean }[];
}

export interface LocationCard {
  name: string;
  note: string;
}

/** Закрытая страница истории: выполненные долги, брошенные дела, выброшенные вещи. */
export interface ArchiveEntry {
  kind: 'hook' | 'promise' | 'quest' | 'item';
  text: string;
  turn: number;
  reason: string;
}

/** Встреченное существо. */
export interface Creature {
  name: string;
  note?: string;
  danger?: 1 | 2 | 3;
}

/** Кадр, нарисованный по сцене. */
export interface Illustration {
  turn: number;
  url: string;
  caption?: string;
}

export interface Quest {
  title: string;
  status: 'active' | 'done' | 'failed' | 'frozen';
  steps: string[];
  deadline?: string;
  /** ход, когда задача взята */
  createdTurn?: number;
  /** сколько ходов даётся; просрочка — последствия */
  turnsLimit?: number;
}

/**
 * Факт, зафиксированный ДО того, как он стал важен.
 *
 * Это механика «запрета ретроактивного подвоха»: ведущий не может выдумать
 * засаду после броска, если она не лежит здесь с более ранним ходом.
 */
export interface HiddenFact {
  id: string;
  turn: number;
  content: string;
  known: boolean;
}

export interface LogEntry {
  turn: number;
  role: Role;
  text: string;
}

export interface GameState {
  turn: number;
  time: { day: number; hour: number };
  place: string;
  weather: string;
  hero: {
    name: string;
    /** 0..100, ниже нуля — смерть */
    health: number;
    wounds: Wound[];
    conditions: string[];
    statuses: Status[];
    /** скиллы героя: 0..20 */
    skills?: Record<string, number>;
    /** мысли, интуиция и предчувствия — то, что герой чувствует, но не говорит */
    intuition?: string;
    /** мастер-лист героя: по нему рисуются сцены */
    card?: string;
    /** пол героя */
    gender?: 'male' | 'female';
    /** поля карточки из формы создания */
    essence?: string;
    appearance?: string;
    bodyAttitude?: string;
    origin?: string;
    quirks?: string;
    start?: string;
    /** прошлое и способности — из шаблона героя */
    bio?: string;
    abilities?: string;
  };
  money: { gold: number; silver: number; copper: number };
  items: Item[];
  party: Actor[];
  npcs: Actor[];
  quests: Quest[];
  promises: string[];
  /** открытые крючки: вопросы и угрозы, за которые спросят позже */
  hooks: string[];
  /** отношения с группами: гильдии, культы, знать, город */
  factions: Faction[];
  /** что герой видел и запомнил о местах */
  locations: LocationCard[];
  /** закрытые страницы: выполнено, брошено, потеряно */
  archive: ArchiveEntry[];
  /** встреченные существа */
  bestiary: Creature[];
  /** автолор: записи, которые агент состояния завёл сам */
  lore: { keys: string[]; content: string }[];
  /** нарисованные кадры */
  illustrations: Illustration[];
  hiddenFacts: HiddenFact[];
  flags: Record<string, string | number | boolean>;
  log: LogEntry[];
}

let factCounter = 0;

export function addHiddenFact(state: GameState, content: string): HiddenFact {
  factCounter += 1;
  const fact: HiddenFact = {
    id: `hf-${state.turn}-${factCounter}`,
    turn: state.turn,
    content,
    known: false,
  };
  state.hiddenFacts.push(fact);
  return fact;
}

export function createState(heroName: string, place: string): GameState {
  return {
    turn: 0,
    time: { day: 1, hour: 8 },
    place,
    weather: 'холодный туман',
    hero: {
      name: heroName,
      health: 100,
      wounds: [],
      conditions: [],
      statuses: [],
      // Скиллы героя: сразу набор, чтобы работали скрытые проверки.
      skills: defaultSkills(heroName),
      intuition: '',
    },
    money: { gold: 0, silver: 12, copper: 40 },
    items: [
      { name: 'кинжал-стилет', qty: 1, where: 'equipped' },
      { name: 'плащ шерстяной', qty: 1, where: 'equipped' },
      { name: 'рубаха льняная', qty: 1, where: 'equipped' },
      { name: 'сапоги кожаные', qty: 1, where: 'equipped' },
      { name: 'ремень с кошелём', qty: 1, where: 'equipped' },
    ],
    party: [],
    npcs: [],
    quests: [],
    promises: [],
    hooks: [],
    factions: [],
    locations: [],
    archive: [],
    bestiary: [],
    lore: [],
    illustrations: [],
    hiddenFacts: [],
    flags: {},
    log: [],
  };
}

/**
 * Старые сохранения не знают новых полей. Дополняем их при загрузке,
 * иначе первый же ход упадёт на отсутствующем массиве.
 */
export function normalizeState(state: GameState): GameState {
  state.items ??= [];
  state.party ??= [];
  state.npcs ??= [];
  state.quests ??= [];
  state.promises ??= [];
  state.hooks ??= [];
  state.factions ??= [];
  state.locations ??= [];
  state.archive ??= [];
  state.bestiary ??= [];
  state.lore ??= [];
  state.illustrations ??= [];
  state.hiddenFacts ??= [];
  state.flags ??= {};
  state.log ??= [];
  state.hero.wounds ??= [];
  state.hero.conditions ??= [];
  state.hero.statuses ??= [];
  if (typeof state.hero.health !== 'number') state.hero.health = 100;
  return state;
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
