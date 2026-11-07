#!/usr/bin/env node
// Аудит ссылок: docs, HTML assets, локальные импорты скриптов.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

const root = process.cwd();
const problems = [];
const checked = new Set();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'data' || name === '.git') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function checkFile(from, raw) {
  if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw) || raw.startsWith('//')) return;
  const clean = raw.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('/api/') || clean.startsWith('/icons/')) return;
  const target = clean.startsWith('/')
    ? (existsSync(join(root, 'src', 'web', clean.slice(1))) ? join(root, 'src', 'web', clean.slice(1)) : join(root, clean.slice(1)))
    : resolve(dirname(from), clean);
  if (checked.has(target)) return;
  checked.add(target);
  if (!existsSync(target)) problems.push(`${from.replace(root + '\\', '')}: ${raw}`);
}

for (const file of walk(root)) {
  const ext = extname(file).toLowerCase();
  if (ext === '.md') {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) checkFile(file, match[1]);
  }
  if (ext === '.html') {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:src|href)="([^"]+)"/g)) checkFile(file, match[1]);
  }
  if (ext === '.mjs' || ext === '.js' || ext === '.ts') {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]);
      if (!checked.has(target)) {
        checked.add(target);
        if (!existsSync(target) && !existsSync(`${target}.ts`) && !existsSync(`${target}.js`) && !existsSync(`${target}.mjs`)) {
          problems.push(`${file.replace(root + '\\', '')}: import ${match[1]}`);
        }
      }
    }
  }
}

console.log(`проверено ссылок: ${checked.size}, битых: ${problems.length}`);
for (const problem of problems) console.log(`  ✗ ${problem}`);
process.exit(problems.length ? 1 : 0);
