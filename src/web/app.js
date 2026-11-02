/* OMIKA — клиент. Восстановлен после потери файла; API и стили прежние. */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

async function api(path, options) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error((data && data.error) || text.slice(0, 200) || `ошибка ${res.status}`);
  return data;
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  toast('Omika установлена на телефон');
});

const PENDING_PREFIX = 'omika_pending_';

function newClientTurnId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function readPending(id) {
  try {
    const raw = localStorage.getItem(PENDING_PREFIX + id);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.clientTurnId || !data.input) return null;
    return data;
  } catch {
    return null;
  }
}

function writePending(id, data) {
  try {
    localStorage.setItem(PENDING_PREFIX + id, JSON.stringify(data));
  } catch {
    /* приватный режим */
  }
}

function clearPending(id, clientTurnId) {
  try {
    const current = readPending(id);
    if (current && clientTurnId && current.clientTurnId !== clientTurnId) return;
    localStorage.removeItem(PENDING_PREFIX + id);
  } catch {
    /* приватный режим */
  }
}

let toastTimer = null;
function toast(message) {
  const box = $('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 4000);
}

const num = (value) => Number(value ?? 0).toLocaleString('ru-RU');
const money = (value) => `$${Number(value ?? 0).toFixed((value ?? 0) < 0.01 ? 6 : 4)}`;

function dateLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('ru-RU');
}

function scrollDown(node) {
  if (node) node.scrollTop = node.scrollHeight;
}

function scrollToNode(container, node) {
  if (!container || !node) return;
  const top =
    node.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTop = Math.max(0, top - 12);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, arg] = raw.split('/');
  return { name: name || 'profile', arg: arg ? safeDecode(arg) : arg };
}

function currentCampaignId() {
  const match = /^#\/play\/(.+)$/.exec(location.hash);
  return match ? safeDecode(match[1]) : null;
}

function markActive(name) {
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
}

const row = (key, value) => {
  const box = el('div', 'row');
  box.append(el('span', '', key), el('span', '', value));
  return box;
};

function section(title, children) {
  const box = el('div', 'sect');
  box.append(el('h3', '', title));
  for (const child of children ?? []) box.append(child);
  return box;
}

function itemList(items) {
  const list = el('ul', 'items');
  for (const item of items) list.append(item);
  return list;
}

function tile(name, value, hint) {
  const box = el('div', 'tile');
  box.append(el('span', 'tile-name', name), el('b', 'tile-value', value));
  if (hint) box.append(el('span', 'tile-hint', hint));
  return box;
}

function emptyBox(title, text) {
  const box = el('div', 'empty');
  box.append(el('b', '', title), el('span', '', text));
  return box;
}

function pageHead(kicker, title, sub) {
  const head = el('div', 'page-head');
  head.append(el('span', 'page-kicker', kicker), el('h1', '', title));
  if (sub) head.append(el('p', 'page-sub', sub));
  return head;
}

function miniBtn(label, title, handler) {
  const btn = el('button', 'ma-btn', label);
  btn.type = 'button';
  btn.title = title;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await handler();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

/* ================= роутер ================= */

async function router() {
  const { name, arg } = currentRoute();
  markActive(name === 'play' || name === 'view' ? 'stories' : name);

  document.body.classList.remove('chrome-hidden');
  document.querySelector('.play-head')?.classList.remove('head-hidden');

  const view = $('view');
  if (!view) return;
  view.replaceChildren();
  app.game = null;

  const sideMap = $('side-map');
  if (sideMap && name !== 'play') sideMap.classList.add('hidden');

  try {
    if (name === 'stories') await viewStories(view);
    else if (name === 'agents') await viewAgents(view);
    else if (name === 'templates') await viewTemplates(view);
    else if (name === 'core') await viewCore(view);
    else if (name === 'keys') await viewKeys(view);
    else if (name === 'stats') await viewStats(view);
    else if (name === 'admin') await viewAdmin(view);
    else if (name === 'new') await viewNew(view, arg);
    else if (name === 'play') await viewPlay(view, arg);
    else if (name === 'view') await viewContainer(view, arg);
    else await viewProfile(view);
  } catch (err) {
    const box = el('div', 'page');
    box.append(emptyBox('Не загрузилось', err.message));
    view.append(box);
  }
}

/* ================= профиль ================= */

async function viewProfile(view) {
  const list = await api('/api/campaigns');
  const page = el('div', 'page');
  page.append(pageHead('Хроники', 'Мой профиль', 'Локальная машина, всё хранится в файлах проекта.'));

  const cardBox = el('div', 'profile-card');
  const tiles = el('div', 'tiles');
  tiles.append(tile('Хроник', num(list.length)), tile('Ходов', num(list.reduce((s, c) => s + c.turn, 0))));
  cardBox.append(tiles);

  const start = el('button', 'btn primary', '＋ Начать историю');
  start.addEventListener('click', () => {
    location.hash = '#/new';
  });
  cardBox.append(start);

  if (list.length === 0) cardBox.append(emptyBox('Пока пусто', 'Создай первую историю — конструктор в меню.'));
  else {
    const last = list[0];
    const resume = el('button', 'btn', `Продолжить «${last.title || last.id}»`);
    resume.addEventListener('click', () => {
      location.hash = `#/play/${encodeURIComponent(last.id)}`;
    });
    cardBox.append(resume);
  }

  page.append(cardBox);
  if (
    'serviceWorker' in navigator &&
    !window.matchMedia('(display-mode: standalone)').matches
  ) {
    const install = el('button', 'btn', 'Установить на телефон');
    install.addEventListener('click', async () => {
      if (!installPrompt) {
        toast('Открой меню Chrome → «Установить приложение»');
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => undefined);
      installPrompt = null;
    });
    page.append(install);
  }
  if (await isAuthEnabled()) page.append(logoutButton());
  const route = currentRoute();
  if (route.name !== 'profile' || route.arg) return;
  view.append(page);
}

/* ================= истории ================= */

async function viewStories(view) {
  const list = await api('/api/campaigns');
  app.campaigns = list;

  const page = el('div', 'page');
  page.append(pageHead('Текущие, завершённые и архив', 'Истории', 'Всё, что начато на этой машине.'));

  if (list.length === 0) {
    page.append(emptyBox('Ни одной истории', 'Создай первую через «＋ Новая игра» в меню.'));
    view.append(page);
    return;
  }

  for (const campaign of list) {
    const card = el('div', 'row-card');
    card.append(el('div', 'row-cover c5', '🜂'));
    const main = el('div', 'row-main');
    main.append(el('h3', '', campaign.title || campaign.id));
    const meta = el('div', 'row-meta');
    meta.append(
      el('span', '', `ход ${campaign.turn}`),
      el('span', '', campaign.place),
      el('span', '', money(campaign.cost)),
      el('span', '', dateLabel(campaign.savedAt)),
    );
    main.append(meta);

    const actions = el('div', 'row-actions');
    actions.append(el('span', `badge-status ${campaign.turn > 0 ? 'live' : ''}`, campaign.turn > 0 ? 'в игре' : 'новая'));
    const look = el('button', 'btn small', 'Просмотреть');
    look.addEventListener('click', () => {
      location.hash = `#/view/${encodeURIComponent(campaign.id)}`;
    });
    const go = el('button', 'btn primary small', 'Продолжить');
    go.addEventListener('click', () => {
      location.hash = `#/play/${encodeURIComponent(campaign.id)}`;
    });
    const del = el('button', 'btn small danger', 'Удалить');
    del.addEventListener('click', async () => {
      if (!confirm(`Удалить «${campaign.id}»? Это необратимо.`)) return;
      await api(`/api/campaign/${encodeURIComponent(campaign.id)}`, { method: 'DELETE' });
      router();
    });
    actions.append(look, go, del);
    card.append(main, actions);
    page.append(card);
  }

  view.append(page);
}

/* ================= контейнер игры ================= */

async function viewContainer(view, id) {
  // Собираем контейнер из существующих ручек: так страница живёт и на старом сервере.
  const [campaign, gameAgents, list, blocks, keys] = await Promise.all([
    api(`/api/campaign/${encodeURIComponent(id)}`),
    api(`/api/agents?id=${encodeURIComponent(id)}`),
    api('/api/campaigns'),
    api(`/api/campaign/${encodeURIComponent(id)}/blocks`),
    api('/api/keys').catch(() => ({ keys: [] })),
  ]);
  const title = (list ?? []).find((c) => c.id === id)?.title || id;
  const data = {
    id,
    title,
    turn: campaign.state?.turn ?? 0,
    place: campaign.state?.place ?? '',
    time: campaign.state?.time ?? {},
    agents: gameAgents ?? {},
    items: campaign.state?.items ?? [],
    hero: campaign.state?.hero ?? {},
    money: campaign.state?.money ?? {},
    npcs: campaign.state?.npcs ?? [],
    party: campaign.state?.party ?? [],
    factions: campaign.state?.factions ?? [],
    quests: campaign.state?.quests ?? [],
    locations: campaign.state?.locations ?? [],
    summary: campaign.summary ?? '',
    memory: campaign.memory ?? '',
    arcs: campaign.arcs ?? [],
    conspect: campaign.conspect ?? '',
    illustrations: campaign.state?.illustrations ?? [],
    blocks: blocks ?? { tone: '', world: '', hero: '' },
    keys: keys.keys ?? [],
  };
  const page = el('div', 'page container-page');
  page.append(
    pageHead(
      'Контейнер игры',
      data.title || id,
      `ход ${data.turn} · ${data.place || '—'} · ${data.time?.day ?? '?'} день, ${data.time?.hour ?? '?'}:00`,
    ),
  );

  const actions = el('div', 'agent-actions');
  const back = el('button', 'btn small', '← Истории');
  back.type = 'button';
  back.addEventListener('click', () => {
    location.hash = '#/stories';
  });
  const cont = el('button', 'btn primary small', 'Продолжить');
  cont.type = 'button';
  cont.addEventListener('click', () => {
    location.hash = `#/play/${encodeURIComponent(id)}`;
  });
  actions.append(back, cont);
  page.append(actions);

  const saveTasks = [];
  let containerDirty = false;
  const saveAll = el('button', 'btn small', 'Сохранить всё');
  saveAll.type = 'button';
  saveAll.disabled = true;
  const markDirty = () => {
    containerDirty = true;
    saveAll.disabled = false;
  };
  saveAll.addEventListener('click', async () => {
    saveAll.disabled = true;
    saveAll.textContent = 'Сохраняю…';
    try {
      for (const task of saveTasks) await task();
      containerDirty = false;
      toast('контейнер сохранён');
    } catch (err) {
      toast(err.message);
      saveAll.disabled = false;
    } finally {
      saveAll.textContent = 'Сохранить всё';
    }
  });
  page.append(saveAll);

  const section = (title, subtitle) => {
    const card = el('div', 'agent-card container-section');
    const head = el('div', 'agent-head');
    head.append(el('h3', '', title));
    card.append(head);
    if (subtitle) card.append(el('p', 'page-sub', subtitle));
    return card;
  };

  // Тон, мир и герой этой истории: правим только её контейнер.
  const blocksCard = section('Тон, мир, герой', 'Эти блоки принадлежат только этой истории.');
  const blockAreas = {};
  for (const [key, label, value] of [
    ['tone', 'Тон', data.blocks.tone],
    ['world', 'Мир', data.blocks.world],
    ['hero', 'Герой', data.blocks.hero],
  ]) {
    const area = el('textarea', 'prompt-area');
    area.value = value ?? '';
    area.addEventListener('input', markDirty);
    blockAreas[key] = area;
    blocksCard.append(agentField(label, area));
  }
  const saveBlocks = async () => {
    await api(`/api/campaign/${encodeURIComponent(id)}/blocks`, {
      method: 'PUT',
      body: JSON.stringify({
        tone: blockAreas.tone.value,
        world: blockAreas.world.value,
        hero: blockAreas.hero.value,
      }),
    });
  };
  saveTasks.push(saveBlocks);
  const blocksBtn = el('button', 'btn primary small', 'Сохранить блоки');
  blocksBtn.type = 'button';
  blocksBtn.addEventListener('click', async () => {
    blocksBtn.disabled = true;
    try {
      await saveBlocks();
      toast('тон, мир и герой сохранены');
    } catch (err) {
      toast(err.message);
    } finally {
      blocksBtn.disabled = false;
    }
  });
  blocksCard.append(blocksBtn);
  page.append(blocksCard);

  // Агенты этой игры: промт каждого.
  const agents = data.agents ?? {};
  const order = ['gm', 'prompter', 'state', 'summarizer', 'filler', 'artistHero', 'artistNpc', 'artistItem', 'artistScene'];
  const agentIds = [...order.filter((a) => agents[a]), ...Object.keys(agents).filter((a) => !order.includes(a))];
  const agentCard = section('Агенты игры', 'Промты сохранены в кампании и не меняются от других игр.');
  for (const agentId of agentIds) {
    const agent = agents[agentId];
    const block = el('details', 'container-agent');
    const summary = el('summary');
    summary.append(
      el('b', '', agent.title || agentId),
      el('span', 'container-agent-meta', `${agent.model || '—'} · t=${agent.temperature} · ${agent.enabled ? 'вкл' : 'выкл'} · ${agent.prompt.length} знаков`),
    );
    block.append(summary);
    const body = el('div', 'container-agent-body');
    const model = el('input');
    model.value = agent.model ?? '';
    const temp = el('input');
    temp.type = 'range';
    temp.min = '0';
    temp.max = '2';
    temp.step = '0.05';
    temp.value = String(agent.temperature ?? 0);
    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.checked = Boolean(agent.enabled);
    const prompt = el('textarea', 'prompt-area');
    prompt.value = agent.prompt || '';
    for (const node of [model, temp, prompt]) node.addEventListener('input', markDirty);
    enabled.addEventListener('change', markDirty);
    body.append(
      agentField('Модель', model),
      agentField('Температура', temp),
      agentField('Включён', enabled),
      agentField('Промт', prompt),
    );
    const save = el('button', 'btn primary small', 'Сохранить агента');
    save.type = 'button';
    const status = el('span', 'status');
    const doSave = async () => {
      await api(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          campaign: id,
          model: model.value.trim(),
          temperature: Number(temp.value),
          enabled: enabled.checked,
          prompt: prompt.value,
        }),
      });
      status.textContent = 'сохранено';
    };
    saveTasks.push(doSave);
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await doSave();
        toast(`${agent.title || agentId}: сохранено`);
      } catch (err) {
        toast(err.message);
      } finally {
        save.disabled = false;
      }
    });
    body.append(save, status);
    block.append(body);
    agentCard.append(block);
  }
  page.append(agentCard);

  // Герой.
  const hero = data.hero ?? {};
  const heroSection = section('Герой', `${hero.name || 'без имени'} · здоровье ${hero.health ?? 100}/100`);
  heroSection.append(heroCard(hero, data.money ?? {}, id));
  page.append(heroSection);

  // Спутники и NPC. Забытые живут в корзине контейнера.
  const activeNpcs = (data.npcs ?? []).filter((actor) => !actor.archived);
  const archivedNpcs = (data.npcs ?? []).filter((actor) => actor.archived);
  const people = [...(data.party ?? []), ...activeNpcs];
  const peopleSection = section('Спутники и NPC', `${(data.party ?? []).length} в пати · ${activeNpcs.length} знакомых · ${archivedNpcs.length} в корзине`);
  const peopleGrid = el('div', 'person-cards');
  for (const actor of data.party ?? []) peopleGrid.append(personCard(actor, id, false));
  for (const actor of activeNpcs) peopleGrid.append(personCard(actor, id, true));
  if (people.length === 0) peopleGrid.append(el('p', 'page-sub', 'никого пока нет'));
  peopleSection.append(peopleGrid);
  page.append(peopleSection);

  if (archivedNpcs.length) {
    const archiveSection = section('Корзина NPC', 'Забытые не удалены: их можно вернуть или удалить окончательно.');
    const archiveList = el('div', 'person-cards');
    for (const actor of archivedNpcs) {
      const box = el('article', 'person-card archived-card');
      box.append(el('h3', 'person-name', actor.name));
      if (actor.role) box.append(el('div', 'person-role', actor.role));
      box.append(el('div', 'person-label', `забыт ${dateLabel(actor.archivedAt)}`));
      const actions = el('div', 'person-actions');
      actions.append(
        miniBtn('Вернуть в игру', 'снять флаг archived', () => forgetNpc(id, actor.name, 'restore')),
        miniBtn('Удалить окончательно', 'удалить NPC из контейнера', () => forgetNpc(id, actor.name, 'purge')),
      );
      box.append(actions);
      archiveList.append(box);
    }
    archiveSection.append(archiveList);
    page.append(archiveSection);
  }

  // Задания.
  const questSection = section('Задания', `${(data.quests ?? []).length} в журнале`);
  const questGrid = el('div', 'quest-grid');
  for (const quest of data.quests ?? []) {
    const box = el('article', 'quest-card');
    const head = el('div', 'quest-head');
    head.append(el('b', '', quest.title), el('span', `chip chip-status-${quest.status || 'active'}`, quest.status || 'active'));
    box.append(head);
    if (quest.deadline) box.append(el('div', 'person-label', `Срок: ${quest.deadline}`));
    if (quest.steps?.length) {
      const list = el('ul', 'quest-steps');
      for (const step of quest.steps) list.append(el('li', '', step));
      box.append(list);
    }
    questGrid.append(box);
  }
  if ((data.quests ?? []).length === 0) questGrid.append(el('p', 'page-sub', 'активных заданий нет'));
  questSection.append(questGrid);
  page.append(questSection);

  // Локации.
  const locations = data.locations ?? [];
  const locationSection = section('Локации', `${locations.length} известных мест`);
  const locationGrid = el('div', 'location-grid');
  for (const place of locations) {
    const box = el('div', 'location-card');
    box.append(el('b', '', place.name));
    if (place.note) box.append(el('span', '', place.note));
    box.append(miniBtn('＋', 'сохранить локацию в библиотеку', () => saveToLibrary(id, 'location', place.name)));
    locationGrid.append(box);
  }
  if (locations.length === 0) locationGrid.append(el('p', 'page-sub', 'локации пока не открыты'));
  locationSection.append(locationGrid);
  page.append(locationSection);

  // Фракции.
  const factions = data.factions ?? [];
  const factionSection = section('Фракции', `${factions.length}`);
  const factionGrid = el('div', 'faction-grid');
  for (const faction of factions) {
    const box = el('article', 'faction-card');
    const head = el('div', 'quest-head');
    head.append(el('b', '', faction.name));
    if (typeof faction.attitude === 'number') head.append(el('span', 'chip', `${faction.attitude > 0 ? '+' : ''}${faction.attitude}`));
    box.append(head);
    if (faction.leader) box.append(el('div', 'person-label', `Глава: ${faction.leader}`));
    if (faction.shadow) box.append(el('div', 'person-label', `Тень: ${faction.shadow}`));
    if (faction.roster?.length) {
      box.append(el('div', 'person-value', faction.roster.map((r) => `${r.name}${r.role ? ` — ${r.role}` : ''}`).join('; ')));
    }
    if (faction.note) box.append(el('p', 'page-sub', faction.note));
    factionGrid.append(box);
  }
  if (factions.length === 0) factionGrid.append(el('p', 'page-sub', 'фракции пока не открыты'));
  factionSection.append(factionGrid);
  page.append(factionSection);

  // Предметы.
  const itemCard = section('Карточки предметов', `${(data.items ?? []).length} у героя`);
  const items = el('div', 'item-grid');
  for (const item of data.items ?? []) {
    const box = el('div', 'item-box');
    box.append(el('b', '', item.name));
    const meta = el('div', 'item-meta');
    meta.append(el('span', '', `×${item.qty ?? 1}`), el('span', '', item.where ?? ''));
    box.append(meta);
    if (item.note) box.append(el('p', 'page-sub', item.note));
    box.append(miniBtn('＋', 'сохранить предмет в библиотеку', () => saveToLibrary(id, 'item', item.name)));
    items.append(box);
  }
  if (!(data.items ?? []).length) items.append(el('p', 'page-sub', 'пока пусто'));
  itemCard.append(items);
  page.append(itemCard);

  // Конспект и память.
  const logCard = section('Конспект', 'Арки, точка входа, крючки и долги.');
  logCard.append(el('div', 'container-memory', data.memory ? `Память: ${data.memory}` : 'Память: пока пусто — закрепи факт в игре.'));
  const summaryPre = el('pre', 'prompt-dump conspect-dump');
  summaryPre.textContent = data.summary || '(конспект пока пуст)';
  logCard.append(summaryPre);
  if ((data.arcs ?? []).length) {
    const archive = el('details', 'container-agent');
    archive.append(el('summary', '', `Архив старых арок (${data.arcs.length})`));
    for (const arcText of data.arcs) {
      const pre = el('pre', 'prompt-dump');
      pre.textContent = arcText;
      archive.append(pre);
    }
    logCard.append(archive);
  }
  if (data.conspect) {
    const frozen = el('details', 'container-agent');
    frozen.append(el('summary', '', 'Замороженный конспект текущего окна'));
    const pre = el('pre', 'prompt-dump');
    pre.textContent = data.conspect;
    frozen.append(pre);
    logCard.append(frozen);
  }
  page.append(logCard);

  // Галерея.
  const galleryCard = section('Галерея', `${(data.illustrations ?? []).length} изображений`);
  const gallery = el('div', 'gallery-grid');
  for (const ill of data.illustrations ?? []) {
    const link = el('a', 'gallery-item');
    link.href = ill.url;
    link.target = '_blank';
    const img = el('img');
    img.src = ill.url;
    img.alt = ill.caption || 'кадр';
    img.loading = 'lazy';
    link.append(img);
    const cap = el('span', 'gallery-cap', `${ill.caption || 'кадр'} · ход ${ill.turn}`);
    link.append(cap);
    gallery.append(link);
  }
  if (!(data.illustrations ?? []).length) gallery.append(el('p', 'page-sub', 'кадров пока нет'));
  galleryCard.append(gallery);
  page.append(galleryCard);

  view.append(page);
}

