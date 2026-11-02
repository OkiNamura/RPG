/**
 * Интеграционный тест интерфейса на jsdom.
 *
 * Рендерит настоящую страницу с сервера, подключает app.js, кликает кнопки
 * и собирает ошибки. Ходы и тесты агентов ходят в живой API — это стоит
 * копейки, зато проверяет всё по-настоящему.
 *
 *   node scripts/ui-test.mjs
 */

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rawFetch = globalThis.fetch;

let sessionCookie = '';
async function authenticate() {
  const state = await (await rawFetch(BASE + '/api/auth')).json();
  if (!state.enabled) return;
  const password =
    process.env.OMIKA_TEST_PASSWORD ?? (await readFile('.admin-password', 'utf8')).trim();
  const page = await (await rawFetch(BASE + '/login')).text();
  const question = (page.match(/id="captcha-question">([^<]+)</) ?? [])[1] ?? '';
  const captchaId = (page.match(/id="captcha-id"[^>]*value="([^"]+)"/) ?? [])[1] ?? '';
  const [a, b] = question.split('+').map((x) => Number(x.trim()));
  const res = await rawFetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, captchaId, captchaAnswer: String(a + b) }),
  });
  if (!res.ok) throw new Error(`вход для UI-теста: ${res.status}`);
  sessionCookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  globalThis.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (sessionCookie) headers.set('Cookie', sessionCookie);
    return rawFetch(input, { ...init, headers });
  };
}

const errors = [];
const results = [];

function pass(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  results.push({ name, ok: false, err: String(err) });
  console.log(`  ✗ ${name} — ${err}`);
}

async function until(fn, timeout = 12000, step = 100) {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error('таймаут ожидания');
    await wait(step);
  }
}

