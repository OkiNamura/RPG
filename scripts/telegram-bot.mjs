/**
 * Telegram-приёмник фидбека для Omika.
 *
 * Запуск: node scripts/telegram-bot.mjs
 * Токен и ID владельца — .telegram.env
 *
 * Бот работает через long polling, без публичного webhook.
 * Принимает текст, фото и документы от одного разрешённого пользователя.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FEEDBACK = join(ROOT, 'data', 'feedback');
const OFFSET_FILE = join(ROOT, 'data', 'telegram-offset.json');

async function readEnv() {
  const text = await readFile(join(ROOT, '.telegram.env'), 'utf8').catch(() => '');
  const get = (key) =>
    (text.match(new RegExp(`^${key}=(.+)$`, 'm')) ?? [])[1]?.trim() ?? '';
  return { token: get('TELEGRAM_BOT_TOKEN'), allowed: get('TELEGRAM_ALLOWED_USER_ID') };
}

const env = await readEnv();
const rate = new Map();
if (!env.token) {
  console.error('Нет TELEGRAM_BOT_TOKEN в .telegram.env');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${env.token}`;

async function api(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    signal: AbortSignal.timeout(65_000),
  });
  return res.json();
}

function allowed(user) {
  if (!user) return false;
  if (/^-?\d+$/.test(env.allowed)) return String(user.id) === env.allowed;
  if (env.allowed.startsWith('@')) {
    return String(user.username ?? '').toLowerCase() === env.allowed.slice(1).toLowerCase();
  }
  return false;
}

async function offset() {
  try {
    const data = JSON.parse(await readFile(OFFSET_FILE, 'utf8'));
    return Number(data.offset) || 0;
  } catch {
    return 0;
  }
}

async function saveOffset(value) {
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(OFFSET_FILE, JSON.stringify({ offset: value }));
}

async function download(fileId, target) {
  const info = await api('getFile', { file_id: fileId });
  const filePath = info?.result?.file_path;
  if (!filePath) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${env.token}/${filePath}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 20 * 1024 * 1024) return null;
  await writeFile(target, data);
  return target;
}

function safeName(name, fallback) {
  const ext = /\.[a-z0-9]{1,6}$/i.exec(name)?.[0] ?? '';
  const base = name.slice(0, name.length - ext.length).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60);
  return `${base || fallback}${ext}`;
}

async function accept(message) {
  const user = message.from;
  const chat = message.chat;
  const text = String(message.text ?? message.caption ?? '').trim().slice(0, 20000);

  if (text === '/start') {
    await api('sendMessage', {
      chat_id: chat.id,
      text: allowed(user)
        ? 'Omika на связи. Присылай баг, скрин или ссылку на страницу.'
        : `Твой Telegram ID: ${user.id}\nUserName: @${user.username ?? '—'}\n\nДоступа пока нет. Передай этот ID владельцу бота.`,
    });
    return;
  }

  if (!allowed(user)) {
    return;
  }
  if (chat.type !== 'private' || String(chat.id) !== String(user.id)) {
    return;
  }

  const now = Date.now();
  const window = rate.get(user.id) ?? { count: 0, resetAt: now + 60 * 60 * 1000 };
  if (window.resetAt < now) {
    window.count = 0;
    window.resetAt = now + 60 * 60 * 1000;
  }
  window.count += 1;
  rate.set(user.id, window);
  if (window.count > 20) {
    await api('sendMessage', { chat_id: chat.id, text: 'Слишком часто. Попробуй позже.' });
    return;
  }

  const id = `tg-${Date.now()}-${message.message_id}`;
  const dir = join(FEEDBACK, id);
  await mkdir(dir, { recursive: true });

  const files = [];
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length) {
    const largest = photos[photos.length - 1];
    const target = join(dir, 'photo.jpg');
    if (await download(largest.file_id, target)) files.push('photo.jpg');
  }
  if (message.document) {
    const original = String(message.document.file_name ?? 'document.bin');
    const name = safeName(original, 'document.bin');
    const target = join(dir, name);
    if (await download(message.document.file_id, target)) files.push(name);
  }

  const ticket = {
    id,
    createdAt: new Date().toISOString(),
    text,
    user: { id: user.id, username: user.username ?? '', name: [user.first_name, user.last_name].filter(Boolean).join(' ') },
    chat: { id: chat.id, type: chat.type },
    messageId: message.message_id,
    files,
    raw: {
      photo: photos.map((p) => ({ file_id: p.file_id, width: p.width, height: p.height })),
      document: message.document ? { file_id: message.document.file_id, file_name: message.document.file_name, mime: message.document.mime_type } : null,
    },
  };
  await writeFile(join(dir, 'message.json'), JSON.stringify(ticket, null, 2));

  await api('sendMessage', {
    chat_id: chat.id,
    text: `Принято, тикет #${id}${files.length ? ` · файлов: ${files.length}` : ''}`,
  });
}

async function main() {
  const me = await api('getMe');
  if (!me.ok) {
    console.error('Telegram: бот не авторизован');
    process.exit(1);
  }
  console.log(`Telegram: @${me.result.username} · ожидаю сообщения`);
  await mkdir(FEEDBACK, { recursive: true });

  let updateOffset = await offset();
  for (;;) {
    try {
      const data = await api('getUpdates', {
        offset: updateOffset,
        timeout: 50,
        allowed_updates: ['message', 'edited_message'],
      });
      if (!data.ok) {
        console.error('Telegram: getUpdates', data.description ?? 'ошибка');
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const update of data.result ?? []) {
        updateOffset = Math.max(updateOffset, Number(update.update_id) + 1);
        const message = update.message ?? update.edited_message;
        if (!message) continue;
        await accept(message).catch((err) => console.error('Telegram: сообщение', err.message));
        await saveOffset(updateOffset);
      }
    } catch (err) {
      console.error('Telegram: сеть', err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();
