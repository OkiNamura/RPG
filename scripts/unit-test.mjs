/**
 * Юнит-проверки применения изменений.
 *
 *   node scripts/unit-test.mjs
 */

import { createState } from '../src/core/state.ts';
import { applyDelta } from '../src/core/delta.ts';
import { matchLore, renderLore } from '../src/core/lore.ts';

let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

// 1. Безличные NPC отбрасываются, именованные остаются.
{
  const s = createState('Кай', 'Площадь');
  applyDelta(s, {
    npcs: [
      { name: 'некто' },
      { name: 'кто-то' },
      { name: 'Женщина у очага' },
      { name: 'Голос из темноты' },
      { name: 'Силуэт без головы' },
      { name: 'Капюшон', role: 'спутник' },
      { name: 'Гуннар', role: 'трактирщик' },
    ],
  });
  check('описания отброшены', s.npcs.length === 2, `(их ${s.npcs.length}: ${s.npcs.map((n) => n.name).join(', ')})`);
  check('необычное имя принято', s.npcs.some((n) => n.name === 'Капюшон'));
  check('именованный NPC сохранён', s.npcs.some((n) => n.name === 'Гуннар'));
}

// 1б. Один и тот же NPC не дублируется под прозвищем.
{
  const s = createState('Кай', 'Площадь');
  applyDelta(s, { npcs: [{ name: 'Ключник', role: 'хозяин таверны' }] });
  applyDelta(s, { npcs: [{ name: 'Рох', role: 'Ключник, хозяин таверны' }] });
  check('NPC не задвоился', s.npcs.length === 1, `(${s.npcs.map((n) => n.name).join(', ')})`);
}

// 2. Место предмета нормализуется.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, {
    addItems: [
      { name: 'камень', qty: 1, where: 'карман' },
      { name: 'нож', qty: 1, where: 'в руках' },
      { name: 'сундук', qty: 1, where: 'схрон' },
    ],
  });
  const get = (n) => s.items.find((i) => i.name === n)?.where;
  check('«карман» → inventory', get('камень') === 'inventory', get('камень'));
  check('«в руках» → equipped', get('нож') === 'equipped', get('нож'));
  check('«схрон» → vault', get('сундук') === 'vault', get('сундук'));
}

// 3. Крючки копятся с лимитом, обещания не режутся, закрытые уходят в архив.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, {
    hooks: Array.from({ length: 60 }, (_, i) => `крючок ${i}`),
    promises: Array.from({ length: 60 }, (_, i) => `обещание ${i}`),
  });
  check('крючки ограничены 30', s.hooks.length === 30, `(${s.hooks.length})`);
  check('крючки — самые свежие', s.hooks.includes('крючок 59') && !s.hooks.includes('крючок 0'));
  check('обещания не режутся', s.promises.length === 60, `(${s.promises.length})`);

  applyDelta(s, { resolveHooks: ['крючок 59'], resolvePromises: ['обещание 7'] });
  check('крючок закрыт', s.hooks.length === 29 && !s.hooks.includes('крючок 59'));
  check('обещание закрыто', s.promises.length === 59 && !s.promises.includes('обещание 7'));
  check('закрытое в архиве', s.archive.length === 2, `(${s.archive.length})`);
  check('в архиве обе причины',
    s.archive.some((a) => a.reason === 'закрыт') &&
      s.archive.some((a) => a.reason === 'выполнено или снято'));
}

{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { quests: [{ title: 'Принести уголь', status: 'active' }] });
  applyDelta(s, { quests: [{ title: 'Принести уголь', status: 'failed' }] });
  check('брошенный квест в архиве', s.archive.some((a) => a.kind === 'quest' && a.reason === 'брошено'));
}

// 3г. Просроченный квест закрывается сам.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { quests: [{ title: 'Успеть до темноты', status: 'active', turnsLimit: 2 }] });
  check('срок записан', s.quests[0]?.turnsLimit === 2 && s.quests[0]?.createdTurn === 0);

  s.turn = 3;
  applyDelta(s, {});
  check('квест просрочен', s.quests[0]?.status === 'failed', `(${s.quests[0]?.status})`);
  check('просрочка в архиве', s.archive.some((a) => a.reason === 'просрочено'));
  check('просрочка даёт крючок', s.hooks.some((h) => h.startsWith('Просрочено')));
}

