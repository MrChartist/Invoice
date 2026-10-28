/**
 * R3-B5 party document defaults: new documents only, notes / terms rules, undo, currency rate, import round-trip.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientMH, installSettings } from './helpers/world.ts';

const pd = await import('../src/lib/party-defaults.ts');
const { parseCsv } = await import('../src/lib/csv.ts');
const { clientsCsv } = await import('../src/lib/contacts.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const ts = await import('../src/lib/timesheets.ts');
import type { DefaultsDraft } from '../src/lib/party-defaults.ts';

const draft = (over: Partial<DefaultsDraft> = {}): DefaultsDraft => ({ template_id: 'classic_orange', currency: 'INR', notes: 'Thank you', terms: 'Net 15', issue_date: '2026-10-20', ...over });
const profile = { notes: 'Thank you', terms: 'Net 15' };
const party = { doc_defaults: { template_id: 'corporate_navy', currency: 'USD', discount_percent: 5, notes: 'Wire to our USD account', terms: 'Net 30', hourly_rate: 40, annexure: true } };
const rates = [{ currency: 'USD', date: '2026-10-01', rate: 83.1 }, { currency: 'USD', date: '2026-10-15', rate: 83.6 }, { currency: 'USD', date: '2026-11-01', rate: 84 }];

test('applies only on new documents', () => {
  assert.equal(pd.applyPartyDefaults(draft({ id: 'saved' }), party, profile, rates), null, 'an existing document never re-applies');
  assert.equal(pd.applyPartyDefaults(draft(), { doc_defaults: undefined }, profile), null);
  const r = pd.applyPartyDefaults(draft(), party, profile, rates)!;
  assert.deepEqual(r.patch, { template_id: 'corporate_navy', currency: 'USD', exchange_rate: 83.6, notes: 'Wire to our USD account', terms: 'Net 30' });
  assert.equal(r.line_discount, 5);
  assert.deepEqual(r.applied.sort(), ['currency', 'discount_percent', 'notes', 'template_id', 'terms']);
});

test('notes overwrite rules (empty / equal to profile default / typed)', () => {
  assert.equal(pd.applyPartyDefaults(draft({ notes: '' }), party, profile)!.patch.notes, 'Wire to our USD account', 'empty');
  assert.equal(pd.applyPartyDefaults(draft({ notes: ' Thank you ' }), party, profile)!.patch.notes, 'Wire to our USD account', 'still the profile default');
  const typed = pd.applyPartyDefaults(draft({ notes: 'Deliver to gate 2', terms: 'Advance' }), party, profile)!;
  assert.equal('notes' in typed.patch, false, 'a typed value beats both');
  assert.equal('terms' in typed.patch, false);
});

test('undo patch restores every changed field', () => {
  const before = draft({ exchange_rate: undefined });
  const r = pd.applyPartyDefaults(before, party, profile, rates)!;
  const after = { ...before, ...r.patch };
  const restored = { ...after, ...r.undo };
  for (const k of Object.keys(r.patch) as (keyof typeof r.patch)[]) assert.equal(restored[k], before[k], k);
});

test('currency + rate by date; Hindi print language picks the Bilingual template', () => {
  assert.equal(pd.referenceRate(rates, 'usd', '2026-10-14'), 83.1);
  assert.equal(pd.referenceRate(rates, 'USD', '2026-09-30'), undefined);
  const r = pd.applyPartyDefaults(draft({ issue_date: '2026-11-05' }), party, profile, rates)!;
  assert.equal(r.patch.exchange_rate, 84);
  const hi = pd.applyPartyDefaults(draft(), { doc_defaults: { print_lang: 'hi' } }, profile)!;
  assert.equal(hi.patch.template_id, pd.BILINGUAL_TEMPLATE_ID);
  assert.deepEqual(hi.applied, ['print_lang']);
});

test('import round-trip of the optional columns', () => {
  resetStorage();
  const csv = clientsCsv([{ ...clientMH, doc_defaults: party.doc_defaults }], { headers: pd.DOC_DEFAULT_COLUMNS, cells: (c) => pd.docDefaultsToCells(c.doc_defaults) });
  const rows = parseCsv(csv);
  const head = rows[0];
  const cell = (k: string) => rows[1][head.indexOf(k)] ?? '';
  assert.deepEqual(pd.docDefaultsFromCells(cell), party.doc_defaults);
  assert.equal(pd.docDefaultsFromCells(() => ''), null);
  assert.deepEqual(pd.docDefaultsFromCells((k) => ({ attach_annexure: 'Yes', print_lang: 'Hindi', default_discount_percent: '7.5%' } as Record<string, string>)[k] ?? ''), { discount_percent: 7.5, annexure: true, print_lang: 'hi' });
  assert.equal(pd.normalizeDocDefaults({ currency: 'dollars', discount_percent: 150 }), null);
});

test('invoice snapshot unchanged when the client’s defaults change later', () => {
  resetStorage();
  installSettings();
  localDb.clients.upsert({ ...clientMH, doc_defaults: { annexure: true, notes: 'Old' } });
  ts.timeDb.save({ id: 't', client_id: 'c-mh', client_name: 'Bharat Traders', description: 'Work', date: '2026-10-05', minutes: 60, hourly_rate: 1000, billable: true });
  const inv = ts.billUnbilled('c-mh', ts.unbilledFor('c-mh'), undefined, { annexure: true });
  const before = JSON.stringify(localDb.invoices.getById(inv.id));
  localDb.clients.upsert({ ...localDb.clients.getById('c-mh')!, doc_defaults: { template_id: 'corporate_navy', notes: 'New' } });
  assert.equal(JSON.stringify(localDb.invoices.getById(inv.id)), before);
});
