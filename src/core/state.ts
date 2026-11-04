/**
 * Состояние кампании — единственный источник правды о цифрах.
 *
 * Проза живёт отдельно: она для игрока. Если проза и стейт расходятся,
 * прав стейт — и это надо чинить, а не «дописывать красиво».
 */

export type Role = 'player' | 'gm' | 'system';

import { defaultSkills } from './skills.ts';
import type { Rank, RankChange } from './rank.ts';

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

export interface Relation {
  with: string;
  feeling?: string;
  /** -100..100: как этот персонаж относится к другому */
  attitude?: number;
  note?: string;
}

export interface Reputation {
  /** -100..100: как героя видят горожане/общество */
  public: number;
  label: string;
  witnesses?: string[];
  note?: string;
}

export interface Actor {
  name: string;
  role: string;
  status: 'alive' | 'dead' | 'gone';
  /** 0..100, только для пати: насколько близко подпускает */
  bond: number;
  /** -100..100, отношение к герою */
  attitude?: number;
  /** 0..100: боевой дух пати */
  morale?: number;
  /** находится ли в текущей сцене */
  present?: boolean;
  /** скиллы персонажа: 0..20, используются в скрытых проверках */
  skills?: Record<string, number>;
  /** предрасположенность к навыкам: +2 к скрытым проверкам */
  skillAffinities?: Record<string, number>;
  /** временные штрафы/бонусы к навыкам */
  skillMods?: SkillMod[];
  /** личные цели, секреты и знание NPC */
  mind?: Mind;
  /** произвольные ресурсы: мана, топливо, рассудок, патроны */
  resources?: Resource[];
  /** кошелёк персонажа, если он есть в сцене */
  money?: { gold: number; silver: number; copper: number };
  /** валюты персонажа для миров без золота/серебра */
  currencies?: Currency[];
  wounds: Wound[];
  note?: string;
  /** карточка: внешность, характер, одежда, прошлое */
  appearance?: string;
  character?: string;
  clothes?: string;
  bio?: string;
  /** протяжённая история/биография */
  history?: string;
  /** что носит при себе (для пати и важных NPC) */
  inventory?: Item[];
  /** портрет, если нарисован */
  portrait?: string;
  /** мастер-лист: референс для всех дальнейших кадров */
  card?: string;
  /** привязанные референсы: основной + ракурсы/приметы */
  refs?: { main?: string; front?: string; back?: string; marks?: string; gallery?: string[] };
  /** ранг: FFF…SSR */
  rank?: Rank;
  rankPoints?: number;
  rankHistory?: RankChange[];
  rankLocked?: boolean;
  /** короткое описание для карточки */
  description?: string;
  /** способности из шаблона NPC */
  abilities?: string;
  /** чувства внутри пати: ревность, любовь, зависть */
  relations?: Relation[];
  /** забыт в корзине контейнера, но не удалён */
  archived?: boolean;
  archivedAt?: string;
  /** привычки и желания — для живой карточки */
  habits?: string;
  wants?: string;
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
  /** полное описание места */
  description?: string;
  /** история и события, которые здесь были */
  history?: string;
  /** карточка места */
  card?: string;
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
  clientTurnId?: string;
  /** техническая сверка чисел для новых ходов */
  numbers?: NumberChange[];
}

/** Ресурс карточки: мана, топливо, рассудок, патроны и т.п. */
export interface Resource {
  name: string;
  value: number;
  max?: number;
  unit?: string;
  note?: string;
}

/** Валюта мира: кредиты, доллары, ракушки, фантики — что угодно. */
export interface Currency {
  name: string;
  amount: number;
  symbol?: string;
  /** формы для числа: один, два, много */
  forms?: [string, string, string];
  primary?: boolean;
  note?: string;
}

/** Временный модификатор навыка: кандалы, яд, благословение. */
export interface SkillMod {
  skill: string;
  delta: number;
  reason: string;
}

/** Внутренний мир важного NPC. */
export interface Mind {
  goals?: string[];
  secrets?: string[];
  knows?: string[];
  notKnows?: string[];
  plans?: string[];
  mood?: string;
  updatedTurn?: number;
}

export interface MarketGood {
  name: string;
  price: number;
  currency?: string;
  qty: number;
}

export interface Market {
  place: string;
  goods: MarketGood[];
}

