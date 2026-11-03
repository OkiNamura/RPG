/** Быстрый аудит доступа и общих заголовков. */
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:7801';
const password = readFileSync('.admin-password', 'utf8').trim();
const page = await (await fetch(`${BASE}/login`)).text();
const q = (page.match(/id="captcha-question">([^<]+)</) || [])[1] || '';
const cid = (page.match(/id="captcha-id"[^>]*value="([^"]+)"/) || [])[1] || '';
const [a, b] = q.split('+').map((value) => Number(value.trim()));
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password, captchaId: cid, captchaAnswer: String(a + b) }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const checks = [];
const expect = async (name, path, status, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers });
  checks.push({ name, ok: res.status === status, status: res.status });
};
await expect('нет входа: кампании', '/api/campaigns', 401);
await expect('нет входа: админ-флаги', '/api/admin/features', 401);
await expect('битая cookie', '/api/campaigns', 401, { Cookie: 'omika_session=bad' });
const features = await fetch(`${BASE}/api/features`, { headers: { Cookie: cookie } });
checks.push({ name: 'флаги с входом', ok: features.status === 200, status: features.status });
checks.push({
  name: 'API без кэша',
  ok: (features.headers.get('cache-control') || '').includes('no-store'),
  status: features.headers.get('cache-control'),
});
const traversal = await fetch(`${BASE}/api/feedback/..%2F..%2Fdata/file/x.jpg`, {
  headers: { Cookie: cookie },
});
checks.push({ name: 'traversal заблокирован', ok: [400, 404].includes(traversal.status), status: traversal.status });
const root = await fetch(`${BASE}/`, { headers: { Cookie: cookie } });
checks.push({
  name: 'CSP на приложении',
  ok: /default-src/.test(root.headers.get('content-security-policy') || ''),
  status: root.status,
});
checks.push({
  name: 'X-Frame-Options',
  ok: root.headers.get('x-frame-options') === 'DENY',
  status: root.headers.get('x-frame-options'),
});
console.log(checks);
if (checks.some((check) => !check.ok)) process.exit(1);
