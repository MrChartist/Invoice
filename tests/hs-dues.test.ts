/**
 * R18-C1 arrears and interest (PRD §7 R18-C): A-101's unpaid October bill (₹6,710, due 20 Oct) brings "Arrears
 * ₹6,710" (memo) and "Interest on arrears 21 Oct – 31 Oct @ 12 % on ₹5,510 = ₹19.93" onto November's bill — never on
 * the ₹1,200 pass-through — which stays exempt (₹5,529.93 counted); a ₹6,000 receipt settles the interest first;
 * dues then ₹7,439.93. Caps by day (MH 21 % to 2026-06-21, 12 % from 2026-06-22), part payment, no interest on
 * interest, interest never charged twice, the oldest-first option, and the waiver as a financial credit note.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { computeInterest } from '../src/lib/interest.ts';
import { readSocietySettings, saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun, undoRun } from '../src/lib/society/hs-issue-io.ts';
import { allocate, billDue, duesIndex, rateOn, unitDues, type InterestFn } from '../src/lib/society/hs-dues.ts';
import { loadDues, receiptSplit, recordUnitReceipt, waiveInterest } from '../src/lib/society/hs-dues-io.ts';
import { isNonGstFinancialNote } from '../src/lib/financial-note.ts';
import type { HsHead, SocietySettings, SocietyUnit } from '../src/types/society-r18.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const fn = computeInterest as InterestFn;
const H = (id: string, kind: HsHead['kind'], basis: HsHead['basis'], rate: number): HsHead => ({ id, name: id, kind, basis, rate, active: true, ...(kind === 'statutory' ? {} : { sac: '999598' }) });
const SEED: HsHead[] = [H('svc', 'service', 'per_unit', 3000), H('snk', 'sinking', 'cost_pct_pa', 0.25), H('rep', 'repair', 'cost_pct_pa', 0.75), H('ptx', 'statutory', 'typed', 0), H('prk', 'parking', 'per_slot', 500), H('noc', 'non_occupancy', 'pct_of_head', 10), H('edu', 'education', 'fixed_member', 10)];
const U = (id: string, code: string, owner: string, o: Partial<SocietyUnit> = {}): SocietyUnit => ({ id, code, wing: 'A', use: 'residential', occupancy: 'owner', parking: [{ slot: `P${id}`, kind: 'covered' }], carpet_area: 600, construction_cost: 2400000, owner_id: owner, typed: { ptx: 1200 }, status: 'active', updated_at: '', ...o });
const inv = () => getTable<InvoiceRecord>('invoices');
const bill = (code: string, period: string) => inv().find((i) => i.hs?.unit?.code === code && i.hs.period === period && i.status !== 'Cancelled')!;

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [['c1', 'Asha Rao'], ['c2', 'Ravi Shah'], ['c3', 'Meena Kulkarni']].map(([id, name]) => ({ id, name, email: '', address: '', city: '', zip: '' })));
  setTable('society_units', [U('u1', 'A-101', 'c1'), U('u2', 'A-102', 'c2', { occupancy: 'tenant' }), U('u3', 'A-901', 'c3', { carpet_area: 1500, construction_cost: 6000000, typed: { ptx: 3000 } })]);
  saveSocietySettings({ state: '27', cycle: 'monthly', due_days: 19, heads: SEED, interest: { from: 'due', on_interest: false }, allocation: 'interest_first' });
});

const payAll = (code: string, period: string, date: string) => { const b = bill(code, period); localDb.payments.record({ invoiceId: b.id, amount: b.total, method: 'Bank transfer', date }); };

test('PRD §7: November bill of A-101 — arrears ₹6,710 (memo), interest ₹19.93 on ₹5,510 (21–31 Oct @ 12 %), still exempt', () => {
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  payAll('A-102', '2026-10', '2026-10-15');
  payAll('A-901', '2026-10', '2026-10-25');
  issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  const n = bill('A-101', '2026-11');
  assert.deepEqual(n.hs!.arrears, { amount: 6710, as_of: '2026-10-31' });
  assert.deepEqual(n.hs!.interest, { amount: 19.93, from: '2026-10-21', to: '2026-10-31', pct: 12, on: 5510, through: '2026-10-31' });
  const line = n.items.find((l) => l.name === 'Interest on arrears')!;
  assert.equal(line.amount, 19.93);
  assert.equal(n.hs!.heads!.find((h) => h.head_id === 'interest')!.line_id, line.id, 'the basis prints under the line');
  assert.deepEqual([n.doc_type, n.hs!.regime, n.hs!.test!.counted, n.total], ['BILL_OF_SUPPLY', 'exempt77c', 5529.93, 6729.93]);
  // A-901 (taxable: ₹8,510 + GST ₹1,531.80 bear interest) paid late on 25 Oct: 21–25 Oct (a receipt counts from the
  // next day, as in computeInterest); A-102 paid before the due date: none.
  assert.equal(bill('A-901', '2026-11').hs!.interest!.amount, Math.round((10041.8 * 12 * 5) / 365) / 100);
  assert.equal(bill('A-102', '2026-11').hs!.interest, undefined);
  assert.equal(bill('A-102', '2026-11').hs!.arrears, undefined);
  // ₹6,000 receipt: interest first, then the oldest principal; dues ₹7,439.93.
  const split = receiptSplit('u1', 6000, '2026-11-02');
  assert.deepEqual(split.map((a) => [a.bill_id, a.amount]), [[n.id, 19.93], [bill('A-101', '2026-10').id, 5980.07]]);
  recordUnitReceipt('u1', 6000, '2026-11-02', 'UPI', split);
  const a101 = loadDues('2026-11-05').find((l) => l.unit.code === 'A-101')!;
  // October's principal was open 1–2 Nov (the receipt counts from the next day): interest to date ₹3.62, not yet billed.
  assert.deepEqual([a101.open, a101.billed, a101.accrued], [7439.93, 0, Math.round((5510 * 12 * 2) / 365) / 100]);
  assert.equal(getTable<Payment & { client_id?: string }>('transactions').filter((p) => p.client_id === 'c1').length, 2);
});

test('interest is never charged twice; an undone run frees its days; no interest on interest or on pass-through', () => {
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  const nov = issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  issueRun({ period: '2026-12', date: '2026-12-01', due: '2026-12-20' });
  const d = bill('A-101', '2026-12').hs!.interest!;
  // Dec: Oct principal 5,510 for 1–30 Nov (its 21–31 Oct were charged on the Nov bill) + Nov principal 5,510 for 21–30 Nov;
  // the Nov bill's ₹19.93 interest line and both bills' ₹1,200 pass-through bear none.
  assert.deepEqual([d.from, d.to, d.on], ['2026-11-01', '2026-11-30', 11020]);
  assert.equal(d.amount, Math.round(((5510 * 30 + 5510 * 10) * 12) / 365) / 100);
  undoRun(nov.run!.id, 'wrong');
  const ix = duesIndex(inv(), [], []);
  const again = unitDues('u1', '2026-11-30', ix, readSocietySettings(), fn);
  assert.equal(again.from, '2026-10-21', 'the cancelled November bill no longer marks 21–31 Oct as charged');
});

test('State cap by day: MH 21 % up to 2026-06-21, 12 % from 2026-06-22; a lower society rate wins; no State row, no rate → none', () => {
  const s: SocietySettings = { state: '27', interest: { from: 'due', on_interest: false } };
  assert.deepEqual([rateOn(s, '2026-06-21'), rateOn(s, '2026-06-22')], [21, 12]);
  assert.equal(rateOn({ ...s, interest: { ...s.interest!, pct: 10 } }, '2026-06-01'), 10);
  assert.equal(rateOn({ ...s, interest: { ...s.interest!, pct: 15 } }, '2026-07-01'), 12);
  assert.equal(rateOn({ state: '19', interest: s.interest }, '2026-07-01'), 0);
  const b = { id: 'b', doc_type: 'BILL_OF_SUPPLY', status: 'Sent', issue_date: '2026-06-01', due_date: '2026-06-15', total: 1000, items: [], hs: { unit: { id: 'u', code: 'X', members: [] }, heads: [] } } as unknown as InvoiceRecord;
  const r = unitDues('u', '2026-06-30', duesIndex([b], [], []), s, fn);
  // 16–21 Jun at 21 % (6 days), 22–30 Jun at 12 % (9 days).
  assert.equal(r.interest, Math.round(((1000 * 21 * 6) / 365 + (1000 * 12 * 9) / 365)) / 100);
  // Part payment of ₹400 on 25 Jun: 600 from 26 Jun.
  const p = unitDues('u', '2026-06-30', duesIndex([b], [{ invoice_id: 'b', date: '2026-06-25', amount: 400 }], []), s, fn);
  assert.equal(p.interest, Math.round(((1000 * 21 * 6) / 365 + (1000 * 12 * 4) / 365 + (600 * 12 * 5) / 365)) / 100);
  assert.equal(unitDues('u', '2026-06-30', duesIndex([b], [], []), { state: '27' }, fn).interest, 0, 'no interest rule → none');
});

test('billDue: receipts settle interest, then the interest-bearing principal, then pass-through; allocation modes', () => {
  const b = { id: 'n', total: 6729.93, items: [{ id: 'i1', amount: 5510, tax_rate: 0 }, { id: 'i2', amount: 1200, charge_head_id: 'rule33' }, { id: 'i3', amount: 19.93, tax_rate: 0 }], hs: { heads: [{ head_id: 'interest', line_id: 'i3' }] } } as unknown as InvoiceRecord;
  const d = billDue(b, [{ date: '2026-11-02', amount: 100 }], '2026-11-30');
  assert.deepEqual([d.open, d.interest, d.base, d.baseEvents], [6629.93, 0, 5429.93, [{ date: '2026-11-02', amount: 80.07 }]]);
  const old = billDue({ ...b, id: 'o', total: 100, items: [{ id: 'x', amount: 100 }], hs: { heads: [] } } as unknown as InvoiceRecord, [], '2026-11-30');
  const fresh = billDue(b, [], '2026-11-30');
  assert.deepEqual(allocate(50, [old, fresh]), [{ bill_id: 'n', amount: 19.93 }, { bill_id: 'o', amount: 30.07 }]);
  assert.deepEqual(allocate(50, [old, fresh], 'oldest_first'), [{ bill_id: 'o', amount: 50 }]);
});

test('waiver: open interest waived by a financial credit note (no GST) with the reason and GB resolution; it then reads as paid', () => {
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  issueRun({ period: '2026-11', date: '2026-11-01', due: '2026-11-20' });
  assert.throws(() => waiveInterest('u1', 19.93, '', 'GB 4/2026', '2026-11-03'), /reason/);
  assert.throws(() => waiveInterest('u1', 50, 'hardship', 'GB 4/2026', '2026-11-03'), /More than/);
  assert.equal(waiveInterest('u1', 19.93, 'hardship', 'GB 4/2026', '2026-11-03'), 1);
  const note = inv().find((i) => i.doc_type === 'CREDIT_NOTE')!;
  assert.ok(isNonGstFinancialNote(note) && /GB resolution GB 4\/2026/.test(JSON.stringify(note)));
  assert.equal(loadDues('2026-11-05').find((l) => l.unit.code === 'A-101')!.billed, 0);
});