/* ================= агенты ================= */

const AGENT_ORDER = ['gm', 'prompter', 'state', 'summarizer', 'filler', 'artistHero', 'artistNpc', 'artistItem', 'artistScene'];

async function viewAgents(view) {
  const page = el('div', 'page');
  page.append(pageHead('Семь ролей', 'Агенты', 'Базовые агенты — шаблон. В новой игре создаются свои ведущий и иллюстратор истории, остальные берутся из базы.'));

  const list = await api('/api/campaigns');
  let campaign = currentCampaignId() ?? '';
  if (campaign && !list.some((c) => c.id === campaign)) campaign = '';

  const scope = el('select', 'agent-scope');
  const globalOption = el('option', '', 'Глобальные настройки');
  globalOption.value = '';
  scope.append(globalOption);
  for (const c of list) {
    const option = el('option', '', `Игра: ${c.id}`);
    option.value = c.id;
    scope.append(option);
  }
  scope.value = campaign;

  const keys = (await api('/api/keys').catch(() => ({ keys: [] }))).keys ?? [];
  const holder = el('div');
  const build = async () => {
    holder.replaceChildren();
    const agents = await api(`/api/agents${campaign ? `?id=${encodeURIComponent(campaign)}` : ''}`);
    for (const id of AGENT_ORDER) if (agents[id]) holder.append(agentCard(agents[id], campaign, keys));
    holder.append(await loreCard());
  };

  scope.addEventListener('change', async () => {
    campaign = scope.value;
    await build();
  });

  const scopeField = el('div', 'field');
  scopeField.append(el('label', '', 'Чьи настройки правим'), scope);
  page.append(scopeField, holder);
  await build();
  view.append(page);
}

function agentCard(agent, campaign, keys = []) {
  const card = el('div', 'agent-card');
  const head = el('div', 'agent-head');
  head.append(el('h3', '', agent.title), el('span', 'agent-id', agent.id));
  card.append(head);

  const toggleLabel = el('label', 'switch');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.checked = Boolean(agent.enabled);
  toggleLabel.append(toggle, el('span', '', 'включён'));
  card.append(toggleLabel);

  const keySelect = el('select');
  const noKey = el('option', '', 'глобальный OPENROUTER_API_KEY');
  noKey.value = '';
  keySelect.append(noKey);
  for (const item of keys) {
    const option = el('option', '', `${item.name} (${item.masked})`);
    option.value = item.id;
    keySelect.append(option);
  }
  keySelect.value = agent.keyRef ?? '';
  card.append(agentField('Ключ API', keySelect));

  const imageAgent = /^artist/.test(agent.id);
  const priceLine = el('div', 'price-line');
  const modelInput = el('input');
  modelInput.value = agent.model;
  modelInput.setAttribute('list', `models-${agent.id}`);
  const modelList = el('datalist');
  modelList.id = `models-${agent.id}`;
  card.append(agentField('Модель', modelInput), modelList, priceLine);

  const showPrice = (models) => {
    const hit = models.find((m) => m.id === modelInput.value);
    if (!hit) {
      priceLine.textContent = '';
      return;
    }
    if (imageAgent && hit.image != null) priceLine.textContent = `$${Number(hit.image).toFixed(4)} за кадр`;
    else if (hit.input != null) {
      priceLine.textContent = `$${Number(hit.input).toFixed(3)} вход · $${Number(hit.output ?? 0).toFixed(3)} выход / 1M`;
    } else priceLine.textContent = 'цена не указана';
  };

  const loadModels = async () => {
    if (!keySelect.value) {
      modelList.replaceChildren();
      priceLine.textContent = 'модель из .env';
      return;
    }
    priceLine.textContent = 'загружаю модели…';
    try {
      const res = await api(`/api/keys/${encodeURIComponent(keySelect.value)}/models`);
      const models = (res.models ?? []).filter((m) => (imageAgent ? m.kind === 'image' : m.kind !== 'image'));
      modelList.replaceChildren();
      for (const model of models) {
        const option = el('option');
        option.value = model.id;
        option.label = model.input != null ? `$${Number(model.input).toFixed(3)} / 1M` : '';
        modelList.append(option);
      }
      priceLine.textContent = `моделей: ${models.length}`;
      showPrice(models);
    } catch (err) {
      priceLine.textContent = err.message;
    }
  };

  keySelect.addEventListener('change', loadModels);
  if (agent.keyRef) loadModels();

  const temp = el('input');
  temp.type = 'range';
  temp.min = '0';
  temp.max = '2';
  temp.step = '0.05';
  temp.value = String(agent.temperature);
  const tempLabel = el('span', 'temp-value', String(agent.temperature));
  temp.addEventListener('input', () => {
    tempLabel.textContent = temp.value;
  });
  const tempWrap = el('div');
  tempWrap.append(temp, tempLabel);
  card.append(agentField('Температура', tempWrap));

  const maxTokens = el('input');
  maxTokens.type = 'number';
  maxTokens.value = String(agent.maxTokens);
  card.append(agentField('Лимит токенов', maxTokens));

  const prompt = el('textarea', 'prompt-area');
  prompt.value = agent.prompt;
  card.append(agentField('Промт', prompt));

  const actions = el('div', 'agent-actions');
  const save = el('button', 'btn primary small', 'Сохранить');
  const reset = el('button', 'btn small', 'Сбросить');
  const test = el('button', 'btn small', 'Тест');
  const status = el('span', 'status');
  actions.append(save, reset, test, status);
  card.append(actions);

  const testBox = el('div', 'agent-test hidden');
  const testInput = el('textarea');
  testInput.placeholder = 'Что отправить агенту. Пусто — короткая проверка связи.';
  const runTest = el('button', 'btn small', 'Отправить');
  const testOut = el('pre', 'test-out');
  testBox.append(testInput, runTest, testOut);
  card.append(testBox);

  test.addEventListener('click', () => testBox.classList.toggle('hidden'));

  save.addEventListener('click', async () => {
    status.textContent = 'сохраняю…';
    try {
      const payload = {
        keyRef: keySelect.value || '',
        model: modelInput.value,
        temperature: Number(temp.value),
        maxTokens: Number(maxTokens.value),
        prompt: prompt.value,
        enabled: toggle.checked,
      };
      if (campaign) payload.campaign = campaign;
      await api(`/api/agents/${agent.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      status.textContent = 'сохранено';
    } catch (err) {
      status.textContent = err.message;
    }
  });

  reset.addEventListener('click', async () => {
    status.textContent = 'сбрасываю…';
    try {
      await api(`/api/agents/${agent.id}/reset`, {
        method: 'POST',
        body: JSON.stringify({ campaign: campaign || undefined }),
      });
      router();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  runTest.addEventListener('click', async () => {
    runTest.disabled = true;
    testOut.textContent = '…';
    try {
      const res = await api(`/api/agents/${agent.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ input: testInput.value.trim() || undefined }),
      });
      testOut.textContent = `${res.text}\n\n— ${res.ms} мс · ${res.tokensOut} ток · $${(res.cost ?? 0).toFixed(6)} · ${res.model}`;
    } catch (err) {
      testOut.textContent = `Ошибка: ${err.message}`;
    } finally {
      runTest.disabled = false;
    }
  });

  return card;
}

function agentField(labelText, node) {
  const wrap = el('div', 'field');
  wrap.append(el('label', '', labelText), node);
  return wrap;
}

async function artTagsCard() {
  const data = await api('/api/art-tags');
  const picked = new Map();
  for (const name of data.selection?.include ?? []) picked.set(name, 'include');
  for (const name of data.selection?.exclude ?? []) picked.set(name, 'exclude');

  const card = el('div', 'art-card');
  card.append(el('p', 'page-sub', 'Клик — выбрать, второй — исключить, третий — сброс. Выбранные дополняют промт кадра, исключённые попадают в «не изображать».'));

  const summary = el('div', 'status art-status');
  const groupsBox = el('div');

  const refresh = () => {
    const inc = [...picked].filter(([, v]) => v === 'include').map(([k]) => k);
    const exc = [...picked].filter(([, v]) => v === 'exclude').map(([k]) => k);
    summary.textContent = `выбрано: ${inc.length} · исключено: ${exc.length}`;
    return { inc, exc };
  };

  for (const group of data.groups ?? []) {
    const total = group.subgroups.reduce((sum, sg) => sum + sg.fields.length, 0);
    const block = el('details', 'tag-group art-group');
    const summaryEl = el('summary');
    summaryEl.append(el('span', 'tg-name', `${group.group} · ${total}`));
    block.append(summaryEl);

    const mkBtn = (label, title, mode, scope) => {
      const btn = el('button', 'tg-btn', label);
      btn.type = 'button';
      btn.title = title;
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        for (const item of scope) {
          for (let step = 0; step < 4; step += 1) {
            const current = item.classList.contains('on')
              ? 'include'
              : item.classList.contains('ex')
                ? 'exclude'
                : '';
            if (current === mode) break;
            item.click();
          }
        }
        refresh();
      });
      return btn;
    };

    for (const sg of group.subgroups) {
      const items = [];
      const roww = el('div', 'tag-row');
      const titleRow = el('div', 'tag-title-row');
      titleRow.append(el('div', 'tag-title', sg.subgroup));
      const controls = el('span', 'tag-group-actions');
      controls.append(
        mkBtn('все', 'выбрать все теги подгруппы', 'include', items),
        mkBtn('исключить', 'исключить все теги подгруппы', 'exclude', items),
        mkBtn('сброс', 'сбросить выбор подгруппы', '', items),
      );
      titleRow.append(controls);
      roww.append(titleRow);
      const list = el('div', 'tag-list');

      for (const field of sg.fields) {
        const item = el('button', 'tag-item');
        item.type = 'button';
        item.title = `«${field.name}» — ${field.description || 'приём в кадре'}`;
        items.push(item);
        const marker = el('span', 'marker', '□');
        item.append(marker, el('span', 'tag-name', field.name));

        const apply = (mode) => {
          item.classList.toggle('on', mode === 'include');
          item.classList.toggle('ex', mode === 'exclude');
          marker.textContent = mode === 'include' ? '✓' : mode === 'exclude' ? '✕' : '□';
        };
        apply(picked.get(field.name));

        item.addEventListener('click', () => {
          const current = picked.get(field.name);
          if (!current) {
            picked.set(field.name, 'include');
            apply('include');
          } else if (current === 'include') {
            picked.set(field.name, 'exclude');
            apply('exclude');
          } else {
            picked.delete(field.name);
            apply('');
          }
          refresh();
        });

        list.append(item);
      }

      roww.append(list);
      block.append(roww);
    }

    groupsBox.append(block);
  }

  const actions = el('div', 'agent-actions');
  const save = el('button', 'btn primary small', 'Сохранить теги');
  const state = el('span', 'status');
  actions.append(save, state);

  save.addEventListener('click', async () => {
    const { inc, exc } = refresh();
    state.textContent = 'сохраняю…';
    try {
      await api('/api/art-tags', { method: 'PUT', body: JSON.stringify({ include: inc, exclude: exc }) });
      state.textContent = 'сохранено';
    } catch (err) {
      state.textContent = err.message;
    }
  });

  card.append(groupsBox, actions, summary);
  refresh();
  return card;
}

async function loreCard() {
  const data = await api('/api/lorebook');
  const entries = (data.entries ?? []).map((e) => ({ ...e }));

  const card = el('div', 'agent-card');
  const head = el('div', 'agent-head');
  head.append(el('h3', '', 'Лор-книга'), el('span', 'agent-id', 'world info'));
  card.append(head);
  card.append(el('p', 'page-sub', 'Запись попадает в контекст, только если её ключ встретился в сцене. Так мир подробный, а контекст короткий.'));

  const list = el('div', 'lore-list');
  const render = () => {
    list.replaceChildren();
    entries.forEach((entry, index) => {
      const roww = el('div', 'lore-row');
      const keys = el('input', 'lore-keys');
      keys.placeholder = 'ключи через запятую: пепел, вулкан';
      keys.value = (entry.keys ?? []).join(', ');
      keys.addEventListener('input', () => {
        entry.keys = keys.value.split(',').map((k) => k.trim()).filter(Boolean);
      });

      const content = el('textarea', 'lore-content');
      content.placeholder = 'Что рассказать модели, когда ключ сработал';
      content.value = entry.content ?? '';
      content.addEventListener('input', () => {
        entry.content = content.value;
      });

      const remove = el('button', 'btn small', '✕');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        entries.splice(index, 1);
        render();
      });

      roww.append(keys, content, remove);
      list.append(roww);
    });
    if (entries.length === 0) list.append(el('p', 'page-sub', 'Пока пусто.'));
  };
  render();

  const actions = el('div', 'agent-actions');
  const add = el('button', 'btn small', '+ запись');
  const save = el('button', 'btn primary small', 'Сохранить лор');
  const state = el('span', 'status');
  actions.append(add, save, state);

  add.addEventListener('click', () => {
    entries.push({ id: `lore-${Date.now()}`, keys: [], content: '' });
    render();
  });

  save.addEventListener('click', async () => {
    const clean = entries.filter((e) => e.keys.length && e.content.trim());
    state.textContent = 'сохраняю…';
    try {
      const res = await api('/api/lorebook', { method: 'PUT', body: JSON.stringify({ entries: clean }) });
      state.textContent = `сохранено: ${res.entries.length}`;
    } catch (err) {
      state.textContent = err.message;
    }
  });

  card.append(list, actions);
  return card;
}

/* ================= статистика ================= */

