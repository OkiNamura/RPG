/**
 * Симуляция мира между ходами.
 *
 * Не расписание уроков и не таймер сцены: только длинные фронты,
 * которые двигаются от поступков, репутации и времени.
 */
import type { GameState, WorldFront } from './state.ts';

/** Свести ценности фракций в отношение: общие нормы сближают, противоположные — ссорят. */
export function ensureFactionRelations(state: GameState): void {
  const factions = state.factions ?? [];
  for (let i = 0; i < factions.length; i += 1) {
    for (let j = i + 1; j < factions.length; j += 1) {
      const left = factions[i];
      const right = factions[j];
      left.relations ??= [];
      right.relations ??= [];
      if (left.relations.some((relation) => relation.with === right.name)) continue;
      const keys = new Set([...Object.keys(left.norms ?? {}), ...Object.keys(right.norms ?? {})]);
      let score = 0;
      for (const key of keys) {
        score += (left.norms?.[key] ?? 0) * (right.norms?.[key] ?? 0);
      }
      const attitude = Math.max(-40, Math.min(40, Math.round(score)));
      left.relations.push({ with: right.name, attitude });
      right.relations.push({ with: left.name, attitude });
    }
  }
}

export function advanceFactionRelations(state: GameState): string[] {
  ensureFactionRelations(state);
  const changes: string[] = [];
  const factions = state.factions ?? [];
  for (let i = 0; i < factions.length; i += 1) {
    for (let j = i + 1; j < factions.length; j += 1) {
      const left = factions[i];
      const right = factions[j];
      left.relations ??= [];
      right.relations ??= [];
      let leftRelation = left.relations.find((relation) => relation.with === right.name);
      let rightRelation = right.relations.find((relation) => relation.with === left.name);
      if (!leftRelation) {
        leftRelation = { with: right.name, attitude: 0 };
        left.relations.push(leftRelation);
      }
      if (!rightRelation) {
        rightRelation = { with: left.name, attitude: 0 };
        right.relations.push(rightRelation);
      }
      const leftFront = state.fronts?.find((front) => front.faction === left.name)?.progress;
      const rightFront = state.fronts?.find((front) => front.faction === right.name)?.progress;
      const frontGap = leftFront != null && rightFront != null ? Math.abs(leftFront - rightFront) : 0;
      const heroGap = Math.abs((left.attitude ?? 0) - (right.attitude ?? 0));
      const hasFronts = leftFront != null && rightFront != null;
      const drift = hasFronts
        ? (heroGap > 0 && heroGap <= 20 ? 1 : 0) - (frontGap >= 20 ? 1 : 0)
        : 0;
      if (drift !== 0) {
        const base = Number.isFinite(leftRelation.attitude) ? leftRelation.attitude : 0;
        leftRelation.attitude = clampRelation(base + drift);
        rightRelation.attitude = leftRelation.attitude;
      }
      const beforeNote = leftRelation.note;
      const nextLeft = relationNote(leftRelation.attitude, leftRelation.note);
      const nextRight = relationNote(rightRelation.attitude, rightRelation.note);
      leftRelation.note = nextLeft;
      rightRelation.note = nextRight;
      if ((nextLeft !== beforeNote || nextRight !== beforeNote) && (nextLeft || nextRight)) {
        changes.push(`${nextLeft ?? nextRight}: ${left.name} и ${right.name}`);
      }
    }
  }
  return changes;
}

