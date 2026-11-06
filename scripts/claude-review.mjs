#!/usr/bin/env node
// Вызов Claude как read-only ревьюера из DeepSeek Harness.
//
//   node scripts/claude-review.mjs plan "<задача>" [файл-с-планом]
//   node scripts/claude-review.mjs diff "<задача>" [база, по умолчанию HEAD~1]
//   node scripts/claude-review.mjs ping
//
// Claude читает файлы и git сам. Писать в репозиторий не может:
// разрешены только Read/Grep/Glob и git diff/log/show/status.
// Ответ — в stdout и в docs/reviews/<время>-<этап>.md.
// Код выхода: 0 = ОК, 2 = НЕ ОК, 1 = ошибка вызова.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [, , stage = 'diff', task = '', extra = ''] = process.argv;
const root = process.cwd();

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(join(root, '.env'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (match && match[1] === key) return match[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    /* .env нет */
  }
  return '';
}

function findClaudeOnWindows() {
  const base = join(process.env.LOCALAPPDATA ?? '', 'Claude-Data');
  if (!existsSync(base)) return null;
  let newest = null;
  let newestMs = -1;
  const stack = [{ dir: base, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 7) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'claude.exe') {
        try {
          const mtime = statSync(path).mtimeMs;
          if (mtime > newestMs) {
            newest = path;
            newestMs = mtime;
          }
        } catch {
          /* удалённый файл */
        }
      } else if (entry.isDirectory()) {
        stack.push({ dir: path, depth: depth + 1 });
      }
    }
  }
  return newest;
}

const claudeBin = envValue('CLAUDE_BIN')
  || (process.platform === 'win32' ? findClaudeOnWindows() : null)
  || 'claude';
const useShell = process.platform === 'win32' && (claudeBin === 'claude' || /\.(cmd|bat)$/i.test(claudeBin));

const RULES = `
Ты — ревьюер проекта (роль Claude из docs/PAIRING.md). Код пишет DeepSeek, ты только читаешь.
Перед ревью прочитай docs/CONTEXT.md (принятые решения, что нельзя ломать) и docs/PAIRING.md.
Не верь пересказам — смотри файлы и git сам. Секреты (.env*, *.env, .admin-password) не открывай.
Формат ответа строго:
ВЕРДИКТ: ОК | НЕ ОК
Блокеры: (файл:строка / сценарий, почему ломает, как проверить) или «нет»
Риски: ...
Не согласен: ...
Что не проверено: ...
«НЕ ОК» ставь только при наличии хотя бы одного блокера. Без общих слов.`.trim();

let prompt;
if (stage === 'ping') {
  prompt = 'Ответь одним словом: ok';
} else if (stage === 'plan') {
  const plan = extra && existsSync(extra) ? readFileSync(extra, 'utf8') : extra;
  prompt = `${RULES}\n\nЭТАП: ревью ПЛАНА до написания кода.\nЗадача: ${task}\n\nПлан DeepSeek:\n${plan || '(не передан — тогда вердикт НЕ ОК)'}\n\nПроверь: решает ли план задачу, не противоречит ли CONTEXT.md/TZ.md, не трогает ли лишнее, какие тесты нужны.`;
} else if (stage === 'diff') {
  const base = extra || 'HEAD~1';
  prompt = `${RULES}\n\nЭТАП: ревью ДИФФА после реализации и дебага.\nЗадача: ${task}\nСмотри: git diff ${base} (и git status для незакоммиченного). Открывай затронутые файлы целиком, где нужен контекст.\nИщи регрессии, edge cases, нарушения «что нельзя ломать», лишние изменения вне задачи.`;
} else {
  console.error('Этапы: plan | diff | ping');
  process.exit(1);
}

const args = [
  '-p',
  '--output-format', 'text',
  '--allowedTools', 'Read', 'Grep', 'Glob',
  'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git status:*)',
  '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
];

const child = spawn(claudeBin, args, { cwd: root, shell: useShell });
let out = '';
let err = '';
child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { err += d; });
child.stdin.end(prompt);

child.on('error', (e) => {
  console.error(`Не удалось запустить claude: ${e.message}\nУстановлен ли Claude Code и выполнен ли вход?`);
  process.exit(1);
});

child.on('close', (code) => {
  if (code !== 0) {
    console.error(err || `claude завершился с кодом ${code}`);
    process.exit(1);
  }
  if (stage === 'ping') process.exit(0);
  const dir = join(root, 'docs', 'reviews');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  writeFileSync(join(dir, `${stamp}-${stage}.md`), `# ${stage}: ${task}\n\n${out}\n`);
  process.exit(/ВЕРДИКТ:\s*НЕ\s*ОК/i.test(out) ? 2 : 0);
});