async function adminSessionsTab(container) {
  const statusOf = (row) => {
    if (row.frozen) return 'frozen';
    const saved = row.savedAt ? new Date(row.savedAt).getTime() : 0;
    const old = saved > 0 && Date.now() - saved > 7 * 24 * 60 * 60 * 1000;
    return row.turn === 0 || old ? 'abandoned' : 'active';
  };
  const data = await api('/api/admin/sessions');
  const active = (data.active ?? []).map((row) => ({
    ...row,
    status: statusOf(row),
    deleted: false,
  }));
  const trash = (data.trash ?? []).map((row) => ({ ...row, status: 'deleted', deleted: true }));
  const all = [...active, ...trash];
  const state = { filter: 'all' };
  const tabs = el('div', 'chips admin-filter');
  const list = el('div', 'admin-list');
  const filters = [
    ['all', 'Все'],
    ['active', 'Играю'],
    ['abandoned', 'Брошенные'],
    ['frozen', 'Замороженные'],
    ['deleted', 'Удалённые'],
  ];

  const reload = async () => {
    container.replaceChildren(tabs, list);
    const fresh = await api('/api/admin/sessions');
    const rows = [
      ...(fresh.active ?? []).map((row) => ({
        ...row,
        status: statusOf(row),
        deleted: false,
      })),
      ...(fresh.trash ?? []).map((row) => ({ ...row, status: 'deleted', deleted: true })),
    ];
    all.length = 0;
    all.push(...rows);
    renderList();
  };

  const renderList = () => {
    tabs.replaceChildren();
    for (const [key, label] of filters) {
      const count = key === 'all' ? all.length : all.filter((row) => row.status === key).length;
      const chip = el('button', `chip${state.filter === key ? ' active' : ''}`, `${label} (${count})`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        state.filter = key;
        renderList();
      });
      tabs.append(chip);
    }
    list.replaceChildren();
    const rows = all.filter((row) => state.filter === 'all' || row.status === state.filter);
    if (!rows.length) {
      list.append(emptyBox('Пусто', 'В этой вкладке пока нет историй.'));
      return;
    }
    for (const row of rows) {
      const card = el('div', 'row-card');
      card.append(el('div', 'row-cover c5', row.deleted ? '🗑' : '🜂'));
      const main = el('div', 'row-main');
      main.append(el('h3', '', row.title || row.id));
      const meta = el('div', 'row-meta');
      meta.append(
        el('span', '', row.id),
        el('span', '', `ход ${row.turn ?? 0}`),
        el('span', '', row.place ?? '—'),
        el('span', '', row.savedAt ? dateLabel(row.savedAt) : 'без даты'),
      );
      main.append(meta);
      const actions = el('div', 'row-actions');
      if (!row.deleted) {
        const go = el('button', 'btn small', 'Продолжить');
        go.addEventListener('click', () => {
          location.hash = `#/play/${encodeURIComponent(row.id)}`;
        });
        const freeze = el('button', 'btn small', row.frozen ? 'Разморозить' : 'Заморозить');
        freeze.addEventListener('click', async () => {
          await api(`/api/admin/sessions/${encodeURIComponent(row.id)}/freeze`, {
            method: 'POST',
            body: JSON.stringify({ frozen: !row.frozen }),
          });
          await reload();
        });
        const del = el('button', 'btn small danger', 'Удалить');
        del.addEventListener('click', async () => {
          if (!confirm(`Удалить «${row.title || row.id}»? Файл уйдёт в корзину.`)) return;
          await api(`/api/campaign/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
          await reload();
        });
        actions.append(go, freeze, del);
      } else {
        const restore = el('button', 'btn small', 'Восстановить');
        restore.addEventListener('click', async () => {
          await api(`/api/admin/trash/${encodeURIComponent(row.file)}/restore`, { method: 'POST' });
          await reload();
        });
        const erase = el('button', 'btn small danger', 'Стереть');
        erase.addEventListener('click', async () => {
          if (!confirm(`Стереть «${row.title || row.id}» навсегда?`)) return;
          await api(`/api/admin/trash/${encodeURIComponent(row.file)}`, { method: 'DELETE' });
          await reload();
        });
        actions.append(restore, erase);
      }
      card.append(main, actions);
      list.append(card);
    }
  };

  container.append(tabs, list);
  renderList();
}

async function viewAdmin(view) {
  const page = el('div', 'page');
  page.append(
    pageHead(
      'Служебный режим',
      'Админка',
      'Все сессии, включая брошенные и удалённые. Статистика, ключи, ядро и агенты — вкладками.',
    ),
  );
  const tabs = el('div', 'chips admin-tabs');
  const content = el('div', 'admin-content');
  page.append(tabs, content);
  view.append(page);

  const sections = [
    ['sessions', 'Сессии'],
    ['stats', 'Статистика'],
    ['keys', 'Ключи'],
    ['core', 'Ядро'],
    ['agents', 'Агенты'],
  ];
  let active = 'sessions';

  const render = async () => {
    tabs.replaceChildren();
    for (const [key, label] of sections) {
      const chip = el('button', `chip${active === key ? ' active' : ''}`, label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        active = key;
        render();
      });
      tabs.append(chip);
    }
    content.replaceChildren();
    if (active === 'sessions') await adminSessionsTab(content);
    else if (active === 'stats') await viewStats(content);
    else if (active === 'keys') await viewKeys(content);
    else if (active === 'core') await viewCore(content);
    else await viewAgents(content);
  };

  await render();
}

async function viewStats(view) {
  const stats = await api('/api/stats');
  const t = stats.totals;

  const page = el('div', 'page');
  page.append(pageHead('Расход и темп', 'Статистика', 'Токены, кэш и деньги по каждой истории.'));

  const tiles = el('div', 'tiles');
  tiles.append(
    tile('Всего', money(t.cost)),
    tile('Ходов', num(t.turns)),
    tile('Средний ход', money(t.avgCostPerTurn)),
    tile('Кэш', `${Math.round((t.cacheHitRate ?? 0) * 100)}`, '%'),
    tile('Кадров', num(stats.images ?? 0)),
  );
  page.append(tiles);

  if (stats.campaigns.length === 0) {
    page.append(emptyBox('Считать нечего', 'Начни историю — здесь появятся цифры.'));
    view.append(page);
    return;
  }

  const table = el('table', 'table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['История', 'Ходов', 'Вход', 'Из кэша', 'Выход', 'Стоимость']) {
    const th = el('th', '', h);
    if (h !== 'История') th.style.textAlign = 'right';
    hr.append(th);
  }
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const c of stats.campaigns) {
    const tr = el('tr');
    tr.append(el('td', '', c.id), el('td', 'num', num(c.turn)), el('td', 'num', num(c.tokensIn)));
    tr.append(el('td', 'num', num(c.cached)), el('td', 'num', num(c.tokensOut)), el('td', 'num', money(c.cost)));
    tbody.append(tr);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', '', 'Итого'), el('td', 'num', num(t.turns)), el('td', 'num', num(t.tokensIn)));
  fr.append(el('td', 'num', num(t.cached)), el('td', 'num', num(t.tokensOut)), el('td', 'num', money(t.cost)));
  tfoot.append(fr);
  table.append(tfoot);

  const wrap = el('div');
  wrap.style.marginTop = '10px';
  wrap.append(table);
  page.append(wrap);

  const agents = stats.agents ?? {};
  if (Object.keys(agents).length > 0) {
    const at = el('table', 'table');
    const ahead = el('thead');
    const ahr = el('tr');
    for (const h of ['Агент', 'Вызовов', 'Вход', 'Выход', 'Стоимость']) {
      const th = el('th', '', h);
      if (h !== 'Агент') th.style.textAlign = 'right';
      ahr.append(th);
    }
    ahead.append(ahr);
    at.append(ahead);
    const abody = el('tbody');
    for (const [name, data] of Object.entries(agents)) {
      const tr = el('tr');
      tr.append(el('td', '', name), el('td', 'num', num(data.calls)));
      tr.append(el('td', 'num', num(data.tokensIn)), el('td', 'num', num(data.tokensOut)));
      tr.append(el('td', 'num', money(data.cost)));
      abody.append(tr);
    }
    at.append(abody);
    page.append(el('h3', 'page-kicker', 'Агенты'), at);
  }

  view.append(page);
}

/* ================= новая игра ================= */

let artCardCache = null;
let catalogCache = null;

async function getCatalog() {
  if (!catalogCache) catalogCache = await api('/api/catalog');
  return catalogCache;
}

function templateSkills(skills) {
  const wrap = el('div', 'person-skills');
  for (const [name, value] of Object.entries(skills ?? {})) {
    const line = el('div', 'skill-row');
    line.append(el('span', 'skill-name', name));
    const bar = el('div', 'skill-bar');
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(20, Number(value) || 0)) * 5}%`;
    bar.append(fill);
    line.append(bar, el('span', 'skill-value', String(value)));
    wrap.append(line);
  }
  return wrap;
}

function templateField(label, value) {
  if (!value) return null;
  const box = el('div', 'template-field');
  box.append(el('span', 'person-label', label), el('div', 'person-value', value));
  return box;
}

async function saveToLibrary(campaignId, type, name) {
  const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/save-card`, {
    method: 'POST',
    body: JSON.stringify({ type, name }),
  });
  toast(`карточка сохранена: ${res.card?.name ?? name}`);
  return res.card;
}

const CARD_TYPE_LABELS = {
  hero: 'Герой',
  npc: 'NPC',
  item: 'Предмет',
  location: 'Локация',
  faction: 'Фракция',
  quest: 'Задание',
  creature: 'Тварь',
};

function cardSkillList(card) {
  const list = [];
  for (const [name, value] of Object.entries(card.attributes ?? {})) list.push([name, value, 'attr']);
  for (const [name, value] of Object.entries(card.skills ?? {})) list.push([name, value, 'skill']);
  return list;
}

function cardToHeroTemplate(card) {
  const start = card.data?.start ?? {};
  return {
    name: card.name,
    title: card.subtitle ?? 'герой',
    essence: card.description ?? card.character ?? '',
    appearance: card.appearance ?? '',
    bodyAttitude: card.data?.bodyAttitude ?? '',
    origin: card.biography ?? '',
    quirks: card.habits ?? '',
    abilities: card.abilities ?? '',
    start: start.description ?? '',
    skills: card.skills ?? {},
  };
}

function openLibraryCard(card, campaigns) {
  const overlay = el('div', 'library-modal');
  const sheet = el('article', 'library-sheet');
  const head = el('div', 'library-sheet-head');
  const titles = el('div');
  titles.append(el('h2', 'person-name', card.name));
  if (card.subtitle) titles.append(el('div', 'person-role', card.subtitle));
  const badge = el('span', 'chip gold', CARD_TYPE_LABELS[card.type] ?? card.type);
  const close = el('button', 'btn small', '✕');
  head.append(titles, badge, close);

  const top = el('div', 'library-sheet-top');
  const media = el('div', 'library-sheet-media');
  if (card.image) {
    const img = el('img', 'library-sheet-img');
    img.src = card.image;
    img.alt = card.name;
    media.append(img);
  } else {
    media.append(el('div', 'library-sheet-img actor-tile-initial', (card.name || '?').slice(0, 1)));
  }
  const meta = el('div', 'library-sheet-meta');
  for (const [label, value] of [
    ['Ранг', card.rank],
    ['Роль', card.role],
    ['Пол', card.gender === 'female' ? 'женский' : card.gender === 'male' ? 'мужской' : ''],
    ['Возраст', card.age ? `${card.age}` : ''],
    ['Статус', card.status],
    ['Происхождение', card.origin?.title],
  ]) {
    if (!value) continue;
    const row = el('div', 'person-field');
    row.append(el('span', 'person-label', label), el('div', 'person-value', value));
    meta.append(row);
  }
  if (card.tags?.length) {
    const chips = el('div', 'chips');
    for (const tag of card.tags) chips.append(el('span', 'chip', tag));
    meta.append(chips);
  }
  top.append(media, meta);

  const body = el('div', 'library-sheet-body');
  for (const [label, value] of [
    ['Описание', card.description],
    ['Биография', card.biography],
    ['Характер', card.character],
    ['Привычки', card.habits],
    ['Способности', card.abilities],
    ['Внешность', card.appearance],
  ]) {
    const node = templateField(label, value);
    if (node) body.append(node);
  }

  const stats = cardSkillList(card);
  if (stats.length) {
    const block = el('div', 'person-field');
    block.append(el('span', 'person-label', 'Характеристики и навыки'));
    const wrap = el('div', 'library-stats');
    for (const [name, value] of stats) {
      const line = el('div', 'skill-row');
      line.append(el('span', 'skill-name', name));
      const bar = el('div', 'skill-bar');
      const fill = el('i');
      fill.style.width = `${Math.max(0, Math.min(20, Number(value) || 0)) * 5}%`;
      bar.append(fill);
      line.append(bar, el('span', 'skill-value', String(value)));
      wrap.append(line);
    }
    block.append(wrap);
    body.append(block);
  }

  const extra = card.data ?? {};
  const extraRows = [
    ['Класс', extra.class],
    ['Уровень', extra.level],
    ['Редкость', extra.rarity],
    ['Урон', extra.damage],
    ['Вес', extra.weight],
    ['Цена', extra.price],
    ['Регион', extra.region],
    ['Опасность', extra.danger],
    ['Глава', extra.leader],
    ['Идеология', extra.ideology],
    ['Статус задания', extra.status],
    ['Награда', extra.reward],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (extraRows.length) {
    const block = el('div', 'person-field');
    block.append(el('span', 'person-label', 'Дополнительно'));
    for (const [label, value] of extraRows) {
      block.append(el('div', 'person-value', `${label}: ${value}`));
    }
    body.append(block);
  }

  const actions = el('div', 'library-sheet-actions');
  if (card.type === 'hero') {
    const take = el('button', 'btn primary small', 'В новую игру');
    take.type = 'button';
    take.addEventListener('click', () => {
      app.pendingHero = cardToHeroTemplate(card);
      overlay.remove();
      location.hash = '#/new';
    });
    actions.append(take);
  }
  if (card.type === 'npc' && campaigns.length) {
    const select = el('select', 'template-select');
    for (const camp of campaigns) {
      const option = el('option', '', `${camp.title || camp.id} · ход ${camp.turn ?? 0}`);
      option.value = camp.id;
      select.append(option);
    }
    const add = el('button', 'btn small', 'Добавить в игру');
    add.type = 'button';
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        await api(`/api/campaign/${encodeURIComponent(select.value)}/npc`, {
          method: 'POST',
          body: JSON.stringify({
            name: card.name,
            role: card.role,
            attitude: card.data?.attitude ?? 0,
            bond: card.data?.bond ?? 0,
            appearance: card.appearance,
            character: card.character,
            clothes: card.data?.clothes,
            bio: card.biography,
            description: card.description,
            abilities: card.abilities,
            note: card.data?.note,
            skills: card.skills,
          }),
        });
        toast(`${card.name} добавлен в игру`);
      } catch (err) {
        toast(err.message);
      } finally {
        add.disabled = false;
      }
    });
    actions.append(select, add);
  }
  if (!['hero', 'npc'].includes(card.type)) {
    actions.append(el('span', 'page-sub', 'добавление этого типа — следующий шаг'));
  }
  sheet.append(head, top, body, actions);
  overlay.append(sheet);
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.append(overlay);
}

async function viewTemplates(view) {
  const [data, campaigns] = await Promise.all([api('/api/cards'), api('/api/campaigns')]);
  const all = data.cards ?? [];
  const page = el('div', 'page');
  page.append(
    pageHead(
      'Библиотека карточек',
      'Карточки',
      'Один файл — одна карточка. Герой, NPC, предмет, локация, фракция, задание, тварь.',
    ),
  );

  const state = { type: 'all', query: '' };
  const toolbar = el('div', 'library-toolbar');
  const tabs = el('div', 'chips library-tabs');
  const search = el('input', 'library-search');
  search.placeholder = 'поиск: имя, описание, биография, теги';
  toolbar.append(tabs, search);
  const grid = el('div', 'library-grid');
  page.append(toolbar, grid);

  const render = () => {
    tabs.replaceChildren();
    const types = ['all', ...Object.keys(CARD_TYPE_LABELS)];
    for (const type of types) {
      const count = type === 'all' ? all.length : all.filter((card) => card.type === type).length;
      if (type !== 'all' && !count) continue;
      const chip = el('button', `chip${state.type === type ? ' active' : ''}`, `${type === 'all' ? 'Все' : CARD_TYPE_LABELS[type]} (${count})`);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        state.type = type;
        render();
      });
      tabs.append(chip);
    }

    const query = state.query.trim().toLowerCase();
    const list = all.filter((card) => {
      if (state.type !== 'all' && card.type !== state.type) return false;
      if (!query) return true;
      return [card.name, card.subtitle, card.description, card.biography, card.character, ...(card.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query);
    });

    grid.replaceChildren();
    if (!list.length) {
      grid.append(emptyBox('Пусто', 'Карточек этого типа пока нет.'));
      return;
    }
    for (const card of list) {
      const tile = el('article', 'library-card');
      tile.tabIndex = 0;
      const image = el('div', 'library-card-image');
      if (card.image) {
        const img = el('img');
        img.src = card.image;
        img.loading = 'lazy';
        img.alt = card.name;
        image.append(img);
      } else {
        image.append(el('span', 'library-card-initial', (card.name || '?').slice(0, 1)));
      }
      const body = el('div', 'library-card-body');
      const type = el('span', 'chip gold', CARD_TYPE_LABELS[card.type] ?? card.type);
      body.append(type);
      body.append(el('h3', 'person-name', card.name));
      if (card.subtitle) body.append(el('div', 'person-role', card.subtitle));
      if (card.description) body.append(el('p', 'library-desc', card.description));
      if (card.tags?.length) {
        const chips = el('div', 'chips');
        for (const tag of card.tags.slice(0, 4)) chips.append(el('span', 'chip', tag));
        body.append(chips);
      }
      const topStats = cardSkillList(card).slice(0, 3);
      if (topStats.length) {
        const wrap = el('div', 'library-mini-stats');
        for (const [name, value] of topStats) {
          wrap.append(el('span', 'library-mini-stat', `${name} ${value}`));
        }
        body.append(wrap);
      }
      tile.append(image, body);
      const open = () => openLibraryCard(card, campaigns);
      tile.addEventListener('click', open);
      tile.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') open();
      });
      grid.append(tile);
    }
  };

  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  view.append(page);
  render();
}

async function viewNew(view) {
  const catalog = await getCatalog();
  const levels = (await api('/api/tone-levels').catch(() => null))?.levels ?? [];
  artCardCache = await artTagsCard().catch(() => null);

  const presetsData = await api('/api/presets').catch(() => ({ presets: [] }));
  const wizard = {
    step: 1,
    title: '',
    customWorld: '',
    worldText: '',
    worldBrief: '',
    worldDescription: '',
    tagQuery: '',
    tagWords: '',
    toneLevel: 5,
    epochYear: 2000,
    altTime: false,
    eraLabel: '',
    gender: 'male',
    permadeath: true,
    presets: presetsData.presets ?? [],
    presetId: '',
    picks: new Map(),
    skills: undefined,
    hero: { name: '', essence: '', appearance: '', bodyAttitude: '', origin: '', quirks: '', abilities: '', start: '' },
    busy: false,
  };

  // Шаблон героя из библиотеки: заполняем форму и навыки.
  if (app.pendingHero) {
    const tpl = app.pendingHero;
    wizard.hero = {
      name: tpl.name ?? '',
      essence: tpl.essence ?? '',
      appearance: tpl.appearance ?? '',
      bodyAttitude: tpl.bodyAttitude ?? '',
      origin: tpl.origin ?? '',
      quirks: tpl.quirks ?? '',
      abilities: tpl.abilities ?? '',
      start: tpl.start ?? '',
    };
    wizard.skills = tpl.skills;
    app.pendingHero = null;
    toast(`карточка героя: ${tpl.name}`);
  }

  const page = el('div', 'page wizard');
  page.append(pageHead('Создать историю', 'Новая хроника', 'Ядро общее и неизменное. Тон собирается по тегам, мир — из твоего описания, герой — из формы.'));

  const stepsBar = el('div', 'steps');
  const stepEls = ['Тон и мир', 'Герой', 'Сборка'].map((name, i) => {
    const node = el('div', 'step', `${i + 1}. ${name}`);
    stepsBar.append(node);
    return node;
  });
  page.append(stepsBar);

  const body = el('div', 'wizard-body');
  const nav = el('div', 'wizard-nav');
  const back = el('button', 'btn', '← Назад');
  const next = el('button', 'btn primary', 'Далее →');
  nav.append(back, next);
  page.append(body, nav);

  const steps = [stepTone, stepHero, stepReview];

  // По шагам можно ходить кликом — страница не выглядит статичной.
  stepEls.forEach((node, i) => {
    node.addEventListener('click', () => {
      wizard.step = i + 1;
      render();
    });
  });

  const render = () => {
    body.replaceChildren();
    stepEls.forEach((node, i) => node.classList.toggle('active', i === wizard.step - 1));
    back.disabled = wizard.step === 1;
    next.classList.toggle('hidden', wizard.step === steps.length);
    steps[wizard.step - 1]();
    window.scrollTo({ top: 0 });
  };

  back.addEventListener('click', () => {
    if (wizard.step > 1) {
      wizard.step -= 1;
      render();
    }
  });
  next.addEventListener('click', () => {
    if (wizard.step < 4) {
      wizard.step += 1;
      render();
    }
  });

  function stepTone() {
    if (wizard.presets.length) {
      const block = el('div', 'preset-block');
      block.append(el('div', 'field-label', 'Мои пресеты'));
      const row = el('div', 'preset-row');
      const select = el('select', 'preset-select');
      for (const preset of wizard.presets) {
        const option = el('option', '', `${preset.name} · ур. ${preset.toneLevel ?? '?'}`);
        option.value = preset.id;
        select.append(option);
      }
      select.value = wizard.presetId || wizard.presets[0].id;
      const load = el('button', 'btn small', 'Загрузить');
      load.type = 'button';
      load.addEventListener('click', () => {
        const preset = wizard.presets.find((entry) => entry.id === select.value);
        if (!preset) return;
        wizard.title = preset.title ?? '';
        wizard.toneLevel = Number(preset.toneLevel ?? 5);
        wizard.epochYear = Number(preset.epochYear ?? 2000);
        wizard.altTime = preset.altTime === true;
        wizard.eraLabel = String(preset.eraLabel ?? '');
        wizard.gender = preset.gender === 'female' ? 'female' : 'male';
        wizard.permadeath = preset.permadeath !== false;
        wizard.customWorld = preset.world?.description ?? '';
        wizard.worldText = preset.world?.text ?? '';
        wizard.worldBrief = preset.world?.brief ?? '';
        wizard.worldDescription = preset.world?.description ?? '';
        wizard.hero = {
          name: '', essence: '', appearance: '', bodyAttitude: '',
          origin: '', quirks: '', abilities: '', start: '',
          ...(preset.hero ?? {}),
        };
        wizard.skills = preset.hero?.skills ?? preset.skills;
        wizard.picks = new Map();
        for (const pick of preset.picks ?? []) {
          if (!pick?.group || !pick?.field) continue;
          const key = `T|${pick.group}|${pick.subgroup ?? ''}|${pick.field}`;
          wizard.picks.set(key, {
            group: pick.group,
            subgroup: pick.subgroup ?? '',
            field: pick.field,
            mode: pick.mode === 'exclude' ? 'exclude' : 'include',
          });
        }
        wizard.presetId = preset.id;
        wizard.step = 1;
        render();
        toast(`пресет загружен: ${preset.name}`);
      });
      const remove = el('button', 'btn small', 'Удалить');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const preset = wizard.presets.find((entry) => entry.id === select.value);
        if (!preset || !window.confirm(`Удалить пресет «${preset.name}»?`)) return;
        await api(`/api/presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' });
        wizard.presets = wizard.presets.filter((entry) => entry.id !== preset.id);
        render();
      });
      row.append(select, load, remove);
      block.append(row);
      body.append(block);
    } else {
      const block = el('div', 'preset-block');
      block.append(el('div', 'field-label', 'Мои пресеты'));
      block.append(
        el('p', 'page-sub', 'Пока пусто. Заполни историю и нажми «Сохранить пресет» на шаге 3.'),
      );
      body.append(block);
    }

    const titleField = el('div', 'field');
    titleField.append(el('label', '', 'Название истории'));
    const titleInput = el('input');
    titleInput.value = wizard.title;
    titleInput.placeholder = 'например: пепельный тракт';
    titleInput.addEventListener('input', () => {
      wizard.title = titleInput.value;
    });
    titleField.append(titleInput);
    body.append(titleField);

    const levelWrap = el('div', 'level-block');
    const levelHead = el('div', 'level-head');
    const levelName = el('b', 'level-name', '');
    const levelValue = el('span', 'level-value', '');
    levelHead.append(el('span', '', 'Уровень повествования'), levelName, levelValue);

    const range = el('input', 'level-range');
    range.type = 'range';
    range.min = '0';
    range.max = '11';
    range.step = '1';

    const applyLevel = () => {
      const info = levels.find((l) => l.value === wizard.toneLevel);
      levelName.textContent = info ? info.name : '';
      levelValue.textContent = `${wizard.toneLevel} / 11`;
      range.value = String(wizard.toneLevel);
    };
    range.addEventListener('input', () => {
      wizard.toneLevel = Number(range.value);
      applyLevel();
    });

    const dice = el('button', 'btn small level-dice', '🎲');
    dice.type = 'button';
    dice.title = 'подобрать теги под текущий уровень';

    const hint = el('p', 'page-sub level-hint', 'На 0–2 смерть и кровь не описываются, на 7–9 — подробная жестокость, на 10–11 — предел без смягчений.');
    applyLevel();

    levelWrap.append(levelHead, range, hint);
    const levelRow = el('div', 'level-row');
    levelRow.append(levelWrap, dice);
    body.append(levelRow);

    // Эпоха: бегунок от -10 000 до далёкого будущего + ручной ввод года.
    const epochWrap = el('div', 'level-block epoch-block');
    const epochHead = el('div', 'level-head');
    const epochLabel = el('b', 'level-name', '2000-е');
    const epochValue = el('span', 'level-value', '');
    epochHead.append(el('span', '', 'Эпоха'), epochLabel, epochValue);

    const epochRange = el('input', 'level-range epoch-range');
    epochRange.type = 'range';
    epochRange.min = '0';
    epochRange.max = '2000';
    epochRange.step = '1';

    const YEAR_MIN = -10000;
    const YEAR_MAX = 999999999;
    const MAX_LOG = Math.log(YEAR_MAX / 2000);

    const yearFromPos = (pos) => {
      if (pos <= 1000) return Math.round(YEAR_MIN + (pos / 1000) * (2000 - YEAR_MIN));
      return Math.round(2000 * Math.exp(((pos - 1000) / 1000) * MAX_LOG));
    };
    const posFromYear = (year) => {
      if (year <= 2000) return Math.round(((year - YEAR_MIN) / (2000 - YEAR_MIN)) * 1000);
      return Math.round(1000 + (Math.log(year / 2000) / MAX_LOG) * 1000);
    };

    const yearText = (year) => (year <= 0 ? `${1 - year} до н.э.` : `${year}`);
    const manualYear = el('input', 'epoch-input');
    manualYear.type = 'number';
    manualYear.min = String(YEAR_MIN);
    manualYear.max = String(YEAR_MAX);
    manualYear.placeholder = 'год, до 9 знаков';

    const applyEpoch = (year, syncSlider = true) => {
      const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, Math.round(Number(year) || 0)));
      wizard.epochYear = clamped;
      epochLabel.textContent = yearText(clamped);
      epochValue.textContent = clamped > 2000 ? 'будущее' : clamped < 2000 ? 'прошлое' : 'наше время';
      manualYear.value = String(clamped);
      if (syncSlider) epochRange.value = String(posFromYear(clamped));
    };

    epochRange.addEventListener('input', () => applyEpoch(yearFromPos(Number(epochRange.value)), false));
    manualYear.addEventListener('change', () => applyEpoch(manualYear.value));

    const epochHint = el('p', 'page-sub level-hint', 'Центр шкалы — 2000-е. Влево от центра — прошлое, вправо — будущее; далёкие годы идут по логарифмической шкале.');
    epochWrap.append(epochHead, epochRange, epochHint);
    const epochRow = el('div', 'level-row');
    epochRow.append(epochWrap, manualYear);
    body.append(epochRow);
    applyEpoch(wizard.epochYear ?? 2000);

    const timeAlt = el('div', 'field alt-time');
    const altLabel = el('label', 'check-line');
    const altToggle = el('input');
    altToggle.type = 'checkbox';
    altToggle.checked = wizard.altTime === true;
    altLabel.append(altToggle, el('span', '', 'Своё летоисчисление — мир живёт вне обычного года'));
    const eraInput = el('input', 'era-input');
    eraInput.placeholder = 'например: Третий век Пепла, 12-й год после Разлома';
    eraInput.value = wizard.eraLabel ?? '';
    eraInput.addEventListener('input', () => {
      wizard.eraLabel = eraInput.value;
      if (wizard.altTime) epochLabel.textContent = eraInput.value.trim() || 'своё летоисчисление';
    });
    const eraRow = el('div', 'era-row');
    const eraDice = el('button', 'btn small level-dice', '🎲');
    eraDice.type = 'button';
    eraDice.title = 'придумать эпоху и летоисчисление';
    eraDice.addEventListener('click', async () => {
      eraDice.disabled = true;
      try {
        const tags = [...wizard.picks.values()]
          .filter((pick) => pick.mode === 'include')
          .map((pick) => pick.field);
        const res = await api('/api/generate/era', {
          method: 'POST',
          body: JSON.stringify({
            tone: tags.join(', '),
            world: wizard.customWorld.trim() || wizard.worldText.trim(),
            toneLevel: wizard.toneLevel,
          }),
        });
        if (res.era) {
          wizard.eraLabel = res.era;
          eraInput.value = res.era;
          epochLabel.textContent = res.era;
          toast(`эпоха: ${res.era}${res.cost ? ` · $${res.cost.toFixed(4)}` : ''}`);
        }
      } catch (err) {
        toast(err.message);
      } finally {
        eraDice.disabled = false;
      }
    });
    eraRow.append(eraInput, eraDice);
    const syncTimeMode = () => {
      timeAlt.classList.toggle('alt-time-on', wizard.altTime);
      eraRow.classList.toggle('hidden', !wizard.altTime);
      epochRange.classList.toggle('hidden', wizard.altTime);
      manualYear.classList.toggle('hidden', wizard.altTime);
      epochHint.classList.toggle('hidden', wizard.altTime);
      if (wizard.altTime) {
        epochLabel.textContent = wizard.eraLabel.trim() || 'своё летоисчисление';
        epochValue.textContent = 'альтернативное';
      } else {
        applyEpoch(wizard.epochYear);
      }
    };
    altToggle.addEventListener('change', () => {
      wizard.altTime = altToggle.checked;
      syncTimeMode();
    });
    timeAlt.append(altLabel, eraRow);
    body.append(timeAlt);
    syncTimeMode();

    const picker = el('div', 'tag-picker');
    const words = el('input', 'tag-words');
    words.placeholder = 'Опиши игру: романтическая комедия, жёсткое фэнтези…';
    words.value = wizard.tagWords;
    const pickAll = el('button', 'btn small', 'Подобрать');
    pickAll.type = 'button';
    const pickDice = el('button', 'btn small', '🎲');
    pickDice.type = 'button';
    picker.append(words, pickAll, pickDice);
    body.append(picker);

    const summary = el('div', 'tag-summary');

    const renderSummary = () => {
      summary.replaceChildren();
      const values = [...wizard.picks.values()];
      const chosen = values.filter((v) => v.mode === 'include').map((v) => v.field);
      const excluded = values.filter((v) => v.mode === 'exclude').map((v) => v.field);

      const line = (title, list, cls) => {
        const box = el('div', 'ts-line');
        box.append(el('span', 'ts-title', `${title} (${list.length})`));
        const chips = el('div', 'chips');
        for (const name of list.slice(0, 40)) chips.append(el('span', `chip ${cls}`, name));
        if (list.length === 0) chips.append(el('span', 'chip', '—'));
        box.append(chips);
        return box;
      };

      summary.append(line('Выбрано', chosen, 'on'), line('Исключено', excluded, 'ex'));
      const clear = el('button', 'btn small', 'Очистить теги');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        wizard.picks.clear();
        render();
      });
      summary.append(clear);
      summary.classList.toggle('hidden', values.length === 0);
    };

    for (const group of catalog.tone.groups) {
      const usable = group.subgroups.filter((sg) =>
        sg.fields.some((f) => f.type === 'Чекбокс' || f.type === 'Выпадающий список'),
      );
      if (usable.length === 0) continue;

      const total = usable.reduce(
        (n, sg) => n + sg.fields.filter((f) => f.type === 'Чекбокс' || f.type === 'Выпадающий список').length,
        0,
      );

      const groupEl = el('details', 'tag-group');
      groupEl.open = false; // по умолчанию все группы свёрнуты
      const summaryEl = el('summary');
      summaryEl.append(el('span', 'tg-name', `${group.group} · ${total}`));
      groupEl.append(summaryEl);

      // Кнопки живут на каждой подгруппе, а не на всей группе.
      const mkBtn = (label, title, fn) => {
        const btn = el('button', 'tg-btn', label);
        btn.type = 'button';
        btn.title = title;
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          fn();
        });
        return btn;
      };
      const setGroup = (list, mode) => {
        for (const entry of list) {
          // Пасхалка не участвует в массовом выборе.
          if (/Ошибка времяисчисления/i.test(entry.field.name)) continue;
          if (mode === null) {
            wizard.picks.delete(entry.key);
            entry.apply('');
          } else {
            wizard.picks.set(entry.key, {
              group: group.group,
              subgroup: entry.sg.subgroup,
              field: entry.field.name,
              mode,
            });
            entry.apply(mode);
          }
        }
        renderSummary();
      };

      for (const sg of usable) {
        const sgEntries = [];
        const roww = el('div', 'tag-row');
        const titleRow = el('div', 'tag-title-row');
        titleRow.append(el('div', 'tag-title', sg.subgroup));
        const controls = el('span', 'tag-group-actions');
        controls.append(
          mkBtn('все', 'выбрать все теги подгруппы', () => setGroup(sgEntries, 'include')),
          mkBtn('исключить', 'исключить все теги подгруппы', () => setGroup(sgEntries, 'exclude')),
          mkBtn('сброс', 'сбросить выбор подгруппы', () => setGroup(sgEntries, null)),
        );
        titleRow.append(controls);
        roww.append(titleRow);
        const list = el('div', 'tag-list');


        for (const field of sg.fields) {
          if (field.type !== 'Чекбокс' && field.type !== 'Выпадающий список') continue;
          const key = `T|${group.group}|${sg.subgroup}|${field.name}`;
          const item = el('button', 'tag-item');
          item.type = 'button';
          item.title = `«${field.name}» — ${field.description || 'влияет на тон и сцены истории'}`;

          const marker = el('span', 'marker', '□');
          item.append(marker, el('span', 'tag-name', field.name));

          const apply = (mode) => {
            item.classList.toggle('on', mode === 'include');
            item.classList.toggle('ex', mode === 'exclude');
            marker.textContent = mode === 'include' ? '✓' : mode === 'exclude' ? '✕' : '□';
          };
          apply(wizard.picks.get(key)?.mode);
          sgEntries.push({ key, sg, field, apply });

          item.addEventListener('click', () => {
            // Пасхалка: у абстрактных эпох годы не считаются.
            if (/Ошибка времяисчисления/i.test(field.name)) {
              toast('⚠ ошибка времяисчисления — повторите запрос');
              return;
            }
            const current = wizard.picks.get(key)?.mode;
            if (!current) {
              wizard.picks.set(key, { group: group.group, subgroup: sg.subgroup, field: field.name, mode: 'include' });
              apply('include');
            } else if (current === 'include') {
              wizard.picks.set(key, { group: group.group, subgroup: sg.subgroup, field: field.name, mode: 'exclude' });
              apply('exclude');
            } else {
              wizard.picks.delete(key);
              apply('');
            }
            renderSummary();
          });

          list.append(item);
        }

        roww.append(list);
        groupEl.append(roww);
      }

      body.append(groupEl);
    }



    const collectMatches = () => {
      const list = words.value
        .toLowerCase()
        .split(/[,;\s]+/u)
        .map((w) => w.trim())
        .filter((w) => w.length > 1);
      if (list.length === 0) return [];
      const found = [];
      for (const group of catalog.tone.groups) {
        for (const sg of group.subgroups) {
          for (const field of sg.fields) {
            const text = `${field.name} ${field.description ?? ''}`.toLowerCase();
            if (list.some((w) => text.includes(w))) found.push({ group, sg, field });
          }
        }
      }
      return found;
    };

    const applyPicks = (matches) => {
      for (const { group, sg, field } of matches) {
        wizard.picks.set(`T|${group.group}|${sg.subgroup}|${field.name}`, {
          group: group.group,
          subgroup: sg.subgroup,
          field: field.name,
          mode: 'include',
        });
      }
      render();
    };

    const DARK = /тёмн|темн|мрачн|постапокал|апокалипт|катастроф|чума|голод|войн|бунт|интриг|страх|ужас|хоррор|триллер|каннибал|фетиш|эротик|юри|яой|насили|жесток|преступ|убий|мёртв|мертв|демон|дьявол|инквизиц|пытк|тюрьм|рабств|кров|резн|злодей|предательств|мучен|труп|агони|гнил|ритуал|кошмар|безуми|заговор|месть|одержим|нежить|проклят|расчлен|жертв|измен|ревност|развод|мистик|оккульт|зомби|вампир|оборотн|нечист|похищен|ограблен|терроризм|гражданск|трагед|яой|юри|нечист/u;
    const LIGHT = /добр|друж|семь|уют|сказк|приключ|юмор|комед|животн|надежд|любов|счасть|мирн|праздн|детск|малыш|волшебн|чудо|радост|тепл|свет|забот|помощ|путешеств/u;

    const rollTagsByLevel = async () => {
      const level = wizard.toneLevel;
      const target = level <= 1 ? 22 : level <= 4 ? 28 : level <= 6 ? 34 : level <= 8 ? 42 : 52;

      const chosen = new Map();
      const put = (group, sg, field) => {
        chosen.set(`T|${group.group}|${sg.subgroup}|${field.name}`, { group, sg, field });
      };

      const allowed = (group, field) => {
        const text = `${field.name} ${field.description ?? ''}`.toLowerCase();
        if (group.group.includes('Контент') && level <= 4) return false;
        if (DARK.test(text) && level <= 4) return false;
        if (level <= 1 && (group.group === 'Персонажи и типажи' || group.group === 'Элементы сюжета и тропы')) return false;
        return true;
      };

      const index = new Map();
      for (const group of catalog.tone.groups) {
        for (const sg of group.subgroups) {
          for (const field of sg.fields) index.set(field.name.toLowerCase(), { group, sg, field });
        }
      }

      const world = (wizard.customWorld ?? '').trim();
      if (world.length > 20) {
        try {
          const res = await api('/api/tags/suggest', {
            method: 'POST',
            body: JSON.stringify({ description: world, level, limit: target }),
          });
          for (const name of res.tags ?? []) {
            const hit = index.get(String(name).toLowerCase());
            if (hit && allowed(hit.group, hit.field)) put(hit.group, hit.sg, hit.field);
          }
          if (res.cost) toast(`мастер промтов: ${chosen.size} тегов · $${res.cost.toFixed(4)}`);
        } catch {
          /* доберём локально */
        }
      }

      const weightOf = (field, group) => {
        const text = `${field.name} ${field.description ?? ''}`.toLowerCase();
        const dark = DARK.test(text);
        const light = LIGHT.test(field.name.toLowerCase());
        if (group.group.includes('Контент') && level <= 4) return 0;
        if (level <= 1) return light ? 10 : dark ? 0 : 2;
        if (level <= 4) return dark ? 0 : light ? 5 : 3;
        if (level <= 6) return dark ? 4 : light ? 2 : 3;
        if (level <= 8) return dark ? 6 : light ? 1 : 3;
        return dark ? 8 : light ? 0 : 2;
      };

      const byGroup = new Map();
      for (const group of catalog.tone.groups) {
        if (level <= 1 && (group.group === 'Персонажи и типажи' || group.group === 'Элементы сюжета и тропы')) continue;
        const entries = [];
        for (const sg of group.subgroups) {
          for (const field of sg.fields) {
            const weight = weightOf(field, group);
            if (weight > 0) entries.push({ group, sg, field, weight });
          }
        }
        if (entries.length > 0) byGroup.set(group.group, entries);
      }

      const takeFrom = (entries, count) => {
        let taken = 0;
        let guard = 0;
        while (taken < count && guard < 300) {
          guard += 1;
          const total = entries.reduce((sum, e) => sum + e.weight, 0);
          if (total <= 0) break;
          let roll = Math.random() * total;
          let found = null;
          for (const entry of entries) {
            roll -= entry.weight;
            if (roll <= 0) {
              found = entry;
              break;
            }
          }
          if (!found) break;
          const before = chosen.size;
          put(found.group, found.sg, found.field);
          if (chosen.size === before) continue;
          taken += 1;
        }
      };

      for (const [, entries] of byGroup) takeFrom(entries, level <= 4 ? 3 : 4);

      const all = [...byGroup.values()].flat();
      let guard = 0;
      while (chosen.size < target && guard < 900) {
        guard += 1;
        takeFrom(all, 1);
      }

      const emotions = [];
      for (const group of catalog.tone.groups) {
        if (group.group !== 'Жанры') continue;
        for (const sg of group.subgroups) {
          if (!/эмоции/i.test(sg.subgroup)) continue;
          for (const field of sg.fields) {
            if (weightOf(field, group) > 0) emotions.push({ group, sg, field, weight: 1 });
          }
        }
      }
      if (emotions.length > 0) takeFrom(emotions, 1);

      if (level <= 4) {
        for (const [key, pick] of [...chosen]) if (!allowed(pick.group, pick.field)) chosen.delete(key);
      }

      const finalPicks = [...chosen.values()].slice(0, target);
      wizard.picks.clear();
      for (const { group, sg, field } of finalPicks) {
        wizard.picks.set(`T|${group.group}|${sg.subgroup}|${field.name}`, {
          group: group.group,
          subgroup: sg.subgroup,
          field: field.name,
          mode: 'include',
        });
      }
      render();
      toast(`уровень ${level}: подобрано тегов ${finalPicks.length}`);
    };

    dice.addEventListener('click', async () => {
      if (dice.disabled) return;
      dice.disabled = true;
      try {
        await rollTagsByLevel();
      } finally {
        dice.disabled = false;
      }
    });

    pickAll.addEventListener('click', async () => {
      wizard.tagWords = words.value;
      const phrase = words.value.trim();
      if (!phrase) {
        pickDice.click();
        return;
      }
      pickAll.disabled = true;
      const label = pickAll.textContent;
      pickAll.textContent = 'подбираю…';
      try {
        const res = await api('/api/tags/suggest', {
          method: 'POST',
          body: JSON.stringify({ description: phrase, level: wizard.toneLevel, limit: 150 }),
        });
        const index = new Map();
        for (const group of catalog.tone.groups) {
          for (const sg of group.subgroups) {
            for (const field of sg.fields) index.set(field.name.toLowerCase(), { group, sg, field });
          }
        }
        const matched = [];
        for (const name of res.tags ?? []) {
          const hit = index.get(String(name).trim().toLowerCase());
          if (hit) matched.push(hit);
        }
        if (matched.length === 0) {
          toast('агент не нашёл подходящих тегов — переформулируй фразу');
          return;
        }
        wizard.picks.clear();
        applyPicks(matched);
        toast(`агент подобрал ${matched.length} тегов${res.cost ? ` · $${res.cost.toFixed(4)}` : ''}`);
      } catch (err) {
        toast(err.message);
      } finally {
        pickAll.disabled = false;
        pickAll.textContent = label;
      }
    });

    pickDice.addEventListener('click', async () => {
      wizard.tagWords = words.value;
      const phrase = words.value.trim();
      const level = wizard.toneLevel;
      const target = level <= 4 ? 45 : level <= 8 ? 60 : 75;
      pickDice.disabled = true;
      try {
        let names = [];
        if (phrase) {
          // Кубик берёт случайную часть из того, что агент считает подходящим.
          const res = await api('/api/tags/suggest', {
            method: 'POST',
            body: JSON.stringify({ description: phrase, level, limit: 80 }),
          });
          names = res.tags ?? [];
        }
        const index = new Map();
        for (const group of catalog.tone.groups) {
          for (const sg of group.subgroups) {
            for (const field of sg.fields) index.set(field.name.toLowerCase(), { group, sg, field });
          }
        }
        const pool = [];
        for (const name of names) {
          const hit = index.get(String(name).trim().toLowerCase());
          if (hit) pool.push(hit);
        }
        if (pool.length === 0) {
          // Без фразы или если агент не ответил — случайные по уровню.
          for (const group of catalog.tone.groups) {
            if (group.group.includes('Контент') && level <= 4) continue;
            for (const sg of group.subgroups) {
              for (const field of sg.fields) {
                if (field.type !== 'Чекбокс' && field.type !== 'Выпадающий список') continue;
                pool.push({ group, sg, field });
              }
            }
          }
        }
        if (pool.length === 0) {
          toast('нет доступных тегов');
          return;
        }
        wizard.picks.clear();
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const take = Math.min(pool.length, target);
        applyPicks(shuffled.slice(0, take));
        toast(`выпало тегов: ${take}${phrase ? ` · из ${pool.length} подходящих` : ''}`);
      } catch (err) {
        toast(err.message);
      } finally {
        pickDice.disabled = false;
      }
    });
    words.addEventListener('input', () => {
      wizard.tagWords = words.value;
    });

    renderSummary();
    body.append(summary);

    if (artCardCache) {
      const artWrap = el('div', 'art-block');
      artWrap.append(el('div', 'field-label', 'Теги иллюстратора: стиль, свет, камера…'), artCardCache);
      body.append(artWrap);
    }
    // Мир живёт на шаге тона: описание влияет на сборку мира.
    const worldField = el('div', 'field');
    worldField.append(el('label', '', 'Мир — описание'));
    const custom = el('textarea', 'world-custom');
    custom.placeholder = 'Опиши мир: устройство, фракции, экономика, угрозы, чем он отличается. Чем конкретнее, тем лучше.';
    custom.value = wizard.customWorld ?? '';
    custom.addEventListener('input', () => {
      wizard.customWorld = custom.value;
    });
    worldField.append(custom);
    const worldOut = el('textarea', 'world-generated');
    worldOut.placeholder = 'Сгенерированный мир появится здесь — его можно править.';
    worldOut.value = wizard.worldText ?? '';
    worldOut.addEventListener('input', () => {
      wizard.worldText = worldOut.value;
    });
    worldField.append(worldOut);
    const briefOut = el('textarea', 'world-brief');
    briefOut.placeholder = 'Коротко о мире: 5–7 тезисов — устройство, силы, экономика, угрозы, тон.';
    briefOut.value = wizard.worldBrief ?? '';
    briefOut.addEventListener('input', () => {
      wizard.worldBrief = briefOut.value;
    });
    const briefRow = el('div', 'world-row');
    const briefBtn = el('button', 'btn small', 'Тезисно о мире');
    briefBtn.type = 'button';
    const briefDice = el('button', 'btn small level-dice', '🎲');
    briefDice.type = 'button';
    briefDice.title = 'другой короткий вариант';
    const briefStatus = el('span', 'page-sub', '');
    const makeBrief = async () => {
      briefBtn.disabled = true;
      briefDice.disabled = true;
      briefStatus.textContent = 'собираю…';
      try {
        const tags = [...wizard.picks.values()]
          .filter((pick) => pick.mode === 'include')
          .map((pick) => pick.field);
        const res = await api('/api/generate/world-brief', {
          method: 'POST',
          body: JSON.stringify({
            description: wizard.customWorld.trim() || wizard.worldText.trim(),
            tags,
            toneLevel: wizard.toneLevel,
          }),
        });
        wizard.worldBrief = res.text ?? '';
        briefOut.value = wizard.worldBrief;
        briefStatus.textContent = res.cost ? `готово · $${res.cost.toFixed(4)}` : 'готово';
      } catch (err) {
        briefStatus.textContent = err.message;
      } finally {
        briefBtn.disabled = false;
        briefDice.disabled = false;
      }
    };
    briefBtn.addEventListener('click', makeBrief);
    briefDice.addEventListener('click', makeBrief);
    briefRow.append(briefBtn, briefDice, briefStatus);
    worldField.append(briefOut, briefRow);
    const worldRow = el('div', 'world-row');
    const genWorld = el('button', 'btn small', 'Сгенерировать мир');
    genWorld.type = 'button';
    const worldStatus = el('span', 'page-sub', '');
    genWorld.addEventListener('click', async () => {
      genWorld.disabled = true;
      worldStatus.textContent = 'собираю…';
      try {
        const tags = [...wizard.picks.values()]
          .filter((pick) => pick.mode === 'include')
          .map((pick) => pick.field);
        const res = await api('/api/generate/world', {
          method: 'POST',
          body: JSON.stringify({
            presetId: '',
            toneLevel: wizard.toneLevel,
            epochYear: wizard.epochYear,
            altTime: wizard.altTime,
            eraLabel: wizard.eraLabel,
            description: wizard.customWorld.trim(),
            title: wizard.title,
            tags,
          }),
        });
        wizard.worldText = res.text ?? '';
        wizard.worldDescription = wizard.customWorld.trim();
        worldOut.value = wizard.worldText;
        worldStatus.textContent = res.cost ? `готово · $${res.cost.toFixed(4)}` : 'готово';
      } catch (err) {
        worldStatus.textContent = err.message;
      } finally {
        genWorld.disabled = false;
      }
    });
    worldRow.append(genWorld, worldStatus);
    const tagsFromWorld = el('button', 'btn small', 'Подобрать теги по миру');
    tagsFromWorld.type = 'button';
    tagsFromWorld.addEventListener('click', async () => {
      const text = wizard.customWorld.trim() || wizard.worldText.trim();
      if (!text) {
        toast('сначала опиши мир или сгенерируй его');
        return;
      }
      tagsFromWorld.disabled = true;
      try {
        const res = await api('/api/tags/suggest', {
          method: 'POST',
          body: JSON.stringify({ description: text, level: wizard.toneLevel, limit: 150 }),
        });
        const index = new Map();
        for (const group of catalog.tone.groups) {
          for (const sg of group.subgroups) {
            for (const field of sg.fields) index.set(field.name.toLowerCase(), { group, sg, field });
          }
        }
        const matched = [];
        for (const name of res.tags ?? []) {
          const hit = index.get(String(name).trim().toLowerCase());
          if (hit) matched.push(hit);
        }
        if (!matched.length) {
          toast('по этому миру теги не нашлись — добавь деталей');
          return;
        }
        wizard.picks.clear();
        for (const { group, sg, field } of matched) {
          wizard.picks.set(`T|${group.group}|${sg.subgroup}|${field.name}`, {
            group: group.group,
            subgroup: sg.subgroup,
            field: field.name,
            mode: 'include',
          });
        }
        render();
        toast(`по миру выбрано тегов: ${matched.length}`);
      } catch (err) {
        toast(err.message);
      } finally {
        tagsFromWorld.disabled = false;
      }
    });
    worldRow.append(tagsFromWorld);
    worldField.append(worldRow);
    const worldHint = el('p', 'page-sub', 'Предустановленных миров нет — каждый мир собирается из твоего описания и тегов.');
    body.append(worldField, worldHint);
    // Уровень и эпоха влияют на мир, поэтому стоят выше него.
    timeAlt.after(worldField, worldHint);
  }

  function field(labelText, key, multiline) {
    const wrap = el('div', 'field');
    wrap.append(el('label', '', labelText));
    const node = multiline ? el('textarea') : el('input');
    node.value = wizard.hero[key] ?? '';
    node.addEventListener('input', () => {
      wizard.hero[key] = node.value;
    });
    wrap.append(node);
    return wrap;
  }

  function stepHero() {
    body.append(
      field('Имя героя', 'name'),
      field('Суть: кто он', 'essence'),
      field('Внешность, возраст, телосложение', 'appearance', true),
      field('Отношение к своему телу', 'bodyAttitude'),
      field('Прошлое, предыстория', 'origin', true),
      field('Привычки, вкусы, особенности', 'quirks'),
      field('Способности и силы', 'abilities'),
      field('Начало истории', 'start', true),
    );

    const fillCard = el('button', 'btn small', 'Заполнить карточку агентом');
    fillCard.type = 'button';
    const fillHint = el('span', 'page-sub', '');
    fillCard.addEventListener('click', async () => {
      if (wizard.busy) return;
      wizard.busy = true;
      fillCard.disabled = true;
      fillHint.textContent = 'мастер промтов заполняет…';
      try {
        const res = await api('/api/generate/hero', {
          method: 'POST',
          body: JSON.stringify({
            form: wizard.hero,
            toneLevel: wizard.toneLevel,
            world: wizard.worldText || wizard.customWorld,
            gender: wizard.gender,
          }),
        });
        wizard.hero = { ...wizard.hero, ...(res.hero ?? {}), name: wizard.hero.name };
        fillHint.textContent = res.cost ? `готово · $${res.cost.toFixed(4)}` : 'готово';
        render();
      } catch (err) {
        fillHint.textContent = err.message;
      } finally {
        wizard.busy = false;
        fillCard.disabled = false;
      }
    });
    body.append(el('div', 'preset-row', fillCard, fillHint));

    const choice = (label, active, onClick) => {
      const btn = el('button', `chip${active ? ' active' : ''}`, label);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        onClick();
        render();
      });
      return btn;
    };

    const genderBox = el('div', 'field');
    genderBox.append(el('label', '', 'Пол героя'));
    const genderRow = el('div', 'chips');
    genderRow.append(
      choice('Мужской', wizard.gender === 'male', () => { wizard.gender = 'male'; }),
      choice('Женский', wizard.gender === 'female', () => { wizard.gender = 'female'; }),
    );
    genderBox.append(genderRow);

    const deathBox = el('div', 'field');
    deathBox.append(el('label', '', 'Смерть'));
    const deathRow = el('div', 'chips');
    deathRow.append(
      choice('Постоянная', wizard.permadeath === true, () => { wizard.permadeath = true; }),
      choice('Может очнуться', wizard.permadeath === false, () => { wizard.permadeath = false; }),
    );
    deathBox.append(
      deathRow,
      el('p', 'page-sub', 'При мягкой смерти герой при нуле здоровья приходит в себя, а не исчезает.'),
    );
    body.append(genderBox, deathBox);

    const xpBox = el('div', 'field');
    xpBox.append(el('label', '', 'Опыт пати'));
    const xpRow = el('div', 'chips');
    const xpChoices = [
      ['own', 'Каждый свой'],
      ['heroParty', 'Герой от пати'],
      ['even', 'Равномерно'],
      ['dynamic', 'Динамично'],
    ];
    for (const [value, label] of xpChoices) {
      xpRow.append(
        choice(label, wizard.xpMode === value, () => {
          wizard.xpMode = value;
        }),
      );
    }
    xpBox.append(
      xpRow,
      el('p', 'page-sub', 'Как очки ранга делятся между героем и спутниками в сцене.'),
    );
    body.append(xpBox);

    // Навыки из шаблона можно проверить и поправить прямо в мастере.
    if (wizard.skills && Object.keys(wizard.skills).length) {
      const box = el('div', 'field');
      box.append(el('label', '', 'Навыки героя (0–20)'));
      const rowsEl = el('div', 'skill-edit');
      for (const [name, value] of Object.entries(wizard.skills)) {
        const row = el('label', 'skill-edit-row');
        row.append(el('span', 'skill-name', name));
        const input = el('input', 'skill-edit-input');
        input.type = 'number';
        input.min = '0';
        input.max = '20';
        input.value = String(value);
        input.addEventListener('input', () => {
          wizard.skills[name] = Math.max(0, Math.min(20, Number(input.value) || 0));
        });
        row.append(input);
        rowsEl.append(row);
      }
      box.append(rowsEl);
      body.append(box);
    }
  }


  function stepReview() {
    const values = [...wizard.picks.values()];
    const chosen = values.filter((p) => p.mode === 'include').map((p) => p.field);
    const excluded = values.filter((p) => p.mode === 'exclude').map((p) => p.field);

    const summary = el('div', 'review');
    summary.append(el('h3', '', 'Что собираем'));
    summary.append(el('div', 'row', `Название: ${wizard.title || 'без названия'}`));
    summary.append(el('div', 'row', `Уровень: ${wizard.toneLevel}/11 — ${levels.find((l) => l.value === wizard.toneLevel)?.name ?? ''}`));
    summary.append(
      el(
        'div',
        'row',
        `Эпоха: ${wizard.epochYear <= 0 ? `${1 - wizard.epochYear} до н.э.` : wizard.epochYear}`,
      ),
    );
    summary.append(el('div', 'row', `Мир: ${wizard.customWorld.trim() ? `${wizard.customWorld.trim().slice(0, 70)}…` : 'описание пустое — соберу тёмное фэнтези по умолчанию'}`));
    summary.append(el('div', 'row', `Выбрано тегов: ${chosen.length ? `${chosen.length} — ${chosen.slice(0, 8).join(', ')}` : 'нет'}`));
    summary.append(el('div', 'row', `Исключено: ${excluded.length || 'нет'}`));
    summary.append(el('div', 'row', `Герой: ${wizard.hero.name || 'без имени'}`));
    summary.append(el('div', 'row', `Пол: ${wizard.gender === 'female' ? 'женский' : 'мужской'}`));
    summary.append(el('div', 'row', `Смерть: ${wizard.permadeath ? 'постоянная' : 'можно очнуться'}`));
    const xpLabel = { own: 'каждый свой', heroParty: 'герой получает от пати', even: 'равномерно', dynamic: 'динамично' }[wizard.xpMode] ?? wizard.xpMode;
    summary.append(el('div', 'row', `Опыт пати: ${xpLabel}`));
    if (wizard.skills && Object.keys(wizard.skills).length) {
      summary.append(
        el(
          'div',
          'row',
          `Навыки: ${Object.entries(wizard.skills).map(([name, value]) => `${name} ${value}`).join(', ')}`,
        ),
      );
    }
    body.append(summary);

    const savePreset = el('button', 'btn', 'Сохранить пресет');
    savePreset.type = 'button';
    savePreset.addEventListener('click', async () => {
      const name = window.prompt('Название пресета', wizard.title || 'Мой старт');
      if (!name || !name.trim()) return;
      savePreset.disabled = true;
      try {
        const picks = [...wizard.picks.values()].map((pick) => ({
          group: pick.group,
          subgroup: pick.subgroup,
          field: pick.field,
          mode: pick.mode,
        }));
        const res = await api('/api/presets', {
          method: 'POST',
          body: JSON.stringify({
            id: wizard.presetId || undefined,
            name: name.trim(),
            title: wizard.title,
            toneLevel: wizard.toneLevel,
            epochYear: wizard.epochYear,
            altTime: wizard.altTime,
            eraLabel: wizard.eraLabel,
            gender: wizard.gender,
            permadeath: wizard.permadeath,
            xpMode: wizard.xpMode,
            picks,
            world: {
              description: wizard.customWorld.trim(),
              text: wizard.worldText.trim(),
              brief: wizard.worldBrief.trim(),
              generated: Boolean(wizard.worldText.trim()),
              source: wizard.customWorld.trim() ? 'tags+description' : 'tags',
            },
            hero: { ...wizard.hero, skills: wizard.skills },
          }),
        });
        wizard.presetId = res.preset?.id ?? wizard.presetId;
        if (res.preset) {
          wizard.presets = [res.preset, ...wizard.presets.filter((entry) => entry.id !== res.preset.id)];
        }
        toast(`пресет сохранён: ${name.trim()}`);
      } catch (err) {
        toast(err.message);
      } finally {
        savePreset.disabled = false;
      }
    });

    body.append(savePreset);
    const status = el('div', 'status', '');
    const build = el('button', 'btn primary', 'Собрать историю');
    build.addEventListener('click', async () => {
      if (wizard.busy) return;
      wizard.busy = true;
      build.disabled = true;
      try {
        status.textContent = 'Собираю тон…';
        const tone = await api('/api/generate/tone', {
          method: 'POST',
          body: JSON.stringify({
            toneLevel: wizard.toneLevel,
            epochYear: wizard.epochYear,
            altTime: wizard.altTime,
            eraLabel: wizard.eraLabel,
            selections: [...wizard.picks.values()].map((p) => ({
              group: p.group,
              field: p.field,
              value: p.mode === 'include' ? 'да' : 'исключить',
            })),
          }),
        });

        status.textContent = 'Собираю мир…';
        const chosenTags = [...wizard.picks.values()]
          .filter((pick) => pick.mode === 'include')
          .map((pick) => pick.field);
        const world = wizard.worldText.trim()
          ? {
              text: `${wizard.worldText.trim()}${
                wizard.worldBrief.trim() ? `\n\n# ТЕЗИСЫ МИРА\n${wizard.worldBrief.trim()}` : ''
              }`,
            }
          : await api('/api/generate/world', {
              method: 'POST',
              body: JSON.stringify({
                presetId: '',
                toneLevel: wizard.toneLevel,
                epochYear: wizard.epochYear,
                altTime: wizard.altTime,
                eraLabel: wizard.eraLabel,
                description:
                  wizard.customWorld.trim() ||
                  'Тёмное фэнтези: погибающий мир, серые земли, голод и древние долги.',
                brief: wizard.worldBrief.trim(),
                tags: chosenTags,
                title: wizard.title,
              }),
            });

        status.textContent = 'Создаю хронику…';
        const base = wizard.title.trim() || 'история';
        const id = base.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '');

        await api('/api/campaigns', {
          method: 'POST',
          body: JSON.stringify({
            id,
            tone: tone.text,
            world: world.text,
            hero: `${heroToMarkdown(wizard.hero)}\n- **Пол:** ${wizard.gender === 'female' ? 'женский' : 'мужской'}`,
            heroName: wizard.hero.name || 'Герой',
            heroSkills: wizard.skills ?? undefined,
            heroBio: wizard.hero.origin || undefined,
            heroAbilities: wizard.hero.abilities || undefined,
            heroEssence: wizard.hero.essence || undefined,
            heroAppearance: wizard.hero.appearance || undefined,
            heroBodyAttitude: wizard.hero.bodyAttitude || undefined,
            heroOrigin: wizard.hero.origin || undefined,
            heroQuirks: wizard.hero.quirks || undefined,
            heroStart: wizard.hero.start || undefined,
            gender: wizard.gender,
            permadeath: wizard.permadeath,
            xpMode: wizard.xpMode,
            toneLevel: wizard.toneLevel,
            epochYear: wizard.epochYear,
            altTime: wizard.altTime,
            eraLabel: wizard.eraLabel,
            meta: {
              title: wizard.title,
              toneLevel: wizard.toneLevel,
              epochYear: wizard.epochYear,
            altTime: wizard.altTime,
            eraLabel: wizard.eraLabel,
              tags: [...wizard.picks.values()].map((p) => ({ group: p.group, field: p.field, value: p.mode })),
            },
          }),
        });

        location.hash = `#/play/${encodeURIComponent(id)}`;
      } catch (err) {
        status.textContent = err.message;
        build.disabled = false;
      } finally {
        wizard.busy = false;
      }
    });

    body.append(build, status);
  }

  render();
  view.append(page);
}

