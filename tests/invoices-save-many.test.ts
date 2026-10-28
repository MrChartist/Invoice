/**
 * Platform fix (R18-B finding): `localDb.invoices.saveMany` writes the invoices table ONCE for a batch, with the same
 * checks, numbers, holds, audit and catalogue learning as one `save` after another; `issueBatch` uses it for a batch of
 * services. Regression: the bulk result equals the sequential one; a clash inside the batch fails it whole; the credit
 * gate sees the batch's earlier documents; a viewer is refused; numbers continue a stored series and skip series
 * high-water marks. Volume: 2,000 society bills in one batch in a few seconds (was O(n²): ≈ 145 s).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { audit } from '../src/lib/audit.ts';
import { isAccessDeniedError, setActorProvider, type Role } from '../src/lib/access.ts';
import { registerCreditGate } from '../src/lib/approval-gate.ts';
import { creditGate, saveCreditPolicy } from '../src/lib/credit-policy.ts';
import { DuplicateNumberError } from '../src/lib/invoice-number.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun } from '../src/lib/society/hs-issue-io.ts';
import type { Client, InvoiceRecord } from '../src/types/invoice.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';

const as = (role: Role | null, name: string = role ?? '') => setActorProvider(role ? () => ({ id: name, name, role }) : null);
beforeEach(() => { as(null); resetStorage(); installSettings(); freezeDate('2026-05-10T10:00:00'); });
afterEach(() => { as(null); thawDate(); });

function doc(id: string, total: number, client: string, over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id, invoice_number: '', doc_type: 'INVOICE', issue_date: '2026-05-10', due_date: '2026-05-24', status: 'Sent', currency: 'INR',
    template_id: 'classic_orange', client: { id: client, name: `Party ${client}`, state_code: '27' } as InvoiceRecord['client'], sender: SELLER,
    items: [{ id: 'l', name: `Work ${total}`, type: 'Service', hsn: '998314', unit: 'NOS', quantity: 1, rate: total, tax_rate: 0, amount: total }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0,
    other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: total, discount_amount: 0, taxable_value: total,
    cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total, balance_due: total, ...over,
  } as InvoiceRecord;
}
const batch = () => [doc('a', 100, 'c1'), doc('b', 200, 'c2'), doc('c', 300, 'c1', { doc_type: 'BILL_OF_SUPPLY' }), doc('d', 400, 'c3'), doc('e', 50, 'c2', { status: 'Draft', batch_run_id: 'r' })];
const strip = (rows: readonly Record<string, unknown>[]) => rows.map(({ updated_at: _u, created_at: _c, ...r }) => r);
const auditOf = () => audit.all().map((r) => `${r.entity}:${r.entity_id}:${r.action}:${r.summary}`).sort();

function seed() {
  setTable('clients', [{ id: 'c1', name: 'Party c1', email: '', address: '', city: '', zip: '' }] as Client[]);
  localDb.invoices.save(doc('old', 10, 'c1', { invoice_number: 'INV/FY26-27/0007' }));
  setTable('series_counters', [{ id: 'BOS/FY26-27', seq: 4 }]);
}

test('saveMany = save one after another: numbers, statuses, rows, clients learnt, catalogue, audit', () => {
  seed();
  const one = batch().map((d) => localDb.invoices.save(d));
  const seq = { inv: strip(getTable('invoices')), clients: strip(getTable('clients')), items: getTable<{ name: string }>('items_catalog').map((i) => i.name), audit: auditOf() };
  assert.deepEqual(one.map((i) => i.invoice_number), ['INV/FY26-27/0008', 'INV/FY26-27/0009', 'BOS/FY26-27/0005', 'INV/FY26-27/0010', ''], 'series continue; the BOS high-water mark is skipped; a batch draft stays unnumbered');
  resetStorage(); installSettings(); seed();
  const many = localDb.invoices.saveMany(batch());
  assert.deepEqual(many.map((i) => i.invoice_number), one.map((i) => i.invoice_number));
  assert.deepEqual(strip(getTable('invoices')), seq.inv);
  assert.deepEqual(strip(getTable('clients')), seq.clients);
  assert.deepEqual(getTable<{ name: string }>('items_catalog').map((i) => i.name), seq.items);
  assert.deepEqual(auditOf(), seq.audit);
});

test('one write of the invoices table for the whole batch; a party learnt again unchanged writes no client row', () => {
  seed();
  localDb.invoices.saveMany([doc('x', 1, 'c1')]);
  const clientsBefore = dumpStorage()['mrchartist_inv_clients'];
  let writes = 0;
  const ls = globalThis.localStorage as unknown as { setItem: (k: string, v: string) => void };
  const orig = ls.setItem;
  ls.setItem = (k, v) => { if (k === 'mrchartist_inv_invoices') writes++; orig(k, v); };
  try {
    localDb.invoices.saveMany(Array.from({ length: 50 }, (_, k) => doc(`m${k}`, 10 + k, 'c1')));
  } finally {
    ls.setItem = orig;
  }
  assert.equal(writes, 1);
  assert.equal(getTable('invoices').length, 52);
  assert.equal(dumpStorage()['mrchartist_inv_clients'], clientsBefore, 'the same party again: clients untouched');
});

test('a clash inside the batch fails it whole (Rule 46); a viewer is refused; nothing is written', () => {
  seed();
  const before = dumpStorage()['mrchartist_inv_invoices'];
  assert.throws(() => localDb.invoices.saveMany([doc('p', 1, 'c1', { invoice_number: 'INV/FY26-27/0100' }), doc('q', 2, 'c2', { invoice_number: 'inv/fy26-27/100' })]), DuplicateNumberError);
  assert.throws(() => localDb.invoices.saveMany([doc('r', 1, 'c1', { invoice_number: 'INV/FY26-27/0007' })]), DuplicateNumberError, 'a stored number');
  as('viewer');
  assert.throws(() => localDb.invoices.saveMany([doc('s', 1, 'c1')]), isAccessDeniedError);
  assert.equal(dumpStorage()['mrchartist_inv_invoices'], before);
});

test('credit gate (Block, clerk): the second bill of a party in the batch counts the first one', () => {
  setTable('clients', [{ id: 'c1', name: 'Party c1', email: '', address: '', city: '', zip: '', credit_limit: 1000 }] as Client[]);
  as('owner');
  saveCreditPolicy({ mode: 'block', include_orders: false, block_overdue: false });
  registerCreditGate(creditGate);
  as('clerk', 'Ravi');
  const out = localDb.invoices.saveMany([doc('g1', 700, 'c1'), doc('g2', 700, 'c1')]);
  assert.deepEqual(out.map((i) => [i.status, i.approval?.reason]), [['Sent', undefined], ['Draft', 'credit']]);
  registerCreditGate(null);
});

const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...(kind === 'statutory' ? {} : { sac: '999598' }) });

test('volume: 2,000 society bills in ONE batch within a few seconds (was ≈ 145 s, O(n²))', () => {
  thawDate();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  const n = 2000;
  setTable('clients', Array.from({ length: n }, (_, k) => ({ id: `m${k}`, name: `Member ${k}`, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', Array.from({ length: n }, (_, k): SocietyUnit => ({ id: `v${k}`, code: `B-${1000 + k}`, use: 'residential', occupancy: 'owner', parking: [], construction_cost: k % 10 ? 2400000 : 6000000, owner_id: `m${k}`, typed: { ptx: 1200 }, status: 'active', updated_at: '' })));
  saveSocietySettings({ state: '27', heads: [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('ptx', 'statutory', 'typed', 0)] });
  const t = performance.now();
  const r = issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  const ms = performance.now() - t;
  assert.equal(r.invoices.length, n);
  assert.equal(new Set(r.invoices.map((i) => i.batch_run_id)).size, 1, 'one batch');
  assert.equal(new Set(r.invoices.map((i) => i.invoice_number)).size, n, 'every number unique');
  assert.deepEqual([r.invoices[0].invoice_number, r.invoices.at(-1)!.invoice_number], ['BOS/FY26-27/0001', 'BOS/FY26-27/2000'], 'consecutive in one series');
  assert.ok(ms < 5000, `${Math.round(ms)} ms`);
});
