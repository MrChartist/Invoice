/** R15-A4 (TV23): supply of manpower is "work" from 1 Apr 2026 — a dated, unverified label row and the picker hint. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MANPOWER_WORK_RULES, manpowerHint } from '../src/lib/tds-rules.ts';
import { ruleAt } from '../src/lib/tax-rules.ts';

test('manpower label row: null before 1 Apr 2026, contractor limb from then, unverified, append-only', () => {
  assert.equal(ruleAt(MANPOWER_WORK_RULES, '2026-03-31'), null);
  assert.match(ruleAt(MANPOWER_WORK_RULES, '2026-04-01') ?? '', /Sl\. 6\(i\) — contractor \/ supply of manpower \(Sec 402\(47\)/);
  const last = MANPOWER_WORK_RULES[MANPOWER_WORK_RULES.length - 1];
  assert.equal(last.from, '2026-04-01');
  assert.equal(last.verified, false);
  for (let i = 1; i < MANPOWER_WORK_RULES.length; i++) assert.ok(MANPOWER_WORK_RULES[i].from > MANPOWER_WORK_RULES[i - 1].from);
});

test('hint: only for manpower bills under the professional / technical limb, on or after 1 Apr 2026', () => {
  assert.ok(manpowerHint('Security guards — manpower supply', '194J', '2026-04-01'));
  assert.ok(manpowerHint('Man-power charges', '194J-T', '2026-06-10'));
  assert.equal(manpowerHint('Manpower supply', '194J', '2026-03-31'), null, 'before the change');
  assert.equal(manpowerHint('Manpower supply', '194C-2', '2026-06-10'), null, 'already the contractor limb');
  assert.equal(manpowerHint('Audit fees', '194J', '2026-06-10'), null);
  assert.equal(manpowerHint('Manpower', undefined, '2026-06-10'), null);
});