/** Календарь мира: месяцы, сезоны, луны и эпоха задаются один раз. */
export interface WorldCalendar {
  era: string;
  /** с какого года начинается отсчёт кампании */
  startYear?: number;
  /** с какого месяца начинается кампания; 0 — январь */
  startMonth?: number;
  months: { name: string; days: number }[];
  seasons: string[];
  moons: { name: string; period: number; phases: string[] }[];
  hasNight: boolean;
  hoursPerDay: number;
  note?: string;
}

/** Строка системной сверки: было → стало. */
export interface NumberChange {
  label: string;
  before: string;
  after: string;
  delta?: string;
  reason?: string;
}

export interface GameState {
  turn: number;
  time: { day: number; hour: number; minute?: number; second?: number };
  place: string;
  weather: string;
  hero: {
    name: string;
    /** 0..100, ниже нуля — смерть */
    health: number;
    /** произвольные ресурсы героя: мана, топливо, рассудок */
    resources?: Resource[];
    wounds: Wound[];
    conditions: string[];
    statuses: Status[];
    /** скиллы героя: 0..20 */
    skills?: Record<string, number>;
    /** временные штрафы/бонусы к навыкам */
    skillMods?: SkillMod[];
    /** мысли, интуиция и предчувствия — то, что герой чувствует, но не говорит */
    intuition?: string;
    /** мастер-лист героя: по нему рисуются сцены */
    card?: string;
    refs?: { main?: string; front?: string; back?: string; marks?: string; gallery?: string[] };
    /** пол героя */
    gender?: 'male' | 'female';
    /** поля карточки из формы создания */
    essence?: string;
    appearance?: string;
    bodyAttitude?: string;
    origin?: string;
    quirks?: string;
    start?: string;
    /** ранг героя */
    rank?: Rank;
    rankPoints?: number;
    rankHistory?: RankChange[];
    /** прошлое и способности — из шаблона героя */
    bio?: string;
    /** протяжённая история/биография */
    history?: string;
    /** предрасположенность к навыкам */
    skillAffinities?: Record<string, number>;
    abilities?: string;
  };
  money: { gold: number; silver: number; copper: number };
  /** валюты мира: если заданы — используются вместо money */
  currencies?: Currency[];
  /** календарь и эпоха этого мира */
  calendar?: WorldCalendar;
  market?: Market;
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
  /** репутация героя в обществе */
  reputation: Reputation;
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
    time: { day: 1, hour: 8, minute: 0, second: 0 },
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
    reputation: { public: 0, label: 'нейтрально', witnesses: [] },
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
  for (const location of state.locations) {
    location.note ??= '';
    location.description ??= '';
    location.history ??= '';
  }
  state.archive ??= [];
  state.reputation ??= { public: 0, label: 'нейтрально', witnesses: [] };
  state.reputation.public = Math.max(-100, Math.min(100, Number(state.reputation.public) || 0));
  state.reputation.label ||= 'нейтрально';
  state.reputation.witnesses ??= [];
  state.bestiary ??= [];
  state.lore ??= [];
  state.illustrations ??= [];
  state.hiddenFacts ??= [];
  state.flags ??= {};
  state.log ??= [];
  state.hero.wounds ??= [];
  state.hero.conditions ??= [];
  state.hero.statuses ??= [];
  if (!Array.isArray(state.hero.resources)) state.hero.resources = [];
  if (!Array.isArray(state.currencies)) state.currencies = [];
  state.time.minute = Number.isFinite(Number(state.time.minute)) ? Math.max(0, Math.min(59, Math.round(Number(state.time.minute)))) : 0;
  state.time.second = Number.isFinite(Number(state.time.second)) ? Math.max(0, Math.min(59, Math.round(Number(state.time.second)))) : 0;
  for (const list of [state.party, state.npcs]) {
    for (const actor of list) {
      if (!Array.isArray(actor.resources)) actor.resources = [];
      if (!Array.isArray(actor.currencies)) actor.currencies = [];
      if (!Array.isArray(actor.relations)) actor.relations = [];
      if (!Number.isFinite(Number(actor.morale))) actor.morale = 50;
      if (!actor.skillAffinities) actor.skillAffinities = {};
    }
  }
  if (typeof state.hero.health !== 'number') state.hero.health = 100;
  return state;
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
