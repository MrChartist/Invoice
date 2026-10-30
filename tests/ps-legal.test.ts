/** R14 PS-B2 advocates: regime by client and line, threshold wording by date, the paper, GSTR-1 effect, appearances, inward. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, clientMH, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { advocateInward, appearanceLines, isLegalLine, legalRegime, workUnitOf } from '../src/lib/prof/ps-legal.ts';
import { docRegime, legalDocKind, legalPatch, legalSentence } from '../src/lib/prof/ps-legal-paper.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { receivableTotal } from '../src/lib/rcm.ts';
import { localDb } from '../src/lib/localDb.ts';
import { normalizeWorkTypes } from '../src/lib/rate-cards.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = { hsn: '998213' };
const D = '2026-10-10';

test('regime by client type and line', () => {
  assert.deepEqual(Object.values(legalRegime({ client: { gstin: BUYER_MH }, line, date: D })).slice(0, 3), ['rcm', 'gstin', 'N 13/2017-CT(R) entry 2']);
  assert.equal(legalRegime({ client: { ps: { entity: 'business' } }, line, date: D }).reason, 'business');
  assert.deepEqual([legalRegime({ client: { gstin: BUYER_MH, ps: { small_business: true } }, line, date: D }).regime, legalRegime({ client: { gstin: BUYER_MH, ps: { small_business: true } }, line, date: D }).entry], ['exempt', 'N 12/2017-CT(R) entry 45']);
  assert.equal(legalRegime({ client: {}, line, date: D }).reason, 'person');
  assert.equal(legalRegime({ client: { ps: { advocate: true } }, line, date: D }).regime, 'exempt');
  assert.deepEqual([legalRegime({ client: { ps: { advocate: true } }, line, supplier: { senior: true }, date: D }).regime, legalRegime({ client: { ps: { advocate: true } }, line, supplier: { senior: true }, date: D }).reason], ['rcm', 'senior_to_advocate']);
  assert.equal(legalRegime({ client: { gstin: BUYER_MH }, line: { hsn: '998231' }, date: D }).regime, 'taxable', 'a tax filing service is forward charge');
  assert.equal(isLegalLine({ hsn: '' }), true, 'an empty SAC on a fee note counts as legal');
});

test('threshold wording by date: the 2019 row is marked verify', () => {
  assert.equal(legalRegime({ client: { ps: { small_business: true, entity: 'business' } }, line, date: '2018-05-01' }).verified, true);
  assert.equal(legalRegime({ client: { ps: { small_business: true, entity: 'business' } }, line, date: D }).verified, false);
});

test('paper: registered vs unregistered, Bill of Supply for all-exempt, sentences', () => {
  assert.equal(legalDocKind(false, ['rcm']), 'fee_memo');
  assert.equal(legalDocKind(true, ['exempt', 'exempt']), 'bill_of_supply');
  assert.equal(legalDocKind(true, ['exempt', 'rcm']), 'tax_invoice');
  assert.equal(docRegime(['taxable', 'exempt']), 'taxable');
  assert.match(legalSentence({ regime: 'rcm', entry: 'N 13/2017-CT(R) entry 2' }, true), /payable by the recipient under reverse charge/);
  assert.match(legalSentence({ regime: 'exempt' }, true), /^Exempt: N 12\/2017-CT\(R\), entry 45/);
  assert.match(legalSentence({ regime: 'exempt' }, false), /^Not registered under GST/);
  const rec = { client: clientRetail, items: [{ id: 'a', name: 'Fees', hsn: '998213', quantity: 1, rate: 10000, tax_rate: 18, discount_percent: 0, amount: 10000, type: 'Service' }], issue_date: D, doc_type: 'INVOICE' } as unknown as InvoiceRecord;
  const memo = legalPatch({ record: rec, registered: false });
  assert.equal(memo.doc, 'fee_memo');
  assert.deepEqual([memo.patch.gst_mode, memo.patch.items![0].tax_rate, memo.patch.ps.kind], ['NONE', 0, 'memo']);
  const bos = legalPatch({ record: rec, registered: true });
  assert.deepEqual([bos.doc, bos.patch.doc_type, bos.patch.items![0].sv?.exempt], ['bill_of_supply', 'BILL_OF_SUPPLY', 'EXEMPT']);
  const r = legalPatch({ record: { ...rec, client: clientMH }, registered: true });
  assert.deepEqual([r.doc, r.patch.reverse_charge, r.patch.rcm_tax_excluded, r.patch.ps.legal], ['tax_invoice', true, true, { regime: 'rcm', entry: 'N 13/2017-CT(R) entry 2' }]);
});

test('GSTR-1: an RCM fee note is reported with rchrg Y and the tax is not receivable; an exempt line goes to Table 8 exempt', () => {
  const inv = createViaStore({ client: { ...clientMH, gstin: BUYER_MH }, docType: 'TAX_INVOICE', date: D, lines: [{ name: 'Professional fees', hsn: '998213', qty: 1, rate: 50000, tax: 18 }], reverseCharge: true });
  assert.equal(receivableTotal(inv), 50000);
  const r = buildGstReport([inv], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.b2b.map((d: { rchrg: string }) => d.rchrg), ['Y']);
  const ex = createViaStore({ client: clientRetail, docType: 'TAX_INVOICE', date: D, lines: [{ name: 'Fees', hsn: '998213', qty: 1, rate: 8000, tax: 18 }, { name: 'Tax filing', hsn: '998231', qty: 1, rate: 1000, tax: 18 }] });
  const p = legalPatch({ record: ex, registered: true });
  assert.deepEqual([p.doc, p.patch.items!.map((l) => l.tax_rate)], ['tax_invoice', [0, 18]], 'exempt fee line, taxable filing line');
  localDb.invoices.save({ ...ex, items: p.patch.items! });
  const g = buildGstReport([localDb.invoices.getById(ex.id) as InvoiceRecord], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.equal(g.gstr1.nil.reduce((s: number, n: { exempt: number }) => s + n.exempt, 0), 8000);
});

test('appearances bill per entry; WorkType.ps survives the normaliser', () => {
  const [wt] = normalizeWorkTypes([{ id: 'w1', name: 'Appearance: Saket court', rate: 15000, ps: { unit: 'appearance' } }]);
  assert.equal(workUnitOf(wt), 'appearance');
  assert.equal(workUnitOf({ ps: { unit: 'x' } }), 'hour');
  const lines = appearanceLines([{ work_type_id: 'w1', date: '2026-10-01', hourly_rate: 4000 }, { work_type_id: 'w1', date: '2026-10-09' }, { work_type_id: 'other', date: '2026-10-09' }], [wt, { id: 'other', name: 'Research', rate: 4000 }]);
  assert.deepEqual(lines, [{ name: 'Appearance: Saket court', quantity: 2, rate: 15000, unit: 'NOS', work_type_id: 'w1' }]);
});

test('inward: a bill from an advocate with a legal SAC prompts RCM unless we are a small business', () => {
  assert.equal(advocateInward([{ hsn: '998212' }], { ps: { advocate: true } }, D), 'N 13/2017-CT(R) entry 2');
  assert.equal(advocateInward([{ hsn: '998212' }], { ps: { advocate: true } }, D, true), null);
  assert.equal(advocateInward([{ hsn: '998311' }], { ps: { advocate: true } }, D), null);
  assert.equal(advocateInward([{ hsn: '998212' }], {}, D), null);
});

test('the chip\'s choice overrides the regime; enrolment snapshotted; a later choice undoes the exempt mark', () => {
  const rec = { client: clientRetail, items: [{ id: 'a', name: 'Fees', hsn: '998213', quantity: 1, rate: 10000, tax_rate: 18, discount_percent: 0, amount: 10000, type: 'Service' }], issue_date: D, doc_type: 'TAX_INVOICE' } as unknown as InvoiceRecord;
  const ex = legalPatch({ record: rec, registered: true, paper: { enrolment: 'D/1234/2010', bar_council: 'Delhi' } });
  assert.deepEqual(ex.patch.ps.legal, { regime: 'exempt', entry: 'N 12/2017-CT(R) entry 45', enrolment: 'D/1234/2010', bar_council: 'Delhi' });
  const r = legalPatch({ record: { ...rec, ...ex.patch } as InvoiceRecord, registered: true, force: 'rcm' });
  assert.deepEqual([r.doc, r.patch.doc_type, r.patch.reverse_charge, r.patch.items![0].tax_rate, r.patch.items![0].sv?.exempt], ['tax_invoice', 'TAX_INVOICE', true, 18, undefined]);
  assert.equal(legalPatch({ record: rec, registered: true, force: 'taxable' }).patch.reverse_charge, false);
  assert.equal(legalRegime({ client: { ps: { entity: 'government' } }, line, date: D }).regime, 'exempt');
  assert.equal(legalRegime({ client: { ps: { entity: 'advocate' } }, line, date: D }).reason, 'advocate');
});