async function main() {
  await authenticate();
  const html = await (await fetch(BASE + '/')).text();
  const dom = new JSDOM(html, {
    url: BASE + '/#/profile',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.fetch = (url, options) => fetch(new URL(url, BASE), options);
  window.confirm = () => true;
  window.alert = () => undefined;
  window.scrollTo = () => undefined;
  window.HTMLElement.prototype.scrollTo = () => undefined;
  // jsdom не всегда даёт эти глобалы, а стрим без них не прочитать
  window.TextDecoder ??= TextDecoder;
  window.ReadableStream ??= ReadableStream;

  window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${e.reason}`));

  const code = await (await fetch(BASE + '/app.js')).text();
  window.eval(code);

  const $ = (id) => window.document.getElementById(id);
  const $$ = (sel) => [...window.document.querySelectorAll(sel)];
  const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // ---------- профиль ----------
  try {
    await until(() => window.document.querySelector('.profile-card'));
    pass('профиль отрисован');
  } catch (e) {
    fail('профиль', e.message);
  }

  // ---------- мастер открывается прямо из меню ----------
  try {
    window.location.hash = '#/new';
    await until(() => window.document.querySelector('.steps'));
    pass('мастер открывается пунктом «Новая игра»');
    if ($$('.story-card').length > 0) throw new Error('каталог пресетов всё ещё на странице');
  } catch (e) {
    fail('мастер', e.message);
  }

  // ---------- мастер ----------
  try {
    await until(() => window.document.querySelector('.steps'));
    const chips = $$('.tag-item').filter((i) => !i.closest('.art-block'));
    if (chips.length < 120) throw new Error(`тегов мало: ${chips.length}`);
    pass(`мастер: ${chips.length} тегов в оглавлении`);

    const detailsCount = $$('.tag-group').filter((g) => !g.closest('.art-block')).length;
    if (detailsCount !== 3) throw new Error(`блоков ${detailsCount}, ожидалось 3`);
    if ($$('.tag-group')[0].tagName.toLowerCase() !== 'details') {
      throw new Error('блоки не выпадающие');
    }
    pass(`мастер: ${detailsCount} выпадающих блоков`);

    // Рисовальные теги живут отдельно, у иллюстратора.
    if ($$('.tag-group').some((g) => g.textContent.includes('Рисование'))) {
      throw new Error('рисовальные теги всё ещё в общем каталоге');
    }
    pass('мастер: рисовальных тегов в общем списке нет');

    // Но у иллюстратора они есть — отдельным блоком.
    const artBlock = window.document.querySelector('.art-block');
    if (!artBlock) throw new Error('нет блока тегов иллюстратора');
    const artChips = artBlock.querySelectorAll('.tag-item');
    if (artChips.length < 20) throw new Error(`тегов иллюстратора мало: ${artChips.length}`);
    if (!artBlock.textContent.includes('Стиль')) throw new Error('в блоке нет стиля');
    pass(`мастер: тегов иллюстратора ${artChips.length} (стиль, план, точка зрения)`);

    // Уровень повествования: ползунок 0..11 и кубик.
    const range = window.document.querySelector('.level-range');
    if (!range || range.max !== '11') throw new Error('нет ползунка уровня 0..11');
    range.value = '11';
    range.dispatchEvent(new window.Event('input', { bubbles: true }));
    if (!window.document.querySelector('.level-name').textContent) throw new Error('нет подписи уровня');
    pass(`мастер: уровень 11 — «${window.document.querySelector('.level-name').textContent}»`);

    // Кубик у уровня подбирает теги, но не меняет сам уровень.
    const levelDice = window.document.querySelector('.level-dice');
    if (!levelDice) throw new Error('нет кубика у уровня');
    const levelBefore = window.document.querySelector('.level-range').value;
    click(levelDice);
    await until(() => $$('.tag-item.on').length > 0, 8000);
    const levelAfter = window.document.querySelector('.level-range').value;
    if (levelAfter !== levelBefore) throw new Error('кубик изменил уровень');
    pass(`мастер: кубик уровня подобрал ${$$('.tag-item.on').length} тегов, уровень ${levelAfter}`);

    // Поле фразы: кубик подбирает случайные подходящие теги, агент — по кнопке.
    const words = window.document.querySelector('.tag-words');
    if (!words) throw new Error('нет поля фразы для подбора тегов');
    if (!/Опиши игру/.test(words.placeholder)) throw new Error('поле не переключено на фразу');
    if (window.document.querySelector('.tag-search')) throw new Error('поиск по тегам не убран');
    words.value = 'романтика';
    words.dispatchEvent(new window.Event('input', { bubbles: true }));
    const pickDice = [...window.document.querySelectorAll('.tag-picker button')].find(
      (b) => b.textContent === '🎲',
    );
    click(pickDice);
    await until(() => $$('.tag-item.on').length > 0, 8000);
    if ($$('.tag-item.on').length < 10) throw new Error('кубик по фразе дал слишком мало тегов');
    pass(`мастер: кубик по фразе «романтика» → ${$$('.tag-item.on').length} тегов, поиска нет`);

    // трёхпозиционный цикл: выбрать → исключить → сброс
    const first = $$('.tag-item').find((i) => !i.closest('.art-block') && !i.classList.contains('hidden') && !i.classList.contains('on') && !/Ошибка времяисчисления/.test(i.textContent));
    if (!first) throw new Error('нет видимого тега для проверки');
    click(first);
    if (!first.classList.contains('on')) throw new Error('первый клик не выбрал');
    if (first.querySelector('.marker').textContent !== '✓') throw new Error('нет зелёной метки');
    click(first);
    if (!first.classList.contains('ex')) throw new Error('второй клик не исключил');
    if (first.querySelector('.marker').textContent !== '✕') throw new Error('нет красной метки');
    click(first);
    if (first.className.includes('on') || first.className.includes('ex')) {
      throw new Error('третий клик не сбросил');
    }
    if (first.querySelector('.marker').textContent !== '□') throw new Error('метка не вернулась в квадрат');
    pass('мастер: теги трёхпозиционные');

    // Кнопки подгруппы: все / исключить / сброс.
    const groupBox = $$('.tag-group').find((g) => !g.closest('.art-block'));
    const rowBox = groupBox.querySelector('.tag-title-row').closest('.tag-row');
    const groupBtn = (label) => [...rowBox.querySelectorAll('.tg-btn')].find((b) => b.textContent === label);
    click(groupBtn('все'));
    const onCount = rowBox.querySelectorAll('.tag-item.on').length;
    if (onCount === 0) throw new Error('кнопка «все» ничего не выбрала');
    click(groupBtn('сброс'));
    if (rowBox.querySelectorAll('.tag-item.on').length > 0) throw new Error('кнопка «сброс» не сбросила');
    pass(`мастер: кнопки подгруппы (все → ${onCount}, сброс → 0)`);

    const nextBtn = () => [...$$('.wizard-nav button')].find((b) => b.textContent.includes('Далее'));
    const worldArea = await until(() => window.document.querySelector('.world-custom'));
    if (!worldArea) throw new Error('нет поля мира на шаге тона');
    worldArea.value = 'Мир затонувших городов, где торгуют воспоминаниями.';
    worldArea.dispatchEvent(new window.Event('input', { bubbles: true }));
    pass('шаг 1: тон и мир на одном шаге');

    click(nextBtn());
    await until(() => window.document.querySelectorAll('.field input, .field textarea').length >= 8);

    if ($$('.template-tile').length > 0) throw new Error('шаблоны героя всё ещё показываются');
    const heroFields = $$('.field input');
    if (heroFields.length < 4) throw new Error(`полей героя мало: ${heroFields.length}`);
    heroFields[0].value = 'Тест';
    heroFields[0].dispatchEvent(new window.Event('input', { bubbles: true }));
    pass(`шаг 3: форма героя, ${heroFields.length} полей, шаблонов нет`);

    click(nextBtn());
    const review = await until(() => window.document.querySelector('.review'));
    if (!review.textContent.includes('Мир:')) throw new Error('сводка неполная');
    pass('шаг 4: сводка собрана');

    const backBtn = [...$$('.wizard-nav button')].find((b) => b.textContent.includes('Назад'));
    click(backBtn);
    await until(() => $$('.field input').some((i) => i.value.length > 0));
    pass('кнопка «Назад» работает');
  } catch (e) {
    fail('мастер', e.message);
  }

  // ---------- агенты ----------
  try {
    window.location.hash = '#/agents';
    // девять агентов + лор-книга
    await until(() => $$('.agent-card').length === 10);
    pass('агенты: 10 блоков (9 агентов + лор)');

    const cards = $$('.agent-card');
    const prompter = cards.find((c) => c.textContent.includes('Мастер промтов'));
    if (!prompter) throw new Error('нет агента «Мастер промтов»');
    pass('агенты: мастер промтов на месте');

    const lore = cards.find((c) => c.textContent.includes('Лор-книга'));
    if (!lore) throw new Error('нет лор-книги');
    const addLore = [...lore.querySelectorAll('button')].find((b) => b.textContent.includes('запись'));
    click(addLore);
    if (!lore.querySelector('.lore-row')) throw new Error('запись не добавилась');
    pass('агенты: лор-книга добавляет записи');

    const agentCards = $$('.agent-card');
    const testBtn = [...agentCards[2].querySelectorAll('button')].find((b) => b.textContent === 'Тест');
    click(testBtn);
    const box = agentCards[2].querySelector('.agent-test');
    if (box.classList.contains('hidden')) throw new Error('панель теста не открылась');
    pass('агенты: панель теста открывается');

    const runBtn = [...box.querySelectorAll('button')].find((b) => b.textContent === 'Отправить');
    click(runBtn);
    const out = await until(() => {
      const t = box.querySelector('.test-out').textContent;
      return t && t !== '…' ? t : null;
    }, 40000);
    if (out.startsWith('Ошибка')) throw new Error(out.slice(0, 120));
    pass(`агенты: тест отвечает (${out.length} знаков)`);

    // сохранение настроек
    const gmCard = agentCards[0];
    const saveBtn = [...gmCard.querySelectorAll('button')].find((b) => b.textContent === 'Сохранить');
    click(saveBtn);
    await until(() => gmCard.querySelector('.status').textContent.includes('сохранено'), 15000);
    pass('агенты: настройки сохраняются');
  } catch (e) {
    fail('агенты', e.message);
  }

  // ---------- ключи и ядро ----------
  try {
    window.location.hash = '#/keys';
    await until(() => window.document.querySelector('.page')?.textContent.includes('Ключи API'));
    pass('ключи: страница открывается');

    window.location.hash = '#/core';
    await until(() => window.document.querySelectorAll('.agent-card[data-key]').length >= 4);
    const blocks = window.document.querySelectorAll('.agent-card[data-key]');
    if (blocks.length < 4) throw new Error('блоков ядра меньше четырёх');
    const coreArea = window.document.querySelector('.agent-card[data-key="core"] textarea');
    if (!coreArea || !coreArea.readOnly) throw new Error('ядро не защищено от правки');
    if (!window.document.querySelector('.page')?.textContent.includes('Отменить изменения')) {
      throw new Error('нет кнопки отмены');
    }
    pass('ядро: 4 блока, ядро только для чтения, сохранение и отмена');
  } catch (e) {
    fail('ключи/ядро', e.message);
  }

  // ---------- истории ----------
  try {
    // После полной очистки тест сам создаёт одну игру и NPC для проверок.
    const existing = await (await window.fetch('/api/campaigns')).json();
    if (!existing.length) {
      await window.fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'ui-test-run',
          tone: 'тёмное фэнтези '.repeat(20),
          world: 'пепельный город '.repeat(20),
          hero: '# Герой\n- **Имя:** Тест',
          generatePrompts: false,
        }),
      });
      await window.fetch('/api/campaign/ui-test-run/npc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Кузнец', role: 'кузнец', skills: { Сила: 12 } }),
      });
    }
    window.location.hash = '#/stories';
    await until(
      () => window.document.querySelector('.row-card') || window.document.querySelector('.empty'),
    );
    const rows = $$('.row-card');
    pass(`истории: ${rows.length} записей`);

    // Контейнер игры: агенты с промтами, предметы, конспект, галерея.
    const viewBtn = [...window.document.querySelectorAll('.row-actions button')].find(
      (b) => b.textContent === 'Просмотреть',
    );
    if (!viewBtn) throw new Error('нет кнопки «Просмотреть»');
    click(viewBtn);
    await until(() => window.document.querySelector('.container-page'));
    const agentBlocks = window.document.querySelectorAll('.container-agent');
    if (agentBlocks.length < 9) throw new Error(`агентов в контейнере мало: ${agentBlocks.length}`);
    const promptAreas = window.document.querySelectorAll('.container-agent textarea.prompt-area');
    if (promptAreas.length < 9 || [...promptAreas].every((area) => area.value.length < 50)) {
      throw new Error('промты агентов не редактируются');
    }
    const dump = window.document.querySelector('.conspect-dump');
    if (!dump) throw new Error('конспект не виден');
    if (!window.document.querySelector('.item-grid')) throw new Error('нет секции предметов');
    if (!window.document.querySelector('.gallery-grid')) throw new Error('нет галереи');
    pass(`контейнер: ${agentBlocks.length} агентов, предметы, конспект, галерея`);

    // Кнопку «Новая история» убрали: создание — только через меню.
    const page = window.document.querySelector('.page');
    const freshBtn = [...page.querySelectorAll('button')].find((b) =>
      /Новая|Создать/.test(b.textContent),
    );
    if (freshBtn) throw new Error(`кнопка создания осталась: ${freshBtn.textContent}`);
    pass('истории: кнопки «Новая» нет');
  } catch (e) {
    fail('истории', e.message);
  }

  // ---------- библиотека карточек ----------
  try {
    window.location.hash = '#/templates';
    await until(() => window.document.querySelector('.library-card'), 15000);
    const cards = $$('.library-card').length;
    if (cards < 12) throw new Error(`карточек мало: ${cards}`);
    click($$('.library-card')[0]);
    await until(() => window.document.querySelector('.library-sheet'), 10000);
    pass(`карточки: ${cards} в библиотеке, карточка открывается`);
    const close = [...window.document.querySelectorAll('.library-sheet .btn')].find((b) => b.textContent === '✕');
    if (close) click(close);
    const npcTab = [...window.document.querySelectorAll('.library-tabs .chip')].find((b) =>
      b.textContent.startsWith('NPC'),
    );
    if (!npcTab) throw new Error('нет фильтра NPC');
    click(npcTab);
    await until(() => $$('.library-card').length >= 6, 10000);
    pass('карточки: фильтр по типу работает');
  } catch (e) {
    fail('карточки', e.message);
  }

  // ---------- игра ----------
  try {
    const list = await (await fetch(BASE + '/api/campaigns')).json();

    // Тест ходит только в свою кампанию — чужие игры не трогаем.
    let target = list.find((c) => c.id === 'ui-test-run');
    if (!target) {
      await fetch(BASE + '/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ui-test-run', meta: { title: 'UI-тест' } }),
      });
      target = { id: 'ui-test-run' };
    }
    if (!target) throw new Error('нет кампаний для игры');

    // Гарантируем персонажа для проверки сетки карточек.
    await fetch(`${BASE}/api/campaign/${encodeURIComponent(target.id)}/npc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Стражник', role: 'стражник', skills: { Сила: 12 } }),
    }).catch(() => undefined);

    window.location.hash = `#/play/${encodeURIComponent(target.id)}`;
    await until(() => window.document.querySelector('.play'), 15000);
    pass(`игра: открыта «${target.id}»`);

    const before = $$('.msg').length;
    const diceBtn = window.document.querySelector('.dice-btn');
    if (!diceBtn) throw new Error('нет кнопки кубика');
    click(diceBtn);
    if (!diceBtn.classList.contains('active')) throw new Error('кубик не подсветился');
    const input = window.document.querySelector('.composer textarea');
    input.value = 'осматриваюсь';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    window.document.querySelector('.composer').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Ждём и реплику игрока, и ответ ведущего: +1 — это ещё только отправка.
    await until(() => $$('.msg').length > before + 2, 90000);
    pass('игра: ход отправлен и ответ пришёл');

    const rollCard = await until(() => window.document.querySelector('.msg.roll'), 30000);
    if (!rollCard.querySelector('.roll-face')) throw new Error('у броска нет грани');
    pass(`игра: бросок карточкой (${rollCard.querySelector('.roll-face').textContent})`);

    const actionBtns = await until(() => {
      const found = $$('.ma-btn');
      return found.length >= 3 ? found : null;
    }, 20000);
    if (!actionBtns.some((b) => b.textContent === '🖼')) throw new Error('нет кнопки изображения');
    if (actionBtns.some((b) => b.textContent.includes('Promise'))) throw new Error('кнопки не отрисованы');
    pass(`игра: под ответом ${actionBtns.length} кнопки, есть 🖼`);

    const dice = window.document.querySelector('.dice-btn');
    if (!dice || !dice.classList.contains('active')) throw new Error('нет активного кубика');
    pass('игра: кубик d36 на месте и подсвечен');

    const quick = $$('.quick-actions .chip');
    if (quick.length) throw new Error(`быстрые кнопки остались: ${quick.length}`);
    pass('игра: быстрых кнопок нет');
    const tiles = $$('.actor-tile');
    if (!tiles.length) throw new Error('нет сетки NPC/пати');
    pass(`игра: ${tiles.length} карточек персонажей сеткой`);

    const panel = window.document.querySelector('.panel');
    if (!panel || panel.children.length === 0) throw new Error('панель состояния пуста');
    pass('игра: панель состояния заполнена');

    const maps = $$('.map-clickable');
    if (maps.length) throw new Error(`карты не убраны: ${maps.length}`);
    pass('игра: карт нет, блок убран');

    // Второй блок иллюстратора: параметры ИИ.
    const artBtn = [...window.document.querySelectorAll('.play-head button')].find(
      (b) => b.textContent.includes('🎨'),
    );
    if (!artBtn) throw new Error('нет кнопки иллюстратора');
    click(artBtn);
    const aiBlock = await until(() => window.document.querySelector('.ai-block'));
    const aiChips = aiBlock.querySelectorAll('.tag-item');
    if (aiChips.length < 30) throw new Error(`параметров ИИ мало: ${aiChips.length}`);
    if (!aiBlock.textContent.includes('Безопасность')) throw new Error('нет блока безопасности');
    pass(`иллюстратор: параметров ИИ ${aiChips.length}`);
    const aiClose = [...window.document.querySelectorAll('.map-modal-head .btn')].find(
      (b) => b.textContent === '✕',
    );
    click(aiClose);
    await until(() => !window.document.querySelector('.map-modal'));
    pass('игра: модалка карты закрывается');

    const placeCards = window.document.querySelector('.place-cards');
    const cardsCount = placeCards ? placeCards.querySelectorAll('.place-card').length : 0;
    if (cardsCount) throw new Error(`быстрые карточки локации остались: ${cardsCount}`);
    pass('игра: быстрых карточек локации нет');

    // Кириллический id не должен ломать открытие игры.
    const cyrillic = list.find((c) => /[^\x20-\x7e]/.test(c.id));
    if (cyrillic) {
      window.location.hash = `#/play/${encodeURIComponent(cyrillic.id)}`;
      await until(() => window.document.querySelectorAll('.msg').length > 0, 15000);
      if (!window.document.querySelector('.panel')) throw new Error('панель не появилась');
      pass(`игра: кириллический id «${cyrillic.id}» открывается`);
    }
  } catch (e) {
    fail('игра', e.message);
  }

  // ---------- статистика ----------
  try {
    window.location.hash = '#/stats';
    await until(() => window.document.querySelector('.table'));
    pass('статистика: таблица есть');
  } catch (e) {
    fail('статистика', e.message);
  }

  console.log('');
  if (errors.length) {
    console.log('Ошибки в консоли страницы:');
    for (const e of errors.slice(0, 10)) console.log('  !', e);
  } else {
    console.log('Ошибок в консоли страницы нет.');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nитого: ${results.length - failed.length}/${results.length} проверок пройдено`);
  process.exit(failed.length || errors.length ? 1 : 0);
}

await main();
