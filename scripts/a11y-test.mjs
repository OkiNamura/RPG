#!/usr/bin/env node
/**
 * Проверка доступности основных экранов.
 * Запускается вручную: node scripts/a11y-test.mjs
 */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.OMIKA_BASE || 'https://game.okinamura.com';
const password = readFileSync(new URL('../.admin-password', import.meta.url), 'utf8').trim();
const browser = await chromium.launch({
  args: ['--host-resolver-rules=MAP game.okinamura.com 104.21.80.40'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const question = await page.locator('#captcha-question').innerText();
const [a, b] = question.split('+').map((part) => Number(part.trim()));
await page.locator('#password').fill(password);
await page.locator('#captcha-answer').fill(String(a + b));
await page.locator('#submit').click();
await page.waitForTimeout(3000);

let total = 0;
for (const [name, hash, wait] of [
  ['stories', '#/stories', 1200],
  ['search', '#/search', 1200],
  ['cards', '#/templates', 2000],
  ['admin', '#/admin', 1500],
  ['play', '#/play/test-modern-child', 5000],
]) {
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(wait);
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  total += serious.length;
  if (!serious.length) {
    console.log(`✓ ${name}: критичных нарушений нет`);
    continue;
  }
  console.log(`! ${name}: ${serious.length}`);
  for (const violation of serious) {
    console.log(`  ${violation.impact}: ${violation.id} — ${violation.help}`);
    for (const node of violation.nodes.slice(0, 3)) console.log(`    ${node.target?.join(' ')}`);
  }
}

await browser.close();
if (total) {
  console.log(`\nкритичных нарушений: ${total}`);
  process.exitCode = 1;
} else {
  console.log('\nдоступность: критичных нарушений нет');
}