// 3в. Бестиарий пополняется без дублей.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { bestiary: [{ name: 'тварь из разлома', danger: 2 }] });
  applyDelta(s, { bestiary: [{ name: 'Тварь из разлома', note: 'боится огня' }] });
  check('существо не задвоилось', s.bestiary.length === 1, `(${s.bestiary.length})`);
  check('заметка обновилась', s.bestiary[0]?.note === 'боится огня');
}

// 4. Дубликаты предметов складываются, а не плодятся.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { addItems: [{ name: 'камень', qty: 1 }] });
  applyDelta(s, { addItems: [{ name: 'Камень', qty: 2 }] });
  const stones = s.items.filter((i) => i.name.toLowerCase() === 'камень');
  check('дубликат слился в один предмет', stones.length === 1, `(${stones.length})`);
  check('количество сложилось', stones[0]?.qty === 3, `(${stones[0]?.qty})`);
}

// 5. Удаление несуществующего предмета не ломает стейт.
{
  const s = createState('Кай', 'Дом');
  const changes = applyDelta(s, { removeItems: [{ name: 'нет такого', qty: 1 }] });
  check('удаление несуществующего отмечено', changes.some((c) => c.includes('нет предмета')));
  check('стейт цел', s.items.length === 5, `(${s.items.length})`);
}

// 6. Отрицательные деньги отбрасываются.
{
  const s = createState('Кай', 'Дом');
  const before = s.money.gold;
  applyDelta(s, { money: { gold: -5 } });
  check('отрицательные деньги отброшены', s.money.gold === before);
}

// 7. Статус NPC нормализуется.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { npcs: [{ name: 'Лейла', status: 'unknown' }, { name: 'Марк', status: 'dead' }] });
  check('unknown → alive', s.npcs.find((n) => n.name === 'Лейла')?.status === 'alive');
  check('dead сохранён', s.npcs.find((n) => n.name === 'Марк')?.status === 'dead');
}

// 8. Здоровье и эффекты.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { health: -20 });
  check('здоровье не уходит в минус', s.hero.health === 0, `(${s.hero.health})`);

  applyDelta(s, { health: 55, statuses: [{ name: 'выспался', kind: 'buff', note: 'внимательнее' }] });
  check('здоровье применяется', s.hero.health === 55);
  check('баф добавлен', s.hero.statuses.length === 1);

  applyDelta(s, { statuses: [{ name: 'выспался', kind: 'buff', note: 'ещё внимательнее' }] });
  check('баф не дублируется', s.hero.statuses.length === 1);

  applyDelta(s, { statusRemove: ['выспался'] });
  check('эффект снимается', s.hero.statuses.length === 0);
}

// 8б. Рана в то же место не дублируется, а углубляется.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { wounds: [{ where: 'левое плечо', severity: 1 }] });
  applyDelta(s, { wounds: [{ where: 'Левое плечо', severity: 2 }] });
  applyDelta(s, { wounds: [{ where: 'левое плечо', severity: 3 }] });
  check('рана одна', s.hero.wounds.length === 1, `(${s.hero.wounds.length})`);
  check('тяжесть выросла до 3', s.hero.wounds[0]?.severity === 3, `(${s.hero.wounds[0]?.severity})`);
}

// 8в. Похожие обещания не дублируются.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { promises: ['обещаю вернуться с подмогой'] });
  applyDelta(s, { promises: ['Обещание: обещаю вернуться с подмогой'] });
  check('обещание одно', s.promises.length === 1, `(${s.promises.length})`);
}