function heroToMarkdown(hero) {
  const rows = [
    ['Имя', hero.name],
    ['Суть', hero.essence],
    ['Внешность и тело', hero.appearance],
    ['Отношение к телу', hero.bodyAttitude],
    ['Прошлое', hero.origin],
    ['Привычки и особенности', hero.quirks],
    ['Способности', hero.abilities],
    ['Начало истории', hero.start],
  ].filter(([, value]) => value && value.trim());

  if (rows.length === 0) return '';
  return `# ГЕРОЙ\n${rows.map(([key, value]) => `- **${key}:** ${value.trim()}`).join('\n')}`;
}

/* ================= игра ================= */

function addSystem(log, text) {
  const wrap = el('div', 'msg system');
  wrap.append(el('div', 'system-text', text));
  log.append(wrap);
  scrollDown(log);
}

function addPlayer(log, text) {
  const wrap = el('div', 'msg player');
  wrap.append(el('div', 'bubble', text));
  log.append(wrap);
  scrollDown(log);
}

function metaLine(payload) {
  const meta = el('div', 'meta');
  const s = payload.stats || {};
  meta.append(el('span', '', `ход ${s.turn ?? '—'}`));
  meta.append(el('span', '', `${s.tokensIn ?? 0} ток · кэш ${s.cachedTokens ?? 0}`));
  meta.append(el('span', '', `$${(s.cost ?? 0).toFixed(6)}`));
  meta.append(el('span', '', `${((s.ms ?? 0) / 1000).toFixed(1)} с`));
  if (payload.changes?.length) meta.append(el('span', '', payload.changes.join(' · ')));
  if (payload.problems?.length) meta.append(el('span', 'warn', payload.problems.join(' · ')));
  return meta;
}

