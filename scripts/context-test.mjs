#!/usr/bin/env node
import { createState } from '../src/core/state.ts';
import { renderState } from '../src/core/context.ts';

const state = createState('Аня', 'Кухня');
for (let i = 0; i < 20; i += 1) {
  state.npcs.push({
    name: `NPC${i}`,
    role: 'знакомый',
    status: 'alive',
    bond: 10,
    present: false,
    mind: { goals: ['секретная цель'], secrets: ['секрет'] },
  });
}
state.npcs[0].present = true;
state.quests.push(
  { title: 'Активный', status: 'active', steps: [] },
  { title: 'Замороженный', status: 'frozen', steps: [] },
  { title: 'Старый', status: 'done', steps: [] },
);
for (let i = 0; i < 20; i += 1) state.hiddenFacts.push({ content: `факт${i}`, turn: i, known: false });
state.factions.push({
  name: 'Гильдия',
  attitude: 0,
  roster: [{ name: 'Член гильдии', role: 'вор' }],
  relations: Array.from({ length: 10 }, (_, index) => ({ with: `Фракция${index}`, attitude: 30, note: 'союз' })),
});

const gm = renderState(state, { mode: 'gm' });
const agent = renderState(state, { mode: 'agent' });
if ((gm.match(/Фракции:/g) ?? []).length !== 1) throw new Error('фракции не один раз в GM state');
if ((agent.match(/Фракции:/g) ?? []).length !== 1) throw new Error('фракции не один раз в agent state');
if (!gm.includes('NPC0')) throw new Error('присутствующий NPC не попал в компактный state');
if (gm.includes('NPC12 — знакомый (alive, цели')) throw new Error('секрет отсутствующего попал в GM state');
if (!gm.includes('Ещё NPC')) throw new Error('нет счётчика отсутствующих');
if (!gm.includes('Активный') || !gm.includes('Замороженный')) throw new Error('потерян активный/замороженный квест');
if (!gm.includes('Старый')) throw new Error('потерян последний закрытый квест');
if (!gm.includes('ещё 8 скрытых фактов')) throw new Error('нет счётчика скрытых фактов');
if (!agent.includes('секретная цель')) throw new Error('агент состояния потерял секреты NPC');
if (!agent.includes('состав:')) throw new Error('агент состояния потерял состав фракции');
if (gm.includes('состав:')) throw new Error('GM state показал состав отсутствующей фракции');
if (!gm.includes('ещё 6')) throw new Error('связи фракции не ограничены');
console.log('✓ компактный state для ведущего');
console.log('✓ полный state для агента состояния');
console.log('✓ фракции без дублей');
