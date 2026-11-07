#!/usr/bin/env node
import { createState, updateSceneCheckpoint } from '../src/core/state.ts';
import { advanceFactionRelations, advanceWorld, makeFrontsFromStory } from '../src/core/world.ts';
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

state.factions = [
  { name: 'Стража', attitude: 0, relations: [{ with: 'Воры', attitude: 0, note: 'война' }] },
  { name: 'Воры', attitude: 0, relations: [{ with: 'Стража', attitude: 0, note: 'война' }] },
];
const relation = state.factions[0].relations[0];
relation.attitude = 0;
relation.note = 'война';
advanceFactionRelations(state);
if (relation.note !== 'перемирие') throw new Error('война не перешла в перемирие');
relation.attitude = -50;
relation.note = 'война';
state.factions[0].attitude = 30;
state.factions[1].attitude = 0;
state.fronts = [
  { id: 'f1', name: 'Стража', faction: 'Стража', progress: 40, status: 'active', updatedTurn: 0 },
  { id: 'f2', name: 'Воры', faction: 'Воры', progress: 0, status: 'active', updatedTurn: 0 },
];
advanceFactionRelations(state);
if (relation.attitude !== -51) throw new Error(`дрейф фракций не сработал: ${relation.attitude}`);

state.place = 'Новая сцена';
const asked = updateSceneCheckpoint(state, 'Вопрос.', false, 'Что здесь не так?');
if (asked.question !== 'Что здесь не так?') throw new Error('вопрос Director не попал в сцену');
updateSceneCheckpoint(state, 'Ещё ход.', false, 'Что изменилось?');
if (state.scene.question !== 'Что изменилось?') throw new Error('вопрос не обновил текущую сцену');

console.log('✓ фронты мира двигаются');
console.log('✓ чекпоинт сцены и смена места');
console.log('✓ три топтания закрывают сцену и сохраняют её в истории');
console.log('✓ война/союз сбрасываются в перемирие');
console.log('✓ дрейф фракций и question сцены');