function addRoll(log, roll) {
  const wrap = el('div', 'msg roll');
  if (roll.joker) wrap.classList.add('joker');
  if (roll.face === 36) wrap.classList.add('abyss');
  wrap.append(el('span', 'roll-face', String(roll.face)));
  wrap.append(el('span', 'roll-label', roll.joker ? roll.label : `грань ${roll.face}`));
  if (roll.skill) {
    wrap.append(el('span', 'roll-skill', `${roll.skill} ${roll.skillValue} · итог ${roll.total}`));
  }
  if (roll.joker) wrap.append(el('span', 'tag', 'джокер'));
  if (roll.fatal) wrap.append(el('span', 'tag', 'смерть'));
  log.append(wrap);
  scrollDown(log);
}

async function openHistoryDialog(campaignId) {
  const data = await api(`/api/campaign/${encodeURIComponent(campaignId)}`);
  const overlay = el('div', 'history-modal');
  const head = el('div', 'map-modal-head');
  const title = el('b', '', `Вся история · ход ${data.state.turn}`);
  const search = el('input', 'history-search');
  search.placeholder = 'поиск по тексту';
  const close = el('button', 'btn small', '✕');
  head.append(title, search, close);

  const body = el('div', 'history-body');
  const hint = el(
    'div',
    'history-hint',
    'Здесь вся история без обрезки. Модель видит только последние 24 хода и конспект — так задумано.',
  );
  body.append(hint);
  const list = el('div', 'history-list');
  body.append(list);

  const images = new Map((data.state.illustrations ?? []).map((ill) => [ill.turn, ill.url]));
  const entries = data.history ?? [];
  const render = () => {
    const query = search.value.trim().toLowerCase();
    list.replaceChildren();
    let lastTurn = -1;
    for (const entry of entries) {
      if (query && !String(entry.text ?? '').toLowerCase().includes(query)) continue;
      if (entry.turn !== lastTurn) {
        list.append(el('div', 'history-turn', `Ход ${entry.turn}`));
        lastTurn = entry.turn;
      }
      const msg = el('div', `history-msg ${entry.role}`);
      msg.append(el('span', 'history-role', entry.role === 'player' ? 'игрок' : 'ведущий'));
      msg.append(el('div', 'history-text', entry.text ?? ''));
      if (entry.role === 'gm' && images.has(entry.turn)) {
        const img = el('img', 'history-image');
        img.src = images.get(entry.turn);
        img.loading = 'lazy';
        msg.append(img);
      }
      list.append(msg);
    }
    if (!list.children.length) list.append(el('p', 'page-sub', 'Ничего не найдено.'));
  };
  search.addEventListener('input', render);
  render();

  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });

  overlay.append(head, body);
  document.body.append(overlay);
  search.focus();
}

function openImageModal(url, caption = '') {
  const overlay = el('div', 'image-modal');
  const img = el('img', 'image-modal-img');
  img.src = url;
  img.alt = caption || 'кадр';
  const close = el('button', 'btn small image-modal-close', '✕');
  overlay.append(img, close);
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.append(overlay);
}

document.addEventListener('click', (event) => {
  const img = event.target.closest('img.msg-image');
  if (img) openImageModal(img.src, img.alt);
});

function openMapModal(title, text) {
  const overlay = el('div', 'map-modal');
  const head = el('div', 'map-modal-head');
  head.append(el('b', '', title));
  const zoomOut = el('button', 'btn small', '−');
  const zoomIn = el('button', 'btn small', '+');
  const reset = el('button', 'btn small', 'сброс');
  const close = el('button', 'btn small', '✕');
  head.append(zoomOut, zoomIn, reset, close);

  const viewport = el('div', 'map-viewport');
  const canvas = el('pre', 'map-canvas', text);
  viewport.append(canvas);
  overlay.append(head, viewport);
  document.body.append(overlay);

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const apply = () => {
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  };
  apply();

  const zoom = (factor) => {
    scale = Math.min(5, Math.max(0.4, scale * factor));
    apply();
  };

  zoomIn.addEventListener('click', () => zoom(1.25));
  zoomOut.addEventListener('click', () => zoom(0.8));
  reset.addEventListener('click', () => {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    apply();
  });
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 0.9 : 1.1);
  }, { passive: false });

  let dragging = false;
  let startX = 0;
  let startY = 0;
  viewport.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
    viewport.classList.add('grabbing');
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    apply();
  });
  const stop = () => {
    dragging = false;
    viewport.classList.remove('grabbing');
  };
  viewport.addEventListener('pointerup', stop);
  viewport.addEventListener('pointercancel', stop);
  viewport.addEventListener('pointerleave', stop);
}

function addGm(log, payload, turnData, imageUrl, entryTurn = null) {
  const wrap = el('div', 'msg gm');
  wrap.append(el('div', 'prose', payload.prose));

  if (imageUrl) {
    const img = el('img', 'msg-image');
    img.src = imageUrl;
    img.alt = 'кадр сцены';
    wrap.append(img);
  }

  if (payload.stats && Object.keys(payload.stats).length > 0) wrap.append(metaLine(payload));

  const campaignId = app.game?.id ?? currentCampaignId();
  if (turnData && campaignId) {
    wrap.append(actionsBar(turnData, campaignId));
  } else if (campaignId && entryTurn) {
    // Старые ходы без панели действий: хотя бы кадр именно этого хода.
    const btn = el('button', 'ma-btn', '🖼');
    btn.type = 'button';
    btn.title = `нарисовать кадр хода ${entryTurn}`;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'scene', turn: entryTurn }),
        });
        const img = el('img', 'msg-image');
        img.src = res.url;
        wrap.append(img);
        toast(`кадр хода ${entryTurn} · $${(res.cost ?? 0).toFixed(3)}`);
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
    wrap.append(btn);
  }

  log.append(wrap);
  scrollDown(log);
}

function actionsBar(turnData, campaignId) {
  const bar = el('div', 'msg-actions');
  const input = turnData.input ?? '';

  const act = (label, title, fn) => {
    const btn = el('button', 'ma-btn', label);
    btn.type = 'button';
    btn.title = title;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await fn();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  };

  bar.append(
    act('⟳', 'перегенерировать', async () => {
      toast('перегенерирую…');
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ turn: turnData.turn }),
      });
      // Меняем только этот ответ, без перезагрузки всей сцены.
      const msg = bar.closest('.msg');
      const prose = msg?.querySelector('.prose');
      if (prose && res?.prose) prose.textContent = res.prose;
      if (msg && res?.stats) {
        const old = msg.querySelector('.meta');
        if (old) old.remove();
        msg.append(metaLine(res));
      }
      if (res?.state) {
        const panelEl = app.game?.panel;
        if (panelEl) renderPanel(res.state, panelEl, campaignId, res.worldMap ?? '', res.map ?? '', res.summary);
      }
    }),
    act('✎', 'править реплику', async () => {
      const next = window.prompt('Изменить реплику игрока', input);
      if (next === null || !next.trim() || next.trim() === input.trim()) return;
      await api(`/api/campaign/${encodeURIComponent(campaignId)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ turn: turnData.turn, input: next.trim() }),
      });
      router();
    }),
  );

  if ((turnData.variants ?? 1) > 1) {
    const total = turnData.variants;
    let current = Math.min(total, Math.max(1, Number(turnData.variant ?? 1)));
    const counter = el('span', 'ma-count', `${current} / ${total}`);
    // Варианты более раннего хода обрезали бы историю — только последний ход.
    const isLast = turnData.turn === (app.game?.state?.turn ?? turnData.turn);

    const apply = (payload) => {
      const msg = bar.closest('.msg');
      const prose = msg?.querySelector('.prose');
      if (prose && payload?.prose) prose.textContent = payload.prose;
      current = Number(payload?.variant ?? current);
      counter.textContent = `${current} / ${total}`;
    };

    if (isLast) {
      const go = async (dir) => {
        let wanted = current + dir;
        if (wanted < 1) wanted = total;
        if (wanted > total) wanted = 1;
        const index = wanted === 1 ? 0 : wanted - 1;
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/variant`, {
          method: 'POST',
          body: JSON.stringify({ turn: turnData.turn, index }),
        });
        apply(res);
      };
      bar.append(act('‹', 'предыдущий вариант', () => go(-1)));
      bar.append(counter);
      bar.append(act('›', 'следующий вариант', () => go(1)));
    } else {
      bar.append(counter);
    }
  }

  bar.append(
    act('🖼', 'создать изображение', async () => {
      toast('рисую кадр…');
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'scene', turn: turnData.turn }),
      });
      const target = bar.closest('.msg');
      if (target && res.url) {
        const img = el('img', 'msg-image');
        img.src = res.url;
        target.append(img);
      }
      toast(`кадр готов · $${(res.cost ?? 0).toFixed(3)}${res.fallback ? ' · откат на Gemini' : ''}`);
    }),
  );

  return bar;
}

