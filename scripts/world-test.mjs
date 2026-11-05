#!/usr/bin/env node
import { createState, updateSceneCheckpoint } from '../src/core/state.ts';
import { advanceWorld, makeFrontsFromStory } from '../src/core/world.ts';
import { normalizeWorldStory } from '../src/core/world-story.ts';

const state = createState('Аня', 'Кухня дома');
state.worldStory = normalizeWorldStory({
  premise: 'Школа и город делят власть',
  factions: [
    { name: 'Стража', interests: 'порядок', norms: { law: 4 } },
    { name: 'Воры', interests: 'свобода', norms: { law: -3 } },
  ],
});
state.fronts = makeFrontsFromStory(state);
if (state.fronts.length !== 2) throw new Error('фронты не созданы');
if (state.clocks.length !== 2) throw new Error('часы мира не созданы');

const before = state.fronts[0].progress;
state.turn = 9;
const changes = advanceWorld(state);
if (state.fronts[0].progress <= before) throw new Error('фронт не двинулся');
for (let i = 0; i < 20; i += 1) { state.turn += 1; advanceWorld(state); }
if (!state.fronts[0].quest) throw new Error('квест фронта не создан');
if (state.clocks[0].value <= 0) throw new Error('часы мира не двинулись');

state.place = 'Кухня дома';
const first = updateSceneCheckpoint(state, 'Мама ставит ложку.', false);
if (!first.id.startsWith('scene-')) throw new Error('нет чекпоинта сцены');
updateSceneCheckpoint(state, 'Мама ставит ложку.', true);
updateSceneCheckpoint(state, 'Мама ставит ложку.', true);
if (state.scene?.stalls < 2) throw new Error('топтание сцены не посчитано');
if (!state.scene.goal?.includes('топчется')) throw new Error('нет статуса топтания');

state.place = 'Студия';
const next = updateSceneCheckpoint(state, 'Ты выходишь.', false);
if (next.id === first.id) throw new Error('смена места не начала новую сцену');

console.log('✓ фронты мира двигаются');
console.log('✓ чекпоинт сцены и смена места');
console.log('✓ топтание сцены фиксируется');
