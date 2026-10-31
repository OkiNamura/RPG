/**
 * Скриншот страницы игры.
 *
 * Использование:
 *   node scripts/shot.mjs "/#/core" core
 *   node scripts/shot.mjs "/#/play/e2e-3-mvve2lpn" play
 *   node scripts/shot.mjs "/#/view/e2e-3-mvve2lpn" container
 *
 * BASE: OMIKA_BASE (по умолчанию http://127.0.0.1:7801)
 * Вывод: .shots/<name>.png + консольные ошибки в stdout.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.OMIKA_BASE ?? 'http://127.0.0.1:7801';
const [, , route = '/', name = 'shot', ...rest] = process.argv;
const width = Number(process.env.SHOT_W ?? 1440);
const height = Number(process.env.SHOT_H ?? 900);

const url = `${BASE}${route.startsWith('/') ? '' : '/'}${route}`;
await mkdir('.shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((err) => {
  errors.push(`goto: ${err.message}`);
});
await page.waitForTimeout(1200);

// Опциональные действия: --click "selector" можно повторять.
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--click' && rest[i + 1]) {
    await page.click(rest[i + 1]).catch((err) => errors.push(`click ${rest[i + 1]}: ${err.message}`));
    await page.waitForTimeout(600);
  }
}

const out = `.shots/${name}.png`;
await page.screenshot({ path: out, fullPage: true });
console.log(`скриншот: ${out} (${width}×${height})`);
if (errors.length) {
  console.log('ошибки страницы:');
  for (const e of errors.slice(0, 20)) console.log(' -', e);
} else {
  console.log('ошибок в консоли нет');
}
await browser.close();
