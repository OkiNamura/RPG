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

import type { WorldStory } from './world-story.ts';

export interface Reputation {
  /** -100..100: как героя видят горожане/общество */
  public: number;
  label: string;
  witnesses?: string[];
  note?: string;
  /** отношение отдельных фракций */
  byFaction?: Record<string, number>;
}

/** Универсальная норма мира: не «грех», а ценность с весом. */
export interface Norm {
  id: string;
  label: string;
  /** 0..5: насколько мир/сторона ценит норму */
  weight: number;
  /** важно ли нарушение даже без свидетелей */
  internalized?: boolean;
}

export interface NormViolation {
  normId: string;
  severity: 1 | 2 | 3;
  public?: boolean;
  witnesses?: string[];
  evidence?: string;
  reason?: string;
}

/** Чекпоинт текущей сцены: где, когда и кто, без жёсткого таймера. */
export interface SceneState {
  id: string;
  startedTurn: number;
  updatedTurn: number;
  place: string;
  participants: string[];
  goal?: string;
  lastBeat?: string;
  stalls: number;
}

/** Долгий фронт мира: не таймер сцены, а давление между ходами. */
export interface WorldFront {
  id: string;
  name: string;
  goal?: string;
  faction?: string;
  progress: number;
  status: 'active' | 'resolved' | 'failed';
  updatedTurn: number;
  /** квест, созданный при усилении фронта */
  quest?: string;
}

/** Часы мира: долгий прогресс, который виден игроку. */
export interface WorldClock {
  id: string;
  name: string;
  value: number;
  max: number;
  status: 'active' | 'done';
  updatedTurn: number;
}

/** Обновить чекпоинт сцены после хода. Не задаёт расписание и таймеры. */
export function updateSceneCheckpoint(state: GameState, prose: string, stalled = false): SceneState {
  const participants = [
    state.hero.name,
    ...state.party.filter((actor) => actor.status === 'alive').map((actor) => actor.name),
    ...state.npcs.filter((actor) => actor.present && !actor.archived).map((actor) => actor.name),
  ].filter(Boolean);
  const beat = prose.replace(/\s+/g, ' ').trim().slice(0, 180);
  const previous = state.scene;
  if (!previous || previous.place !== state.place) {
    state.scene = {
      id: `scene-${state.turn}-${state.place.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}`,
      startedTurn: state.turn,
      updatedTurn: state.turn,
      place: state.place,
      participants: [...new Set(participants)],
      lastBeat: beat,
      stalls: stalled ? 1 : 0,
    };
    return state.scene;
  }
  previous.updatedTurn = state.turn;
  previous.participants = [...new Set(participants)];
  previous.lastBeat = beat;
  previous.stalls = stalled ? (previous.stalls ?? 0) + 1 : 0;
  if (previous.stalls >= 2) previous.goal = 'сцена топчется: нужен новый факт';
  else if (previous.goal === 'сцена топчется: нужен новый факт') previous.goal = undefined;
  return previous;
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
  /** источник: норма, фракция, событие */
  source?: string;
  severity?: number;
  witnesses?: string[];
  until?: string;
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
  /** собственные веса норм; отсутствующие берутся из мира */
  norms?: Record<string, number>;
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
  /** часы задачи: сколько шагов осталось до провала */
  clock?: { value: number; max: number };
}

/** Событие календаря: встреча, дедлайн, будильник, прибытие, поломка. */
export interface StateEvent {
  id: string;
  at: { day: number; hour: number; minute: number };
  title: string;
  importance: 'critical' | 'meaningful' | 'ambient' | 'silent';
  /** может ли событие разбудить героя */
  wake?: boolean;
  place?: string;
  status?: 'active' | 'done' | 'missed';
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
  /** репутация, при которой сформированы цены */
  reputation?: number;
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
  /** календарь событий: встречи, дедлайны, будильники, прибытие */
  events: StateEvent[];
  /** последний явный скачок времени: нужен для отчёта и продолжения */
  lastTimeSkip?: {
    from: { day: number; hour: number; minute: number; second?: number };
    to: { day: number; hour: number; minute: number; second?: number };
    target: string;
    atTurn: number;
  };
  promises: string[];
  /** открытые крючки: вопросы и угрозы, за которые спросят позже */
  hooks: string[];
  /** отношения с группами: гильдии, культы, знать, город */
  factions: Faction[];
  /** универсальные нормы мира */
  norms: Norm[];
  /** рамка сюжета мира: заполняется мастером промтов */
  worldStory?: WorldStory;
  /** текущая сцена: чекпоинт для resume и защиты от топтания */
  scene?: SceneState;
  /** долгие фронты мира, которые двигаются между ходами */
  fronts: WorldFront[];
  /** видимые часы мира */
  clocks: WorldClock[];
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

/** Базовый словарь ценностей. Мир/фракции переопределяют веса. */
export const DEFAULT_NORMS: Norm[] = [
  { id: 'honesty', label: 'Честность', weight: 2, internalized: true },
  { id: 'loyalty', label: 'Верность своим', weight: 3, internalized: true },
  { id: 'law', label: 'Закон', weight: 2, internalized: false },
  { id: 'piety', label: 'Почитание богов', weight: 2, internalized: true },
  { id: 'purity', label: 'Чистота и традиция', weight: 2, internalized: false },
  { id: 'courage', label: 'Смелость', weight: 2, internalized: true },
  { id: 'mercy', label: 'Милосердие', weight: 2, internalized: true },
  { id: 'freedom', label: 'Свобода', weight: 2, internalized: true },
];

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
    events: [],
    promises: [],
    hooks: [],
    factions: [],
    norms: DEFAULT_NORMS.map((norm) => ({ ...norm })),
    fronts: [],
    clocks: [],
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
  state.events ??= [];
  state.promises ??= [];
  state.hooks ??= [];
  state.factions ??= [];
  state.norms ??= DEFAULT_NORMS.map((norm) => ({ ...norm }));
  state.fronts ??= [];
  state.clocks ??= [];
  state.worldStory ??= undefined;
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