function formatSkills(skills) {
  if (!skills) return '';
  return Object.entries(skills).map(([name, value]) => `${name} ${value}`).join(' · ');
}

function actorCard(actor, campaignId) {
  const details = el('details', 'card');
  details.dataset.name = actor.name;
  const summary = el('summary');
  summary.append(el('span', 'card-name', actor.name));
  if (actor.role) summary.append(el('span', 'tag', actor.role));
  if (typeof actor.attitude === 'number') summary.append(el('span', 'tag', `отн ${actor.attitude > 0 ? '+' : ''}${actor.attitude}`));
  if (typeof actor.bond === 'number' && actor.bond > 0) summary.append(el('span', 'tag', `связь ${actor.bond}`));
  details.append(summary);

  const bodyEl = el('div', 'card-body');

  if (actor.card) {
    const img = el('img', 'portrait master');
    img.src = actor.card;
    bodyEl.append(img);
  }
  if (actor.portrait) {
    const img = el('img', 'portrait');
    img.src = actor.portrait;
    bodyEl.append(img);
  }

  if (campaignId) {
    const actions = el('div', 'card-actions');

    if (!actor.card) {
      actions.append(miniBtn('✎ мастер-лист', 'нарисовать референс', async () => {
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'card', name: actor.name }),
        });
        actor.card = res.url;
        const img = el('img', 'portrait master');
        img.src = res.url;
        bodyEl.prepend(img);
        toast(`мастер-лист · $${(res.cost ?? 0).toFixed(3)}`);
      }));
    }
    if (!actor.portrait) {
      actions.append(miniBtn('◉ портрет', 'нарисовать портрет', async () => {
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'portrait', name: actor.name }),
        });
        actor.portrait = res.url;
        const img = el('img', 'portrait');
        img.src = res.url;
        bodyEl.append(img);
      }));
    }
    actions.append(miniBtn('▣ в полный рост', 'одна фигура в полный рост', async () => {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'sheet', name: actor.name }),
      });
      actor.card = res.url;
      const img = el('img', 'portrait master');
      img.src = res.url;
      bodyEl.prepend(img);
      toast(`лист персонажа · $${(res.cost ?? 0).toFixed(3)}`);
    }));
    actions.append(miniBtn('＋ в карточки', 'сохранить карточку в библиотеку', () => saveToLibrary(campaignId, 'npc', actor.name)));
    if (actions.children.length) bodyEl.append(actions);
  }

  const rows = [
    ['Внешность', actor.appearance],
    ['Характер', actor.character],
    ['Одет', actor.clothes],
    ['Прошлое', actor.bio],
    ['Описание', actor.description],
    ['Заметка', actor.note],
  ].filter(([, value]) => value);
  for (const [key, value] of rows) bodyEl.append(row(key, value));

  if (actor.skills && Object.keys(actor.skills).length) bodyEl.append(el('div', 'skills-line', formatSkills(actor.skills)));
  if (actor.relations?.length) bodyEl.append(row('Отношения', actor.relations.map((r) => `${r.with}: ${r.feeling}`).join('; ')));

  details.append(bodyEl);
  return details;
}

function rankBar(actor) {
  const points = Math.max(0, Math.min(100, Number(actor.rankPoints ?? 0)));
  const wrap = el('div', 'rank-progress');
  const top = el('div', 'rank-progress-top');
  top.append(el('span', 'chip gold', `ранг ${actor.rank ?? 'F'}`), el('span', '', `опыт ${points}/100`));
  const bar = el('div', 'rank-bar');
  const fill = el('i');
  fill.style.width = `${points}%`;
  bar.append(fill);
  wrap.append(top, bar);
  return wrap;
}

async function forgetNpc(campaignId, name, action) {  const labels = { archive: 'убран в корзину', restore: 'возвращён в игру', purge: 'удалён окончательно' };
  if (action === 'purge' && !window.confirm(`Удалить «${name}» из контейнера окончательно?`)) return;
  try {
    await api(`/api/campaign/${encodeURIComponent(campaignId)}/forget`, {
      method: 'POST',
      body: JSON.stringify({ name, ...(action === 'archive' ? {} : { [action]: true }) }),
    });
    toast(`${name}: ${labels[action] ?? 'готово'}`);
    router();
  } catch (err) {
    toast(err.message);
  }
}

