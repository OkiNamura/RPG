/**
 * Глубокий прогон: 55 ходов со всеми функциями.
 *
 *   node scripts/deep-playtest.mjs [ходов]
 *
 * Проверяет: ходы, кубик, память, конспект, варианты, перегенерацию,
 * редактирование, карточку, изображение, SSE, блокировку, арт-настройки.
 * Отчёт: data/deep-playtest-report.md
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';

const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const TOTAL = Number(process.argv[2] ?? process.env.DEEP_TURNS ?? 55);
const ID = `deep-${Date.now().toString(36)}`;
const LEVEL = Number(process.env.DEEP_LEVEL ?? 6);

const api = async (path, options = {}) => {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const INPUTS = [
  'Осматриваюсь и запоминаю выходы.',
  'Иду по улице, держась ближе к стенам.',
  'Говорю со встречным и спрашиваю дорогу.',
  'Проверяю карманы и пересчитываю монеты.',
  'Ищу место, где можно передохнуть.',
  'Прислушиваюсь к звукам за дверью.',
  'Осторожно открываю дверь и заглядываю внутрь.',
  'Спрашиваю у торговца цену и торгуюсь.',
  'Пробую еду и воду, что нашёл в доме.',
  'Бегу к воротам, не оглядываясь.',
  'Прячусь в тени и жду, пока пройдёт стража.',
  'Осматриваю тело и ищу подсказки.',
  'Разговариваю с ребёнком у колодца.',
  'Помогаю старику донести воду.',
  'Иду в сторону кузницы.',
  'Стучу в дверь и жду ответа.',
  'Обыскиваю сундук в углу.',
  'Пробую открыть замок найденным ключом.',
  'Оставляю метку на стене и иду дальше.',
  'Отдыхаю у огня и слушаю разговоры.',
  'Считаю шаги до поворота и запоминаю путь.',
  'Говорю с женщиной в плаще и предлагаю помощь.',
  'Проверяю, не следят ли за мной.',
  'Иду к площади и смешиваюсь с толпой.',
  'Тихо закрываю за собой дверь.',
  'Ищу воду и промываю рану.',
  'Пробую вспомнить, где видел этот герб.',
  'Оставляю монету на столе и ухожу.',
  'Прошу ночлега у хозяина дома.',
  'Засыпаю, прислушиваясь к дому.',
];

const rows = [];
const errors = [];
const events = [];
let cost = 0;

const pick = (i) => INPUTS[i % INPUTS.length];

async function main() {
  console.log(`\n=== Глубокий прогон ${TOTAL} ходов · ${BASE} · уровень ${LEVEL} ===\n`);

  const tone = [
    'Тёмное фэнтези с редкими тёплыми моментами: пепел, долги, голод.',
    'Город под вулканом, ночь длится полгода, гильдии делят воду.',
    'Смерть — статистика, но каждая потеря — с лицом и именем.',
  ]
    .join(' ')
    .repeat(5);
  const world = [
    'Норвал — город на пепле, у стен беженцы, в шахтах просыпаются твари.',
    'Власть делят три гильдии, стража продажна, вода дороже золота.',
  ]
    .join(' ')
    .repeat(6);
  const hero = '# ГЕРОЙ\n- **Имя:** Кай\n- **Суть:** картограф без левой руки.\n- **Прошлое:** служил гильдии, сбежал с картами.';

  const t0 = Date.now();
  const created = await api('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      id: ID,
      tone,
      world,
      hero,
      heroName: 'Кай',
      toneLevel: LEVEL,
      epochYear: 2317,
      meta: {
        title: `Глубокий прогон ${TOTAL}`,
        toneLevel: LEVEL,
        epochYear: 2317,
        tags: [
          { group: 'Жанры и стиль', field: 'Тёмное фэнтези', value: 'include' },
          { group: 'Жанры и стиль', field: 'Романтика', value: 'include' },
        ],
      },
      generatePrompts: true,
    }),
  });
  if (created.status !== 200) throw new Error(`кампания не создана: ${created.status} ${JSON.stringify(created.body)}`);
  cost += created.body?.meta?.prompts ? 0.001 : 0;
  console.log(`кампания: ${ID} · создана за ${Date.now() - t0} мс\n`);

  await api(`/api/campaign/${encodeURIComponent(ID)}/art`, {
    method: 'PUT',
    body: JSON.stringify({
      include: ['аниме-стиль', 'кинематографичное освещение'],
      exclude: [],
      settings: ['гейм-мастер (GM)', 'кинематографичный темп', 'взрослый режим (NSFW)'],
    }),
  });
  await api(`/api/campaign/${encodeURIComponent(ID)}/memory`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Помнить: герой ищет карты, которые сжёг сам.' }),
  });
  events.push('арт-настройки и память записаны');

  const _started = Date.now();
  let turnErrors = 0;

  for (let i = 0; i < TOTAL; i += 1) {
    const num = i + 1;
    const input = pick(i);
    const useDice = num % 7 === 0;
    const t = Date.now();
    try {
      const res = await api(`/api/campaign/${encodeURIComponent(ID)}/turn`, {
        method: 'POST',
        body: JSON.stringify({ input, dice: useDice }),
      });
      if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      const body = res.body;
      cost += body.stats?.cost ?? 0;
      const state = body.state ?? {};
      rows.push({
        turn: num,
        ms: Date.now() - t,
        input,
        dice: useDice,
        prose: (body.prose ?? '').length,
        changes: body.changes?.length ?? 0,
        cost: body.stats?.cost ?? 0,
        tokensIn: body.stats?.tokensIn ?? 0,
        cached: body.stats?.cachedTokens ?? 0,
        time: `${state.time?.day ?? '?'}д ${state.time?.hour ?? '?'}ч`,
        place: state.place ?? '',
        npcs: state.npcs?.length ?? 0,
        hooks: state.hooks?.length ?? 0,
        quests: state.quests?.length ?? 0,
        items: state.items?.length ?? 0,
        summary: (body.summary ?? '').length,
      });

      if (num % 10 === 0) {
        console.log(
          `  ${num}/${TOTAL} · $${cost.toFixed(3)} · NPC ${state.npcs?.length ?? 0} · крюч ${state.hooks?.length ?? 0} · конспект ${(body.summary ?? '').length} · ${state.time?.day}д ${state.time?.hour}ч`,
        );
      }

      if (num === 10) {
        const mem = await api(`/api/campaign/${encodeURIComponent(ID)}/memory`, {
          method: 'POST',
          body: JSON.stringify({ text: 'Помнить: должник по имени Могильщик.' }),
        });
        events.push(`память: ${mem.status}`);
      }
      if (num === 15) {
        const art = await api(`/api/campaign/${encodeURIComponent(ID)}/art`);
        events.push(`арт: ${art.body?.groups?.[0]?.subgroups?.length ?? 0} подгрупп, ${art.body?.settings?.length ?? 0} настроек`);
      }
      if (num === 20 && state.npcs?.length) {
        const card = await api(
          `/api/campaign/${encodeURIComponent(ID)}/card?name=${encodeURIComponent(state.npcs[0].name)}`,
        );
        events.push(`карточка NPC: ${card.status}`);
      }
      if (num === 25) {
        const regen = await api(`/api/campaign/${encodeURIComponent(ID)}/regenerate`, {
          method: 'POST',
          body: JSON.stringify({ turn: num }),
        });
        cost += regen.body?.stats?.cost ?? 0;
        events.push(`регенерация хода ${num}: ${regen.status}`);
        const v1 = await api(`/api/campaign/${encodeURIComponent(ID)}/variant`, {
          method: 'POST',
          body: JSON.stringify({ turn: num, index: 1 }),
        });
        const v0 = await api(`/api/campaign/${encodeURIComponent(ID)}/variant`, {
          method: 'POST',
          body: JSON.stringify({ turn: num, index: 0 }),
        });
        events.push(`варианты: ${v1.status}/${v0.status}`);
      }
      if (num === 30) {
        const edit = await api(`/api/campaign/${encodeURIComponent(ID)}/edit`, {
          method: 'POST',
          body: JSON.stringify({ turn: num, input: 'Осторожно возвращаюсь к дому и стучу в дверь.' }),
        });
        cost += edit.body?.stats?.cost ?? 0;
        events.push(`правка хода ${num}: ${edit.status}`);
      }
      if (num === 35) {
        const img = await api(`/api/campaign/${encodeURIComponent(ID)}/image`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'scene' }),
        });
        cost += img.body?.cost ?? 0;
        events.push(`картинка: ${img.status} ${img.body?.model ?? ''}`);
      }
      if (num === 40) {
        const drop = await api(`/api/campaign/${encodeURIComponent(ID)}/drop`, {
          method: 'POST',
          body: JSON.stringify({ name: state.items?.[0]?.name ?? 'кинжал' }),
        });
        events.push(`выброшен предмет: ${drop.status}`);
      }
      if (num === 50) {
        const before = (await api(`/api/campaign/${encodeURIComponent(ID)}`)).body.state.turn;
        const post = () =>
          fetch(`${BASE}/api/campaign/${encodeURIComponent(ID)}/turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: 'Делаю шаг.' }),
          });
        const [a, b] = await Promise.all([post(), post()]);
        events.push(`блокировка: ${[a.status, b.status].sort().join('/')} · ход ${before}`);
        cost += 0.003;
      }
    } catch (err) {
      turnErrors += 1;
      errors.push(`ход ${num}: ${err.message}`);
      console.log(`  ОШИБКА ${num}: ${err.message}`);
      if (String(err.message).includes('не найдена')) break;
    }
  }

  // SSE — отдельный ход после прогона; в таблицу обычных ходов не попадает.
  try {
    const before = (await api(`/api/campaign/${encodeURIComponent(ID)}`)).body.state.turn;
    const streamRes = await fetch(`${BASE}/api/campaign/${encodeURIComponent(ID)}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Слушаю тишину и жду.' }),
    });
    const text = await streamRes.text();
    const types = text
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => {
        try {
          return JSON.parse(line.slice(6)).type;
        } catch {
          return 'bad';
        }
      });
    const after = (await api(`/api/campaign/${encodeURIComponent(ID)}`)).body.state.turn;
    events.push(
      `SSE: delta ${types.filter((x) => x === 'delta').length}, done ${types.filter((x) => x === 'done').length}, ход ${before}→${after}`,
    );
    cost += 0.003;
  } catch (err) {
    errors.push(`SSE: ${err.message}`);
  }

  const final = await api(`/api/campaign/${encodeURIComponent(ID)}`);
  const state = final.body.state;
  const summary = final.body.summary ?? '';
  const arcs = [...summary.matchAll(/## Арка (\d+) · ходы (\d+)–(\d+)/g)].map((m) => `${m[1]}:${m[2]}-${m[3]}`);
  const uniqueArcs = new Set(arcs).size === arcs.length;
  let fileSize = 0;
  let snapshotLogs = 0;
  try {
    const file = JSON.parse(
      await (await import('node:fs/promises')).readFile(`data/campaigns/${ID}.json`, 'utf8'),
    );
    fileSize = statSync(`data/campaigns/${ID}.json`).size;
    snapshotLogs = (file.turns ?? []).filter((t) => t.state?.log?.length).length;
  } catch {
    /* файл мог не сохраниться */
  }

  const avgMs = rows.filter((r) => r.ms > 0).reduce((s, r) => s + r.ms, 0) / Math.max(1, rows.filter((r) => r.ms > 0).length);
  const lines = [
    `# Глубокий прогон ${TOTAL} ходов`,
    '',
    `- кампания: \`${ID}\``,
    `- ходов: ${state.turn} (в таблице ${rows.length} обычных; SSE и проверка блокировки добавляют ещё ходы)`,
    `- ошибок ходов: ${turnErrors}`,
    `- потрачено: $${cost.toFixed(4)}`,
    `- средний ход: ${Math.round(avgMs)} мс`,
    `- время в игре: ${state.time?.day}д ${state.time?.hour}ч`,
    `- место: ${state.place}`,
    `- NPC: ${state.npcs?.length ?? 0} · пати: ${state.party?.length ?? 0} · квестов: ${state.quests?.length ?? 0} · крючков: ${state.hooks?.length ?? 0}`,
    `- предметов: ${state.items?.length ?? 0} · фракций: ${state.factions?.length ?? 0} · локаций: ${state.locations?.length ?? 0}`,
    `- иллюстраций: ${state.illustrations?.length ?? 0}`,
    `- конспект: ${summary.length} знаков · арок: ${arcs.length} · без дублей: ${uniqueArcs ? 'да' : 'НЕТ'}`,
    `- арки: ${arcs.join(', ')}`,
    `- файл кампании: ${(fileSize / 1024).toFixed(0)} КБ · снимков с логом: ${snapshotLogs}`,
    '',
    '## События',
    '',
    ...events.map((e) => `- ${e}`),
    '',
    '## Ошибки',
    '',
    ...(errors.length ? errors.map((e) => `- ${e}`) : ['- нет']),
    '',
    '## Ходы',
    '',
    '| ход | мс | вход | кэш | $ | Δ | NPC | крюч | конспект | время |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map(
      (r) =>
        `| ${r.turn} | ${r.ms} | ${r.tokensIn} | ${r.cached} | ${r.cost.toFixed(4)} | ${r.changes} | ${r.npcs} | ${r.hooks} | ${r.summary} | ${r.time} |`,
    ),
  ];

  await mkdir('data', { recursive: true });
  await writeFile('data/deep-playtest-report.md', `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nготово: ${state.turn} ходов · ошибок ${turnErrors} · $${cost.toFixed(3)} · средний ${Math.round(avgMs)} мс`);
  console.log(`отчёт: data/deep-playtest-report.md\nкампания: ${ID}`);
}

main().catch((err) => {
  console.error('прогон упал:', err);
  process.exit(1);
});
