/** R6-A6: one-time screen tips and the in-app beta guide. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIPS, markSeen, parseSeen, shouldShowTip } from '../src/lib/help/tips.ts';
import { BETA_GUIDE } from '../src/lib/help/beta-guide.ts';

const root = join(import.meta.dirname, '..');
const routes = new Set([...readFileSync(join(root, 'src/App.tsx'), 'utf8').matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1].replace(/\/\*$/, '')));

test('every tip belongs to a real route, ids are unique, English and Hindi', () => {
  assert.ok(TIPS.length >= 10);
  assert.equal(new Set(TIPS.map((t) => t.id)).size, TIPS.length);
  for (const t of TIPS) {
    assert.ok(routes.has(t.route), `${t.id}: ${t.route} is not a route`);
    assert.ok(t.en.trim() && /[ऀ-ॿ]/.test(t.hi), `${t.id}: text`);
  }
});

test('every tip id is mounted on its page', () => {
  const mounted = new Set<string>();
  for (const f of ['pages/GstReports.tsx', 'pages/Tds.tsx', 'pages/Payroll.tsx', 'pages/Clients.tsx', 'pages/Expenses.tsx', 'pages/Pos.tsx', 'pages/InvoiceCreator.tsx', 'components/dashboard/DashboardStart.tsx']) {
    for (const m of readFileSync(join(root, 'src', f), 'utf8').matchAll(/<ScreenTip id="([^"]+)"/g)) mounted.add(m[1]);
  }
  // Books, Inventory, Gateway and Invoices are mounted by their owner (R6-B, §6 of the Round 6 PRD).
  for (const id of ['gst', 'tds', 'payroll', 'clients', 'expenses', 'pos', 'editor', 'dashboard']) assert.ok(mounted.has(id), `${id} not mounted`);
  for (const id of mounted) assert.ok(TIPS.some((t) => t.id === id), `unknown tip ${id}`);
});

test('seen / off logic', () => {
  assert.equal(shouldShowTip('gst', null, null), true, 'fresh device shows the tip');
  const seen = markSeen('gst', null);
  assert.deepEqual(parseSeen(seen), ['gst']);
  assert.equal(shouldShowTip('gst', seen, null), false, 'seen once → never again');
  assert.equal(shouldShowTip('pos', seen, null), true, 'other tips still show');
  assert.equal(markSeen('gst', seen), seen, 'marking twice changes nothing');
  assert.equal(shouldShowTip('pos', seen, '1'), false, '"Don\'t show tips" turns all off');
  assert.deepEqual(parseSeen('not json'), []);
  assert.deepEqual(parseSeen('{"a":1}'), []);
});

test('beta-guide.ts headings match docs/BETA_GUIDE.md ## headings', () => {
  const doc = [...readFileSync(join(root, 'docs/BETA_GUIDE.md'), 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(BETA_GUIDE.map((s) => s.heading), doc);
  for (const s of BETA_GUIDE) {
    assert.ok(s.hiHeading.trim() && s.lines.length, s.heading);
    for (const l of s.links ?? []) assert.ok(routes.has(l.href.split('?')[0]), `${s.heading}: ${l.href}`);
  }
  assert.ok(BETA_GUIDE.some((s) => s.report), 'the guide ends with how to report');
  assert.ok(BETA_GUIDE.some((s) => /verify with your CA/i.test(s.lines.join(' '))), 'known limits keep the CA wording');
});