function clampRelation(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function relationNote(attitude: number, current?: string): string | undefined {
  if (current === 'война') return attitude >= -25 ? 'перемирие' : 'война';
  if (current === 'союз') return attitude <= 25 ? 'перемирие' : 'союз';
  if (attitude <= -30) return 'война';
  if (attitude >= 30) return 'союз';
  return current === 'перемирие' ? 'перемирие' : current;
}

export function makeFrontsFromStory(state: GameState): WorldFront[] {
  const story = state.worldStory;
  if (!story?.factions?.length) return [];
  state.clocks = story.factions.map((faction, index) => ({
    id: `clock-${index + 1}-${faction.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32)}`,
    name: `Давление: ${faction.name}`,
    value: 0,
    max: 6,
    status: 'active',
    updatedTurn: state.turn,
  }));
  return story.factions.map((faction, index) => ({
    id: `front-${index + 1}-${faction.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32)}`,
    name: faction.name,
    goal: faction.interests || 'усилить влияние',
    faction: faction.name,
    progress: 0,
    status: 'active',
    updatedTurn: state.turn,
  }));
}

export function makeFrontsFromFactions(state: GameState): WorldFront[] {
  if (!state.factions?.length) return [];
  state.clocks = state.factions.map((faction, index) => ({
    id: `clock-${index + 1}-${faction.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32)}`,
    name: `Давление: ${faction.name}`,
    value: 0,
    max: 6,
    status: 'active',
    updatedTurn: state.turn,
  }));
  return state.factions.map((faction, index) => ({
    id: `front-${index + 1}-${faction.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 32)}`,
    name: faction.name,
    goal: faction.note || 'усилить влияние',
    faction: faction.name,
    progress: 0,
    status: 'active',
    updatedTurn: state.turn,
  }));
}

export function advanceWorld(state: GameState): string[] {
  if (!state.fronts?.length && !state.factions?.length) return [];
  const changes: string[] = [];
  state.clocks ??= [];
  for (const change of advanceFactionRelations(state)) changes.push(change);
  const now = state.time.day * 1440 + state.time.hour * 60 + (state.time.minute ?? 0);
  for (const event of state.events ?? []) {
    if (event.status && event.status !== 'active') continue;
    const at = event.at.day * 1440 + event.at.hour * 60 + event.at.minute;
    if (at > now) continue;
    event.status = 'done';
    changes.push(`событие: ${event.title}`);
    const front = state.fronts.find((item) => event.title.includes(item.name));
    if (front && front.status === 'active') {
      front.progress = Math.min(100, front.progress + (event.importance === 'critical' ? 4 : 2));
    }
  }
  for (const front of state.fronts) {
    if (front.status !== 'active') continue;
    const faction = state.factions.find((item) => item.name === front.faction);
    // Враждебная фракция и плохая репутация давят быстрее, союзная — медленнее.
    const pressure = 1 + (state.turn % 3 === 0 ? 1 : 0) + (faction && faction.attitude < -20 ? 1 : 0) + (state.reputation.public < -20 ? 1 : 0);
    front.progress = Math.max(0, Math.min(100, front.progress + pressure));
    front.updatedTurn = state.turn;
    const clock = state.clocks.find((item) => item.name === `Давление: ${front.name}`);
    if (clock && clock.status === 'active') {
      clock.value = Math.min(clock.max, clock.value + pressure);
      clock.updatedTurn = state.turn;
      if (clock.value >= clock.max) {
        clock.status = 'done';
        changes.push(`часы: ${clock.name} заполнены`);
      }
    }
    if (front.progress >= 25 && !front.quest) {
      front.quest = `Сдержать: ${front.name}`;
      state.quests.push({
        title: front.quest,
        status: 'active',
        steps: [front.goal ?? 'не дать фронту завершиться'],
        createdTurn: state.turn,
        turnsLimit: 20,
        clock: { value: 0, max: 6 },
      });
      changes.push(`квест: ${front.quest}`);
    }
    if (front.progress >= 50 && !front.npcEvent && state.worldStory?.npcLines?.length) {
      const line = state.worldStory.npcLines.find((item) => item.faction === front.faction);
      if (line) {
        front.npcEvent = true;
        state.events.push({
          id: `front-npc-${front.id}-${state.turn}`,
          at: { day: state.time.day, hour: Math.min(23, state.time.hour + 2), minute: 0 },
          title: `${line.name}: ${front.name}`,
          importance: 'meaningful',
          status: 'active',
        });
        changes.push(`линия NPC: ${line.name}`);
      }
    }
    if (front.progress >= 100) {
      front.status = 'resolved';
      const quest = state.quests.find((item) => item.title === front.quest);
      if (quest) quest.status = 'done';
      changes.push(`мир: фронт «${front.name}» завершён`);
      state.events.push({
        id: `front-done-${front.id}-${state.turn}`,
        at: {
          day: state.time.day,
          hour: Math.min(23, state.time.hour + 1),
          minute: 0,
        },
        title: `${front.name}: итог`,
        importance: 'meaningful',
        status: 'active',
      });
    }
  }
  for (const quest of state.quests) {
    if (quest.status !== 'active' || !quest.clock) continue;
    quest.clock.value = Math.min(quest.clock.max, quest.clock.value + 1);
    if (quest.clock.value >= quest.clock.max) {
      quest.status = 'failed';
      changes.push(`квест провален по часам: ${quest.title}`);
    }
  }
  return changes;
}
