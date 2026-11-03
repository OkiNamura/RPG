/**
 * Изменения состояния: разбор блока из ответа модели и применение к стейту.
 *
 * Принцип: модель предлагает, движок проверяет. Непрошедшее изменение
 * отбрасывается, ход продолжается — стейт нельзя испортить одним ответом.
 */

import { addHiddenFact, type Actor, type GameState, type Item, type Quest, type Resource, type Status } from './state.ts';

/** Изменение ресурса: можно задать новое значение или прирост. */
export interface ResourcePatch {
  name: string;
  value?: number;
  delta?: number;
  max?: number;
  unit?: string;
  note?: string;
  reason?: string;
}

/** Карточка персонажа: одна и та же для пати и для знакомых. */
export interface ActorPatch {
  name: string;
  role?: string;
  status?: Actor['status'];
  note?: string;
  bond?: number;
  attitude?: number;
  /** в сцене ли прямо сейчас */
  present?: boolean;
  appearance?: string;
  character?: string;
  clothes?: string;
  bio?: string;
  /** короткое описание для карточки */
  description?: string;
  /** способности/умения */
  abilities?: string;
  skills?: Record<string, number>;
  rank?: Actor['rank'];
  rankPoints?: number;
  relations?: { with: string; feeling: string }[];
  resources?: ResourcePatch[];
  money?: { gold?: number; silver?: number; copper?: number };
}

export interface Delta {
  place?: string;
  weather?: string;
  advanceHours?: number;
  health?: number;
  healthReason?: string;
  money?: { gold?: number; silver?: number; copper?: number };
  moneyReason?: string;
  /** ресурсы героя: мана, топливо, рассудок и т.п. */
  heroResources?: ResourcePatch[];
  addItems?: { name: string; qty: number; where?: Item['where']; reason?: string }[];
  removeItems?: { name: string; qty: number; reason?: string }[];
  conditions?: string[];
  conditionsRemove?: string[];
  statuses?: Status[];
  statusRemove?: string[];
  wounds?: { where: string; severity: 1 | 2 | 3 }[];
  /** какие раны обработаны и заживают */
  healWounds?: string[];
  flags?: Record<string, string | number | boolean>;
  promises?: string[];
  hiddenFacts?: { content: string }[];
  quests?: {
    title: string;
    status?: Quest['status'];
    steps?: string[];
    deadline?: string;
    turnsLimit?: number;
  }[];
  npcs?: ActorPatch[];
  party?: ActorPatch[];
  factions?: {
    name: string;
    attitude?: number;
    note?: string;
    leader?: string;
    shadow?: string;
    roster?: { name: string; role: string; note?: string; hidden?: boolean }[];
  }[];
  places?: { name: string; note?: string }[];
  lore?: { keys: string[]; content: string }[];
  intuition?: string;
  heroSkills?: Record<string, number>;
  /** очки ранга за значимое событие (0..10); обычный ход — 0 или 1 */
  rankGain?: number;
  rankReason?: string;
  hooks?: string[];
  /** закрытые крючки и обещания уходят в архив, а не висят вечно */
  resolveHooks?: string[];
  resolvePromises?: string[];
  archive?: { kind: 'hook' | 'promise' | 'quest' | 'item'; text: string; reason?: string }[];
  bestiary?: { name: string; note?: string; danger?: 1 | 2 | 3 }[];
}

const FENCE = /```json\s*([\s\S]*?)```/g;

export interface ParsedReply {
  prose: string;
  delta: Delta | null;
  error?: string;
}

export function parseDelta(raw: string): ParsedReply {
  const matches = [...raw.matchAll(FENCE)];
  if (matches.length === 0) {
    return { prose: raw.trim(), delta: null };
  }
  const last = matches[matches.length - 1];
  const prose = raw.replace(last[0], '').trim();
  try {
    const delta = JSON.parse(last[1]) as Delta;
    return { prose, delta };
  } catch (err) {
    return { prose, delta: null, error: `не разобрал JSON: ${String(err)}` };
  }
}

/**
 * Описания сцены — не знакомства. Фильтр по родовым словам, но имена
 * вроде «Капюшон» или «Плотный» проходят: это прозвища, а не описание.
 */
