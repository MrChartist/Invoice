/**
 * QA round 21 (Round 18 societies + the R18 bulk save `localDb.invoices.saveMany`): one regression per finding W1–W10
 * (docs/prd/qa-round-21.md). Each fails on the baseline source (55d62df / f95f5e9).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { audit } from '../src/lib/audit.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun, undoRun } from '../src/lib/society/hs-issue-io.ts';
import { issueCertificate, loadDues, receiptSplit, transferMembership, waiveInterest } from '../src/lib/society/hs-dues-io.ts';
import { mapFunds, postFundTransfer } from '../src/lib/society/hs-books-io.ts';
import { FUND_CLASS } from '../src/lib/society/hs-funds.ts';
import { unitWarnings, validateUnit } from '../src/lib/society/hs-units.ts';
import { saveUnit } from '../src/lib/society/hs-units-save.ts';
import { loadVouchers } from '../src/lib/ledger/index.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { nonCashBankLedgerIds } from '../src/lib/bank-ledgers.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { restoreEntries } from '../src/lib/trust/recycle-bin.ts';
import { resetI18nForTests, setCatalogueForTests, setLanguage } from '../src/i18n/index.ts';
import { setupTransport } from './helpers/transport-works.ts';
import { saveLr, type LrInput } from '../src/lib/transport/consignment-notes.ts';
import { createFreightBills } from '../src/lib/transport/freight-bill.ts';
import { importMtr, setupWorld } from './helpers/marketplace.ts';
import type { HsHead, SocietyUnit } from '../src/types/society-r18.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { BankAccount } from '../src/lib/bank-accounts.ts';

const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...(kind === 'statutory' ? {} : { sac: '999598' }) });
const U = (id: string, code: string, owner: string, o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id, code, wing: 'A', use: 'residential', occupancy: 'owner', parking: [], carpet_area: 600, construction_cost: 2400000, owner_id: owner, typed: { ptx: 1200 }, status: 'active', updated_at: '', ...o });
const inv = () => getTable<InvoiceRecord>('invoices');
const bill = (code: string, period: string) => inv().find((i) => i.hs?.unit?.code === code && i.hs.period === period && i.status !== 'Cancelled')!;
const run = (m: string) => issueRun({ period: `2026-${m}`, date: `2026-${m}-01`, due: `2026-${m}-20` });

function society() {
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [['c1', 'Asha'], ['c2', 'Ravi'], ['c3', 'Meena']].map(([id, name]) => ({ id, name, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', [U('u1', 'A-101', 'c1'), U('u3', 'A-901', 'c3', { carpet_area: 1500, construction_cost: 6000000 })]);
  saveSocietySettings({ state: '27', due_days: 19, heads: [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('rep', 'repair', 'cost_pct_pa', 0.75), H('ptx', 'statutory', 'typed', 0), H('big', 'service', 'area_carpet', 3)], interest: { from: 'due', on_interest: false } });
}

beforeEach(() => { thawDate(); resetStorage(); installSettings(); });

test('W1: saveMany numbers like one save after another when the batch carries a typed number', () => {
  freezeDate('2026-05-10T10:00:00');
  const d = (id: string, n = '') => ({ id, invoice_number: n, doc_type: 'INVOICE', issue_date: '2026-05-10', due_date: '2026-05-10', status: 'Sent', client: { id: 'c1', name: 'Asha' }, sender: SELLER, items: [], total: 1 } as unknown as InvoiceRecord);
  const batch = () => [d('a'), d('b', 'INV/FY26-27/0050'), d('c'), d('e')];
  const seq = batch().map((x) => localDb.invoices.save(x)).map((i) => i.invoice_number);
  resetStorage(); installSettings();
  const many = localDb.invoices.saveMany(batch()).map((i) => i.invoice_number);
  assert.deepEqual(seq, ['INV/FY26-27/0001', 'INV/FY26-27/0050', 'INV/FY26-27/0051', 'INV/FY26-27/0052']);
  assert.deepEqual(many, seq, 'never a number below one already issued in the batch');
});

test('W2: a society bill\'s place of supply is the building — a member with an out-of-State GSTIN pays CGST + SGST, not IGST', () => {
  society();
  const g14 = '29AAPFU0939F1Z', gstin = g14 + gstinChecksumChar(g14);
  setTable('clients', localDb.clients.getAll().map((c) => (c.id === 'c3' ? { ...c, state_code: '29', gstin } : c)));
  run('10');
  const b = bill('A-901', '2026-10');
  assert.deepEqual([b.place_of_supply, b.gst_mode, b.igst_amount, b.cgst_amount, b.sgst_amount], ['27', 'CGST_SGST', 0, 1125, 1125]);
  assert.equal(b.client.gstin, gstin, 'the member snapshot is untouched');
  const g = buildGstReport(inv(), [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  const row = g.gstr1.b2b.find((r: { invoiceId: string }) => r.invoiceId === b.id) as { pos: string; igst: number; cgst: number } | undefined;
  assert.ok(row, 'B2B with the member\'s GSTIN');
  assert.deepEqual([row!.pos, row!.igst, row!.cgst], ['27', 0, 1125], 'GSTR-1: intra-State');
});

test('W3: after a transfer the outgoing member\'s unpaid bill brings no arrears or interest onto the incoming member\'s bill or dues', () => {
  society();
  run('10');
  transferMembership('u1', { date: '2026-10-25', to_id: 'c2', dues_settled: true });
  run('11');
  const n = bill('A-101', '2026-11');
  assert.equal(n.client.id, 'c2');
  assert.equal(n.hs!.arrears, undefined, 'Asha\'s October bill is hers');
  assert.equal(n.hs!.interest, undefined);
  assert.ok(!n.items.some((l) => l.name === 'Interest on arrears'));
  const row = loadDues('2026-11-05').find((l) => l.unit.code === 'A-101')!;
  assert.deepEqual([row.member?.id, row.open], ['c2', n.total], 'the Dues view shows Ravi\'s own bill only');
  assert.deepEqual(receiptSplit('u1', 100, '2026-11-05').map((a) => a.bill_id), [n.id], 'his receipt never settles her bill');
  assert.match(issueCertificate('u1', '2026-11-05'), /principal ₹16,000\.00/);
});

test('W4: a fund transfer is refused for a period another transfer already covers (year-end, then a month; a quarter, then a month)', () => {
  society();
  mapFunds();
  run('10');
  const fy = postFundTransfer('FY2026')!;
  assert.equal(fy.date, '2027-03-31');
  assert.throws(() => postFundTransfer('2026-10'), /FY2026 already covers/);
  assert.throws(() => postFundTransfer('2027-03'), /FY2026 already covers/, 'no reversal of the year-end journal by March');
  assert.equal(postFundTransfer('FY2026'), null, 'the FY itself: nothing left');
  assert.equal(loadVouchers().filter((v) => v.voucher_class === FUND_CLASS).length, 1);
  // A quarter's journal, then a month inside it.
  resetStorage(); installSettings(); society(); mapFunds(); run('10');
  assert.ok(postFundTransfer('2026-Q3'));
  assert.throws(() => postFundTransfer('2026-10'), /2026-Q3 already covers/);
  // Months first, then the FY: still fine (the FY counts its months).
  resetStorage(); installSettings(); society(); mapFunds(); run('10'); run('11');
  assert.ok(postFundTransfer('2026-10'));
  const y = postFundTransfer('FY2026')!;
  assert.deepEqual(y.lines.filter((l) => l.account_id === 'sales').map((l) => l.dr), [1750_00, 5250_00], 'November only');
});

test('W5: undo run is refused, naming the unit, while a bill of the run carries an interest waiver note (or a receipt)', () => {
  society();
  run('10');
  const nov = run('11');
  waiveInterest('u1', bill('A-101', '2026-11').hs!.interest!.amount, 'hardship', 'GB 1', '2026-11-03');
  assert.throws(() => undoRun(nov.run!.id, 'wrong rates'), /A-101/);
  assert.equal(inv().filter((i) => i.hs?.period === '2026-11' && i.status === 'Cancelled').length, 0, 'nothing cancelled');
  assert.equal(inv().find((i) => i.doc_type === 'CREDIT_NOTE')!.status, 'Sent');
  const b = bill('A-901', '2026-10');
  localDb.payments.record({ invoiceId: b.id, amount: 100, method: 'UPI', date: '2026-10-05' });
  const oct = getTable<{ id: string; period: string }>('society_runs').find((r) => r.period === '2026-10')!;
  assert.throws(() => undoRun(oct.id, 'wrong'), /A-901/);
});

test('W6: an interest waiver over several bills is all or nothing', () => {
  society();
  run('10'); run('11'); run('12');
  const nov = bill('A-101', '2026-11'), dec = bill('A-101', '2026-12');
  // December paid in full later in the month: on the 5th its interest still reads open, but the bill has nothing due.
  localDb.payments.record({ invoiceId: dec.id, amount: dec.total, method: 'UPI', date: '2026-12-25' });
  const amt = Math.round((nov.hs!.interest!.amount + dec.hs!.interest!.amount) * 100) / 100;
  assert.throws(() => waiveInterest('u1', amt, 'hardship', 'GB 2', '2026-12-05'));
  assert.equal(inv().filter((i) => i.doc_type === 'CREDIT_NOTE').length, 0, 'the November note is not left behind');
  assert.equal(getTable('doc_links').length, 0);
});

test('W7: the Receipts and Payments cash set leaves out clearing accounts even when they are inactive', () => {
  const accts = [{ id: 'main', name: 'Main', active: true }, { id: 'mk', name: 'Marketplace clearing', active: false, clearing: true }, { id: 'hdfc', name: 'HDFC', active: false }] as BankAccount[];
  const off = nonCashBankLedgerIds(accts);
  assert.ok(off.has('bank:mk'));
  assert.ok(!off.has('bank:hdfc'), 'an inactive real bank stays cash');
});

test('W8: unit validation and warnings follow the interface language', async () => {
  resetI18nForTests();
  setCatalogueForTests('hi', {});
  await setLanguage('hi', { persist: false });
  try {
    assert.match(validateUnit({ id: 'x', code: '' } as SocietyUnit, []), /यूनिट कोड/);
    assert.match(validateUnit({ id: 'x', code: 'A-1' } as SocietyUnit, [{ id: 'y', code: 'a-1' }]), /पहले से है/);
    assert.match(unitWarnings([U('a', 'A-1', 'c1', { undivided_pct: 40 })])[0], /100 नहीं/);
  } finally {
    await setLanguage('en', { persist: false });
  }
});

test('W9: a deleted unit comes back from the bin only while no live unit holds its code', () => {
  society();
  const gone = getTable<SocietyUnit>('society_units').find((u) => u.code === 'A-101')!;
  setTable('society_units', getTable<SocietyUnit>('society_units').filter((u) => u.id !== gone.id));
  saveUnit({ code: 'a-101 ', use: 'residential', occupancy: 'owner', parking: [], owner_id: 'c2', status: 'active' } as SocietyUnit);
  audit.flush();
  const e = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((x) => x.table === 'society_units' && x.row_id === gone.id)!;
  assert.ok(e);
  assert.throws(() => restoreEntries([e.id]), /exists again/);
  assert.equal(getTable<SocietyUnit>('society_units').filter((u) => u.code.trim().toLowerCase() === 'a-101').length, 1);
});

function countInvoiceWrites(fn: () => void): number {
  let writes = 0;
  const ls = globalThis.localStorage as unknown as { setItem: (k: string, v: string) => void };
  const orig = ls.setItem;
  ls.setItem = (k, v) => { if (k === 'mrchartist_inv_invoices') writes++; orig(k, v); };
  try { fn(); } finally { ls.setItem = orig; }
  return writes;
}

test('W10: a marketplace sales import and a freight-bill run write the invoices table once (saveMany), with the same result', () => {
  const ch = setupWorld();
  let n = 0;
  assert.equal(countInvoiceWrites(() => { n = importMtr(ch).res.saved.length; }), 2, 'the documents once, the refund\'s re-settlement once (was one write per document)');
  assert.equal(n, 4);
  setupTransport();
  const lr = (o: Partial<LrInput> = {}): LrInput => ({ date: '2026-06-10', from: { place: 'Pune', state: '27' }, to: { place: 'Nashik', state: '27' }, consignor_id: 'c-mh', consignee_id: 'c-ka', billing_party_id: 'c-mh', lines: [{ description: 'Cartons', packages: 20, charged_weight: 2000 }], basis: 'per_kg', rate: 4, charges: [], payment_basis: 'tbb', ...o });
  const a = saveLr(lr(), localDb.clients.getAll()), b = saveLr(lr({ billing_party_id: 'c-ka' }), localDb.clients.getAll());
  let bills: InvoiceRecord[] = [];
  assert.equal(countInvoiceWrites(() => { bills = createFreightBills([a.id, b.id], '2026-06-30'); }), 1);
  assert.equal(bills.length, 2);
  assert.equal(new Set(bills.map((x) => x.invoice_number)).size, 2);
  const lrs = getTable<{ id: string; bill_id?: string }>('consignment_notes');
  assert.deepEqual([a.id, b.id].map((id) => lrs.find((l) => l.id === id)!.bill_id).sort(), bills.map((x) => x.id).sort());
});
