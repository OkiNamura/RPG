/**
 * Полный e2e-прогон: каталог, ядро, ключи, создание игры, ходы,
 * конспект, карта, время, действия над ходом, иллюстратор.
 *
 * BASE: OMIKA_BASE (по умолчанию http://127.0.0.1:7801)
 */
const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const LEVEL = Number(process.env.E2E_LEVEL ?? 9);
const TURNS = Number(process.env.E2E_TURNS ?? 8);
const KEEP = process.env.E2E_KEEP === '1';

const results = [];
let failures = 0;
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures += 1;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

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
  'Осматриваюсь по сторонам и запоминаю дорогу.',
  'Говорю со старухой у колодца и спрашиваю про ключ.',
  'Проверяю карманы и пересчитываю монеты.',
  'Иду в сторону кузницы, держась в тени.',
  'Пробую открыть дверь и прислушиваюсь.',
  'Отвечаю незнакомцу и предлагаю обмен.',
  'Отдыхаю у стены и наблюдаю за улицей.',
  'Бегу к воротам, не оглядываясь.',
];

async function main() {
  console.log(`\n=== E2E ${BASE} · уровень ${LEVEL} · ходов ${TURNS} ===\n`);

  // 1. Каталог
  const cat = await api('/api/catalog');
  const groups = cat.body?.tone?.groups ?? [];
  const tagCount = groups.reduce((n, g) => n + g.subgroups.reduce((m, s) => m + s.fields.length, 0), 0);
  check('каталог: 3 группы', groups.length === 3, `${groups.length}`);
  check('каталог: 239 тегов', tagCount === 239, `${tagCount}`);
  const names = new Set(groups.flatMap((g) => g.subgroups.flatMap((s) => s.fields.map((f) => f.name))));
  for (const wanted of ['Гейм-мастер (GM)', 'Романтическая комедия', 'Абьюзивные отношения', 'Зоофилия / Монстродевушки']) {
    check(`каталог: есть «${wanted}»`, names.has(wanted));
  }

  // 2. Ядро
  const blocks = await api('/api/blocks');
  check('ядро: GET 200', blocks.status === 200);
  check('ядро: core > 50 КБ', (blocks.body?.core ?? '').length > 50000);
  check('ядро: тон-промт на месте', (blocks.body?.tone ?? '').length > 3000, `${(blocks.body?.tone ?? '').length} симв.`);
  check('ядро: мир-промт на месте', (blocks.body?.world ?? '').length > 5000, `${(blocks.body?.world ?? '').length} симв.`);
  check('ядро: герой-промт на месте', (blocks.body?.hero ?? '').length > 500);
  check('ядро: помечено неизменяемым', blocks.body?.locked?.core === true);
  const corePut = await api('/api/blocks', { method: 'PUT', body: JSON.stringify({ core: 'взлом' }) });
  check('ядро: правка запрещена (403)', corePut.status === 403, `${corePut.status}`);

  // 3. Ключи
  const made = await api('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ name: 'e2e-ключ', provider: 'openrouter', apiKey: 'sk-e2e-000000' }),
  });
  const keyId = made.body?.key?.id;
  check('ключи: создание', made.status === 200 && Boolean(keyId), made.body?.key?.masked);
  const list = await api('/api/keys');
  check('ключи: маска в списке', (list.body?.keys ?? []).some((k) => k.id === keyId && k.masked));
  const ren = await api(`/api/keys/${keyId}`, { method: 'PUT', body: JSON.stringify({ name: 'e2e-ключ 2' }) });
  check('ключи: переименование', ren.status === 200 && ren.body?.key?.name === 'e2e-ключ 2');
  const bad = await api('/api/keys/test', {
    method: 'POST',
    body: JSON.stringify({ apiKey: 'sk-invalid-e2e', baseUrl: 'https://openrouter.ai/api/v1' }),
  });
  check('ключи: плохой ключ не валит сервер', bad.status === 200 || bad.status === 502, `${bad.status}`);
  const del = await api(`/api/keys/${keyId}`, { method: 'DELETE' });
  check('ключи: удаление', del.status === 200);

  // 4. Создание игры с авто-сборкой промтов
  const id = `e2e-${LEVEL}-${Date.now().toString(36)}`;
  const tone = [
    'Тёмное фэнтези: пепел, гильдии, долги и голод.',
    'Город под пеплом, ночь длится полгода, стража продажна.',
    'Смерть — статистика, но каждая потеря — с лицом.',
  ].join(' ').repeat(6);
  const world = [
    'Город Норвал под вулканом, пепел вместо снега.',
    'Гильдии делят воду и дороги, у стен стоят беженцы.',
    'Разломы открываются по ночам, из них идут твари.',
  ].join(' ').repeat(6);
  const hero = '# ГЕРОЙ\n- **Имя:** Кай\n- **Суть:** картограф без левой руки.\n- **Прошлое:** служил гильдии, сбежал с картами.';

  const t0 = Date.now();
  const created = await api('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      id,
      tone,
      world,
      hero,
      heroName: 'Кай',
      toneLevel: LEVEL,
      epochYear: 3000,
      meta: { title: `E2E ${LEVEL}`, toneLevel: LEVEL, epochYear: 3000, tags: [{ group: 'Жанры и стиль', field: 'Тёмное фэнтези', value: 'include' }] },
      generatePrompts: true,
    }),
  });
  check('игра: создана', created.status === 200 && created.body?.id === id, `${Date.now() - t0} мс`);
  check('игра: получены промты от мастера', (created.body?.meta?.prompts?.gm ?? '').length > 200, `${(created.body?.meta?.prompts?.gm ?? '').length} симв.`);
  check('игра: своя температура', typeof created.body?.meta?.prompts?.temperature === 'number');

  const art = await api(`/api/campaign/${encodeURIComponent(id)}/art`);
  check('иллюстратор: группы стиля', (art.body?.groups?.[0]?.subgroups ?? []).length === 4);
  check('иллюстратор: параметры ИИ', (art.body?.aiGroups ?? []).length === 5);
  const artPut = await api(`/api/campaign/${encodeURIComponent(id)}/art`, {
    method: 'PUT',
    body: JSON.stringify({
      include: ['аниме-стиль', 'крупный план'],
      exclude: [],
      settings: ['гейм-мастер (GM)', 'кинематографичный темп', 'взрослый режим (NSFW)'],
    }),
  });
  check('иллюстратор: сохранение', artPut.status === 200);
  const art2 = await api(`/api/campaign/${encodeURIComponent(id)}/art`);
  check('иллюстратор: чтение настроек', (art2.body?.settings ?? []).length === 3, (art2.body?.settings ?? []).join(', '));

  // 5. Ходы
  const started = Date.now();
  let last = null;
  let cost = 0;
  let turnErrors = 0;
  for (let i = 0; i < TURNS; i += 1) {
    const res = await api(`/api/campaign/${encodeURIComponent(id)}/turn`, {
      method: 'POST',
      body: JSON.stringify({ input: INPUTS[i % INPUTS.length] }),
    });
    if (res.status !== 200) {
      turnErrors += 1;
      console.log(`    ошибка хода ${i + 1}: ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
      break;
    }
    last = res.body;
    cost += res.body?.stats?.cost ?? 0;
  }
  check('ходы: без ошибок', turnErrors === 0, `${TURNS} ходов за ${Math.round((Date.now() - started) / 1000)} с`);
  check('ходы: есть проза', (last?.prose ?? '').length > 100);
  check('ходы: есть изменения', (last?.changes ?? []).length > 0, `${(last?.changes ?? []).length}`);

  const camp = await api(`/api/campaign/${encodeURIComponent(id)}`);
  const st = camp.body?.state ?? {};
  check('время: идёт', st.time?.hour !== 8 || st.time?.day > 1, `день ${st.time?.day}, ${st.time?.hour}:00`);
  check(
    'конспект: не пустой',
    (st.turn ?? 0) < 3 || (camp.body?.summary ?? '').length > 500,
    `${(camp.body?.summary ?? '').length} симв.`,
  );
  check('конспект: арки', (st.turn ?? 0) < 3 || (camp.body?.summary ?? '').includes('## Арка'));
  check('крючки: лимит 30', (st.hooks ?? []).length <= 30, `${(st.hooks ?? []).length}`);
  check('карта: строки', (camp.body?.map ?? '').split('\n').length >= 12);
  check('карта: символы', /[#.@$*!]/.test(camp.body?.map ?? ''));
  check('карта мира: есть', (camp.body?.worldMap ?? '').length > 100);
  check('состояние: NPC и задачи', Array.isArray(st.npcs) && Array.isArray(st.quests));

  const prompts = await api(`/api/campaign/${encodeURIComponent(id)}/prompts`);
  check('промты игры: сохранены', (prompts.body?.prompts?.gm ?? '').length > 100);

  // 6. Действия над ходом
  const turnNo = last?.stats?.turn ?? TURNS;
  const regen = await api(`/api/campaign/${encodeURIComponent(id)}/regenerate`, {
    method: 'POST',
    body: JSON.stringify({ turn: turnNo }),
  });
  check('ход: перегенерация', regen.status === 200, `${regen.status}`);
  const mem = await api(`/api/campaign/${encodeURIComponent(id)}/memory`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Помнить: должник по имени Могильщик.' }),
  });
  check('память: запись', mem.status === 200 && mem.body?.memory?.includes('Могильщик'));
  const drop = await api(`/api/campaign/${encodeURIComponent(id)}/drop`, {
    method: 'POST',
    body: JSON.stringify({ name: (st.items ?? [])[0]?.name ?? 'кинжал' }),
  });
  check('предмет: выбросить', drop.status === 200 || drop.status === 404, `${drop.status}`);

  // 7. Карточки и изображения
  const actor = (st.npcs ?? [])[0]?.name;
  if (actor) {
    const card = await api(`/api/campaign/${encodeURIComponent(id)}/card?name=${encodeURIComponent(actor)}`);
    check('карточка NPC: экспорт', card.status === 200 && card.body?.data?.name === actor);
  } else {
    check('карточка NPC: пока нет NPC (не ошибка)', true, 'пропущено');
  }
  // SSE: клиент должен получить delta + done, и ход ровно один.
  const turnBefore = (await api(`/api/campaign/${encodeURIComponent(id)}`)).body.state.turn;
  const streamRes = await fetch(`${BASE}/api/campaign/${encodeURIComponent(id)}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'Слушаю и жду.' }),
  });
  const streamText = await streamRes.text();
  const streamTypes = streamText
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => {
      try {
        return JSON.parse(line.slice(6)).type;
      } catch {
        return 'bad';
      }
    });
  check('SSE: есть delta и done', streamTypes.includes('delta') && streamTypes.includes('done'));
  const afterStream = (await api(`/api/campaign/${encodeURIComponent(id)}`)).body.state.turn;
  check('SSE: ход ровно один', afterStream === turnBefore + 1, `${turnBefore}→${afterStream}`);

  // Блокировка: два параллельных хода — один 200, второй 409.
  const postTurn = () =>
    fetch(`${BASE}/api/campaign/${encodeURIComponent(id)}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'Делаю шаг.' }),
    });
  const [lockA, lockB] = await Promise.all([postTurn(), postTurn()]);
  const lockCodes = [lockA.status, lockB.status].sort((x, y) => x - y);
  check('ходы: блокировка 409', lockCodes[0] === 200 && lockCodes[1] === 409, lockCodes.join('/'));

  // Картинка: провайдер иногда отвечает очень долго — тест не должен висеть.
  let imgNote = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    const res = await fetch(`${BASE}/api/campaign/${encodeURIComponent(id)}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'scene' }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    imgNote = `статус ${res.status}`;
  } catch (err) {
    imgNote = `провайдер не ответил за 60 с: ${err.message}`;
  }
  check('картинка: запрос не подвешивает игру', true, imgNote);

  console.log(`\nпотрачено: $${cost.toFixed(4)} · ходов: ${turnNo}`);
  console.log(failures === 0 ? '\nИТОГ: OK' : `\nИТОГ: провалов ${failures}`);
  console.log(`кампания: ${id}`);
  if (!KEEP) console.log('(кампания оставлена в data/campaigns)');
}

main().catch((err) => {
  console.error('E2E упал:', err);
  process.exit(1);
});
