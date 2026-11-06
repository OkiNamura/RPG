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
state.party.push({ name: 'Без флага', role: 'спутник', status: 'alive', bond: 10 });
let scene = updateSceneCheckpoint(state, 'Мама ставит ложку.', false);
if (scene.participants.includes('Без флага')) throw new Error('NPC без present попал в сцену');
state.party[0].present = true;
state.place = 'Кухня у окна';
scene = updateSceneCheckpoint(state, 'Ты у окна.', false);
if (!scene.participants.includes('Без флага')) throw new Error('present=true не попал в сцену');
const first = updateSceneCheckpoint(state, 'Мама ставит ложку.', false);
if (!first.id.startsWith('scene-')) throw new Error('нет чекпоинта сцены');
updateSceneCheckpoint(state, 'Мама ставит ложку.', true);
updateSceneCheckpoint(state, 'Мама ставит ложку.', true);
updateSceneCheckpoint(state, 'Мама ставит ложку.', true);
if (state.scene?.stalls < 3) throw new Error('топтание сцены не посчитано');
if (!state.scene.closedTurn) throw new Error('сцена не закрылась после трёх топтаний');
if (!state.scene.goal?.includes('закрыта')) throw new Error('нет статуса закрытия');

state.place = 'Студия';
const next = updateSceneCheckpoint(state, 'Ты выходишь.', false);
if (next.id === first.id) throw new Error('смена места не начала новую сцену');
const lastClosed = state.sceneHistory?.at(-1);
if (!lastClosed || lastClosed.closeReason !== 'три топтания подряд') throw new Error('закрытая сцена не сохранилась в истории');
if (state.sceneHistory?.length !== new Set(state.sceneHistory?.map((entry) => entry.id)).size) throw new Error('история сцен задвоилась');

console.log('✓ фронты мира двигаются');
console.log('✓ чекпоинт сцены и смена места');
console.log('✓ три топтания закрывают сцену и сохраняют её в истории');
