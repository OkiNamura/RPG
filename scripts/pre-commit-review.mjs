#!/usr/bin/env node
// Проверка pre-commit: коммит разрешён только с OK-ревью того же диффа.
// Хэш считается по git diff HEAD (все изменения, которые войдут в коммит).
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const approvalsPath = join(homedir(), '.dsh-plugins', 'claude-pair', 'approvals.json');
const libPath = process.env.CLAUDE_PAIR_LIB || join(homedir(), '.dsh-plugins', 'claude-pair', 'lib', 'claude.mjs');

if (process.env.OMIKA_SKIP_REVIEW === '1') {
  const reason = String(process.env.OMIKA_SKIP_REASON ?? '').trim();
  if (!reason) {
    console.error('commit gate: OMIKA_SKIP_REVIEW=1 требует OMIKA_SKIP_REASON');
    process.exit(1);
  }
  try {
    appendFileSync(join(root, 'docs', 'reviews', 'skips.log'), `${new Date().toISOString()} ${reason}\n`);
  } catch {
    /* best effort */
  }
  process.exit(0);
}

let buildDiff;
try {
  ({ buildDiff } = await import(pathToFileURL(libPath).href));
} catch (error) {
  console.error(`commit gate: нет общего bridge (${libPath}): ${error.message}`);
  process.exit(1);
}

let diff = '';
try {
  diff = buildDiff(root);
} catch {
  console.error('commit gate: не удалось получить git diff HEAD');
  process.exit(1);
}
if (!diff.trim()) process.exit(0);

const hash = createHash('sha256').update(diff).digest('hex');
let approvals = {};
try {
  approvals = JSON.parse(readFileSync(approvalsPath, 'utf8'));
} catch {
  /* no approvals */
}
const approval = approvals[hash];
if (approval && approval.verdict === 'ОК') process.exit(0);

console.error('commit gate: нет OK-ревью для этого диффа.');
console.error(`hash: ${hash}`);
console.error('Сначала: node scripts/claude-review.mjs diff "<задача>" HEAD');
console.error('Или осознанно: OMIKA_SKIP_REVIEW=1 OMIKA_SKIP_REASON="причина" git commit ...');
process.exit(1);