function looksGeneric(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;

  // «кто-то», «некто» — вообще не персонаж
  if (/^(кто-то|кто то|некто|что-то|нечто|неизвестно)$/i.test(n)) return true;

  // «человек», «женщина», «силуэт» и т.п. как отдельное слово внутри имени
  const generic =
    /(^|\s)(человек|женщина|мужчина|силуэт|фигура|голос|отражение|пара|пятно|парень|девушка|старик|старуха|незнакомец|незнакомка|тень|существо|тварь|мальчик|девочка|ребёнок|ребенок)(\s|$)/i;

  return generic.test(n);
}

/** Убираем служебные «обещание:», «обещаю», чтобы сравнить суть, а не форму. */
function normPromise(text: string): string {
  let value = text.toLowerCase().replace(/[.,;:!?…]+$/g, '').trim();
  for (let i = 0; i < 2; i += 1) {
    value = value.replace(/^(обещание|обещаю|обещал|обещала|клянусь)\s*:?\s*/i, '').trim();
  }
  return value;
}
function archive(state: GameState, kind: 'hook' | 'promise' | 'quest' | 'item', text: string, reason: string): void {
  const clean = text.trim();
  if (!clean) return;
  if (state.archive.some((a) => a.kind === kind && a.text.toLowerCase() === clean.toLowerCase())) return;
  state.archive.push({ kind, text: clean, turn: state.turn, reason });
}

/** Найти и вынуть запись по нечёткому совпадению. */
function takeMatch(list: string[], needle: string): string | null {
  const n = needle.toLowerCase().trim();
  if (!n) return null;
  let index = list.findIndex((item) => item.toLowerCase() === n);
  if (index === -1) index = list.findIndex((item) => item.toLowerCase().includes(n) || n.includes(item.toLowerCase()));
  if (index === -1) return null;
  const [value] = list.splice(index, 1);
  return value;
}

/** Один и тот же человек мог прийти под именем и под прозвищем. */
/** Ключ имени: без регистра, пробелов и пунктуации — «Ли» и «ли.» одно лицо. */
export function actorKey(name: string): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[«»"'`.,!?;:()\[\]{}<>—–-]/g, '')
    .replace(/\s+/g, ' ');
}

function sameNpc(existing: Actor, incoming: { name: string; role?: string }): boolean {
  const a = actorKey(existing.name);
  const b = actorKey(incoming.name);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  if (incoming.role && actorKey(incoming.role).includes(a)) return true;
  return false;
}

/** Слить дубликаты в одном списке, сохраняя более полную карточку. */
function dedupeList(list: Actor[]): Actor[] {
  const byKey = new Map<string, Actor>();
  for (const actor of list) {
    const key = actorKey(actor.name);
    if (!key) continue;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, { ...actor });
      continue;
    }
    const merged: Actor = { ...previous };
    for (const [field, value] of Object.entries(actor)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value) && value.length === 0) continue;
      (merged as unknown as Record<string, unknown>)[field] = value;
    }
    // Статус: dead/gone важнее alive; present — последний.
    if (previous.status !== 'alive') merged.status = previous.status;
    byKey.set(key, merged);
  }
  return [...byKey.values()];
}

/** Починить дубликаты в готовом состоянии. true — что-то изменилось. */
export function dedupeActorLists(state: GameState): boolean {
  const partyBefore = state.party.length;
  const npcsBefore = state.npcs.length;
  state.party = dedupeList(state.party);
  state.npcs = dedupeList(state.npcs);
  // Если персонаж есть и в пати, и в знакомых — оставляем только в пати.
  const partyKeys = new Set(state.party.map((actor) => actorKey(actor.name)));
  state.npcs = state.npcs.filter((actor) => !partyKeys.has(actorKey(actor.name)));
  return state.party.length !== partyBefore || state.npcs.length !== npcsBefore;
}

