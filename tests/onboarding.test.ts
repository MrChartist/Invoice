import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { answersFrom, applyAnswers, shouldShowWizard, stepProblem } from '../src/lib/onboarding.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import type { AppSettings } from '../src/lib/localDb.ts';
import { buildChecklist } from '../src/lib/checklist.ts';
import { allSteps, cardSteps, normalizeProgress, showCard, withSkipped, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';

const GSTIN = '27AAPFU0939F1Z' + gstinChecksumChar('27AAPFU0939F1Z');
const settings = { profiles: [{ id: 'p1', companyName: '', bankName: '' }, { id: 'p2', companyName: 'Other' }], activeProfileId: 'p1', onboarded: false } as unknown as AppSettings;
const base = { ...answersFrom(null, 'classic_orange'), companyName: 'Ravi Traders', stateCode: '' };

test('each step blocks only on what it asks for', () => {
  assert.match(stepProblem('business', { ...base, companyName: ' ' }), /name/);
  assert.match(stepProblem('business', { ...base, pin: '4006' }), /6 digits/);
  assert.equal(stepProblem('business', base), '');
  assert.match(stepProblem('gst', { ...base, gstRegistered: false }), /state/);
  assert.equal(stepProblem('gst', { ...base, gstRegistered: false, stateCode: '27' }), '');
  assert.match(stepProblem('gst', { ...base, gstRegistered: true, companyGstin: '27AAPFU0939F1ZX' }), /checksum|format/i);
  assert.equal(stepProblem('gst', { ...base, gstRegistered: true, companyGstin: GSTIN }), '');
  assert.match(stepProblem('payment', { ...base, upiId: 'nope' }), /UPI/);
  assert.match(stepProblem('payment', { ...base, ifsc: 'HDFC1234' }), /IFSC/);
  assert.equal(stepProblem('payment', base), '', 'payment details are optional');
});

test('applyAnswers fills the active profile only, derives the state from the GSTIN and marks onboarded', () => {
  const out = applyAnswers(settings, { ...base, gstRegistered: true, companyGstin: GSTIN.toLowerCase(), upiId: 'ravi@okhdfc', accountNumber: '1234 5678 90', ifsc: 'hdfc0001234' });
  const p = out.profiles[0];
  assert.equal(out.onboarded, true);
  assert.equal(p.companyName, 'Ravi Traders');
  assert.equal(p.companyGstin, GSTIN);
  assert.equal(p.stateCode, '27');
  assert.equal(p.accountNumber, '1234567890');
  assert.equal(p.ifsc, 'HDFC0001234');
  assert.equal(p.accountName, 'Ravi Traders', 'account name defaults to the business name');
  assert.equal(out.profiles[1].companyName, 'Other');
  // Not registered: GSTIN dropped even if typed, chosen state kept.
  const unreg = applyAnswers(settings, { ...base, gstRegistered: false, companyGstin: GSTIN, stateCode: '29' }).profiles[0];
  assert.equal(unreg.companyGstin, '');
  assert.equal(unreg.stateCode, '29');
});

test('the wizard appears only for a brand-new account', () => {
  assert.equal(shouldShowWizard({ onboarded: false }, 0), true);
  assert.equal(shouldShowWizard({ onboarded: true }, 0), false);
  assert.equal(shouldShowWizard({ onboarded: false }, 3), false, 'existing users with data are never interrupted');
});

/* ── R6-A1 setup checklist v3 ─────────────────────────────────────────────── */

const none: ChecklistFactsV3 = { profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 };
const ctxOf = (businessType: string | undefined, over: Partial<ChecklistCtx> = {}): ChecklistCtx => ({ businessType, packs: [], modules: null, role: 'owner', gstRegistered: true, ...over });
const kinds = (f: ChecklistFactsV3, c: ChecklistCtx) => allSteps(f, c).map((s) => s.key);

test('checklist v3: each business type gets its documented steps', () => {
  assert.deepEqual(kinds(none, ctxOf('kirana', { modules: new Set(['pos', 'inventory']) })), ['profile', 'retailProfile', 'item', 'posbill', 'whatsapp', 'payment', 'backup'], 'kirana (no GST module): no client / invoice, a POS bill; R9: "Pick your shop" until a shop is chosen');
  assert.deepEqual(kinds(none, ctxOf('full')), ['profile', 'opening', 'import', 'client', 'item', 'invoice', 'payment', 'gstPeriod', 'backup']);
  assert.deepEqual(kinds(none, ctxOf(undefined)), kinds(none, ctxOf('full')), 'an existing company without a type is "full"');
  assert.deepEqual(kinds(none, ctxOf('services')), ['profile', 'client', 'item', 'invoice', 'whatsapp', 'payment', 'gstPeriod', 'backup']);
  assert.deepEqual(kinds(none, ctxOf('wholesale')), ['profile', 'tradeProfile', 'opening', 'import', 'client', 'item', 'invoice', 'whatsapp', 'payment', 'gstPeriod', 'backup'], 'R8-C: "Pick your trade" until a trade profile is chosen');
  assert.deepEqual(kinds(none, ctxOf('wholesale', { tradeKind: 'wholesaler' })), ['profile', 'opening', 'import', 'client', 'item', 'invoice', 'whatsapp', 'payment', 'gstPeriod', 'backup']);
  assert.deepEqual(kinds(none, ctxOf('restaurant')), ['profile', 'client', 'item', 'posbill', 'invoice', 'payment', 'gstPeriod', 'backup']);
  assert.deepEqual(kinds(none, ctxOf('manufacturer', { gstRegistered: false })), ['profile', 'opening', 'client', 'item', 'invoice', 'payment', 'backup'], 'no GSTIN: no GST step');
  const item = allSteps(none, ctxOf('services', { modules: new Set(['recurring']) })).find((s) => s.kind === 'item')!;
  assert.equal(item.to, '/settings?tab=items', 'no inventory module: the catalogue');
  assert.equal(allSteps(none, ctxOf('full')).find((s) => s.kind === 'item')!.to, '/inventory?new=1');
  assert.equal(allSteps({ ...none, stockItems: 2 }, ctxOf('full')).find((s) => s.kind === 'item')!.done, true, 'a stock item counts when inventory is on');
});

test('checklist v3: a pack adds its first-record step; at most 7 shown, open steps first', () => {
  const c = ctxOf('transport', { packs: ['transport'] });
  const steps = allSteps(none, c);
  const pack = steps.find((s) => s.kind === 'packFirst')!;
  assert.equal(pack.key, 'packFirst:transport');
  assert.equal(pack.to, '/distribution?tab=transport');
  assert.equal(allSteps({ ...none, packRecords: { transport: 1 } }, c).find((s) => s.kind === 'packFirst')!.done, true);
  assert.ok(steps.some((s) => s.kind === 'opening'), 'any pack asks for opening balances');
  const card = buildChecklist(none, ctxOf('full'));
  assert.equal(card.length, 7);
  assert.deepEqual(card.map((s) => s.key), ['profile', 'opening', 'import', 'client', 'item', 'invoice', 'payment']);
  const later = buildChecklist({ ...none, profileReady: true, clients: 1, items: 1, invoices: 1 }, ctxOf('full'));
  assert.ok(later.some((s) => s.key === 'backup'), 'done steps give their slots to open ones');
  assert.ok(later.length <= 7);
});

test('checklist v3: skipped counts as done and shows "skipped"; hidden hides the card', () => {
  const c = ctxOf('services');
  const p = withSkipped({ skipped: [] }, 'whatsapp', true);
  const s = allSteps(none, c, p).find((x) => x.key === 'whatsapp')!;
  assert.equal(s.done, true);
  assert.equal(s.skipped, true);
  assert.equal(allSteps(none, c, withSkipped(p, 'whatsapp', false)).find((x) => x.key === 'whatsapp')!.done, false, 'undo skip');
  const steps = cardSteps(allSteps(none, c, p));
  assert.equal(showCard(steps, p, 'owner'), true);
  assert.equal(showCard(steps, { ...p, hidden_at: '2026-10-26T10:00:00Z' }, 'owner'), false, 'hidden');
  assert.equal(showCard(steps, p, 'viewer'), false, 'viewers never see it');
  assert.deepEqual(normalizeProgress({ skipped: ['a', 'a', 3], hidden_at: '' }), { skipped: ['a'] });
  assert.deepEqual(normalizeProgress('junk'), { skipped: [] });
});

test('checklist v3: a clerk sees only client / item / invoice / POS bill / payment; a viewer nothing', () => {
  assert.deepEqual(kinds(none, ctxOf('full', { role: 'clerk' })), ['client', 'item', 'invoice', 'payment']);
  assert.deepEqual(kinds(none, ctxOf('restaurant', { role: 'clerk' })), ['client', 'item', 'posbill', 'invoice', 'payment']);
  assert.deepEqual(kinds(none, ctxOf('full', { role: 'viewer' })), []);
});

test('checklist: the old buildChecklist(facts) still returns the v2 seven steps', () => {
  assert.deepEqual(buildChecklist(none).map((s) => s.id), ['profile', 'client', 'item', 'invoice', 'whatsapp', 'payment', 'backup']);
});
