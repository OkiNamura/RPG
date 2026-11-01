/**
 * Управление локальным сервером Omika.
 *
 *   node scripts/dev.mjs status
 *   node scripts/dev.mjs start
 *   node scripts/dev.mjs stop
 *   node scripts/dev.mjs restart
 *
 * PORT по умолчанию 7801, лог — data/dev-server.log.
 */
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 7801);
const LOG = join(ROOT, 'data', 'dev-server.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidsOnPort() {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes(`:${PORT}`) || !line.includes('LISTENING')) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/auth`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function status() {
  const pids = pidsOnPort();
  const ok = await health();
  console.log(`порт ${PORT}: ${ok ? 'отвечает' : 'не отвечает'}${pids.length ? `, pid ${pids.join(',')}` : ''}`);
  return ok;
}

function stop() {
  const pids = pidsOnPort();
  if (pids.length === 0) {
    console.log(`порт ${PORT}: не занят`);
    return;
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      console.log(`остановлен pid ${pid}`);
    } catch (err) {
      console.error(`не удалось остановить ${pid}: ${err.message}`);
    }
  }
}

async function start() {
  if (await health()) {
    const pids = pidsOnPort();
    console.log(`уже работает на ${PORT}${pids.length ? ` (pid ${pids.join(',')})` : ''}`);
    return;
  }
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, `\n=== ${new Date().toISOString()} start :${PORT} ===\n`);
  const child = spawn(process.execPath, [join(ROOT, 'src', 'server.ts')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  child.unref();
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    if (await health()) {
      console.log(`запущен на ${PORT}, pid ${pidsOnPort().join(',') || child.pid}, лог ${LOG}`);
      return;
    }
  }
  console.error(`не поднялся на ${PORT}, смотри ${LOG}`);
  process.exitCode = 1;
}

const command = process.argv[2] ?? 'status';
if (command === 'status') await status();
else if (command === 'start') await start();
else if (command === 'stop') stop();
else if (command === 'restart') {
  stop();
  await sleep(500);
  await start();
} else {
  console.error('использование: node scripts/dev.mjs status|start|stop|restart');
  process.exitCode = 2;
}
