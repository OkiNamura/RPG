#!/usr/bin/env node
import { createState } from '../src/core/state.ts';
import { Conspect } from '../src/core/conspect.ts';
import { runTurn } from '../src/core/turn.ts';

const state = createState('Аня', 'Кухня дома');
state.log.push({ turn: 1, role: 'player', text: 'Первый вопрос' });
state.log.push({
  turn: 1,
  role: 'gm',
  text: 'Мама ставит ложку на край плиты и медленно разворачивается к тебе. Взгляд её скользит по выбритому виску. — И это ты сделала сама? Или тебе кто-то помог?',
});

let calls = 0;
const model = {
  complete: async () => {
    calls += 1;
    return {
      text: calls === 1
        ? 'Мама ставит ложку на край плиты и медленно разворачивается к тебе. Взгляд её скользит по выбритому виску. — И это ты сделала сама? Или тебе кто-то помог?'
        : 'Мама выдыхает и ставит чашку. — Значит, договор на словах. Покажи, что там за реклама. Она протягивает руку за телефоном.',
      outputTokens: 10,
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

const stats = await runTurn(session, 'Я договорилась, мне сделали бесплатно.');
if (!stats.timings || typeof stats.timings.gmMs !== 'number') throw new Error('нет замеров этапов');
const last = state.log.at(-1)?.text ?? '';
if (calls !== 2) throw new Error(`ожидался один повтор, вызовов: ${calls}`);
if (/И это ты сделала сама/.test(last)) throw new Error('повтор сцены остался');
console.log('✓ повтор сцены перегенерирован');
