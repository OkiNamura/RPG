/**
 * Простая авторизация для self-hosted игры.
 *
 * Один пароль из OMIKA_PASSWORD. Сессия — подписанная HttpOnly-cookie.
 * Без OMIKA_PASSWORD авторизация выключена (удобно для локальной разработки).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE = 'omika_session';
const MAX_AGE = 30 * 24 * 60 * 60;

export function authEnabled(): boolean {
  return Boolean(String(process.env.OMIKA_PASSWORD ?? '').trim());
}

function password(): string {
  return String(process.env.OMIKA_PASSWORD ?? '').trim();
}

function secret(): string {
  return String(process.env.OMIKA_SESSION_SECRET ?? '').trim() || `${password()}:omika-session`;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function createSessionToken(now = Date.now()): string {
  const payload = `${Math.floor(now / 1000) + MAX_AGE}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string, now = Date.now()): boolean {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return false;
  const [expires, nonce, signature] = parts;
  const expected = sign(`${expires}.${nonce}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expires) > Math.floor(now / 1000);
}

export function checkPassword(input: string): boolean {
  const expected = password();
  if (!expected) return true;
  const a = createHash('sha256').update(String(input ?? '')).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export function requestSession(req: {
  headers: { cookie?: string };
}): string {
  return parseCookies(req.headers.cookie)[AUTH_COOKIE] ?? '';
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// --- защита от перебора пароля -------------------------------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();

export function allowLogin(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 10;
}

// --- капча -------------------------------------------------------------------

interface Captcha {
  question: string;
  answer: number;
  expiresAt: number;
}

const captchas = new Map<string, Captcha>();

function cleanupCaptchas(now: number): void {
  for (const [id, captcha] of captchas) {
    if (captcha.expiresAt < now) captchas.delete(id);
  }
  while (captchas.size > 500) {
    const first = captchas.keys().next().value;
    if (!first) break;
    captchas.delete(first);
  }
}

export function turnstileSiteKey(): string {
  return String(process.env.TURNSTILE_SITE_KEY ?? '').trim();
}

export function turnstileConfigured(): boolean {
  return Boolean(turnstileSiteKey() && String(process.env.TURNSTILE_SECRET ?? '').trim());
}

export async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = String(process.env.TURNSTILE_SECRET ?? '').trim();
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: String(token), remoteip: ip });
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export function createCaptcha(): { id: string; question: string } {
  const now = Date.now();
  cleanupCaptchas(now);
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const id = randomBytes(12).toString('base64url');
  captchas.set(id, { question: `${a} + ${b}`, answer: a + b, expiresAt: now + 10 * 60 * 1000 });
  return { id, question: `${a} + ${b}` };
}

export function verifyCaptcha(id: string, answer: string): boolean {
  const now = Date.now();
  cleanupCaptchas(now);
  const captcha = captchas.get(String(id ?? ''));
  if (!captcha) return false;
  captchas.delete(String(id));
  if (captcha.expiresAt < now) return false;
  return Number(String(answer ?? '').trim()) === captcha.answer;
}

export function loginPage(captcha: { id: string; question: string }): string {
  const siteKey = turnstileSiteKey();
  if (siteKey) return loginPageWithTurnstile(siteKey, captcha);
  const question = captcha.question.replace(/[^0-9+\s]/g, '');
  const id = captcha.id.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OMIKA — вход</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0c; color: #e8e3d8;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
  main { width: min(360px, calc(100vw - 32px)); padding: 24px; border: 1px solid #26262c; border-radius: 14px; background: #101013; }
  h1 { margin: 0 0 6px; font: 26px Georgia, serif; letter-spacing: .08em; }
  p { margin: 0 0 18px; color: #a8a196; font-size: 14px; }
  input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #33333b; background: #0b0b0e; color: #e8e3d8; font: inherit; }
  .captcha { margin-top: 10px; padding: 10px 12px; border: 1px solid #26262c; border-radius: 8px; color: #a8a196; font-size: 13px; }
  .captcha b { color: #e8e3d8; font-size: 16px; }
  button { width: 100%; margin-top: 12px; padding: 12px; border-radius: 8px; border: 1px solid #8a723f; background: #c9a45c; color: #17130c; font: inherit; font-weight: 600; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: .6; }
  .err { min-height: 20px; margin-top: 10px; color: #d8897b; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>OMIKA</h1>
  <p>Вход в игру. Пароль выдаётся владельцем сервера.</p>
  <form id="form">
    <input id="password" type="password" autocomplete="current-password" placeholder="Пароль" autofocus>
    <div class="captcha">Проверка: <b id="captcha-question">${question}</b> = <input id="captcha-answer" inputmode="numeric" autocomplete="off" placeholder="ответ" style="margin-top:8px"></div>
    <input id="captcha-id" type="hidden" value="${id}">
    <button id="submit" type="submit">Войти</button>
    <div class="err" id="error"></div>
  </form>
</main>
<script>
  const form = document.getElementById('form');
  const input = document.getElementById('password');
  const answer = document.getElementById('captcha-answer');
  const captchaId = document.getElementById('captcha-id');
  const question = document.getElementById('captcha-question');
  const error = document.getElementById('error');
  const submit = document.getElementById('submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: input.value,
          captchaId: captchaId.value,
          captchaAnswer: answer.value,
        }),
      });
      if (res.ok) { location.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      error.textContent = data.error || 'Неверный пароль';
      if (data.captcha) {
        captchaId.value = data.captcha.id;
        question.textContent = data.captcha.question;
        answer.value = '';
      }
    } catch {
      error.textContent = 'Сервер недоступен';
    } finally {
      submit.disabled = false;
    }
  });
</script>
</body>
</html>`;
}

function loginPageWithTurnstile(siteKey: string, captcha: { id: string; question: string }): string {
  const key = siteKey.replace(/[^A-Za-z0-9_-]/g, '');
  const question = captcha.question.replace(/[^0-9+\\s]/g, '');
  const id = captcha.id.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OMIKA — вход</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0a0a0c; color: #e8e3d8;
    font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
  main { width: min(360px, calc(100vw - 32px)); padding: 24px; border: 1px solid #26262c; border-radius: 14px; background: #101013; }
  h1 { margin: 0 0 6px; font: 26px Georgia, serif; letter-spacing: .08em; }
  p { margin: 0 0 18px; color: #a8a196; font-size: 14px; }
  input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #33333b; background: #0b0b0e; color: #e8e3d8; font: inherit; }
  .turnstile { margin-top: 12px; min-height: 65px; }
  .captcha { margin-top: 10px; padding: 10px 12px; border: 1px solid #26262c; border-radius: 8px; color: #a8a196; font-size: 13px; }
  .captcha b { color: #e8e3d8; font-size: 16px; }
  button { width: 100%; margin-top: 12px; padding: 12px; border-radius: 8px; border: 1px solid #8a723f; background: #c9a45c; color: #17130c; font: inherit; font-weight: 600; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: .6; }
  .err { min-height: 20px; margin-top: 10px; color: #d8897b; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>OMIKA</h1>
  <p>Вход в игру. Пароль выдаётся владельцем сервера.</p>
  <form id="form">
    <input id="password" type="password" autocomplete="current-password" placeholder="Пароль" autofocus>
    <div class="turnstile cf-turnstile" data-sitekey="${key}" data-theme="dark"></div>
    <div class="captcha">Если Cloudflare не загрузился: <b id="captcha-question">${question}</b> = <input id="captcha-answer" inputmode="numeric" autocomplete="off" placeholder="ответ" style="margin-top:8px"></div>
    <input id="captcha-id" type="hidden" value="${id}">
    <button id="submit" type="submit">Войти</button>
    <div class="err" id="error"></div>
  </form>
</main>
<script>
  const form = document.getElementById('form');
  const input = document.getElementById('password');
  const error = document.getElementById('error');
  const submit = document.getElementById('submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    const token = window.turnstile ? turnstile.getResponse() : '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: input.value,
          turnstileToken: token,
          captchaId: document.getElementById('captcha-id').value,
          captchaAnswer: document.getElementById('captcha-answer').value,
        }),
      });
      if (res.ok) { location.replace('/'); return; }
      const data = await res.json().catch(() => ({}));
      error.textContent = data.error || 'Неверный пароль';
      if (window.turnstile) turnstile.reset();
      if (data.captcha) {
        document.getElementById('captcha-id').value = data.captcha.id;
        document.getElementById('captcha-question').textContent = data.captcha.question;
        document.getElementById('captcha-answer').value = '';
      }
    } catch {
      error.textContent = 'Сервер недоступен';
    } finally {
      submit.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