function personCard(actor, campaignId, isNpc = false) {
  const card = el('article', 'person-card');
  const head = el('div', 'person-head');
  const image = actor.card || actor.portrait;
  if (image) {
    const img = el('img', 'person-avatar');
    img.src = image;
    img.alt = actor.name;
    head.append(img);
  } else {
    head.append(el('div', 'person-avatar person-initial', (actor.name || '?').slice(0, 1)));
  }
  const titles = el('div', 'person-titles');
  titles.append(el('h3', 'person-name', actor.name));
  if (actor.role) titles.append(el('div', 'person-role', actor.role));
  const chips = el('div', 'chips');
  if (actor.status) chips.append(el('span', 'chip', actor.status));
  chips.append(el('span', 'chip gold', `ранг ${actor.rank ?? 'F'}`));
  if (typeof actor.attitude === 'number') {
    chips.append(el('span', 'chip', `отношение ${actor.attitude > 0 ? '+' : ''}${actor.attitude}`));
  }
  if (typeof actor.bond === 'number' && actor.bond > 0) {
    chips.append(el('span', 'chip', `связь ${actor.bond}`));
  }
  if (actor.present === true) chips.append(el('span', 'chip chip-live', 'в сцене'));
  if (chips.children.length) titles.append(chips);
  titles.append(rankBar(actor));
  head.append(titles);
  card.append(head);

  const fields = [
    ['Внешность', actor.appearance],
    ['Характер', actor.character],
    ['Одет', actor.clothes],
    ['Прошлое', actor.bio],
    ['Привычки', actor.habits],
    ['Желания', actor.wants],
    ['Способности', actor.abilities],
    ['Описание', actor.description],
    ['Заметка', actor.note],
  ].filter(([, value]) => value);
  if (fields.length) {
    const grid = el('div', 'person-grid');
    for (const [label, value] of fields) {
      const cell = el('div', 'person-field');
      cell.append(el('span', 'person-label', label), el('div', 'person-value', value));
      grid.append(cell);
    }
    card.append(grid);
  }

  if (actor.skills && Object.keys(actor.skills).length) {
    const skills = el('div', 'person-skills');
    for (const [name, value] of Object.entries(actor.skills)) {
      const line = el('div', 'skill-row');
      line.append(el('span', 'skill-name', name));
      const bar = el('div', 'skill-bar');
      bar.append(el('i', '', ));
      bar.firstChild.style.width = `${Math.max(0, Math.min(20, value)) * 5}%`;
      line.append(bar, el('span', 'skill-value', String(value)));
      skills.append(line);
    }
    card.append(skills);
  }

  if (actor.relations?.length) {
    const rel = el('div', 'person-field');
    rel.append(
      el('span', 'person-label', 'Отношения'),
      el('div', 'person-value', actor.relations.map((r) => `${r.with}: ${r.feeling}`).join('; ')),
    );
    card.append(rel);
  }

  if (campaignId) {
    const actions = el('div', 'person-actions');
    actions.append(miniBtn('▣ в полный рост', 'одна фигура в полный рост', async () => {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'sheet', name: actor.name }),
      });
      actor.card = res.url;
      const avatar = card.querySelector('.person-avatar');
      if (avatar && avatar.tagName === 'IMG') {
        avatar.src = res.url;
      } else if (avatar) {
        const img = el('img', 'person-avatar');
        img.src = res.url;
        avatar.replaceWith(img);
      }
      toast(`лист персонажа · $${(res.cost ?? 0).toFixed(3)}`);
    }));
    actions.append(miniBtn('＋ в карточки', 'сохранить карточку в библиотеку', () => saveToLibrary(campaignId, 'npc', actor.name)));
    actions.append(
      miniBtn('Дополнить карточку', 'агент-наполнитель допишет пустые поля', async () => {
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/fill-card`, {
          method: 'POST',
          body: JSON.stringify({ name: actor.name }),
        });
        toast(res.changed?.length ? `дополнено: ${res.changed.join(', ')}` : 'все поля уже заполнены');
        router();
      }),
    );
    if (isNpc) {
      actions.append(miniBtn('Забыть', 'убрать NPC в корзину контейнера', () => forgetNpc(campaignId, actor.name, 'archive')));
    }
    card.append(actions);
  }
  return card;
}

function openHeroSheet(hero, money, campaignId) {
  const overlay = el('div', 'library-modal');
  const sheet = el('article', 'library-sheet hero-sheet');
  const head = el('div', 'library-sheet-head');
  const titles = el('div');
  titles.append(el('h2', 'person-name', hero.name || 'Герой'));
  titles.append(el('div', 'person-role', 'главный герой'));
  const close = el('button', 'btn small', '✕');
  head.append(titles, el('span', 'chip gold', `ранг ${hero.rank ?? 'F'}`), close);

  const top = el('div', 'library-sheet-top');
  const media = el('div', 'library-sheet-media');
  const image = el(hero.card ? 'img' : 'div', hero.card ? 'library-sheet-img' : 'library-sheet-img actor-tile-initial');
  if (hero.card) {
    image.src = hero.card;
    image.alt = hero.name;
  } else {
    image.textContent = (hero.name || '?').slice(0, 1);
  }
  media.append(image);
  const meta = el('div', 'library-sheet-meta');
  for (const [label, value] of [
    ['Пол', hero.gender === 'female' ? 'женский' : hero.gender === 'male' ? 'мужской' : ''],
    ['Здоровье', `${hero.health ?? 100}/100`],
    ['Деньги', money ? `${money.gold ?? 0} з · ${money.silver ?? 0} с · ${money.copper ?? 0} м` : ''],
    ['Состояния', hero.conditions?.join(', ')],
    ['Раны', hero.wounds?.map((w) => `${w.where} (${w.severity})`).join('; ')],
  ]) {
    if (!value) continue;
    const row = el('div', 'person-field');
    row.append(el('span', 'person-label', label), el('div', 'person-value', value));
    meta.append(row);
  }
  top.append(media, meta);

  const body = el('div', 'library-sheet-body');
  for (const [label, value] of [
    ['Суть', hero.essence],
    ['Внешность', hero.appearance],
    ['Отношение к телу', hero.bodyAttitude],
    ['Прошлое', hero.origin ?? hero.bio],
    ['Привычки', hero.quirks],
    ['Способности', hero.abilities],
    ['Начало истории', hero.start],
  ]) {
    const field = templateField(label, value);
    if (field) body.append(field);
  }
  if (hero.intuition) body.append(el('div', 'person-quote', `«${hero.intuition}»`));
  if (hero.skills && Object.keys(hero.skills).length) {
    const wrap = el('div', 'person-field');
    wrap.append(el('span', 'person-label', 'Навыки'));
    wrap.append(templateSkills(hero.skills));
    body.append(wrap);
  }

  const actions = el('div', 'library-sheet-actions');
  if (campaignId) {
    const sheetBtn = el('button', 'btn small', '▣ в полный рост');
    sheetBtn.type = 'button';
    sheetBtn.addEventListener('click', async () => {
      sheetBtn.disabled = true;
      try {
        const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
          method: 'POST',
          body: JSON.stringify({ mode: 'sheet', hero: true, name: hero.name }),
        });
        hero.card = res.url;
        if (image.tagName === 'IMG') image.src = res.url;
        else {
          const img = el('img', 'library-sheet-img');
          img.src = res.url;
          image.replaceWith(img);
        }
        toast(`лист героя · $${(res.cost ?? 0).toFixed(3)}`);
      } catch (err) {
        toast(err.message);
      } finally {
        sheetBtn.disabled = false;
      }
    });
    const saveCard = el('button', 'btn small', '＋ в карточки');
    saveCard.type = 'button';
    saveCard.addEventListener('click', async () => {
      saveCard.disabled = true;
      try {
        await saveToLibrary(campaignId, 'hero', hero.name);
      } catch (err) {
        toast(err.message);
      } finally {
        saveCard.disabled = false;
      }
    });
    actions.append(sheetBtn, saveCard);
  }
  sheet.append(head, top, body, actions);

  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });
  overlay.append(sheet);
  document.body.append(overlay);
}

function heroCard(hero, money, campaignId) {
  const card = el('article', 'person-card hero-card');
  const head = el('div', 'person-head');
  if (hero.card) {
    const img = el('img', 'person-avatar');
    img.src = hero.card;
    img.alt = hero.name;
    head.append(img);
  } else {
    head.append(el('div', 'person-avatar person-initial', (hero.name || '?').slice(0, 1)));
  }
  const titles = el('div', 'person-titles');
  titles.append(el('h3', 'person-name', hero.name || 'Герой'));
  titles.append(el('div', 'person-role', 'главный герой'));
  const chips = el('div', 'chips');
  chips.append(el('span', 'chip', `здоровье ${hero.health ?? 100}/100`));
  chips.append(el('span', 'chip gold', `ранг ${hero.rank ?? 'F'}`));
  if (hero.gender) {
    chips.append(el('span', 'chip', hero.gender === 'female' ? 'женщина' : 'мужчина'));
  }
  if (money) chips.append(el('span', 'chip', `${money.gold ?? 0} з · ${money.silver ?? 0} с · ${money.copper ?? 0} м`));
  titles.append(chips);
  titles.append(rankBar(hero));
  head.append(titles);
  card.append(head);
  if (hero.essence) card.append(el('div', 'hero-card-summary', hero.essence));
  card.append(el('div', 'hero-card-hint', 'нажми, чтобы открыть карточку'));

  const heroFields = [
    ['Суть', hero.essence],
    ['Внешность', hero.appearance],
    ['Отношение к телу', hero.bodyAttitude],
    ['Прошлое', hero.origin ?? hero.bio],
    ['Привычки', hero.quirks],
    ['Способности', hero.abilities],
    ['Начало истории', hero.start],
  ].filter(([, value]) => value);
  if (heroFields.length) {
    const grid = el('div', 'person-grid');
    for (const [label, value] of heroFields) {
      const cell = el('div', 'person-field');
      cell.append(el('span', 'person-label', label), el('div', 'person-value', value));
      grid.append(cell);
    }
    card.append(grid);
  }
  if (hero.wounds?.length) {
    card.append(el('div', 'person-field', `Раны: ${hero.wounds.map((w) => `${w.where} (${w.severity}${w.treated ? ', обработано' : ''})`).join('; ')}`));
  }
  if (hero.conditions?.length) card.append(el('div', 'person-field', `Состояния: ${hero.conditions.join(', ')}`));
  if (hero.statuses?.length) {
    card.append(el('div', 'person-field', `Эффекты: ${hero.statuses.map((s) => s.name).join(', ')}`));
  }
  if (hero.intuition) card.append(el('div', 'person-quote', `«${hero.intuition}»`));

  if (hero.skills && Object.keys(hero.skills).length) {
    const skills = el('div', 'person-skills');
    for (const [name, value] of Object.entries(hero.skills)) {
      const line = el('div', 'skill-row');
      line.append(el('span', 'skill-name', name));
      const bar = el('div', 'skill-bar');
      bar.append(el('i'));
      bar.firstChild.style.width = `${Math.max(0, Math.min(20, value)) * 5}%`;
      line.append(bar, el('span', 'skill-value', String(value)));
      skills.append(line);
    }
    card.append(skills);
  }
  if (campaignId) {
    const actions = el('div', 'person-actions');
    actions.append(miniBtn('▣ в полный рост', 'одна фигура в полный рост', async () => {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'sheet', hero: true, name: hero.name }),
      });
      hero.card = res.url;
      const avatar = card.querySelector('.person-avatar');
      if (avatar && avatar.tagName === 'IMG') {
        avatar.src = res.url;
      } else if (avatar) {
        const img = el('img', 'person-avatar');
        img.src = res.url;
        avatar.replaceWith(img);
      }
      toast(`лист героя · $${(res.cost ?? 0).toFixed(3)}`);
    }));
    actions.append(miniBtn('＋ в карточки', 'сохранить героя в библиотеку', () => saveToLibrary(campaignId, 'hero', hero.name)));
    card.append(actions);
  }
  card.title = 'открыть карточку героя';
  card.classList.add('hero-card-clickable');
  card.addEventListener('click', (event) => {
    if (event.target.closest('button,a')) return;
    openHeroSheet(hero, money, campaignId);
  });
  return card;
}

function actorTile(actor, campaignId, isNpc = false) {
  const tile = el('button', 'actor-tile');
  tile.type = 'button';
  const image = actor.card || actor.portrait;
  if (image) {
    const img = el('img', 'actor-tile-img');
    img.src = image;
    img.alt = actor.name;
    img.loading = 'lazy';
    tile.append(img);
  } else {
    tile.append(el('div', 'actor-tile-img actor-tile-initial', (actor.name || '?').slice(0, 1)));
  }
  tile.append(el('span', 'actor-tile-name', actor.name));
  tile.append(el('span', 'actor-tile-role', actor.role || 'знакомый'));
  tile.addEventListener('click', () => openActorModal(actor, campaignId, isNpc));
  return tile;
}

function actorGrid(actors, campaignId, isNpc = false) {
  const grid = el('div', 'actor-grid');
  for (const actor of actors) grid.append(actorTile(actor, campaignId, isNpc));
  return grid;
}

function openActorModal(actor, campaignId, isNpc = false) {
  const overlay = el('div', 'actor-modal');
  const sheet = el('article', 'actor-sheet');
  const head = el('div', 'actor-sheet-head');
  const title = el('div');
  title.append(el('h3', 'person-name', actor.name));
  title.append(el('div', 'person-role', `${actor.role || 'знакомый'}${actor.status ? ` · ${actor.status}` : ''}`));
  const close = el('button', 'btn small', '✕');
  head.append(title, close);

  const media = el('div', 'actor-sheet-media');
  const image = actor.card || actor.portrait;
  if (image) {
    const img = el('img', 'actor-sheet-img');
    img.src = image;
    img.alt = actor.name;
    media.append(img);
  } else {
    media.append(el('div', 'actor-sheet-img actor-tile-initial', (actor.name || '?').slice(0, 1)));
  }

  const chips = el('div', 'chips');
  chips.append(el('span', 'chip gold', `ранг ${actor.rank ?? 'F'}`));
  if (typeof actor.attitude === 'number') {
    chips.append(el('span', 'chip', `отношение ${actor.attitude > 0 ? '+' : ''}${actor.attitude}`));
  }
  if (typeof actor.bond === 'number' && actor.bond > 0) chips.append(el('span', 'chip', `связь ${actor.bond}`));
  if (actor.present) chips.append(el('span', 'chip chip-live', 'в сцене'));

  const info = el('div', 'actor-sheet-info');
  for (const [label, value] of [
    ['Внешность', actor.appearance],
    ['Характер', actor.character],
    ['Одет', actor.clothes],
    ['Прошлое', actor.bio],
    ['Привычки', actor.habits],
    ['Желания', actor.wants],
    ['Способности', actor.abilities],
    ['Описание', actor.description],
    ['Заметка', actor.note],
    ['Отношения', (actor.relations ?? []).map((r) => `${r.with}: ${r.feeling}`).join('; ')],
  ]) {
    if (!value) continue;
    const field = el('div', 'person-field');
    field.append(el('span', 'person-label', label), el('div', 'person-value', value));
    info.append(field);
  }
  if (actor.skills && Object.keys(actor.skills).length) info.append(templateSkills(actor.skills));

  const actions = el('div', 'actor-sheet-actions');
  const sheetBtn = el('button', 'btn small', '▣ в полный рост');
  sheetBtn.type = 'button';
  sheetBtn.addEventListener('click', async () => {
    sheetBtn.disabled = true;
    try {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'sheet', name: actor.name }),
      });
      actor.card = res.url;
      const old = media.querySelector('.actor-sheet-img');
      if (old && old.tagName === 'IMG') old.src = res.url;
      else if (old) {
        const img = el('img', 'actor-sheet-img');
        img.src = res.url;
        old.replaceWith(img);
      }
      toast(`лист персонажа · $${(res.cost ?? 0).toFixed(3)}`);
    } catch (err) {
      toast(err.message);
    } finally {
      sheetBtn.disabled = false;
    }
  });
  const portraitBtn = el('button', 'btn small', '◉ портрет');
  portraitBtn.type = 'button';
  portraitBtn.addEventListener('click', async () => {
    portraitBtn.disabled = true;
    try {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'portrait', name: actor.name }),
      });
      actor.portrait = res.url;
      const old = media.querySelector('.actor-sheet-img');
      if (old && old.tagName === 'IMG') old.src = res.url;
      else if (old) {
        const img = el('img', 'actor-sheet-img');
        img.src = res.url;
        old.replaceWith(img);
      }
      toast(`портрет · $${(res.cost ?? 0).toFixed(3)}`);
    } catch (err) {
      toast(err.message);
    } finally {
      portraitBtn.disabled = false;
    }
  });
  actions.append(sheetBtn, portraitBtn);
  const saveCardBtn = el('button', 'btn small', '＋ в карточки');
  saveCardBtn.type = 'button';
  saveCardBtn.addEventListener('click', async () => {
    saveCardBtn.disabled = true;
    try {
      await saveToLibrary(campaignId, 'npc', actor.name);
    } catch (err) {
      toast(err.message);
    } finally {
      saveCardBtn.disabled = false;
    }
  });
  actions.append(saveCardBtn);
  if (isNpc) {
    actions.append(
      (() => {
        const forget = el('button', 'btn small danger', 'Забыть');
        forget.type = 'button';
        forget.addEventListener('click', () => {
          overlay.remove();
          forgetNpc(campaignId, actor.name, 'archive');
        });
        return forget;
      })(),
    );
  }

  sheet.append(head, media, chips, info, actions);
  overlay.append(sheet);
  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  });
  document.body.append(overlay);
}

function healthBar(value) {
  const wrap = el('div', 'health');
  const bar = el('div', 'health-bar');
  bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  wrap.append(bar, el('span', 'health-label', `${value}/100`));
  return wrap;
}

function showNewCards(state, g) {
  const actors = [...(state.party ?? []), ...(state.npcs ?? [])];
  if (!g.known) {
    g.known = new Set(actors.map((a) => a.name));
    return;
  }
  for (const actor of actors) {
    if (g.known.has(actor.name)) continue;
    g.known.add(actor.name);
    const wrap = el('div', 'msg card-notice');
    const head = el('div', 'cn-head');
    head.append(el('span', 'cn-kind', 'новая карточка'), el('b', '', actor.name));
    if (actor.role) head.append(el('span', 'tag', actor.role));
    wrap.append(head);
    if (actor.appearance) wrap.append(el('div', 'cn-line', `Внешность: ${actor.appearance}`));
    if (actor.character) wrap.append(el('div', 'cn-line', `Характер: ${actor.character}`));
    g.log.append(wrap);
  }
  scrollDown(g.log);
}

function renderPanel(state, panel, campaignId, worldMap, mapText, summary) {
  const hh = String(state.time.hour).padStart(2, '0');
  const frag = document.createDocumentFragment();

  const refresh = async () => {
    const data = await api(`/api/campaign/${encodeURIComponent(campaignId)}`);
    renderPanel(data.state, panel, campaignId, data.worldMap, data.map, data.summary);
  };

  const drop = async (name) => {
    await api(`/api/campaign/${encodeURIComponent(campaignId)}/drop`, { method: 'POST', body: JSON.stringify({ name }) });
    await refresh();
  };

  frag.append(section('Место и время', [
    row('День', `${state.time.day}, ${hh}:00`),
    row('Локация', state.place),
    row('Погода', state.weather),
  ]));

  const mem = el('details', 'card');
  mem.append(el('summary', '', 'Память истории'));
  const memBody = el('div', 'card-body');
  const memArea = el('textarea', 'memory-area');
  memArea.placeholder = 'Пока пусто. Закрепи имя, долг или обещание — ведущий будет помнить это всегда.';
  const memSave = el('button', 'btn small', 'Закрепить');
  memSave.type = 'button';
  const memStatus = el('span', 'status');
  let memLoaded = false;
  mem.addEventListener('toggle', async () => {
    if (!mem.open || memLoaded) return;
    memLoaded = true;
    const fresh = await api(`/api/campaign/${encodeURIComponent(campaignId)}`);
    memArea.value = fresh.memory ?? '';
  });
  memSave.addEventListener('click', async () => {
    await api(`/api/campaign/${encodeURIComponent(campaignId)}/memory`, { method: 'POST', body: JSON.stringify({ text: memArea.value }) });
    memStatus.textContent = 'закреплено';
  });
  memBody.append(
    el('p', 'page-sub', 'Факты, которые ведущий помнит всегда: имена, долги, обещания.'),
    memArea,
    memSave,
    memStatus,
  );
  mem.append(memBody);
  frag.append(section('Память', [mem]));

  let conspectSection = null;
  if (summary && summary.trim()) {
    const cons = el('details', 'card');
    cons.append(el('summary', '', 'Конспект'));
    const consBody = el('div', 'card-body');
    const pre = el('pre', 'prompt-dump conspect-panel');
    pre.textContent = summary;
    consBody.append(pre);
    cons.append(consBody);
    conspectSection = section('Конспект', [cons]);
  }

  const body = [healthBar(state.hero.health ?? 100)];
  if (state.hero.wounds.length) {
    body.push(itemList(state.hero.wounds.map((w) => {
      const li = el('li');
      li.append(el('span', '', w.where), el('span', 'tag', `${w.severity}${w.treated ? ' · обр.' : ''}`));
      return li;
    })));
  }
  if (state.hero.conditions.length) body.push(itemList(state.hero.conditions.map((c) => el('li', '', c))));
  if (state.hero.statuses?.length) {
    body.push(itemList(state.hero.statuses.map((s) => {
      const li = el('li');
      li.append(el('span', '', s.name), el('span', 'tag', s.kind === 'debuff' ? 'минус' : 'плюс'));
      return li;
    })));
  }
  if (state.hero.skills && Object.keys(state.hero.skills).length) body.push(el('div', 'skills-line', formatSkills(state.hero.skills)));
  frag.append(section('Тело', body));

  frag.append(section('Деньги', [row('Кошель', `${state.money.gold} з · ${state.money.silver} с · ${state.money.copper} м`)]));
  frag.append(section('Карточка героя', [heroCard(state.hero, state.money, campaignId)]));

  const inventory = state.items.length
    ? itemList(state.items.map((i) => {
        const li = el('li');
        li.append(el('span', '', `${i.name} ×${i.qty}`), el('span', 'tag', i.where));
        if (i.card) {
          const img = el('img', 'item-card');
          img.src = i.card;
          li.append(img);
        } else {
          li.append(miniBtn('◈', 'карточка предмета', async () => {
            const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
              method: 'POST',
              body: JSON.stringify({ mode: 'item', name: i.name }),
            });
            i.card = res.url;
            const img = el('img', 'item-card');
            img.src = res.url;
            li.append(img);
          }));
        }
        li.append(miniBtn('✕', 'выбросить', () => drop(i.name)));
        return li;
      }))
    : row('С собой', 'пусто');
  frag.append(section('Снаряжение', [inventory]));

  if (state.quests.length) {
    frag.append(section('Задачи', [itemList(state.quests.map((q) => {
      const li = el('li');
      li.append(el('span', '', q.title), el('span', 'tag', q.status));
      return li;
    }))]));
  }

  if (state.party.length) frag.append(section('Пати', [actorGrid(state.party, campaignId, false)]));
  const activeNpcs = (state.npcs ?? []).filter((actor) => !actor.archived);
  const archivedNpcs = (state.npcs ?? []).filter((actor) => actor.archived);
  if (activeNpcs.length) frag.append(section('Знакомые', [actorGrid(activeNpcs, campaignId, true)]));
  if (archivedNpcs.length) {
    const archive = el('div');
    for (const actor of archivedNpcs) {
      const line = el('div', 'row');
      line.append(el('span', '', actor.name), el('span', 'tag', 'забыт'));
      line.lastChild.style.cursor = 'pointer';
      line.lastChild.title = 'вернуть в игру';
      line.lastChild.addEventListener('click', () => forgetNpc(campaignId, actor.name, 'restore'));
      archive.append(line);
    }
    frag.append(section('Корзина NPC', [archive]));
  }

  if (state.factions?.length) {
    frag.append(section('Фракции', state.factions.map((f) => {
      const details = el('details', 'card');
      const summary = el('summary');
      summary.append(el('span', 'card-name', f.name), el('span', 'tag', `${f.attitude > 0 ? '+' : ''}${f.attitude}`));
      details.append(summary);
      const bodyEl = el('div', 'card-body');
      if (f.note) bodyEl.append(row('О чём', f.note));
      if (f.leader) bodyEl.append(row('Глава', f.leader));
      if (f.shadow) bodyEl.append(row('Серый кардинал', f.shadow));
      if (f.roster?.length) {
        bodyEl.append(itemList(f.roster.map((p) => {
          const li = el('li');
          li.append(el('span', '', p.name), el('span', 'tag', p.hidden ? 'скрыт' : p.role));
          return li;
        })));
      }
      details.append(bodyEl);
      return details;
    })));
  }

  const makeMap = (title, text) => {
    const details = el('details', 'map-details');
    details.open = true;
    details.append(el('summary', '', title));
    const box = el('div', 'map-clickable');
    box.title = 'открыть карту с зумом';
    const caption = el('span', 'map-caption', title);
    caption.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
    const pre = el('pre', /карта мира/i.test(title) ? 'world-map' : 'map-pre', text);
    box.append(caption, pre);
    box.addEventListener('click', () => openMapModal(title, text));
    details.append(box);
    details.append(el('div', 'map-hint', 'нажми, чтобы увеличить и двигать'));
    return details;
  };

  if (mapText) frag.append(section('Карта места', [makeMap('Карта места', mapText)]));
  if (worldMap) frag.append(section('Мир', [makeMap('Карта мира', worldMap)]));

  if (state.locations?.length) {
    frag.append(section('Места', [itemList(state.locations.slice(-8).map((l) => {
      const li = el('li');
      li.append(el('span', '', l.name), el('span', 'tag', 'знакомо'));
      return li;
    }))]));
  }

  if (state.bestiary?.length) {
    frag.append(section('Бестиарий', [itemList(state.bestiary.slice(-8).map((b) => {
      const li = el('li');
      li.append(el('span', '', b.name), el('span', 'tag', `опасн ${b.danger ?? '?'}`));
      return li;
    }))]));
  }

  if (state.illustrations?.length) {
    const wrap = el('div', 'chips');
    for (const ill of state.illustrations.slice(-6)) {
      const img = el('img', 'item-card');
      img.src = ill.url;
      img.title = ill.caption ?? '';
      wrap.append(img);
    }
    frag.append(section('Кадры', [wrap]));
  }

  if (state.archive?.length) {
    const details = el('details', 'card');
    details.append(el('summary', '', `Архив · ${state.archive.length}`));
    details.append(itemList(state.archive.slice(-20).map((a) => el('li', '', `${a.text} (${a.reason})`))));
    frag.append(section('Архив', [details]));
  }

  const danger = el('details', 'card danger-zone');
  danger.append(el('summary', '', 'Действия'));
  const dangerBody = el('div', 'card-body danger-body');
  const resetBtn = el('button', 'btn small danger-btn', 'Сбросить настройки игры');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Сбросить агентов, промты и арт этой игры к глобальным настройкам?')) return;
    try {
      await api(`/api/campaign/${encodeURIComponent(campaignId)}/reset`, { method: 'POST' });
      toast('настройки игры сброшены');
      router();
    } catch (err) {
      toast(err.message);
    }
  });
  const restartBtn = el('button', 'btn small danger-btn', 'Начать прохождение заново');
  restartBtn.type = 'button';
  restartBtn.addEventListener('click', async () => {
    if (!window.confirm('История, конспект и снимки будут очищены. Начать с хода 0?')) return;
    try {
      await api(`/api/campaign/${encodeURIComponent(campaignId)}/restart`, { method: 'POST' });
      toast('прохождение начато заново');
      router();
    } catch (err) {
      toast(err.message);
    }
  });
  const deleteBtn = el('button', 'btn small danger-btn', 'Удалить прохождение');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', async () => {
    if (!window.confirm('Удалить кампанию целиком? Это необратимо.')) return;
    try {
      await api(`/api/campaign/${encodeURIComponent(campaignId)}`, { method: 'DELETE' });
      location.hash = '#/stories';
    } catch (err) {
      toast(err.message);
    }
  });
  dangerBody.append(resetBtn, restartBtn, deleteBtn);
  danger.append(dangerBody);
  frag.append(section('Опасная зона', [danger]));
  if (conspectSection) frag.append(conspectSection);

  panel.replaceChildren(frag);
}

async function viewPlay(view, id) {
  const data = await api(`/api/campaign/${encodeURIComponent(id)}`);
  const route = currentRoute();
  if (route.name !== 'play' || route.arg !== id) return;

  const play = el('div', 'play');
  const head = el('div', 'play-head');
  const cost = el('span', 'tag', `$${(data.totals?.cost ?? 0).toFixed(6)}`);
  cost.style.marginRight = 'auto';

  const menu = el('div', 'play-menu hidden');
  const menuBtn = el('button', 'btn small icon-btn menu-btn', '☰');
  menuBtn.type = 'button';
  menuBtn.title = 'меню игры';
  menuBtn.setAttribute('aria-label', 'Меню игры');
  menuBtn.setAttribute('aria-expanded', 'false');

  const panelBtn = el('button', 'btn small icon-btn panel-btn', '▣');
  panelBtn.type = 'button';
  panelBtn.title = 'состояние';
  panelBtn.setAttribute('aria-label', 'Состояние');
  panelBtn.addEventListener('click', () => document.body.classList.toggle('panel-open'));

  const menuItem = (icon, label, cls = '') => {
    const btn = el('button', `play-menu-item ${cls}`.trim());
    btn.type = 'button';
    btn.append(el('span', 'pm-icon', icon), el('span', '', label));
    return btn;
  };

  let diceOn = false;
  const diceBtn = menuItem('🎲', 'Бросок', 'dice-btn');
  diceBtn.title = 'бросить d36: 36 граней, 3 джокера';
  const renderDice = () => {
    diceBtn.classList.toggle('active', diceOn);
    diceBtn.setAttribute('aria-pressed', String(diceOn));
    menuBtn.classList.toggle('has-dice', diceOn);
  };
  diceBtn.addEventListener('click', () => {
    diceOn = !diceOn;
    renderDice();
  });
  renderDice();

  const shotBtn = menuItem('🖼', 'Кадр');
  shotBtn.title = 'нарисовать кадр сцены';

  const artBtn = menuItem('🎨', 'Иллюстратор');
  artBtn.title = 'настройки иллюстратора: стиль, камера, формат';
  artBtn.addEventListener('click', () => openArtDialog(id));

  const fontBlock = el('div', 'play-menu-section');
  fontBlock.append(el('div', 'play-menu-label', 'Размер текста'));
  const fontMenu = el('div', 'play-menu-fonts');
  const fontSizes = [
    ['12px', '12'],
    ['13px', '13'],
    ['14px', '14'],
    ['15px', '15'],
    ['16px', '16'],
    ['18px', '18'],
    ['20px', '20'],
    ['22px', '22'],
  ];
  const applyFont = (size) => {
    document.documentElement.style.setProperty('--prose-size', size);
    try {
      localStorage.setItem('omika_font_size', size);
    } catch {
      /* приватный режим */
    }
    for (const btn of fontMenu.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.size === size);
    }
  };
  const savedFont = (() => {
    try {
      return localStorage.getItem('omika_font_size') ?? '18px';
    } catch {
      return '18px';
    }
  })();
  for (const [size, label] of fontSizes) {
    const btn = el('button', '', label);
    btn.type = 'button';
    btn.dataset.size = size;
    btn.addEventListener('click', () => {
      applyFont(size);
      menu.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
    fontMenu.append(btn);
  }
  applyFont(savedFont);
  fontBlock.append(fontMenu);

  const historyBtn = menuItem('📜', 'История');
  historyBtn.title = 'вся история: можно перечитать любой ход';
  historyBtn.addEventListener('click', () => openHistoryDialog(id));

  const closeMenu = () => {
    menu.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  const toggleMenu = () => {
    const open = menu.classList.toggle('hidden');
    menuBtn.setAttribute('aria-expanded', String(!open));
  };
  menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleMenu();
  });
  menu.addEventListener('click', (event) => {
    if (event.target.closest('.play-menu-item')) closeMenu();
  });
  document.addEventListener('click', (event) => {
    if (!document.body.contains(menu)) return;
    if (!menu.contains(event.target) && event.target !== menuBtn) closeMenu();
  });

  menu.append(diceBtn, shotBtn, fontBlock, artBtn, historyBtn);
  head.append(cost, panelBtn, menuBtn, menu);

  const body = el('div', 'play-body');
  const log = el('div', 'log');
  const panel = el('aside', 'panel');

  const typing = el('div', 'typing hidden');
  typing.append(el('span'), el('span'), el('span'));

  const composer = el('form', 'composer');
  const field = el('div', 'composer-field');
  const input = el('textarea');
  input.placeholder = 'Твой ход…';

  const send = el('button', 'send-icon', '↑');
  send.type = 'submit';
  send.title = 'Отправить';
  send.setAttribute('aria-label', 'Отправить');
  field.append(input, send);
  composer.append(field);

  const outbox = el('div', 'outbox hidden');
  const outboxText = el('div', 'outbox-text');
  const outboxActions = el('div', 'outbox-actions');
  const outboxRetry = el('button', 'btn small', 'Отправить снова');
  outboxRetry.type = 'button';
  const outboxDiscard = el('button', 'btn small danger', 'Удалить');
  outboxDiscard.type = 'button';
  outboxActions.append(outboxRetry, outboxDiscard);
  outbox.append(outboxText, outboxActions);

  const renderThoughts = (state) => {
    const text = state?.hero?.intuition;
    input.placeholder = text ? `«${text}»` : 'Твой ход…';
    input.title = text ? `Мысль: ${text}` : '';
  };
  renderThoughts(data.state);

  body.append(log, panel);
  play.append(head, body, typing, outbox, composer);
  view.append(play);

  const sideMap = $('side-map');
  if (sideMap) sideMap.classList.add('hidden');

  addSystem(log, `хроника «${id}» · ход ${data.state.turn}`);
  const turnsById = new Map((data.turns ?? []).map((t) => [t.turn, t]));
  const imagesByTurn = new Map((data.state.illustrations ?? []).map((ill) => [ill.turn, ill.url]));
  for (const entry of data.history) {
    if (entry.role === 'player') addPlayer(log, entry.text);
    else if (entry.role === 'gm') {
      // Кнопки действий — только у последних десяти ходов, иначе лента тормозит.
      const recent = entry.turn > data.state.turn - 10;
      addGm(log, { prose: entry.text, stats: {} }, recent ? turnsById.get(entry.turn) : null, imagesByTurn.get(entry.turn), entry.turn);
    }
  }

  if (!(data.history ?? []).length) {
    log.append(el('div', 'log-empty', 'История ещё не началась. Напиши первое действие — ведущий откроет сцену.'));
  }

  renderPanel(data.state, panel, id, data.worldMap ?? '', data.map ?? '', data.summary);
  scrollDown(log);

  // Шапка прячется при чтении вниз и возвращается при прокрутке вверх.
  let lastLogScroll = log.scrollTop;
  let scrollArmed = false;
  window.setTimeout(() => {
    scrollArmed = true;
    lastLogScroll = log.scrollTop;
  }, 600);
  log.addEventListener('scroll', () => {
    if (!scrollArmed || document.body.classList.contains('panel-open')) return;
    const now = log.scrollTop;
    if (now > lastLogScroll + 8 && now > 48) {
      head.classList.add('head-hidden');
      if (window.matchMedia('(max-width: 900px)').matches) {
        document.body.classList.add('chrome-hidden');
      }
      closeMenu();
    } else if (now < lastLogScroll - 8) {
      head.classList.remove('head-hidden');
      document.body.classList.remove('chrome-hidden');
    }
    lastLogScroll = now;
  });

  app.game = {
    id,
    busy: false,
    log,
    panel,
    input,
    send,
    typing,
    costEl: cost,
    renderThoughts,
    known: new Set([...(data.state.party ?? []), ...(data.state.npcs ?? [])].map((a) => a.name)),
  };

  shotBtn.addEventListener('click', async () => {
    shotBtn.disabled = true;
    try {
      const res = await api(`/api/campaign/${encodeURIComponent(id)}/image`, {
        method: 'POST',
        body: JSON.stringify({ mode: 'scene', turn: app.game?.state?.turn }),
      });
      const img = el('img', 'msg-image');
      img.src = res.url;
      log.append(img);
      scrollDown(log);
      toast(`кадр готов · $${(res.cost ?? 0).toFixed(3)}${res.fallback ? ' · откат на Gemini' : ''}`);
    } finally {
      shotBtn.disabled = false;
    }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(160, input.scrollHeight)}px`;
  });

  const hideOutbox = () => outbox.classList.add('hidden');
  const showOutbox = (record) => {
    outboxText.textContent = `Не отправлено: «${record.input.slice(0, 180)}»`;
    outbox.classList.remove('hidden');
    outboxRetry.onclick = () => {
      const current = readPending(id);
      if (current) runTurn(current.input, Boolean(current.dice), current.clientTurnId, true);
    };
    outboxDiscard.onclick = () => {
      const current = readPending(id);
      clearPending(id, current?.clientTurnId);
      hideOutbox();
    };
  };

  async function runTurn(text, dice, clientTurnId, fromPending = false) {
    if (!text || app.game.busy) return;
    app.game.busy = true;
    if (!fromPending) {
      writePending(id, {
        clientTurnId,
        input: text,
        dice: Boolean(dice),
        createdAt: new Date().toISOString(),
      });
      input.value = '';
      input.style.height = 'auto';
    }
    hideOutbox();
    addPlayer(log, text);
    scrollDown(log);
    typing.classList.remove('hidden');

    const wrap = el('div', 'msg gm');
    const prose = el('div', 'prose');
    wrap.append(prose);
    let started = false;
    let keepTop = false;

    const applyResult = (result) => {
      keepTop = true;
      typing.classList.add('hidden');
      if (!started) {
        log.append(wrap);
        scrollToNode(log, wrap);
      }
      prose.textContent = result.prose || prose.textContent;
      wrap.append(metaLine(result));
      wrap.append(
        actionsBar({ turn: result.stats?.turn ?? result.state.turn, variants: 1, input: text }, id),
      );
      renderPanel(result.state, panel, id, result.worldMap ?? '', result.map ?? '', result.summary);
      renderThoughts(result.state);
      if (result.roll) addRoll(log, result.roll);
      showNewCards(result.state, app.game);
      cost.textContent = `$${(result.totals?.cost ?? 0).toFixed(6)}`;
    };

    try {
      const result = await streamTurn(
        id,
        text,
        (piece) => {
          if (!started) {
            started = true;
            typing.classList.add('hidden');
            log.append(wrap);
            scrollToNode(log, wrap);
          }
          prose.textContent += piece;
          // Дальше не тянем прокрутку: остаёмся на первом сообщении ответа.
        },
        Boolean(dice),
        clientTurnId,
      );
      clearPending(id, clientTurnId);
      hideOutbox();
      if (result.duplicate) {
        toast('Этот ход уже сохранён — обновляю ленту');
        router();
        return;
      }
      applyResult(result);
      for (const change of result.agentChanges ?? []) {
        if (/ранг/i.test(change)) toast(change);
      }
    } catch (err) {
      typing.classList.add('hidden');
      if (started) wrap.remove();
      toast(err.message);
      // Если поток уже начал отдавать текст, повторный POST мог бы стоить
      // второй ход. Но у нас есть clientTurnId — сервер вернёт сохранённый.
      if (!started) {
        try {
          const res = await api(`/api/campaign/${encodeURIComponent(id)}/turn`, {
            method: 'POST',
            body: JSON.stringify({ input: text, dice: Boolean(dice), clientTurnId }),
          });
          clearPending(id, clientTurnId);
          hideOutbox();
          if (res.duplicate) {
            toast('Этот ход уже сохранён — обновляю ленту');
            router();
            return;
          }
          applyResult(res);
          return;
        } catch (err2) {
          toast(err2.message);
        }
      }
      const current = readPending(id);
      if (current) showOutbox(current);
    } finally {
      app.game.busy = false;
      input.focus();
      if (keepTop) {
        window.requestAnimationFrame(() => {
          if (log.contains(wrap)) scrollToNode(log, wrap);
        });
      }
    }
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || app.game.busy) return;
    runTurn(text, diceOn, newClientTurnId());
  });

  const pending = readPending(id);
  if (pending) {
    const completed =
      (data.turns ?? []).some((turn) => turn.clientTurnId === pending.clientTurnId) ||
      (data.history ?? []).some((entry) => entry.clientTurnId === pending.clientTurnId);
    if (completed) clearPending(id, pending.clientTurnId);
    else showOutbox(pending);
  }
}

