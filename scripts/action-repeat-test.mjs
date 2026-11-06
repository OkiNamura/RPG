#!/usr/bin/env node
import { createState } from '../src/core/state.ts';
import { Conspect } from '../src/core/conspect.ts';
import { runTurn } from '../src/core/turn.ts';

const state = createState('Аня', 'Дом');
state.log.push({ turn: 1, role: 'player', text: 'Иду домой' });
state.log.push({ turn: 1, role: 'gm', text: 'Ты стоишь у подъезда. Дверь закрыта.' });
let calls = 0;
const model = {
  complete: async () => {
    calls += 1;
    return {
      text: 'Дверь открывается изнутри. На пороге — соседка с собакой.',
      outputTokens: 7,
      inputTokens: 10,
      cachedTokens: 0,
    };
  },
};
const session = {
  text: { core: '', world: '', tone: '' },
  state,
  conspect: new Conspect(),
  model,
  prices: { input: 0, output: 0, cachedInput: 0 },
  totals: { tokensIn: 0, tokensOut: 0, cached: 0, cost: 0 },
  usage: {},
  windowTurns: 5,
  summarizeEvery: 20,
  lastSegments: [],
};
const stats = await runTurn(session, 'Иду домой');
if (calls !== 1) throw new Error(`повтор действия вызвал ведущего повторно: ${calls}`);
if (stats.tokensOut !== 7) throw new Error(`неверный output: ${stats.tokensOut}`);
console.log('✓ повтор действия без повтора ответа — один вызов');
