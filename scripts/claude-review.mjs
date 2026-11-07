#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const [, , stage = 'diff', task = '', extra = ''] = process.argv;
const libPath = process.env.CLAUDE_PAIR_LIB || join(homedir(), 'dsh-plugins', 'claude-pair', 'lib', 'claude.mjs');
let lib;
try {
  lib = await import(pathToFileURL(libPath).href);
} catch (error) {
  console.error(`claude-pair: не удалось загрузить ${libPath}: ${error.message}`);
  process.exit(1);
}

function exitFor(result, allowOkWithoutVerdict = false) {
  if (result.verdict === 'ОК') process.exit(0);
  if (result.verdict === 'НЕ ОК') process.exit(2);
  if (allowOkWithoutVerdict && result.ok) process.exit(0);
  process.exit(1);
}

try {
  if (stage === 'ping') {
    const result = await lib.askClaude({ prompt: 'Ответь одним словом: ok' });
    process.stdout.write(`${result.text}\n`);
    exitFor(result, true);
  }
  if (stage === 'plan') {
    const plans = resolve('docs', 'plans');
    const candidate = extra ? resolve(extra) : '';
    const plan = candidate && candidate.startsWith(`${plans}${sep}`) && existsSync(candidate)
      ? readFileSync(candidate, 'utf8')
      : extra;
    const result = await lib.askClaude({ prompt: task, plan });
    process.stdout.write(`${result.text}\n`);
    exitFor(result);
  }
  if (stage === 'diff') {
    const result = await lib.reviewDiff({ task, base: extra || undefined });
    process.stdout.write(`${result.text}\n`);
    exitFor(result);
  }
  console.error('Этапы: plan | diff | ping');
  process.exit(1);
} catch (error) {
  console.error(`claude-pair: ${error.message}`);
  process.exit(1);
}
