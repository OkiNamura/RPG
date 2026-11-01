/**
 * Отправка сообщения владельцу Omika в Telegram.
 *
 * node scripts/telegram-send.mjs "Тикет #... выполнен"
 * или текст из stdin.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const env = await readFile(join(ROOT, '.telegram.env'), 'utf8').catch(() => '');
const get = (key) => (env.match(new RegExp(`^${key}=(.+)$`, 'm')) ?? [])[1]?.trim() ?? '';
const token = get('TELEGRAM_BOT_TOKEN');
const chatId = get('TELEGRAM_ALLOWED_USER_ID');

let text = process.argv.slice(2).join(' ').trim();
if (!text && !process.stdin.isTTY) {
  for await (const chunk of process.stdin) text += chunk;
  text = text.trim();
}

if (!token || !/^\d+$/.test(chatId)) {
  console.error('Нет TELEGRAM_BOT_TOKEN или числового TELEGRAM_ALLOWED_USER_ID');
  process.exit(1);
}
if (!text) {
  console.error('Пустое сообщение');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
});
const data = await res.json().catch(() => ({}));
if (!data.ok) {
  console.error('Telegram:', data.description ?? res.status);
  process.exit(1);
}
console.log('отправлено');
