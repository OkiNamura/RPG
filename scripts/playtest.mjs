/**
 * Прогон на N ходов с анализом.
 *
 *   node scripts/playtest.mjs [ходов] [--preset=2.1] [--id=имя] [--tags]
 *
 * --preset=<id>  сгенерировать тон и мир по пресету перед стартом
 * --tags         передать теги тона в генерацию тона
 * --id=<имя>     своё имя кампании
 *
 * Пишет отчёт в data/playtest-report.md и оставляет кампанию для просмотра.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const TOTAL = Number(argv.find((a) => /^\d+$/.test(a)) ?? 100);
const PRESET = flag('preset');
const ID = flag('id', `run-${Date.now().toString(36)}`);

const INPUTS = [
  'осматриваюсь по сторонам',
  'поднимаю с земли камень и кладу его в карман',
  'иду к ближайшему дому',
  'стучу в дверь',
  'здороваюсь и спрашиваю имя',
  'спрашиваю, что здесь случилось',
  'предлагаю помочь за еду',
  'беру со стола кусок хлеба',
  'спрашиваю про дорогу на север',
  'выхожу на улицу',
  'иду к колодцу',
  'достаю камень и бросаю в колодец',
  'прислушиваюсь к звуку',
  'возвращаюсь к дому',
  'спрашиваю хозяина, помнит ли он меня',
  'обещаю вернуться к закату',
  'иду по улице дальше',
  'замечаю силуэт в переулке',
  'подхожу ближе',
  'окликаю силуэт',
  'спрашиваю, кто он такой',
  'предлагаю идти вместе',
  'иду к площади',
  'осматриваю здание с вывеской',
  'захожу внутрь',
  'ищу, где сесть',
  'заказываю еду',
  'слушаю разговоры за соседним столом',
  'спрашиваю трактирщика о пропаже',
  'запоминаю имя трактирщика',
  'проверяю кошель',
  'пересчитываю монеты',
  'иду на ночлег',
  'просыпаюсь и осматриваюсь',
  'выхожу на рассвете',
  'иду к воротам города',
  'спрашиваю стражу о новостях',
  'иду по тракту',
  'замечаю следы на дороге',
  'изучаю следы',
  'иду по следам',
  'останавливаюсь и прислушиваюсь',
  'прячусь за деревом',
  'наблюдаю',
  'выхожу из укрытия',
  'здороваюсь',
  'возвращаюсь в город',
  'иду к тому же дому',
  'спрашиваю, помнит ли он моё обещание',
  'отдаю ему камень',
  'спрашиваю про человека с красными глазами',
  'иду в храм',
  'осматриваю алтарь',
  'трогаю символ на колонне',
  'читаю надпись',
  'иду в подвал',
  'зажигаю факел',
  'осматриваю комнату',
  'открываю сундук',
  'беру то, что внутри',
  'возвращаюсь наверх',
];

function pick(i) {
  const base = INPUTS[i % INPUTS.length];
  return i < INPUTS.length ? base : `${base} (круг ${Math.floor(i / INPUTS.length) + 1})`;
}

async function api(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const rows = [];
const errors = [];
const problems = [];
let cost = 0;
let prev = null;

function counters(state) {
  return {
    items: state.items.length,
    npcs: state.npcs.length,
    hooks: state.hooks.length,
    quests: state.quests.length,
    promises: state.promises.length,
  };
}

try {
  let world = '';
  let tone = '';
  let meta = { title: `Прогон ${TOTAL} ходов` };

  if (PRESET) {
    console.log(`генерация мира по пресету ${PRESET}…`);
    const w = await api('/api/generate/world', { method: 'POST', body: JSON.stringify({ presetId: PRESET }) });
    world = w.text;
    console.log(`  мир: ${world.length} знаков, $${(w.cost ?? 0).toFixed(4)}`);

    console.log('генерация тона…');
    const t = await api('/api/generate/tone', {
      method: 'POST',
      body: JSON.stringify({
        selections: [
          { group: 'Жанры', field: 'Триллер', value: 'да' },
          { group: 'Формат', field: 'Мрачное', value: 'да' },
        ],
      }),
    });
    tone = t.text;
    console.log(`  тон: ${tone.length} знаков, $${(t.cost ?? 0).toFixed(4)}`);
    meta = { ...meta, presetId: PRESET, presetTitle: PRESET };
  }

  await api('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({ id: ID, world, tone, meta }),
  });
  console.log(`кампания: ${ID}`);

  for (let i = 0; i < TOTAL; i += 1) {
    const input = pick(i);
    const started = Date.now();
    try {
      const r = await api(`/api/campaign/${encodeURIComponent(ID)}/turn`, {
        method: 'POST',
        body: JSON.stringify({ input }),
      });
      const ms = Date.now() - started;
      cost += r.stats?.cost ?? 0;

      const now = counters(r.state);
      const delta = prev
        ? {
            items: now.items - prev.items,
            npcs: now.npcs - prev.npcs,
            hooks: now.hooks - prev.hooks,
            quests: now.quests - prev.quests,
            promises: now.promises - prev.promises,
          }
        : { items: now.items, npcs: now.npcs, hooks: now.hooks, quests: now.quests, promises: now.promises };
      prev = now;

      if (r.problems?.length) problems.push(`ход ${r.stats?.turn}: ${r.problems.join('; ')}`);

      rows.push({
        turn: r.stats?.turn,
        input,
        ms,
        tokensIn: r.stats?.tokensIn,
        cached: r.stats?.cachedTokens,
        cost: r.stats?.cost,
        changes: r.changes?.length ?? 0,
        items: delta.items,
        npcs: delta.npcs,
        hooks: delta.hooks,
        quests: delta.quests,
        promises: delta.promises,
        summarized: Boolean(r.summarized),
        proseLen: (r.prose || '').length,
      });

      if ((i + 1) % 10 === 0) {
        console.log(
          `  ${i + 1}/${TOTAL} · $${cost.toFixed(4)} · предм ${now.items} · NPC ${now.npcs} · крюч ${now.hooks} · обещ ${now.promises}`,
        );
      }
    } catch (err) {
      errors.push(`ход ${i + 1}: ${err.message}`);
      rows.push({ turn: i + 1, input, ms: Date.now() - started, error: err.message });
      console.log(`  ОШИБКА на ${i + 1}: ${err.message}`);
      if (String(err.message).includes('не найдена')) break;
    }
  }

  const final = await api(`/api/campaign/${encodeURIComponent(ID)}`);
  const s = final.state;

  const turns = rows.filter((r) => !r.error);
  const avg = (fn) => (turns.length ? turns.reduce((a, r) => a + fn(r), 0) / turns.length : 0);
  const sum = (fn) => turns.reduce((a, r) => a + fn(r), 0);

  const avgMs = Math.round(avg((r) => r.ms));
  const avgIn = Math.round(avg((r) => r.tokensIn ?? 0));
  const avgCached = Math.round(avg((r) => r.cached ?? 0));
  const cacheRate = avgIn ? Math.round((avgCached / avgIn) * 100) : 0;

  // динамика: первые и последние десять ходов
  const head = turns.slice(0, 10);
  const tail = turns.slice(-10);
  const avgOf = (list, fn) => (list.length ? list.reduce((a, r) => a + fn(r), 0) / list.length : 0);

  const report = [
    `# Прогон ${TOTAL} ходов`,
    '',
    `- кампания: \`${ID}\``,
    `- пресет: ${PRESET ?? 'базовый мир'}`,
    `- ходов: ${s.turn}`,
    `- ошибок: ${errors.length}`,
    `- замечаний критика: ${problems.length}`,
    `- потрачено: $${cost.toFixed(4)} (в среднем $${(cost / Math.max(s.turn, 1)).toFixed(6)})`,
    `- средний ответ: ${avgMs} мс`,
    `- средний вход: ${avgIn} ток., из кэша ${avgCached} (${cacheRate}%)`,
    '',
    '## Динамика',
    '',
    '| | первые 10 | последние 10 |',
    '|---|---|---|',
    `| мс | ${Math.round(avgOf(head, (r) => r.ms))} | ${Math.round(avgOf(tail, (r) => r.ms))} |`,
    `| вход, ток | ${Math.round(avgOf(head, (r) => r.tokensIn ?? 0))} | ${Math.round(avgOf(tail, (r) => r.tokensIn ?? 0))} |`,
    `| кэш, ток | ${Math.round(avgOf(head, (r) => r.cached ?? 0))} | ${Math.round(avgOf(tail, (r) => r.cached ?? 0))} |`,
    `| знаков в ответе | ${Math.round(avgOf(head, (r) => r.proseLen ?? 0))} | ${Math.round(avgOf(tail, (r) => r.proseLen ?? 0))} |`,
    `| изменений за ход | ${avgOf(head, (r) => r.changes).toFixed(1)} | ${avgOf(tail, (r) => r.changes).toFixed(1)} |`,
    '',
    '## Итоговое состояние',
    '',
    `- место: ${s.place}`,
    `- время: день ${s.time.day}, ${s.time.hour}:00`,
    `- деньги: ${s.money.gold} з / ${s.money.silver} с / ${s.money.copper} м`,
    `- предметов: ${s.items.length}`,
    `- NPC: ${s.npcs.length}`,
    `- задач: ${s.quests.length}`,
    `- обещаний: ${s.promises.length}`,
    `- крючков: ${s.hooks.length}`,
    `- скрытых фактов: ${s.hiddenFacts.length}`,
    '',
    '### Предметы',
    ...s.items.map((i) => `- ${i.name} ×${i.qty} [${i.where}]`),
    '',
    '### NPC',
    ...s.npcs.map((n) => `- ${n.name} — ${n.role || '—'} — ${n.status}`),
    '',
    '### Задачи',
    ...s.quests.map((q) => `- ${q.title} [${q.status}]`),
    '',
    '### Обещания',
    ...s.promises.map((p) => `- ${p}`),
    '',
    '### Крючки',
    ...s.hooks.map((h) => `- ${h}`),
    '',
    '## Ошибки',
    ...(errors.length ? errors.map((e) => `- ${e}`) : ['- нет']),
    '',
    '## Замечания критика',
    ...(problems.length ? problems.slice(0, 50).map((p) => `- ${p}`) : ['- нет']),
    '',
    '## По ходам',
    '',
    '| ход | мс | вход | кэш | $ | Δпредм | ΔNPC | Δкрюч | Δобещ | конспект | знаков |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.turn} | ${r.ms} | ${r.tokensIn ?? ''} | ${r.cached ?? ''} | ${(r.cost ?? 0).toFixed(6)} | ${r.items ?? ''} | ${r.npcs ?? ''} | ${r.hooks ?? ''} | ${r.promises ?? ''} | ${r.summarized ? 'да' : ''} | ${r.proseLen ?? ''} |`,
    ),
  ].join('\n');

  const out = join(import.meta.dirname, '..', 'data', 'playtest-report.md');
  await writeFile(out, report, 'utf8');

  console.log('');
  console.log(`готово: ${s.turn} ходов · ошибок ${errors.length} · критик ${problems.length} · $${cost.toFixed(4)}`);
  console.log(`средний ход: ${avgMs} мс · вход ${avgIn} (кэш ${cacheRate}%)`);
  console.log(`отчёт: ${out}`);
} catch (err) {
  console.error('фатально:', err.message);
  process.exit(1);
}
