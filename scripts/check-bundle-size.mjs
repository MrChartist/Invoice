#!/usr/bin/env node
/**
 * Bundle budget check (gzip). Fails CI when budgets are exceeded.
 *  - initial: JS the browser must download before first paint (entry + modulepreloads
 *             listed in dist/index.html).
 *  - entry:   the entry chunk alone.
 *  - total:   all JS in dist/assets (everything precached for offline).
 * Override with env BUDGET_INITIAL_GZ_KB, BUDGET_ENTRY_GZ_KB, BUDGET_TOTAL_GZ_KB.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const kb = (n) => n / 1024;
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const env = (k, d) => Number(process.env[k] ?? d);

const BUDGET_INITIAL = env('BUDGET_INITIAL_GZ_KB', 185);
const BUDGET_ENTRY = env('BUDGET_ENTRY_GZ_KB', 90);
const BUDGET_TOTAL = env('BUDGET_TOTAL_GZ_KB', 650);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
const entry = html.match(/<script[^>]+src="\/(assets\/[^"]+\.js)"/)?.[1];
const all = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));

const initialGz = initial.reduce((s, f) => s + gz(join(dist, f)), 0);
const entryGz = entry ? gz(join(dist, entry)) : 0;
const totalGz = all.reduce((s, f) => s + gz(join(dist, 'assets', f)), 0);

const rows = [
  ['initial JS (gz)', kb(initialGz), BUDGET_INITIAL],
  ['entry chunk (gz)', kb(entryGz), BUDGET_ENTRY],
  ['total JS (gz)', kb(totalGz), BUDGET_TOTAL],
];
let bad = false;
for (const [name, v, b] of rows) {
  const ok = v <= b;
  if (!ok) bad = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${v.toFixed(1).padStart(7)} kB / budget ${b} kB`);
}
console.log(`initial files: ${initial.join(', ')}`);
process.exit(bad ? 1 : 0);
