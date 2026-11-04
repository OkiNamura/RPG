/** Ночной игровой прогон 50 ходов с реальным сервером. */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:7801';
const ID = process.env.NIGHT_ID || 'night-playtest';
const password = readFileSync('.admin-password', 'utf8').trim();

async function login() {
  const page = await (await fetch(`${BASE}/login`)).text();
  const q = (page.match(/id="captcha-question">([^<]+)</) || [])[1] || '';
  const cid = (page.match(/id="captcha-id"[^>]*value="([^"]+)"/) || [])[1] || '';
  const [a, b] = q.split('+').map((value) => Number(value.trim()));
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, captchaId: cid, captchaAnswer: String(a + b) }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

const cookie = await login();
const api = async (path, options = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...options,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

await api(`/api/campaign/${ID}`, { method: 'DELETE' });
const world = [
  'Мрачный портовый город на краю холодного моря.',
  'Власть держит гильдия солеваров, на улицах торгуют контрабандой.',
  'Магия редкая и дорогая, каждый ритуал имеет цену.',
  'В городе есть порт, рынок, старая библиотека, храм и трущобы.',
].join(' ').repeat(8);
const created = await api('/api/campaigns', {
  method: 'POST',
  body: JSON.stringify({
    id: ID,
    tone: world,
    world,
    hero: '# ГЕРОЙ\nМира — бывшая ученица картографа, ищет пропавшего брата.',
    heroName: 'Мира',
    generatePrompts: false,
    toneLevel: 6,
    meta: { title: 'Ночной прогон' },
  }),
});
if (created.status !== 200) throw new Error(`create ${created.status}`);

const inputs = [
  'Я осматриваюсь на пристани.', 'Иду к рынку.', 'Спрашиваю торговку о брате.',
  'Покупаю еду и воду.', 'Иду в старую библиотеку.', 'Ищу карты порта.',
  'Разговариваю с архивариусом.', 'Осторожно спрашиваю о солеварах.',
  'Выхожу на улицу.', 'Иду к храму.', 'Слушаю проповедь.', 'Оставляю монету.',
  'Возвращаюсь на рынок.', 'Ищу следы брата.', 'Иду в трущобы.', 'Осматриваю переулки.',
  'Говорю с местным мальчишкой.', 'Даю ему монету.', 'Иду к старому складу.',
  'Проверяю дверь.', 'Захожу внутрь.', 'Ищу документы.', 'Беру найденную карту.',
  'Осторожно выхожу.', 'Возвращаюсь к библиотеке.', 'Сравниваю карты.',
  'Иду в порт.', 'Наблюдаю за кораблями.', 'Говорю с матросом.', 'Предлагаю помощь.',
  'Помогаю с грузом.', 'Спрашиваю о пропавшем.', 'Иду к храму.', 'Молюсь.',
  'Проверяю тайник.', 'Возвращаюсь на рынок.', 'Покупаю плащ.', 'Иду к трущобам.',
  'Ищу старую женщину.', 'Слушаю её рассказ.', 'Записываю имена.', 'Иду к библиотеке.',
  'Проверяю архив.', 'Нахожу запись.', 'Иду к порту.', 'Встречаюсь с матросом.',
  'Планирую следующий шаг.', 'Отдыхаю в таверне.', 'Проверяю вещи.', 'Иду спать.',
  'Просыпаюсь и проверяю кошелёк.', 'Иду к рынку.', 'Покупаю еду.',
  'Разговариваю с торговцем.', 'Возвращаюсь в таверну.',
];

const rows = [];
let failed = 0;
let checkpoint = null;
const totalTurns = Math.min(inputs.length, Number(process.env.NIGHT_TURNS || inputs.length));
for (let index = 0; index < totalTurns; index += 1) {
  const started = Date.now();
  const result = await api(`/api/campaign/${ID}/turn`, {
    method: 'POST',
    body: JSON.stringify({ input: inputs[index], clientTurnId: `night-${index}-${Date.now()}` }),
  });
  if (result.status === 200 && result.body?.clarification) {
    result.body = (
      await api(`/api/campaign/${ID}/turn`, {
        method: 'POST',
        body: JSON.stringify({
          input: inputs[index],
          clientTurnId: `night-${index}-${Date.now()}`,
          timeTarget: { kind: 'morning' },
        }),
      })
    ).body;
  }
  const ok = result.status === 200 && Boolean(result.body?.prose);
  if (!ok) failed += 1;
  rows.push({
    n: index + 1,
    status: result.status,
    ms: Date.now() - started,
    numbers: result.body?.numbers?.length ?? 0,
    time: result.body?.state?.time ?? null,
    error: result.body?.error ?? null,
  });
  console.log(`${index + 1}/${inputs.length} ${result.status} ${Date.now() - started}ms`);
  if (!ok) {
    console.log(result.body);
    break;
  }
  if (index === 19) {
    const created = await api(`/api/campaign/${ID}/branches`, {
      method: 'POST',
      body: JSON.stringify({ name: 'checkpoint-20', turn: 20 }),
    });
    checkpoint = created.body?.branch ?? null;
    console.log('checkpoint', checkpoint);
  }
}

const file = (await api(`/api/campaign/${ID}`)).body;
let restored = null;
if (checkpoint) {
  const loaded = await api(`/api/campaign/${ID}/branches/${checkpoint.id}/load`, { method: 'POST' });
  const afterLoad = await api(`/api/campaign/${ID}`);
  restored = {
    status: loaded.status,
    turn: loaded.body?.state?.turn,
    log: loaded.body?.state?.log?.length,
    reputation: loaded.body?.state?.reputation,
    currencies: loaded.body?.state?.currencies,
    summary: afterLoad.body?.summary,
  };
  console.log('restored checkpoint', restored);
}
const report = [
  '# Ночной прогон',
  '',
  `Ходов: ${rows.length}, ошибок: ${failed}`,
  `Итоговый ход: ${file?.state?.turn ?? '—'}`,
  `Время: ${JSON.stringify(file?.state?.time ?? {})}`,
  `Валюты: ${JSON.stringify(file?.state?.currencies ?? [])}`,
  `Предметы: ${(file?.state?.items ?? []).map((item) => item.name).join(', ')}`,
  `Репутация: ${JSON.stringify(file?.state?.reputation ?? {})}`,
  `Пати: ${(file?.state?.party ?? []).map((actor) => `${actor.name}(отн ${actor.attitude ?? 0}, дух ${actor.morale ?? 50})`).join('; ')}`,
  `Конспект: ${(file?.summary ?? '').length} символов`,
  `Чекпоинт 20: ${JSON.stringify(restored)}`,
  '',
  '| # | статус | мс | чисел | время |',
  '|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.n} | ${row.status} | ${row.ms} | ${row.numbers} | ${JSON.stringify(row.time)} |`),
].join('\n');
writeFileSync('data/night-playtest-report.md', report);
console.log(report);

