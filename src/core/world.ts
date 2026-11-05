/**
 * Симуляция мира между ходами.
 *
 * Не расписание уроков и не таймер сцены: только длинные фронты,
 * которые двигаются от поступков, репутации и времени.
 */
import type { GameState, WorldFront } from './state.ts';

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

export function advanceWorld(state: GameState): string[] {
  if (!state.fronts?.length) return [];
  const changes: string[] = [];
  state.clocks ??= [];
  for (const front of state.fronts) {
    if (front.status !== 'active') continue;
    const faction = state.factions.find((item) => item.name === front.faction);
    // Враждебная фракция давит быстрее, союзная — медленнее.
    const pressure = 1 + (state.turn % 3 === 0 ? 1 : 0) + (faction && faction.attitude < -20 ? 1 : 0);
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
      });
      changes.push(`квест: ${front.quest}`);
    }
    if (front.progress >= 100) {
      front.status = 'resolved';
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
  return changes;
}
