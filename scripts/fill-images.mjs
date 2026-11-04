#!/usr/bin/env node
/**
 * Наполняет контейнер игры карточками:
 * герой, пати, NPC, предметы и локации, у которых ещё нет своей картинки.
 *
 *   node scripts/fill-images.mjs <campaign-id> [--dry-run] [--items] [--locations]
 *
 * Без --items/--locations берутся все четыре категории.
 * Скрипт последовательный: локальная Qwen не любит параллельные запросы.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const campaignId = process.argv[2];
const flags = new Set(process.argv.slice(3));
if (!campaignId) {
  console.error('usage: node scripts/fill-images.mjs <campaign-id> [--dry-run]');
  process.exit(2);
}
const dryRun = flags.has('--dry-run');
const onlyItems = flags.has('--items') && !flags.has('--locations');
const onlyLocations = flags.has('--locations') && !flags.has('--items');

const password = readFileSync('.admin-password', 'utf8').trim();
const page = await (await fetch(`${BASE}/login`)).text();
const question = (page.match(/id="captcha-question">([^<]+)</) || [])[1] || '';
const captchaId = (page.match(/id="captcha-id"[^>]*value="([^"]+)"/) || [])[1] || '';
const [a, b] = question.split('+').map((value) => Number(value.trim()));
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password, captchaId, captchaAnswer: String(a + b) }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) throw new Error('login failed');

const api = async (path, options = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${body.error ?? response.status}`);
  return body;
};

const data = await api(`/api/campaign/${encodeURIComponent(campaignId)}`);
const state = data.state;
const jobs = [];
if (!onlyItems && !onlyLocations) {
  if (!state.hero.card) jobs.push({ mode: 'hero', name: state.hero.name, label: 'герой' });
  for (const actor of [...(state.party ?? []), ...(state.npcs ?? []).filter((npc) => !npc.archived)]) {
    if (!actor.card) jobs.push({ mode: 'card', name: actor.name, label: `карточка ${actor.name}` });
  }
}
if (!onlyLocations) {
  for (const item of state.items ?? []) {
    if (!item.card) jobs.push({ mode: 'item', name: item.name, label: `предмет ${item.name}` });
  }
}
if (!onlyItems) {
  for (const location of state.locations ?? []) {
    if (!location.card) jobs.push({ mode: 'location', name: location.name, label: `локация ${location.name}` });
  }
}

if (dryRun) {
  console.log(`кампания «${campaignId}»: ${jobs.length} картинок`);
  for (const job of jobs) console.log(`- ${job.label} (${job.mode})`);
  process.exit(0);
}

let done = 0;
for (const job of jobs) {
  const started = Date.now();
  try {
    const result = await api(`/api/campaign/${encodeURIComponent(campaignId)}/image`, {
      method: 'POST',
      body: JSON.stringify({ mode: job.mode, name: job.name }),
    });
    done += 1;
    console.log(`[${done}/${jobs.length}] ${job.label} → ${result.url} (${Math.round((Date.now() - started) / 1000)}s)`);
  } catch (error) {
    console.error(`[${done + 1}/${jobs.length}] ${job.label}: ${error.message}`);
  }
}
console.log(`готово: ${done}/${jobs.length}`);