// 9. Фракции и места.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, { factions: [{ name: 'Гильдия', attitude: -150 }] });
  check('отношение фракции зажато в -100', s.factions[0]?.attitude === -100, `(${s.factions[0]?.attitude})`);

  applyDelta(s, { factions: [{ name: 'гильдия', attitude: 30, note: 'помог' }] });
  check('фракция не дублируется', s.factions.length === 1, `(${s.factions.length})`);
  check('отношение обновилось', s.factions[0]?.attitude === 30);

  applyDelta(s, { places: [{ name: 'Таверна', note: 'там Гуннар' }] });
  applyDelta(s, { places: [{ name: 'Таверна', note: 'запомнил выходы' }] });
  check('место не дублируется', s.locations.length === 1);
  check('заметка о месте обновилась', s.locations[0]?.note === 'запомнил выходы');
}

// 10. Карточка персонажа заполняется только тем, что пришло.
{
  const s = createState('Кай', 'Дом');
  applyDelta(s, {
    party: [{ name: 'Амелия', role: 'тень', bond: 40, attitude: 70, appearance: 'бледная, зелёные глаза' }],
  });
  const a = s.party[0];
  check('карточка пати создана', a?.name === 'Амелия');
  check('связь записана', a?.bond === 40);
  check('внешность записана', a?.appearance === 'бледная, зелёные глаза');
  check('характер не выдуман', a?.character === undefined);
}

/** Лор-книга: записи подмешиваются только по ключам. */
function testLore() {
  const entries = [
    { id: '1', keys: ['пепел', 'вулкан'], content: 'Пепел здесь радиоактивен.', priority: 2 },
    { id: '2', keys: ['колодец'], content: 'В колодце кто-то живёт.', priority: 1 },
    { id: '3', keys: ['король'], content: 'Король мёртв.', priority: 0 },
  ];

  const hit = matchLore(entries, 'Я иду к колодцу и трогаю пепел.');
  check('лор: совпадения найдены', hit.length === 2, `(${hit.length})`);
  check('лор: приоритет выше — первым', hit[0].id === '1', `(${hit[0]?.id})`);
  check('лор: лишнего не подмешано', !hit.some((e) => e.id === '3'));

  const none = matchLore(entries, 'Тишина и ветер.');
  check('лор: без ключей — пусто', none.length === 0);

  const empty = renderLore([]);
  check('лор: пустой текст без заголовка', empty === '');

  const text = renderLore(hit);
  check('лор: заголовок и записи', text.startsWith('Лор по сцене:') && text.includes('колодц'));

  check('лор: короткие ключи отброшены', matchLore([{ id: 'x', keys: ['а'], content: 'x' }], 'а б в').length === 0);
}

testLore();

/** Новые механики: мысли, скиллы, состав фракций, автолор. */
function testMechanics() {
  const s = createState('Кай', 'Дом');
  check('у героя сразу есть скиллы', Object.keys(s.hero.skills ?? {}).length === 8);

  applyDelta(s, {
    intuition: 'За дверью кто-то дышит.',
    heroSkills: { Скрытность: 14 },
    factions: [
      {
        name: 'Городской совет',
        attitude: -10,
        leader: 'бургомистр Хальд',
        shadow: 'писарь Верн',
        roster: [
          { name: 'Хальд', role: 'бургомистр' },
          { name: 'Верн', role: 'писарь', hidden: true },
        ],
      },
    ],
    places: [{ name: 'Северные ворота', note: 'охрана, очередь' }],
    lore: [{ keys: ['совет', 'печать'], content: 'Печать совета подделывают.' }],
  });

  check('мысли записаны', s.hero.intuition === 'За дверью кто-то дышит.');
  check('скилл обновлён', s.hero.skills.Скрытность === 14);

  const faction = s.factions[0];
  check('фракция с главой', faction?.leader === 'бургомистр Хальд');
  check('серый кардинал записан', faction?.shadow === 'писарь Верн');
  check('состав фракции записан', faction?.roster?.length === 2);
  check('скрытый член помечен', faction?.roster?.[1]?.hidden === true);

  check('лор от агента записан', s.lore.some((l) => l.content === 'Печать совета подделывают.'));
  check('новое место дало автолор', s.lore.some((l) => l.keys.includes('Северные ворота')));
}

testMechanics();

console.log('');
console.log(failed === 0 ? 'все проверки пройдены' : `провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
