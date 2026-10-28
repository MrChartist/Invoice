#!/usr/bin/env node
/**
 * R6-A4: the newest What's-new entry (`src/lib/whats-new.ts`, newest first) must carry the package.json version, so a
 * version bump without release notes fails the build. Run by `postbuild`.
 */
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const src = readFileSync(new URL('src/lib/whats-new.ts', root), 'utf8');
const list = src.slice(src.indexOf('WHATS_NEW'));
const newest = /version:\s*'([^']+)'/.exec(list)?.[1];

if (newest !== pkg.version) {
  console.error(`check-whats-new: the newest entry in src/lib/whats-new.ts is ${newest ?? '(none)'}, but package.json says ${pkg.version}. Add release notes for ${pkg.version}.`);
  process.exit(1);
}
console.log(`check-whats-new: ok (${pkg.version})`);
