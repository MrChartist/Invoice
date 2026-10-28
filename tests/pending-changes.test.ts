/**
 * R16-D4: the 57th GST Council's recommendations are a pending list (notes), never rule rows. No rule file or reader
 * applies a pending row; every row names its source and CA id; `pendingFor` shows a row up to 6 months before its
 * proposed start and hides it once notified.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PENDING_CHANGES, addMonths, pendingAll, pendingFor, pendingLine, type PendingChange } from '../src/lib/pending-changes.ts';

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

test('no rule file (and no lib reader) imports pending-changes.ts', () => {
  const importers = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && /pending-changes['"]/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/'));
  assert.ok(!importers.some((f) => /-rules\.ts$|gst-penalties\.ts$|tax-rules\.ts$|ita2025\.ts$/.test(f)), importers.join(', '));
  assert.deepEqual(importers.filter((f) => f.startsWith('src/lib/')), [], 'only screens load it (lazily) — no calculation reads it');
  for (const f of importers) assert.doesNotMatch(readFileSync(f, 'utf8'), /^import (?!type )[^\n]*pending-changes['"]/m, `${f}: lazy import (or type-only)`);
});

test('every row: source, CA id (PF), recommendation date, not notified; ids unique', () => {
  assert.ok(PENDING_CHANGES.length >= 2);
  assert.equal(new Set(PENDING_CHANGES.map((r) => r.id)).size, PENDING_CHANGES.length);
  for (const r of PENDING_CHANGES) {
    assert.match(r.source, /^PIB 8 Oct 2026 /, r.id);
    assert.match(r.ca, /^PF\d+$/, r.id);
    assert.equal(r.recommended_on, '2026-10-08');
    assert.equal(r.notified, false);
    assert.ok(pendingLine(r).endsWith(`(${r.ca})`) && pendingLine(r).length > r.ca.length + 10, r.id);
  }
  // Cut 1 keeps at least the refund paper and the late-fee card.
  assert.ok(PENDING_CHANGES.some((r) => r.area === 'refund' && r.proposed_from === '2026-11-01'));
  assert.ok(PENDING_CHANGES.some((r) => r.area === 'latefee'));
});

test('pendingFor: shown up to 6 months before the proposed start; hidden once notified', () => {
  assert.equal(addMonths('2026-10-28', 6), '2027-04-28');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
  assert.deepEqual(pendingFor('refund', '2026-10-28').map((r) => r.id), ['pf1_services', 'pf1_capital']);
  assert.deepEqual(pendingFor('refund', '2026-09-30').map((r) => r.id), ['pf1_services'], 'capital goods (Apr 2027) not yet within 6 months');
  assert.deepEqual(pendingFor('refund', '2026-04-30').map((r) => r.id), [], 'too early for either');
  assert.deepEqual(pendingFor('latefee', '2020-01-01').map((r) => r.id), ['pf3_latefee'], 'no proposed date → always shown');
  const notified: PendingChange[] = PENDING_CHANGES.map((r) => (r.id === 'pf3_latefee' ? { ...r, notified: 'N 99/2026-CT' } : r));
  assert.deepEqual(pendingFor('latefee', '2026-10-28', notified), []);
  assert.equal(pendingAll().length, PENDING_CHANGES.length);
});
