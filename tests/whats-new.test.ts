/** R6-A4: release notes bundled with the build and the "What's new" card rule. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WHATS_NEW, compareVersions, newestEntry, shouldShowCard } from '../src/lib/whats-new.ts';
import { APP_VERSION } from '../src/lib/app-version.ts';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const routes = new Set([...readFileSync(join(root, 'src/App.tsx'), 'utf8').matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1].replace(/\/\*$/, '')));

test('entries are newest first with unique versions, and the newest is the package.json version', () => {
  assert.ok(WHATS_NEW.length >= 4);
  assert.equal(new Set(WHATS_NEW.map((e) => e.version)).size, WHATS_NEW.length, 'unique versions');
  for (let i = 1; i < WHATS_NEW.length; i++) {
    assert.ok(compareVersions(WHATS_NEW[i - 1].version, WHATS_NEW[i].version) > 0, `${WHATS_NEW[i - 1].version} before ${WHATS_NEW[i].version}`);
    assert.ok(WHATS_NEW[i - 1].date >= WHATS_NEW[i].date, 'dates newest first');
  }
  assert.equal(newestEntry().version, pkg.version, 'scripts/check-whats-new.mjs would fail the build');
  for (const e of WHATS_NEW) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.items.length > 0 && e.label.trim());
    for (const it of e.items) assert.ok(it.title.trim() && /[ऀ-ॿ]/.test(it.hi), `${e.version}: ${it.title}`);
  }
});

test('every href opens a route in App.tsx', () => {
  for (const e of WHATS_NEW) for (const it of e.items) if (it.href) assert.ok(routes.has(it.href.split('?')[0]), `${e.version}: ${it.href}`);
});

test('shouldShowCard: fresh install no, older yes, same no', () => {
  assert.equal(shouldShowCard(null, '3.1.0'), false, 'fresh install never shows the card');
  assert.equal(shouldShowCard('', '3.1.0'), false);
  assert.equal(shouldShowCard(null, '3.1.0', true), true, 'a device that already had data before the seen-key existed');
  assert.equal(shouldShowCard('3.0.3', '3.1.0'), true, 'after an upgrade');
  assert.equal(shouldShowCard('3.1.0', '3.1.0'), false, 'already dismissed');
  assert.equal(shouldShowCard('3.2.0', '3.1.0'), false, 'a downgrade shows nothing');
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('3.1', '3.1.0'), 0);
});

test('the app version under node:test is a dev value (Vite defines the real one)', () => {
  assert.equal(APP_VERSION, '0.0.0-dev');
  assert.match(readFileSync(join(root, 'vite.config.ts'), 'utf8'), /__APP_VERSION__: JSON\.stringify\(pkg\.version\)/);
  assert.match(readFileSync(join(root, 'package.json'), 'utf8'), /check-whats-new\.mjs/);
});
