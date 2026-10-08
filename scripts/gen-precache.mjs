#!/usr/bin/env node
/**
 * Post-build: emit dist/precache-manifest.json and stamp dist/sw.js with a build id.
 * Every file in dist/assets plus a small allow-list of root files is precached by sw.js,
 * so every route (including lazy chunks never visited online) works offline.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(dist)) {
  console.error('gen-precache: dist/ not found - run vite build first');
  process.exit(1);
}

const ROOT_FILES = [
  'offline.html',
  'manifest.json',
  'logo.png',
  'theme-init.js',
  'favicon.svg',
  'favicon.ico',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'branding/logo-horizontal-black.svg',
  'branding/logo-horizontal-white.svg',
];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = [{ url: '/', file: join(dist, 'index.html') }];
for (const f of ROOT_FILES) {
  if (existsSync(join(dist, f))) entries.push({ url: '/' + f, file: join(dist, f) });
}
for (const dir of ['fonts']) {
  if (!existsSync(join(dist, dir))) continue;
  for (const f of walk(join(dist, dir))) entries.push({ url: '/' + relative(dist, f).split(sep).join('/'), file: f });
}
if (existsSync(join(dist, 'assets'))) {
  for (const f of walk(join(dist, 'assets'))) {
    if (f.endsWith('.map')) continue;
    entries.push({ url: '/' + relative(dist, f).split(sep).join('/'), file: f });
  }
}

const hashes = entries.map((e) => ({
  url: e.url,
  hash: createHash('sha256').update(readFileSync(e.file)).digest('hex').slice(0, 16),
}));
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
// Worker logic changes must also roll the cache name.
const version = createHash('sha256')
  .update(hashes.map((f) => f.url + f.hash).join('\n') + sw)
  .digest('hex')
  .slice(0, 12);

writeFileSync(
  join(dist, 'precache-manifest.json'),
  JSON.stringify({ version, files: hashes.map((f) => f.url), hashes }, null, 1),
);

if (!sw.includes('__BUILD_ID__')) {
  console.error('gen-precache: __BUILD_ID__ placeholder missing from dist/sw.js');
  process.exit(1);
}
writeFileSync(swPath, sw.replace('__BUILD_ID__', version));
console.log(`gen-precache: ${hashes.length} files, build ${version}`);