function clampScore(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** Добавляет или обновляет карточку персонажа: пати и знакомые устроены одинаково. */
function upsertActor(
  list: Actor[],
  patch: ActorPatch,
  prefix: string,
  other?: Actor[],
  changes: string[] = [],
): string {
  const status: Actor['status'] =
    patch.status === 'dead' || patch.status === 'gone' ? patch.status : 'alive';
  let existing = list.find((a) => sameNpc(a, patch));
  if (!existing && other) {
    const index = other.findIndex((a) => sameNpc(a, patch));
    if (index >= 0) {
      existing = other.splice(index, 1)[0];
      list.push(existing);
    }
  }

  if (existing) {
    if (patch.status) existing.status = status;
    if (patch.role) existing.role = patch.role;
    if (patch.note) existing.note = patch.note;
    if (patch.appearance) existing.appearance = patch.appearance;
    if (patch.character) existing.character = patch.character;
    if (patch.clothes) existing.clothes = patch.clothes;
    if (patch.bio) existing.bio = patch.bio;
    if (patch.description) existing.description = patch.description;
    if (patch.abilities) existing.abilities = patch.abilities;
    if (patch.skills) existing.skills = { ...(existing.skills ?? {}), ...patch.skills };
    if (patch.rank) existing.rank = patch.rank;
    if (typeof patch.rankPoints === 'number') existing.rankPoints = patch.rankPoints;
    if (patch.relations) existing.relations = patch.relations;
    if (patch.resources) applyResourcePatches(existing, patch.resources, existing.name, changes);
    if (patch.money) {
      existing.money ??= { gold: 0, silver: 0, copper: 0 };
      if (applyCoins(existing.money, patch.money)) changes.push(`кошелёк ${existing.name}: изменён`);
    }
    if (typeof patch.present === 'boolean') existing.present = patch.present;

    const attitude = clampScore(patch.attitude);
    if (attitude !== undefined) existing.attitude = attitude;
    const bond = clampScore(patch.bond);
    if (bond !== undefined) existing.bond = bond;

    return `${prefix}: ${existing.name}`;
  }

  const created: Actor = {
    name: patch.name,
    role: patch.role ?? '',
    status,
    bond: clampScore(patch.bond) ?? 0,
    attitude: clampScore(patch.attitude),
    present: patch.present ?? true,
    resources: [],
    money: patch.money ? { gold: 0, silver: 0, copper: 0 } : undefined,
    wounds: [],
    note: patch.note,
    appearance: patch.appearance,
    character: patch.character,
    clothes: patch.clothes,
    bio: patch.bio,
    description: patch.description,
    abilities: patch.abilities,
    skills: patch.skills,
    rank: patch.rank ?? 'F',
    rankPoints: patch.rankPoints ?? 0,
    rankHistory: [],
    relations: patch.relations,
  };
  if (patch.resources) applyResourcePatches(created, patch.resources, created.name, changes);
  if (patch.money) applyCoins(created.money!, patch.money);
  list.push(created);
  return `${prefix}: ${patch.name}`;
}

function findItem(state: GameState, name: string): Item | undefined {
  return state.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
}

/** Агент может прислать «карман» вместо inventory — приводим к схеме. */
function normalizeWhere(value: unknown): Item['where'] {
  const raw = String(value ?? '').toLowerCase().trim();
  if (raw === 'equipped' || raw === 'inventory' || raw === 'vault' || raw === 'lost') return raw;
  if (/(карман|сумк|рюкзак|мешок|пояс)/.test(raw)) return 'inventory';
  if (/(рук|надет|на себе|экип|оружи)/.test(raw)) return 'equipped';
  if (/(схрон|хранил|тайник|сундук|дом)/.test(raw)) return 'vault';
  if (/(потеря|выброс|брошен)/.test(raw)) return 'lost';
  return 'inventory';
}

/** Применяет ресурсы к герою или карточке NPC. */
function applyResourcePatches(
  target: { resources?: Resource[] },
  patches: ResourcePatch[] | undefined,
  label: string,
  changes: string[],
): void {
  if (!Array.isArray(patches) || !patches.length) return;
  target.resources ??= [];
  for (const patch of patches) {
    const name = String(patch?.name ?? '').trim().slice(0, 40);
    if (!name) continue;
    let resource = target.resources.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!resource) {
      resource = { name, value: 0 };
      target.resources.push(resource);
    }
    const before = resource.value;
    if (typeof patch.max === 'number' && Number.isFinite(patch.max)) {
      resource.max = Math.max(0, patch.max);
    }
    if (typeof patch.unit === 'string' && patch.unit.trim()) resource.unit = patch.unit.trim().slice(0, 12);
    if (typeof patch.note === 'string' && patch.note.trim()) resource.note = patch.note.trim().slice(0, 120);
    if (typeof patch.value === 'number' && Number.isFinite(patch.value)) {
      resource.value = patch.value;
    } else if (typeof patch.delta === 'number' && Number.isFinite(patch.delta)) {
      resource.value += patch.delta;
    }
    resource.value = Math.max(0, Number(resource.value.toFixed(2)));
    if (typeof resource.max === 'number') {
      resource.value = Math.min(resource.max, resource.value);
    }
    if (resource.value !== before) {
      changes.push(`${label} · ${resource.name}: ${before} → ${resource.value}`);
    }
  }
}