async function streamTurn(id, input, onText, dice, clientTurnId) {
  const res = await fetch(`/api/campaign/${encodeURIComponent(id)}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, dice, clientTurnId }),
  });
  if (!res.ok || !res.body) throw new Error(`поток недоступен: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = null;

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let payload = null;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.t === 'delta' || payload.type === 'delta') onText(payload.text ?? '');
      else if (payload.t === 'done' || payload.type === 'done') done = payload.payload ?? payload.data ?? payload;
      else if (payload.t === 'error' || payload.type === 'error') throw new Error(payload.error ?? 'ошибка потока');
    }
  }

  if (!done) throw new Error('поток оборвался');
  return done;
}

function openImportDialog(campaignId, onDone) {
  const overlay = el('div', 'map-modal');
  const head = el('div', 'map-modal-head');
  head.append(el('b', '', 'Импорт карточки V2'));
  const close = el('button', 'btn small', '✕');
  head.append(close);

  const bodyEl = el('div', 'import-body');
  const zone = el('label', 'dropzone');
  zone.append(el('b', '', 'Перетащи JSON сюда'), el('span', '', 'или нажми, чтобы выбрать файл'));
  const file = el('input', 'hidden');
  file.type = 'file';
  file.accept = '.json,application/json';
  zone.append(file);

  const modes = el('div', 'import-modes');
  const npc = el('input');
  npc.type = 'radio';
  npc.name = 'import-mode';
  npc.checked = true;
  const hero = el('input');
  hero.type = 'radio';
  hero.name = 'import-mode';
  const npcLabel = el('label', 'import-mode');
  npcLabel.append(npc, el('span', '', 'знакомый'));
  const heroLabel = el('label', 'import-mode');
  heroLabel.append(hero, el('span', '', 'в пати'));
  modes.append(npcLabel, heroLabel);

  const preview = el('div', 'import-preview', 'Файл не выбран');
  const status = el('span', 'status');
  const submit = el('button', 'btn primary small', 'Импортировать');
  submit.disabled = true;

  let card = null;

  const read = async (picked) => {
    try {
      card = JSON.parse(await picked.text());
      preview.textContent = `Карточка: ${card?.data?.name ?? card?.name ?? 'без имени'}`;
      submit.disabled = false;
    } catch (err) {
      status.textContent = err.message;
    }
  };

  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    if (picked) read(picked);
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const picked = e.dataTransfer?.files?.[0];
    if (picked) read(picked);
  });

  submit.addEventListener('click', async () => {
    submit.disabled = true;
    try {
      const res = await api(`/api/campaign/${encodeURIComponent(campaignId)}/card`, {
        method: 'POST',
        body: JSON.stringify({ card, mode: hero.checked ? 'hero' : 'npc' }),
      });
      status.textContent = `готово: ${res.name}`;
      onDone?.(res);
      setTimeout(() => overlay.remove(), 600);
    } catch (err) {
      status.textContent = err.message;
      submit.disabled = false;
    }
  });

  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  bodyEl.append(zone, modes, preview, submit, status);
  overlay.append(head, bodyEl);
  document.body.append(overlay);
}

/* ================= ключи API ================= */

async function viewKeys(view) {
  const page = el('div', 'page');
  page.append(pageHead('Провайдеры', 'Ключи API', 'Ключ хранится локально в data/keys.json, в браузер уходит только маска.'));

  const listBox = el('div');
  const form = el('div', 'agent-card');
  const formHead = el('div', 'agent-head');
  formHead.append(el('h3', '', 'Новый ключ'));
  form.append(formHead);

  const name = el('input');
  name.placeholder = 'например: OpenRouter основной';
  const provider = el('select');
  const optOR = el('option', '', 'OpenRouter');
  optOR.value = 'openrouter';
  const optCustom = el('option', '', 'Свой OpenAI-совместимый');
  optCustom.value = 'custom';
  provider.append(optOR, optCustom);
  const baseUrl = el('input');
  baseUrl.placeholder = 'https://openrouter.ai/api/v1';
  const apiKey = el('input');
  apiKey.type = 'password';
  apiKey.placeholder = 'sk-…';
  const status = el('span', 'status');
  let editingId = '';
  const actions = el('div', 'agent-actions');
  const check = el('button', 'btn small', 'Проверить');
  check.type = 'button';
  const save = el('button', 'btn primary small', 'Сохранить');
  save.type = 'button';
  const cancel = el('button', 'btn small hidden', 'Отмена');
  cancel.type = 'button';
  actions.append(check, save, cancel, status);

  const resetForm = () => {
    editingId = '';
    formHead.replaceChildren(el('h3', '', 'Новый ключ'));
    name.value = '';
    baseUrl.value = '';
    apiKey.value = '';
    provider.value = 'openrouter';
    cancel.classList.add('hidden');
    status.textContent = '';
  };

  cancel.addEventListener('click', resetForm);

  form.append(
    agentField('Название', name),
    agentField('Провайдер', provider),
    agentField('Адрес API', baseUrl),
    agentField('Ключ', apiKey),
    actions,
  );

  const modelsBox = el('div', 'lore-list');
  const filter = el('select');
  for (const [value, label] of [
    ['all', 'все модели'],
    ['free', 'бесплатные'],
    ['cheap', 'дешёвые до $0.5'],
    ['text', 'текстовые'],
    ['image', 'для картинок'],
  ]) {
    const option = el('option', '', label);
    option.value = value;
    filter.append(option);
  }
  let lastModels = [];
  const renderModels = () => {
    if (lastModels.length === 0) return;
    const mode = filter.value;
    const list = lastModels.filter((m) => {
      if (mode === 'free') return m.free;
      if (mode === 'cheap') return m.input != null && m.input <= 0.5;
      if (mode === 'text') return m.kind === 'text';
      if (mode === 'image') return m.kind === 'image';
      return true;
    });
    const table = el('table', 'table');
    const head = el('thead');
    const hr = el('tr');
    for (const h of ['Модель', 'Тип', 'Вход', 'Выход']) hr.append(el('th', '', h));
    head.append(hr);
    table.append(head);
    const body = el('tbody');
    for (const m of list.slice(0, 60)) {
      const tr = el('tr');
      tr.append(
        el('td', '', m.id),
        el('td', '', m.kind),
        el('td', 'num', m.input != null ? `$${Number(m.input).toFixed(3)}` : '—'),
        el('td', 'num', m.output != null ? `$${Number(m.output).toFixed(3)}` : '—'),
      );
      body.append(tr);
    }
    table.append(body);
    modelsBox.replaceChildren(el('p', 'page-sub', `показано: ${Math.min(list.length, 60)} из ${lastModels.length}`), table);
  };
  filter.addEventListener('change', renderModels);

  const renderList = async () => {
    const data = await api('/api/keys');
    listBox.replaceChildren();
    if ((data.keys ?? []).length === 0) listBox.append(emptyBox('Ключей нет', 'Добавь хотя бы один — иначе работает OPENROUTER_API_KEY из .env.'));
    for (const key of data.keys ?? []) {
      const roww = el('div', 'row-card');
      const main = el('div', 'row-main');
      main.append(el('h3', '', key.name));
      const meta = el('div', 'row-meta');
      meta.append(el('span', '', key.provider), el('span', '', key.baseUrl), el('span', '', key.masked));
      main.append(meta);
      const rowActions = el('div', 'row-actions');
      const showModels = el('button', 'btn small', 'Модели');
      showModels.type = 'button';
      showModels.addEventListener('click', async () => {
        modelsBox.replaceChildren(el('p', 'page-sub', 'загружаю…'));
        try {
          const res = await api(`/api/keys/${encodeURIComponent(key.id)}/models`);
          const table = el('table', 'table');
          const head = el('thead');
          const hr = el('tr');
          for (const h of ['Модель', 'Тип', 'Вход', 'Выход']) hr.append(el('th', '', h));
          head.append(hr);
          table.append(head);
          const body = el('tbody');
          for (const m of (res.models ?? []).slice(0, 40)) {
            const tr = el('tr');
            tr.append(
              el('td', '', m.id),
              el('td', '', m.kind),
              el('td', 'num', m.input != null ? `$${Number(m.input).toFixed(3)}` : '—'),
              el('td', 'num', m.output != null ? `$${Number(m.output).toFixed(3)}` : '—'),
            );
            body.append(tr);
          }
          table.append(body);
          modelsBox.replaceChildren(table);
        } catch (err) {
          modelsBox.replaceChildren(el('p', 'page-sub', err.message));
        }
      });
      const edit = el('button', 'btn small', 'Изменить');
      edit.type = 'button';
      edit.addEventListener('click', () => {
        editingId = key.id;
        formHead.replaceChildren(el('h3', '', `Ключ: ${key.name}`));
        name.value = key.name;
        provider.value = key.provider;
        baseUrl.value = key.baseUrl;
        apiKey.value = '';
        cancel.classList.remove('hidden');
        window.scrollTo({ top: 0 });
      });
      const del = el('button', 'btn small danger', 'Удалить');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(`Удалить ключ «${key.name}»?`)) return;
        await api(`/api/keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
        renderList();
      });
      rowActions.append(showModels, edit, del);
      roww.append(main, rowActions);
      listBox.append(roww);
    }
  };

  check.addEventListener('click', async () => {
    status.textContent = 'проверяю…';
    try {
      const res = await api('/api/keys/test', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: baseUrl.value || undefined, apiKey: apiKey.value }),
      });
      status.textContent = res.ok ? `OK · моделей ${res.count}` : res.error;
    } catch (err) {
      status.textContent = err.message;
    }
  });

  save.addEventListener('click', async () => {
    status.textContent = 'сохраняю…';
    try {
      const editing = Boolean(editingId);
      await api(editing ? `/api/keys/${encodeURIComponent(editingId)}` : '/api/keys', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          name: name.value,
          provider: provider.value,
          baseUrl: baseUrl.value || undefined,
          apiKey: apiKey.value || undefined,
        }),
      });
      status.textContent = editing ? 'ключ обновлён' : 'ключ сохранён';
      resetForm();
      renderList();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  page.append(form, el('h3', 'page-kicker', 'Сохранённые ключи'), listBox, el('h3', 'page-kicker', 'Модели'), modelsBox);
  await renderList();
  view.append(page);
}

/* ================= ядро и четыре блока ================= */

const BLOCK_AGENTS = {
  core: ['gm', 'state', 'summarizer', 'prompter'],
  tone: ['gm', 'artistScene', 'artistHero', 'artistNpc', 'artistItem'],
  world: ['gm', 'artistScene', 'state'],
  hero: ['gm', 'artistHero', 'artistNpc'],
};

async function viewCore(view) {
  const page = el('div', 'page core-page');
  page.append(
    pageHead(
      'Правила и промты',
      'Ядро',
      'Ядро неизменяемо. Тон, мир и герой — промты для промтов: по ним мастер собирает историю.',
    ),
  );

  const holder = el('div');
  page.append(holder);
  view.append(page);

  const BLOCKS = [
    { key: 'core', title: 'Ядро — правила (не изменяется)', readonly: true },
    { key: 'tone', title: 'Тон — промт для генерации тона' },
    { key: 'world', title: 'Мир — промт для генерации мира' },
    { key: 'hero', title: 'Герой — промт для мастера' },
  ];

  let areas = {};

  const build = async () => {
    const data = await api('/api/blocks');
    areas = {};
    holder.replaceChildren();

    for (const spec of BLOCKS) {
      const card = el('div', 'agent-card');
      card.dataset.key = spec.key;
      const head = el('div', 'agent-head');
      head.append(el('h3', '', spec.title));
      card.append(head);

      const area = el('textarea', 'prompt-area');
      area.value = data[spec.key] ?? '';
      area.readOnly = Boolean(spec.readonly);
      if (spec.readonly) area.classList.add('locked');
      areas[spec.key] = area;
      card.append(area);

      const badges = el('div', 'chips');
      for (const id of BLOCK_AGENTS[spec.key] ?? []) {
        const agent = data.agents?.[id];
        badges.append(el('span', 'chip', `${agent?.title ?? id}: ${agent?.model ?? '—'}`));
      }
      if (badges.children.length) card.append(badges);
      if (spec.readonly) card.append(el('p', 'page-sub', 'Правила неизменяемы: правка ядра запрещена.'));
      holder.append(card);
    }

    const status = el('span', 'status');
    const actions = el('div', 'agent-actions');
    const save = el('button', 'btn primary', 'Сохранить');
    const cancel = el('button', 'btn', 'Отменить изменения');
    save.type = 'button';
    cancel.type = 'button';
    actions.append(save, cancel, status);
    holder.append(actions);

    save.addEventListener('click', async () => {
      status.textContent = 'сохраняю…';
      try {
        await api('/api/blocks', {
          method: 'PUT',
          body: JSON.stringify({
            tone: areas.tone.value,
            world: areas.world.value,
            hero: areas.hero.value,
          }),
        });
        status.textContent = 'сохранено';
      } catch (err) {
        status.textContent = err.message;
      }
    });

    cancel.addEventListener('click', async () => {
      await build();
      toast('изменения отменены');
    });
  };

  await build();
}
/* ================= теги иллюстратора внутри игры ================= */

async function openArtDialog(campaignId, onSaved) {
  const data = await api(`/api/campaign/${encodeURIComponent(campaignId)}/art`);
  const picked = new Map();
  for (const name of data.art?.include ?? []) picked.set(name, 'include');
  for (const name of data.art?.exclude ?? []) picked.set(name, 'exclude');

  const overlay = el('div', 'map-modal');
  const head = el('div', 'map-modal-head');
  head.append(el('b', '', 'Иллюстратор'));
  const close = el('button', 'btn small', '✕');
  head.append(close);

  const bodyEl = el('div', 'import-body');
  const presets = el('div', 'chips');
  for (const [label, names] of [
    ['крупный план', ['крупный план']],
    ['вид сверху', ['вид сверху']],
    ['со стороны', ['со стороны']],
    ['ч/б', ['ч/б']],
  ]) {
    const chip = el('button', 'chip quick', label);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      for (const name of names) picked.set(name, 'include');
      render();
    });
    presets.append(chip);
  }
  bodyEl.append(presets);

  const groups = el('div');
  bodyEl.append(groups);

  const render = () => {
    groups.replaceChildren();
    for (const group of data.groups ?? []) {
      const block = el('details', 'tag-group');
      block.append(el('summary', '', group.group));
      for (const sg of group.subgroups) {
        const roww = el('div', 'tag-row');
        roww.append(el('div', 'tag-title', sg.subgroup));
        const list = el('div', 'tag-list');
        for (const field of sg.fields) {
          const item = el('button', 'tag-item');
          item.type = 'button';
          item.title = field.description ?? '';
          const marker = el('span', 'marker', '□');
          item.append(marker, el('span', 'tag-name', field.name));
          const apply = (mode) => {
            item.classList.toggle('on', mode === 'include');
            item.classList.toggle('ex', mode === 'exclude');
            marker.textContent = mode === 'include' ? '✓' : mode === 'exclude' ? '✕' : '□';
          };
          apply(picked.get(field.name));
          item.addEventListener('click', () => {
            const current = picked.get(field.name);
            if (!current) {
              picked.set(field.name, 'include');
              apply('include');
            } else if (current === 'include') {
              picked.set(field.name, 'exclude');
              apply('exclude');
            } else {
              picked.delete(field.name);
              apply('');
            }
          });
          list.append(item);
        }
        roww.append(list);
        block.append(roww);
      }
      groups.append(block);
    }
  };
  render();

  // Второй блок: параметры поведения ИИ и генерации картинок.
  const aiPicked = new Set(data.settings ?? []);
  const aiBlock = el('details', 'tag-group ai-block');
  aiBlock.open = true;
  aiBlock.append(el('summary', '', 'Параметры ИИ'));
  for (const group of data.aiGroups ?? []) {
    const head = el('div', 'tag-title', group.group);
    head.style.marginTop = '10px';
    aiBlock.append(head);
    const sections = group.subgroups ?? [{ subgroup: '', fields: group.fields ?? [] }];
    for (const sg of sections) {
      const roww = el('div', 'tag-row');
      if (sg.subgroup) roww.append(el('div', 'tag-title', sg.subgroup));
      const list = el('div', 'tag-list');
      const buttons = [];
      let pickedInSection = '';
      for (const field of sg.fields) {
        const item = el('button', 'tag-item');
        item.type = 'button';
        item.title = field.description ?? '';
        item.dataset.name = field.name;
        // В секции только один выбор: лишние старые настройки гасим.
        let picked = aiPicked.has(field.name);
        if (picked && pickedInSection) {
          aiPicked.delete(field.name);
          picked = false;
        }
        if (picked) pickedInSection = field.name;
        const marker = el('span', 'marker', picked ? '✓' : '□');
        item.append(marker, el('span', 'tag-name', field.name));
        item.classList.toggle('on', picked);
        item.addEventListener('click', () => {
          if (aiPicked.has(field.name)) {
            aiPicked.delete(field.name);
            item.classList.remove('on');
            marker.textContent = '□';
            return;
          }
          // Внутри секции выбор одиночный: снимаем соседей.
          for (const sibling of buttons) {
            if (sibling === item) continue;
            const name = sibling.dataset.name;
            if (aiPicked.delete(name)) {
              sibling.classList.remove('on');
              const sm = sibling.querySelector('.marker');
              if (sm) sm.textContent = '□';
            }
          }
          aiPicked.add(field.name);
          item.classList.add('on');
          marker.textContent = '✓';
        });
        buttons.push(item);
        list.append(item);
      }
      roww.append(list);
      aiBlock.append(roww);
    }
  }
  bodyEl.append(aiBlock);

  const status = el('span', 'status');
  const save = el('button', 'btn primary small', 'Сохранить');
  save.type = 'button';
  save.addEventListener('click', async () => {
    const inc = [...picked].filter(([, v]) => v === 'include').map(([k]) => k);
    const exc = [...picked].filter(([, v]) => v === 'exclude').map(([k]) => k);
    await api(`/api/campaign/${encodeURIComponent(campaignId)}/art`, {
      method: 'PUT',
      body: JSON.stringify({ include: inc, exclude: exc, settings: [...aiPicked] }),
    });
    status.textContent = `сохранено: ${inc.length} / ${exc.length}`;
    onSaved?.();
  });

  close.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.remove();
  });

  const actions = el('div', 'agent-actions');
  actions.append(save, status);
  bodyEl.append(actions);
  overlay.append(head, bodyEl);
  document.body.append(overlay);
}

/* ================= запуск ================= */

const app = { game: null, campaigns: [], pendingHero: null };

async function isAuthEnabled() {
  try {
    const res = await fetch('/api/auth');
    return res.ok && (await res.json()).enabled === true;
  } catch {
    return false;
  }
}

function logoutButton() {
  const btn = el('button', 'logout-btn', 'Выйти');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined);
    location.href = '/login';
  });
  return btn;
}

async function setupAuthBar() {
  if (!(await isAuthEnabled())) return;
  app.authEnabled = true;
  const foot = document.querySelector('.side-foot');
  if (foot) foot.append(logoutButton());
}

window.addEventListener('hashchange', router);
setupAuthBar();
router();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
