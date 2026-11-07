#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [, , stage = 'diff', task = ''] = process.argv;
const libPath = process.env.CLAUDE_PAIR_LIB || join(homedir(), '.dsh-plugins', 'claude-pair', 'lib', 'claude.mjs');
let lib;
try {
  lib = await import(pathToFileURL(libPath).href);
} catch (error) {
  console.error(`claude-pair: не удалось загрузить ${libPath}: ${error.message}`);
  process.exit(1);
}
try {
  const result = stage === 'plan'
    ? await lib.askClaude({ prompt: task, plan: task })
    : await lib.reviewDiff({ task });
  process.stdout.write(`${result.text}\n`);
  process.exit(result.ok ? 0 : 2);
} catch (error) {
  console.error(`claude-pair: ${error.message}`);
  process.exit(1);
}