function applyCoins(
  wallet: { gold: number; silver: number; copper: number },
  patch: { gold?: number; silver?: number; copper?: number },
): boolean {
  let changed = false;
  for (const key of ['gold', 'silver', 'copper'] as const) {
    const next = patch[key];
    if (typeof next !== 'number' || !Number.isFinite(next)) continue;
    const value = Math.max(0, Math.round(next));
    if (wallet[key] !== value) {
      wallet[key] = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Применяет изменения. Возвращает человекочитаемый журнал:
 * по нему видно, что реально поменялось, а что отброшено.
 */
export function applyDelta(state: GameState, delta: Delta): string[] {
  const changes: string[] = [];
  // Старые кампании могли не иметь лор-книги.
  state.lore ??= [];

  if (typeof delta.advanceHours === 'number' && delta.advanceHours > 0) {
    const total = state.time.hour + delta.advanceHours;
    const addDays = Math.floor(total / 24);
    state.time.hour = total % 24;
    state.time.day += addDays;
    changes.push(`время +${delta.advanceHours} ч`);
  }

  if (typeof delta.place === 'string' && delta.place.trim()) {
    state.place = delta.place.trim();
    changes.push(`место: ${state.place}`);
  }

  if (typeof delta.weather === 'string' && delta.weather.trim()) {
    state.weather = delta.weather.trim();
    changes.push(`погода: ${state.weather}`);
  }

  if (delta.money) {
    const total = state.money.gold + state.money.silver + state.money.copper;
    const incoming = delta.money;
    const zeroes =
      (incoming.gold ?? state.money.gold) === 0 &&
      (incoming.silver ?? state.money.silver) === 0 &&
      (incoming.copper ?? state.money.copper) === 0;

    // Явные все три поля — игрок/агент сознательно потратил всё; иначе
    // считаем нулевой кошель ошибкой модели и отбрасываем.
    const explicitAll = ['gold', 'silver', 'copper'].every((key) =>
      Object.prototype.hasOwnProperty.call(incoming, key),
    );

    // Агент иногда «обнуляет» кошель, хотя герой ничего не тратил.
    // Такое изменение отбрасываем: деньги теряются только по явной причине.
    if (zeroes && total > 0 && !explicitAll) {
      changes.push('отброшено: обнуление кошеля без причины');
    } else {
      for (const key of ['gold', 'silver', 'copper'] as const) {
        const value = incoming[key];
        if (typeof value === 'number') {
          if (value < 0) {
            changes.push(`отброшено: ${key} < 0`);
            continue;
          }
          state.money[key] = value;
          changes.push(`${key}: ${value}`);
        }
      }
    }
  }

  for (const add of delta.addItems ?? []) {
    if (!add.name || add.qty <= 0) continue;
    const existing = findItem(state, add.name);
    if (existing) {
      existing.qty += add.qty;
      if (add.where) existing.where = normalizeWhere(add.where);
    } else {
      state.items.push({ name: add.name, qty: add.qty, where: normalizeWhere(add.where) });
    }
    changes.push(`+ ${add.name}×${add.qty}`);
  }

  for (const rem of delta.removeItems ?? []) {
    const existing = findItem(state, rem.name);
    if (!existing) {
      changes.push(`отброшено: нет предмета «${rem.name}»`);
      continue;
    }
    existing.qty -= rem.qty;
    if (existing.qty <= 0) {
      state.items = state.items.filter((i) => i !== existing);
      changes.push(`− ${rem.name}`);
    } else {
      changes.push(`− ${rem.name}×${rem.qty}`);
    }
  }

  for (const cond of delta.conditions ?? []) {
    if (!state.hero.conditions.includes(cond)) {
      state.hero.conditions.push(cond);
      changes.push(`состояние: ${cond}`);
    }
  }

  for (const wound of delta.wounds ?? []) {
    const where = String(wound.where ?? '').trim();
    if (!where) continue;

    const existing = state.hero.wounds.find((w) => w.where.toLowerCase() === where.toLowerCase());
    if (existing) {
      // Рана в то же место не плодит дубликаты — она углубляется.
      existing.severity = Math.min(3, existing.severity + 1) as 1 | 2 | 3;
      existing.treated = false;
      changes.push(`рана углубилась: ${where} (${existing.severity})`);
    } else {
      state.hero.wounds.push({ where, severity: wound.severity, treated: false });
      changes.push(`рана: ${where} (${wound.severity})`);
    }
  }

  if (typeof delta.health === 'number' && Number.isFinite(delta.health)) {
    state.hero.health = Math.max(0, Math.min(150, Math.round(delta.health)));
    changes.push(`здоровье: ${state.hero.health}`);
    if (state.hero.health <= 0) {
      state.flags.dead = true;
      if (!state.hero.conditions.includes('мёртв')) state.hero.conditions.push('мёртв');
      changes.push('герой мёртв');
    }
  }

  applyResourcePatches(state.hero, delta.heroResources, 'герой', changes);

  for (const where of delta.healWounds ?? []) {
    const wound = state.hero.wounds.find(
      (w) => w.where.toLowerCase() === String(where).toLowerCase(),
    );
    if (!wound) continue;
    wound.treated = true;
    wound.severity = Math.max(1, wound.severity - 1) as 1 | 2 | 3;
    changes.push(`рана обработана: ${wound.where}`);
  }

  for (const cond of delta.conditionsRemove ?? []) {
    const at = state.hero.conditions.findIndex(
      (c) => c.toLowerCase() === String(cond).toLowerCase(),
    );
    if (at >= 0) {
      state.hero.conditions.splice(at, 1);
      changes.push(`состояние снято: ${cond}`);
    }
  }

  for (const status of delta.statuses ?? []) {
    if (!status?.name) continue;
    const existing = state.hero.statuses.find((s) => s.name.toLowerCase() === status.name.toLowerCase());
    if (existing) {
      existing.kind = status.kind ?? existing.kind;
      if (status.note) existing.note = status.note;
    } else {
      state.hero.statuses.push({ name: status.name, kind: status.kind ?? 'buff', note: status.note });
      changes.push(`${status.kind === 'debuff' ? 'дебаф' : 'баф'}: ${status.name}`);
    }
  }

  for (const name of delta.statusRemove ?? []) {
    const before = state.hero.statuses.length;
    state.hero.statuses = state.hero.statuses.filter(
      (s) => s.name.toLowerCase() !== String(name).toLowerCase(),
    );
    if (state.hero.statuses.length !== before) changes.push(`снято: ${name}`);
  }

  for (const promise of delta.promises ?? []) {
    const text = String(promise ?? '').trim();
    // Модель иногда оставляет заглушки вида promise_2 или s_push_1.
    if (!text || /^[a-z_]+\d*$/i.test(text)) continue;

    const normalized = normPromise(text);
    const exists = state.promises.some((p) => normPromise(p) === normalized);
    if (!exists) {
      state.promises.push(text);
      changes.push(`обещание: ${text}`);
    }
  }

  // Обещания не режем: закрытые уходят в архив, остальные живут.
  for (const closing of delta.resolvePromises ?? []) {
    const taken = takeMatch(state.promises, closing);
    if (taken) {
      archive(state, 'promise', taken, 'выполнено или снято');
      changes.push(`обещание закрыто: ${taken}`);
    }
  }

  for (const quest of delta.quests ?? []) {
    if (!quest.title) continue;
    const existing = state.quests.find((q) => q.title.toLowerCase() === quest.title.toLowerCase());
    if (existing) {
      if (quest.status) existing.status = quest.status;
      if (quest.steps?.length) existing.steps = quest.steps;
      if (quest.deadline) existing.deadline = quest.deadline;
      if (typeof quest.turnsLimit === 'number') existing.turnsLimit = quest.turnsLimit;
      changes.push(`задача: ${existing.title} [${existing.status}]`);
      if (existing.status === 'failed') {
        archive(state, 'quest', existing.title, 'брошено');
      } else if (existing.status === 'done') {
        archive(state, 'quest', existing.title, 'выполнено');
      }
    } else {
      state.quests.push({
        title: quest.title,
        status: quest.status ?? 'active',
        steps: quest.steps ?? [],
        deadline: quest.deadline,
        createdTurn: state.turn,
        turnsLimit: quest.turnsLimit,
      });
      changes.push(`+ задача: ${quest.title}`);
    }
  }

  // Срок — часть задания: просроченное закрывается последствиями, а не висит.
  for (const quest of state.quests) {
    if (quest.status !== 'active') continue;
    if (typeof quest.turnsLimit !== 'number' || typeof quest.createdTurn !== 'number') continue;
    if (state.turn - quest.createdTurn <= quest.turnsLimit) continue;

    quest.status = 'failed';
    archive(state, 'quest', quest.title, 'просрочено');
    const hook = `Просрочено: «${quest.title}». За это спросят.`;
    if (!state.hooks.includes(hook)) state.hooks.push(hook);
    changes.push(`задача просрочена: ${quest.title}`);
  }

  for (const npc of delta.npcs ?? []) {
    if (!npc.name) continue;
    if (looksGeneric(npc.name)) {
      changes.push(`отброшено: безличный NPC «${npc.name}»`);
      continue;
    }
    const inParty = state.party.some((actor) => sameNpc(actor, npc));
    changes.push(inParty ? upsertActor(state.party, npc, '= пати', undefined, changes) : upsertActor(state.npcs, npc, '+ NPC', undefined, changes));
  }

  for (const member of delta.party ?? []) {
    if (!member.name) continue;
    changes.push(upsertActor(state.party, member, '+ в пати', state.npcs, changes));
  }
  dedupeActorLists(state);

  // Знакомые тоже копятся: держим последних шестидесяти.
  const NPCS_LIMIT = 60;
  if (state.npcs.length > NPCS_LIMIT) {
    state.npcs = state.npcs.slice(-NPCS_LIMIT);
  }

  for (const faction of delta.factions ?? []) {
    if (!faction.name) continue;
    const existing = state.factions.find(
      (f) => f.name.toLowerCase() === faction.name.toLowerCase(),
    );
    const attitude = Math.max(-100, Math.min(100, Number(faction.attitude ?? existing?.attitude ?? 0)));
    if (existing) {
      existing.attitude = attitude;
      if (faction.note) existing.note = faction.note;
      if (faction.leader) existing.leader = faction.leader;
      if (faction.shadow) existing.shadow = faction.shadow;
      if (faction.roster?.length) existing.roster = faction.roster;
      changes.push(`фракция: ${existing.name} (${attitude})`);
    } else {
      state.factions.push({
        name: faction.name,
        attitude,
        note: faction.note,
        leader: faction.leader,
        shadow: faction.shadow,
        roster: faction.roster,
      });
      // Автолор: организация сама попадает в книгу.
      const parts = [faction.leader ? `глава: ${faction.leader}` : '', faction.shadow ? `тень: ${faction.shadow}` : faction.note ?? ''];
      state.lore.push({
        keys: [faction.name],
        content: `${faction.name}${parts.filter(Boolean).length ? ` — ${parts.filter(Boolean).join(', ')}` : ''}`,
      });
      changes.push(`+ фракция: ${faction.name} (${attitude})`);
    }
  }

  // Автолор: агент сам заводит записи для лор-книги.
  for (const entry of delta.lore ?? []) {
    const keys = (entry.keys ?? []).map((k) => String(k).trim()).filter(Boolean);
    const content = String(entry.content ?? '').trim();
    if (keys.length === 0 || !content) continue;
    if (state.lore.some((e) => e.content === content)) continue;
    state.lore.push({ keys: keys.slice(0, 8), content });
    changes.push(`лор: ${content.slice(0, 40)}`);
  }

  // Мысли героя: короткая строка, что он чувствует и подозревает.
  if (typeof delta.intuition === 'string' && delta.intuition.trim()) {
    state.hero.intuition = delta.intuition.trim().slice(0, 240);
    changes.push('мысли героя обновлены');
  }

  // Скиллы героя: точечные правки, значения 0..20.
  for (const [skill, value] of Object.entries(delta.heroSkills ?? {})) {
    const score = Math.max(0, Math.min(20, Number(value)));
    if (!Number.isFinite(score)) continue;
    state.hero.skills = { ...(state.hero.skills ?? {}), [skill]: score };
    changes.push(`скилл: ${skill} ${score}`);
  }

  for (const place of delta.places ?? []) {
    if (!place.name) continue;
    const existing = state.locations.find((l) => l.name.toLowerCase() === place.name.toLowerCase());
    if (existing) {
      if (place.note) existing.note = place.note;
    } else {
      state.locations.push({ name: place.name, note: place.note ?? '' });
  // Автолор: новое место само попадает в лор-книгу.
  state.lore.push({ keys: [place.name], content: `${place.name}${place.note ? ` — ${place.note}` : ''}` });
      changes.push(`+ место: ${place.name}`);
    }
  }

  // Мест тоже может стать много — держим последние сорок.
  const LOCATIONS_LIMIT = 40;
  if (state.locations.length > LOCATIONS_LIMIT) {
    state.locations = state.locations.slice(-LOCATIONS_LIMIT);
  }

  const hookKey = (value: string) =>
    value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  for (const hook of delta.hooks ?? []) {
    if (!hook) continue;
    const key = hookKey(hook);
    const duplicate = state.hooks.some((existing) => hookKey(existing) === key);
    if (!duplicate) {
      state.hooks.push(hook);
      changes.push(`крючок: ${hook}`);
    }
  }

  // Крючки не растут бесконечно: старые уходят, свежие остаются.
  const HOOKS_LIMIT = 30;
  if (state.hooks.length > HOOKS_LIMIT) {
    const extra = state.hooks.length - HOOKS_LIMIT;
    const dropped = state.hooks.splice(0, extra);
    for (const hook of dropped) archive(state, 'hook', hook, 'вытеснен');
    changes.push(`крючки вытеснены в архив: ${dropped.length}`);
  }

  // Закрытые крючки уходят в архив, а не висят вечно.
  for (const closing of delta.resolveHooks ?? []) {
    const taken = takeMatch(state.hooks, closing);
    if (taken) {
      archive(state, 'hook', taken, 'закрыт');
      changes.push(`крючок закрыт: ${taken}`);
    }
  }

  // Если крючков стало слишком много — старые уходят в архив, не теряясь.
  const HOOKS_ACTIVE_LIMIT = 60;
  if (state.hooks.length > HOOKS_ACTIVE_LIMIT) {
    const overflow = state.hooks.splice(0, state.hooks.length - HOOKS_ACTIVE_LIMIT);
    for (const item of overflow) archive(state, 'hook', item, 'вытеснен');
    changes.push(`крючков в архив: ${overflow.length}`);
  }

  for (const entry of delta.archive ?? []) {
    archive(state, entry.kind, entry.text, entry.reason ?? 'в архив');
    changes.push(`архив: ${entry.text}`);
  }

  for (const beast of delta.bestiary ?? []) {
    if (!beast?.name) continue;
    const existing = state.bestiary.find((b) => b.name.toLowerCase() === beast.name.toLowerCase());
    if (existing) {
      if (beast.note) existing.note = beast.note;
      if (beast.danger) existing.danger = beast.danger;
    } else {
      state.bestiary.push({ name: beast.name, note: beast.note, danger: beast.danger });
  state.lore.push({ keys: [beast.name], content: `${beast.name}${beast.note ? ` — ${beast.note}` : ''}` });
      changes.push(`бестиарий: ${beast.name}`);
    }
  }

  for (const fact of delta.hiddenFacts ?? []) {
    const created = addHiddenFact(state, fact.content);
    changes.push(`скрытый факт ${created.id}`);
  }

  if (delta.flags) {
    for (const [key, value] of Object.entries(delta.flags)) {
      state.flags[key] = value;
      changes.push(`флаг ${key}=${String(value)}`);
    }
  }

  return changes;
}
