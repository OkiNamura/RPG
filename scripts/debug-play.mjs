/**
 * Диагностика: открыть игру в jsdom и показать ошибки клиента.
 *   node scripts/debug-play.mjs "<id кампании>"
 */

import { JSDOM } from 'jsdom';

const BASE = 'http://127.0.0.1:7801';
const id = process.argv[2];
if (!id) {
  console.error('укажи id кампании');
  process.exit(1);
}

const errors = [];
const logs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const html = await (await fetch(BASE + '/')).text();
const dom = new JSDOM(html, {
  url: `${BASE}/#/play/${encodeURIComponent(id)}`,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

window.fetch = (url, options) => fetch(new URL(url, BASE), options);
window.scrollTo = () => undefined;
window.HTMLElement.prototype.scrollTo = () => undefined;
window.TextDecoder ??= TextDecoder;
window.ReadableStream ??= ReadableStream;
window.console.error = (...args) => logs.push(args.join(' '));

window.addEventListener('error', (e) => errors.push(`window.error: ${e.message}\n${e.error?.stack ?? ''}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${e.reason?.stack ?? e.reason}`));

window.eval(await (await fetch(BASE + '/app.js')).text());

await wait(3000);

const doc = window.document;
console.log('view пуст:', doc.getElementById('view')?.children.length === 0);
console.log('сообщений в ленте:', doc.querySelectorAll('.msg').length);
console.log('панель:', Boolean(doc.querySelector('.panel')));
console.log('ошибок:', errors.length);
for (const e of errors) console.log('---\n' + e);
if (logs.length) console.log('console.error:\n' + logs.join('\n'));
process.exit(errors.length ? 1 : 0);
