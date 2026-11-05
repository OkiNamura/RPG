#!/usr/bin/env node
import { createState } from '../src/core/state.ts';
import { applyDelta } from '../src/core/delta.ts';

const state = createState('Аня', 'школа');
state.factions = [
  { name: 'Стража', attitude: 10, norms: { honesty: 4, law: 4 } },
  { name: 'Воры', attitude: 0, norms: { honesty: -2, freedom: 4 } },
];
state.party = [{ name: 'Ася', role: 'подруга', status: 'alive', bond: 50, attitude: 20, morale: 50 }];
state.npcs = [{ name: 'Соня', role: 'одноклассница', status: 'alive', bond: 20, attitude: 0, present: true }];

const changes = applyDelta(state, {
  normViolations: [{
    normId: 'honesty',
    severity: 2,
    public: true,
    witnesses: ['Ася', 'Соня'],
    evidence: 'Ася знает, что герой соврала',
    reason: 'ложь раскрыта',
  }],
});
if (state.reputation.public >= 0) throw new Error('публичная репутация не упала');
if (state.factions[0].attitude >= 10) throw new Error('стража не осудила ложь');
if (state.factions[1].attitude <= 0) throw new Error('воры не одобрили ложь');
if (!state.hero.statuses.some((status) => status.source === 'norm:honesty')) throw new Error('нет дебаффа');
if (!changes.some((change) => change.includes('Тень'))) throw new Error('нет сообщения о дебаффе');

const hidden = createState('Аня', 'дом');
applyDelta(hidden, {
  normViolations: [{ normId: 'honesty', severity: 2, public: false, witnesses: [], evidence: 'тайна' }],
});
if (!hidden.hiddenFacts.length) throw new Error('скрытое нарушение не записано');
if (hidden.hero.statuses.some((status) => status.source === 'norm:honesty')) throw new Error('публичный дебафф без свидетелей');
console.log('✓ норма: стража и воры реагируют по-разному');
console.log('✓ норма: дебафф и скрытый факт');
