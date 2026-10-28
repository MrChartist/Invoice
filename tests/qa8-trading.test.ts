/** QA round 8 (docs/prd/qa-round-8.md T1–T16): regression tests turned from the QA8 probes. */
import './helpers/shim.ts';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, clientMH, createViaStore, installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { agencySales, saveArrival, cancelArrival } from '../src/lib/trade/tr-arrivals.ts';
import { loadPattis, postPatti, savePatti } from '../src/lib/trade/tr-patti.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { applyTotals } from '../src/lib/demo-data.ts';
import { BIN_TABLE, restoreEntries } from '../src/lib/trust/recycle-bin.ts';
import { agentsDb } from '../src/lib/sales-commission.ts';
import { brokerageStatement, loadBrokers } from '../src/lib/trade/tr-brokers.ts';
import { deleteBrokeragePosting, postBrokerage } from '../src/lib/trade/tr-brokers-post.ts';
import { saveClaim, settleClaim, unsettleClaim, deleteClaim, loadClaims, markClaim } from '../src/lib/trade/tr-claims.ts';
import { recordPackMove, removePackMove, savePackType, chargeUnreturned, packBalances, loadPackMoves, activeMoves } from '../src/lib/trade/tr-packaging.ts';
import { issuePriceDrop, claimPriceDrop, loadPriceDrops, undoPriceDrop } from '../src/lib/trade/tr-price-drop.ts';
import { partyInterest, raiseInterest, loadInterestRuns, undoInterestRun } from '../src/lib/trade/tr-interest.ts';
import { createLateFeeInvoice } from '../src/lib/late-fee.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { preflightEInvoice, preflightEway } from '../src/lib/einvoice-validate.ts';
import { PURE_AGENT_CHARGE } from '../src/lib/trade/tr-charges.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { effectivePercent } from '../src/lib/trade/tr-discounts.ts';
import { rcmGoodsMatches, supplierKinds } from '../src/lib/trade/tr-statutory.ts';
import { yearEndChecklist } from '../src/lib/year-end.ts';
import { loadAgencyLots } from '../src/lib/year-end-store.ts';
import { lotIssues } from '../src/lib/trade/lot-gate.ts';
import { liveDocTrackingIssues } from '../src/lib/stock-tracking.ts';
import { trackingText } from '../src/components/templates/paper-helpers.ts';
import { setActorProvider } from '../src/lib/access.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['agency', 'commodity', 'distributor'], business_type: 'wholesale' } as never);
  localDb.clients.upsert({ ...clientMH });
});
afterEach(() => setActorProvider(null));

const bin = () => getTable<BinEntry>(BIN_TABLE);
const live = (t: string) => getTable<any>(t);

const sale = (id: string, date: string, items: any[], extra: Partial<InvoiceRecord> = {}) =>
  localDb.invoices.save(applyTotals({
    id, invoice_number: '', doc_type: 'INVOICE', issue_date: date, due_date: date, status: 'Sent', currency: 'INR', template_id: 't', client: { ...clientMH }, sender: SELLER,
    items: items.map((l, i) => ({ id: `${id}-${i}`, type: 'Goods', unit: 'QTL', tax_rate: 0, discount_percent: 0, amount: l.quantity * l.rate, ...l })),
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, ...extra,
  } as InvoiceRecord));
const ctx = () => ({ arrivals: live('arrivals'), sales: agencySales(localDb.invoices.getAll()) });

/* ── T1 / T3: patti valuation ── */

test('QA8 T1: patti gross = the sales\' taxable value (invoice discount and tax-inclusive prices)', () => {
  const p0 = vendorsDb.save({ name: 'Ram', principal_kind: 'registered' }).id;
  const a = saveArrival({ date: '2026-10-01', principal_id: p0, principal_name: 'Ram', principal_kind: 'registered', lot_no: 'L1', item_name: 'Jaggery', hsn: '1701', unit: 'QTL', packages: 10, qty: 10, produce: 'other' } as never);
  const s1 = sale('s1', '2026-10-02', [{ name: 'Jaggery', hsn: '1701', quantity: 5, rate: 4000, tax_rate: 5, arrival_id: a.id }], { agency: true, discount_type: 'PERCENT', discount_rate: 10 } as never);
  const s2 = sale('s2', '2026-10-02', [{ name: 'Jaggery', hsn: '1701', quantity: 5, rate: 4200, tax_rate: 5, arrival_id: a.id }], { agency: true, price_includes_tax: true } as never);
  const taxable = (localDb.invoices.getById(s1.id)!.taxable_value ?? 0) + (localDb.invoices.getById(s2.id)!.taxable_value ?? 0);
  const p = savePatti({ date: '2026-10-03', principalId: p0, arrivalIds: [a.id], deductions: [] }, ctx());
  assert.equal(taxable, 38000);
  assert.equal(p.gross, 38000, 'was 41,000 (₹3,000 over)');
});

test('QA8 T1: a foreign-currency agency sale is valued in rupees', () => {
  const p0 = vendorsDb.save({ name: 'Ram', principal_kind: 'registered' }).id;
  const a = saveArrival({ date: '2026-10-01', principal_id: p0, principal_name: 'Ram', principal_kind: 'registered', lot_no: 'L1', item_name: 'Jaggery', unit: 'QTL', packages: 1, qty: 10 } as never);
  sale('s1', '2026-10-02', [{ name: 'Jaggery', quantity: 1, rate: 100, arrival_id: a.id }], { agency: true, currency: 'USD', exchange_rate: 83 } as never);
  assert.equal(agencySales(localDb.invoices.getAll())[0].amount, 8300);
});

test('QA8 T3: two pattis on one lot recover the arrival advance once', () => {
  const farmer = vendorsDb.save({ name: 'Ram', principal_kind: 'agriculturist' }).id;
  const a = saveArrival({ date: '2026-10-01', principal_id: farmer, principal_name: 'Ram', principal_kind: 'agriculturist', lot_no: 'L1', item_name: 'Mustard', hsn: '1207', unit: 'QTL', packages: 80, qty: 40, produce: 'agricultural', advance: 20000 } as never);
  sale('s1', '2026-10-02', [{ name: 'Mustard', hsn: '1207', quantity: 20, rate: 5000, arrival_id: a.id }], { agency: true } as never);
  const p1 = postPatti(savePatti({ date: '2026-10-03', principalId: farmer, arrivalIds: [a.id], deductions: [] }, ctx()).id);
  sale('s2', '2026-10-05', [{ name: 'Mustard', hsn: '1207', quantity: 20, rate: 5000, arrival_id: a.id }], { agency: true } as never);
  const p2 = savePatti({ date: '2026-10-06', principalId: farmer, arrivalIds: [a.id], deductions: [] }, ctx());
  assert.deepEqual([p1.advance, p1.net_payable, p2.advance, p2.net_payable], [20000, 80000, 0, 100000]);
  assert.deepEqual(p1.advance_by_lot, { [a.id]: 20000 });
  assert.equal(p1.net_payable + p2.net_payable, 180000);
  assert.equal(loadPattis().length, 2);
});

/* ── T2: recycle-bin restores never double-post ── */

test('QA8 T2: an undone brokerage journal is not restored alone; the posting comes back with its journal and TDS, never over a re-post', () => {
  const b = agentsDb.save({ id: '', name: 'Dalal', rate: 0, basis: 'invoice', kind: 'broker', brokerage_basis: 'percent', brokerage_rate: 1, pan: 'ABCPM1234D' } as never);
  sale('s1', '2026-10-02', [{ name: 'Wheat', hsn: '1001', quantity: 100, rate: 2500 }], { broker_id: b.id } as never);
  const br = loadBrokers()[0];
  const period = { from: '2026-10-01', to: '2026-10-31' };
  const st = brokerageStatement(br, period, { invoices: localDb.invoices.getAll(), purchases: [] });
  const p = postBrokerage(br, period, '2026-10-31', st);
  deleteBrokeragePosting(p.id);
  const ev = bin().find((x) => x.table === 'vouchers' && x.row_id === p.voucher_id)!;
  assert.throws(() => restoreEntries([ev.id]), /undone where it was posted/);
  // Restoring the posting row brings its journal back with it.
  const ep = bin().find((x) => x.table === 'brokerage_postings')!;
  restoreEntries([ep.id]);
  assert.equal(loadVouchers().filter((v) => v.voucher_class === 'Brokerage').length, 1);
  assert.equal(live('brokerage_postings').length, 1);
  // Undo again, post again: the old posting can no longer come back.
  deleteBrokeragePosting(p.id);
  postBrokerage(br, period, '2026-10-31', st);
  const ep2 = [...bin()].reverse().find((x) => x.table === 'brokerage_postings')!;
  assert.throws(() => restoreEntries([ep2.id]), /already posted again/);
  assert.equal(loadVouchers().filter((v) => v.voucher_class === 'Brokerage').length, 1);
});

test('QA8 T2: a trade-claim journal / supplier note undone by unsettle cannot be restored', () => {
  const v = vendorsDb.save({ name: 'HUL' }).id;
  const c = saveClaim({ date: '2026-10-05', kind: 'scheme', principal_id: v, principal_name: 'HUL', from: '2026-10-01', to: '2026-10-31', rows: [{ invoice_number: 'X', date: '2026-10-02', party: 'r', item: 'Soap', qty: 0, free_qty: 1, value: 1000 }] } as never);
  const s = settleClaim(c.id, { mode: 'financial', note_no: 'CN1', date: '2026-10-20', amount: 1000 });
  unsettleClaim(c.id);
  const e = bin().find((x) => x.table === 'vouchers' && x.row_id === s.settlement!.voucher_id)!;
  assert.throws(() => restoreEntries([e.id]), /Trade claim/);
  settleClaim(c.id, { mode: 'financial', note_no: 'CN1', date: '2026-10-20', amount: 1000 });
  assert.equal(loadVouchers().filter((x) => x.voucher_class === 'Trade claim').length, 1);
  const c2 = saveClaim({ date: '2026-10-05', kind: 'scheme', principal_id: v, principal_name: 'HUL', from: '2026-10-01', to: '2026-10-31', rows: [{ invoice_number: 'Y', date: '2026-10-02', party: 'r', item: 'Soap', qty: 0, free_qty: 1, value: 1180 }] } as never);
  const s2 = settleClaim(c2.id, { mode: 'gst', note_no: 'CN2', date: '2026-10-20', amount: 1180, gst_rate: 18 });
  unsettleClaim(c2.id);
  const e2 = bin().find((x) => x.row_id === s2.settlement!.return_id)!;
  assert.throws(() => restoreEntries([e2.id]), /unsettled since/);
  assert.equal(live('purchase_returns').length, 0);
});

test('QA8 T2: a packaging deposit voucher comes back only with its movement', () => {
  const t = savePackType({ name: 'Crate', deposit: 50, charge_rate: 150, hsn: '3923', tax_rate: 18 });
  const m = recordPackMove({ date: '2026-10-01', party_kind: 'client', party_id: clientMH.id, party_name: clientMH.name, type_id: t.id, out: 40, in: 0, deposit: 2000 });
  removePackMove(m.id);
  const ev = bin().find((x) => x.table === 'vouchers' && x.row_id === m.voucher_id)!;
  assert.throws(() => restoreEntries([ev.id]), /Packaging deposit/);
  const em = bin().find((x) => x.table === 'packaging_moves')!;
  restoreEntries([em.id]);
  assert.deepEqual([loadVouchers().filter((v) => v.voucher_class === 'Packaging deposit').length, loadPackMoves().length], [1, 1]);
});

/* ── T4 / T5 / T6: interest ── */

const idata = () => ({ invoices: localDb.invoices.getAll(), payments: getTable<any>('transactions'), links: getTable<any>('doc_links'), clients: localDb.clients.getAll(), openingBills: [], runs: loadInterestRuns() as any[] });

test('QA8 T4: a bill with a late-fee invoice is not charged interest for the same days, and the reverse', () => {
  localDb.clients.upsert({ ...clientMH, late_fee: { mode: 'percent_pa', rate: 18, graceDays: 0 } } as never);
  const inv = sale('s1', '2026-07-01', [{ name: 'Cable', hsn: '8544', unit: 'NOS', quantity: 1, rate: 100000 }], { due_date: '2026-07-31', client: { ...clientMH, late_fee: { mode: 'percent_pa', rate: 18, graceDays: 0 } } } as never);
  createLateFeeInvoice(localDb.invoices.getById(inv.id)!, new Date('2026-10-31T10:00:00'));
  assert.equal(partyInterest('2026-10-31', { rate: 18 }, idata()).length, 0, 'was charged again 1 Aug – 31 Oct');
  const later = partyInterest('2026-11-30', { rate: 18 }, idata())[0].bills[0];
  assert.deepEqual([later.from, later.to], ['2026-11-01', '2026-11-30']);
  // The reverse: a bill on a live interest run refuses a late fee.
  const b2 = sale('s2', '2026-07-01', [{ name: 'Cable', hsn: '8544', unit: 'NOS', quantity: 1, rate: 50000 }], { due_date: '2026-07-31', client: { ...clientMH, late_fee: { mode: 'percent_pa', rate: 18, graceDays: 0 } } } as never);
  raiseInterest(partyInterest('2026-10-31', { rate: 18 }, idata()), '2026-10-31', '2026-10-31');
  assert.throws(() => createLateFeeInvoice(localDb.invoices.getById(b2.id)!, new Date('2026-10-31T10:00:00')), /already charged up to 2026-10-31/);
});

test('QA8 T5: deleting an interest draft frees its bills; undoInterestRun deletes the drafts and the bin keeps them gone', () => {
  sale('s1', '2026-07-01', [{ name: 'Cable', hsn: '8544', unit: 'NOS', quantity: 1, rate: 100000 }], { due_date: '2026-07-31' } as never);
  const run = raiseInterest(partyInterest('2026-10-31', { rate: 18 }, idata()), '2026-10-31', '2026-10-31');
  assert.equal(run.bills[0].invoice_id, run.invoice_ids[0]);
  for (const id of run.invoice_ids) localDb.invoices.remove(id);
  assert.equal(partyInterest('2026-10-31', { rate: 18 }, idata())[0].total, 4536.99, 'was lost for good');
  const run2 = raiseInterest(partyInterest('2026-10-31', { rate: 18 }, idata()), '2026-10-31', '2026-10-31');
  const undone = undoInterestRun(run2.id);
  assert.equal(undone.status, 'undone');
  assert.equal(localDb.invoices.getById(run2.invoice_ids[0]), undefined);
  assert.equal(partyInterest('2026-10-31', { rate: 18 }, idata())[0].total, 4536.99);
  const e = [...bin()].reverse().find((x) => x.table === 'invoices' && x.row_id === run2.invoice_ids[0])!;
  assert.throws(() => restoreEntries([e.id]), /interest run that was undone/);
  // An issued interest invoice must be cancelled first.
  const run3 = raiseInterest(partyInterest('2026-10-31', { rate: 18 }, idata()), '2026-10-31', '2026-10-31');
  localDb.invoices.setStatus(run3.invoice_ids[0], 'Sent');
  assert.throws(() => undoInterestRun(run3.id), /cancel it first/);
  localDb.invoices.setStatus(run3.invoice_ids[0], 'Cancelled');
  assert.equal(partyInterest('2026-10-31', { rate: 18 }, idata())[0].total, 4536.99, 'a cancelled interest invoice frees its bills');
});

test('QA8 T6: interest on an export (LUT) bill stays zero-rated; a mixed party gets one draft per supply type', () => {
  const us = { id: 'c-us', name: 'Acme Inc', address: 'SF, USA', state_code: '99' };
  localDb.clients.upsert({ ...us } as never);
  sale('x1', '2026-07-01', [{ name: 'Software', hsn: '998314', unit: 'NOS', quantity: 1, rate: 100000, tax_rate: 18 }], { due_date: '2026-07-31', client: { ...us }, supply_type: 'EXPORT_LUT', gst_mode: 'IGST', place_of_supply: '96', lut_number: 'AD270326000001' } as never);
  sale('x2', '2026-07-01', [{ name: 'Support', hsn: '998314', unit: 'NOS', quantity: 1, rate: 100000, tax_rate: 18 }], { due_date: '2026-07-31', client: { ...us }, supply_type: 'EXPORT_WITH_PAYMENT', gst_mode: 'IGST', place_of_supply: '96' } as never);
  const run = raiseInterest(partyInterest('2026-10-31', { rate: 18 }, idata()), '2026-10-31', '2026-10-31');
  assert.equal(run.invoice_ids.length, 2);
  const docs = run.invoice_ids.map((id) => localDb.invoices.getById(id)!);
  const lut = docs.find((d) => d.supply_type === 'EXPORT_LUT')!;
  assert.deepEqual([lut.place_of_supply, lut.igst_amount, lut.taxable_value, lut.lut_number], ['96', 0, 4536.99, 'AD270326000001'], 'was B2B with IGST ₹816.66');
  const paid = docs.find((d) => d.supply_type === 'EXPORT_WITH_PAYMENT')!;
  assert.equal(paid.igst_amount, Math.round((paid.taxable_value ?? 0) * 18) / 100, 'export with payment: IGST at the bill rate');
  assert.ok((paid.igst_amount ?? 0) > 0);
});

/* ── T7: price drops and claims ── */

test('QA8 T7: deleting / rejecting a price-drop claim frees the run; undo rejects a draft claim; a hand-cancelled note frees its bills', () => {
  const v = vendorsDb.save({ name: 'HUL' }).id;
  sale('s1', '2026-10-02', [{ name: 'Soap', hsn: '3401', unit: 'NOS', quantity: 100, rate: 40 }]);
  const run = issuePriceDrop({ date: '2026-10-10', mode: 'financial', items: [{ name: 'Soap', drop: 2 }], from: '2026-10-01', to: '2026-10-09' });
  const c = claimPriceDrop(run.id, { id: v, name: 'HUL' }, '2026-10-11');
  deleteClaim(c.id);
  assert.equal(loadPriceDrops()[0].claim_id, undefined);
  const c2 = claimPriceDrop(run.id, { id: v, name: 'HUL' }, '2026-10-12');
  markClaim(c2.id, 'rejected');
  const c3 = claimPriceDrop(run.id, { id: v, name: 'HUL' }, '2026-10-13');
  markClaim(c3.id, 'sent');
  assert.throws(() => undoPriceDrop(run.id), /is sent: reject it/);
  assert.throws(() => settleClaim(c2.id, { mode: 'financial', note_no: 'N', date: '2026-10-20', amount: 200 }), /rejected/);
  markClaim(c3.id, 'rejected');
  const c4 = claimPriceDrop(run.id, { id: v, name: 'HUL' }, '2026-10-14');
  undoPriceDrop(run.id);
  assert.equal(loadClaims().find((x) => x.id === c4.id)!.status, 'rejected', 'its draft claim was left to be settled');
  assert.throws(() => settleClaim(c4.id, { mode: 'financial', note_no: 'N', date: '2026-10-20', amount: 200 }), /rejected/);
  // A note cancelled by hand frees its bills for a new run.
  sale('s2', '2026-10-03', [{ name: 'Oil', hsn: '1508', unit: 'NOS', quantity: 10, rate: 100 }]);
  const run2 = issuePriceDrop({ date: '2026-10-10', mode: 'financial', items: [{ name: 'Oil', drop: 5 }], from: '2026-10-01', to: '2026-10-09' });
  localDb.invoices.setStatus(run2.note_ids[0], 'Cancelled');
  const run3 = issuePriceDrop({ date: '2026-10-11', mode: 'financial', items: [{ name: 'Oil', drop: 5 }], from: '2026-10-01', to: '2026-10-09' });
  assert.equal(run3.total, 50);
  // …and the old run's claim would no longer include those rows.
  assert.throws(() => claimPriceDrop(run2.id, { id: v, name: 'HUL' }, '2026-10-12'), /Nothing to claim/);
});

/* ── T8: crates ── */

test('QA8 T8: deleting the crate-charge draft reopens the crates; the orphan movement can be removed', () => {
  const t = savePackType({ name: 'Crate', deposit: 50, charge_rate: 150, hsn: '3923', tax_rate: 18 });
  recordPackMove({ date: '2026-08-01', party_kind: 'client', party_id: clientMH.id, party_name: clientMH.name, type_id: t.id, out: 40, in: 35 });
  const bal = packBalances(loadPackMoves(), '2026-10-31')[0];
  const { invoice, move } = chargeUnreturned(bal, 5, '2026-10-31');
  assert.equal(packBalances(activeMoves(loadPackMoves()), '2026-10-31')[0].balance, 0);
  assert.throws(() => removePackMove(move.id), /cancel that invoice instead/);
  localDb.invoices.remove(invoice.id);
  assert.equal(packBalances(activeMoves(loadPackMoves()), '2026-10-31')[0].balance, 5, 'was 0');
  removePackMove(move.id);
  assert.equal(loadPackMoves().length, 1);
  const em = [...bin()].reverse().find((x) => x.table === 'packaging_moves')!;
  assert.throws(() => restoreEntries([em.id]), /gone or cancelled/);
});

/* ── T9 / T13: pure-agent and charge lines in GST / e-Invoice / e-Way / Tally ── */

const pureAgentDoc = () => {
  installSettings();
  const inv = createViaStore({ client: { ...clientMH, gstin: BUYER_MH }, docType: 'TAX_INVOICE', date: '2026-10-05', lines: [{ name: 'Rice', hsn: '10063020', qty: 100, rate: 50, tax: 5, unit: 'KGS' }, { name: 'Dharmada', hsn: '', qty: 1, rate: 200, tax: 0, unit: 'OTH' }] });
  const items = inv.items.map((l, i) => (i === 1 ? { ...l, charge_head_id: 'h', description: PURE_AGENT_CHARGE } : l));
  localDb.invoices.save({ ...inv, items });
  return localDb.invoices.getById(inv.id) as InvoiceRecord;
};

test('QA8 T9: a pure-agent charge line is not a supply — out of Table 8, 3B 3.1(c), HSN; no e-Invoice / e-Way block', () => {
  const rec = pureAgentDoc();
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.nil, []);
  assert.deepEqual(r.gstr1.hsn.map((h: any) => [h.hsn, h.taxable]), [['10063020', 5000]]);
  const codes = r.issues.map((i: any) => i.code);
  assert.ok(!codes.includes('HSN_MISSING'));
  assert.ok(codes.includes('PURE_AGENT'));
  assert.match(r.issues.find((i: any) => i.code === 'PURE_AGENT')!.message, /verify with your CA/);
  assert.equal(JSON.stringify(r.gstr3b).includes('"intra":200'), false);
  const e = preflightEInvoice(rec, { now: new Date('2026-10-06') });
  assert.deepEqual((e.errors ?? []).map((x: any) => x.code), []);
  assert.equal(e.payload!.ItemList.length, 1);
  assert.equal(e.payload!.ValDtls.AssVal, 5000);
  assert.equal(e.payload!.ValDtls.OthChrg, 200);
  const w = preflightEway(rec, { now: new Date('2026-10-06') });
  assert.deepEqual(w.bill.itemList.map((i: any) => i.productName), ['Rice']);
  assert.ok(!(w.errors ?? []).some((x: any) => x.code === 'EWB_HSN'));
  assert.equal(w.bill.OthValue, 200);
});

test('QA8 T13: Tally inventory entries hold our stock only; charge and agency lines post to ledgers', async () => {
  const rec = pureAgentDoc();
  const agency = { ...rec, id: 'ag', invoice_number: 'INV/AG', items: [{ ...rec.items[0], id: 'ag-0', arrival_id: 'arr1' }] } as InvoiceRecord;
  const { buildTallyModel } = await import('../src/lib/tally-xml.ts');
  const m = buildTallyModel({ invoices: [rec, agency], payments: [], clients: [], items: [], purchases: [], vendors: [] } as never, { companyName: 'X', includeInventory: true });
  assert.deepEqual(m.stockItems.map((s: any) => s.name), ['Rice']);
  const v = m.vouchers.find((x: any) => x.number === rec.invoice_number)!;
  assert.deepEqual(v.inventory.map((l: any) => l.item), ['Rice']);
  assert.ok(v.entries.some((e: any) => /charges/i.test(e.ledger) && e.paise === 20000));
  const va = m.vouchers.find((x: any) => x.number === 'INV/AG')!;
  assert.equal(va.inventory.length, 0);
  assert.ok(va.entries.some((e: any) => e.ledger === va.inventoryLedger && e.paise === 500000));
});

/* ── T10: year-end ── */

test('QA8 T10: unsettled agency lots are a year-end checklist row, whatever the pack', () => {
  const farmer = vendorsDb.save({ name: 'Ram', principal_kind: 'agriculturist' }).id;
  const a = saveArrival({ date: '2026-10-01', principal_id: farmer, principal_name: 'Ram', principal_kind: 'agriculturist', lot_no: 'L7', item_name: 'Mustard', unit: 'QTL', packages: 1, qty: 10 } as never);
  sale('s1', '2026-10-02', [{ name: 'Mustard', quantity: 5, rate: 5000, arrival_id: a.id }], { agency: true } as never);
  installSettings({ industry_packs: ['distributor'], business_type: 'wholesale' } as never); // agency pack off
  const lots = loadAgencyLots('2027-03-31')!;
  assert.deepEqual(lots.map((l) => l.lot_no), ['L7']);
  const step = (agencyLots?: typeof lots) => yearEndChecklist({ fyStart: 2026, ledger: { vouchers: [], accounts: [], byId: new Map() } as never, integrity: { issues: [], totals: { dr: 0, cr: 0, diff: 0 } } as never, closingStock: { value: 0, items: 0 }, assets: [], manual: [], lockUntil: '', oldOpenBills: { count: 0, amount: 0 }, today: '2027-04-01', ...(agencyLots ? { agencyLots } : {}) }).find((s) => s.id === 'agency_lots');
  assert.equal(step(lots)!.status, 'warn');
  assert.match(step(lots)!.facts[0], /L7 \(ARR\/FY26-27\/0001, Ram\)/);
  assert.equal(step(), undefined, 'no arrivals: no row');
  assert.equal(step([])!.status, 'done');
  assert.equal(loadAgencyLots('2026-09-30'), undefined, 'before the arrival');
});

/* ── T11: discount precision ── */

test('QA8 T11: the effective % reproduces the exact net of large per-unit and 3-step chain lines', () => {
  const rec = (items: unknown[]) => ({ items, gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0 }) as unknown as InvoiceRecord;
  const cases: [number[] | undefined, number, number, number][] = [
    [undefined, 5, 333, 100000], [undefined, 1, 999, 10000], [undefined, 0.5, 7, 20000], [[12.5, 7.5, 2.5], 0, 1000, 10000], [[18, 4], 3, 287, 5000],
  ];
  for (const [chain, pu, rate, qty] of cases) {
    const pct = effectivePercent(chain, pu, rate);
    const c = calculateInvoice(calcInputFromRecord(rec([{ id: 'a', name: 'x', quantity: qty, rate, tax_rate: 0, discount_percent: pct, amount: 0 }])));
    const chainF = (chain ?? []).reduce((p, d) => p * (1 - d / 100), 1);
    assert.equal(c.taxable_value, Math.round(qty * (rate * chainF - pu) * 100) / 100, `${chain ?? ''} ${pu}/unit on ${qty} × ${rate}`);
  }
});

/* ── T12: weighing on notes ── */

test('QA8 T12: a partial credit note does not print the original weighing; a full one keeps it', async () => {
  const { createCreditNote } = await import('../src/lib/documents.ts');
  const wt = { packages: 120, kind: 'BAG', gross: 6072, tare_per_package: 0.6, deduction: { basis: 'per_qtl', value: 1 }, gross_unit: 'KG' };
  const inv = sale('w1', '2026-10-02', [{ name: 'Wheat', hsn: '1001', quantity: 59.4, rate: 2450, wt }]);
  const cn = createCreditNote(localDb.invoices.getById(inv.id)!, { lines: [{ itemId: 'w1-0', quantity: 10 }], reason: 'Sales return', goodsReturned: true });
  assert.equal(cn.items[0].wt, undefined);
  assert.equal(trackingText(cn.items[0]), '');
  // A stale weighing (quantity edited with the pack off) is not printed either.
  assert.equal(trackingText({ wt, quantity: 10, unit: 'QTL' } as never), '');
  assert.match(trackingText({ wt, quantity: 59.4, unit: 'QTL' } as never), /120 BAG/);
});

test('QA8 T12: a GST rate-difference note carries no weighing', async () => {
  const { gstDropNote } = await import('../src/lib/trade/tr-price-drop.ts');
  const inv = sale('w1', '2026-10-02', [{ name: 'Wheat', hsn: '1001', quantity: 59.4, rate: 2450, wt: { packages: 120, kind: 'BAG', gross: 6072, tare_per_package: 0.6, deduction: { basis: 'per_qtl', value: 1 }, gross_unit: 'KG' } }]);
  const note = gstDropNote(localDb.invoices.getById(inv.id)!, [{ client_name: 'x', invoice_id: inv.id, invoice_number: 'I', item: 'Wheat', qty: 10, value: 100 }], new Map([['wheat', 10]]), '2026-10-10');
  assert.equal(note.items[0].wt, undefined);
});

/* ── T14: RCM prompt ── */

test('QA8 T14: the notified-goods prompt matches cashew in shell only, and silk yarn only from a flagged maker', () => {
  const farmer = supplierKinds({ principal_kind: 'agriculturist' });
  assert.deepEqual(rcmGoodsMatches([{ hsn: '08011100' }], ['maker', 'agriculturist'], '2026-10-01'), [], 'coconut');
  assert.deepEqual(rcmGoodsMatches([{ hsn: '08012100' }], farmer, '2026-10-01'), [], 'Brazil nuts');
  assert.equal(rcmGoodsMatches([{ hsn: '08013100' }], farmer, '2026-10-01')[0].goods, 'Cashew nuts, not shelled or peeled');
  assert.deepEqual(rcmGoodsMatches([{ hsn: '0801', name: 'Coconut' }], farmer, '2026-10-01'), []);
  assert.equal(rcmGoodsMatches([{ hsn: '0801', name: 'Raw cashew' }], farmer, '2026-10-01').length, 1);
  assert.equal(rcmGoodsMatches([{ hsn: '08013200' }], farmer, '2026-10-01').length, 0, 'shelled cashew');
  assert.deepEqual(supplierKinds({ gstin: '27AABCU9603R1ZX' }), []);
  assert.deepEqual(rcmGoodsMatches([{ hsn: '50040000' }], supplierKinds({ gstin: '27AABCU9603R1ZX' }), '2026-10-01'), []);
  assert.equal(rcmGoodsMatches([{ hsn: '50040000' }], supplierKinds({ gstin: '27AABCU9603R1ZX', rcm_maker: true }), '2026-10-01').length, 1);
});

/* ── T15: lot gate ── */

test('QA8 T15: overselling a lot or selling a cancelled lot stops the save (stock checks)', () => {
  const farmer = vendorsDb.save({ name: 'Ram', principal_kind: 'agriculturist' }).id;
  const a = saveArrival({ date: '2026-10-01', principal_id: farmer, principal_name: 'Ram', principal_kind: 'agriculturist', lot_no: 'L1', item_name: 'Mustard', unit: 'QTL', packages: 1, qty: 10 } as never);
  sale('s1', '2026-10-02', [{ name: 'Mustard', quantity: 6, rate: 5000, arrival_id: a.id }], { agency: true } as never);
  const doc = (q: number, arrival = a.id) => ({ id: 'new', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-10-03', items: [{ id: 'n0', name: 'Mustard', quantity: q, rate: 5000, arrival_id: arrival }] as never });
  assert.deepEqual(liveDocTrackingIssues(doc(4)).errors, []);
  const over = liveDocTrackingIssues(doc(5));
  assert.match(over.errors[0], /only 4 QTL left to sell; this document sells 5/);
  assert.deepEqual(over.lots, over.errors);
  assert.deepEqual(liveDocTrackingIssues({ ...doc(5), status: 'Draft' }).errors, [], 'drafts never move a lot');
  // Its own saved copy does not count against it; a returning credit note gives quantity back.
  assert.deepEqual(lotIssues({ ...doc(6), id: 's1' }, localDb.invoices.getAll(), live('arrivals')), []);
  const b = saveArrival({ date: '2026-10-01', principal_id: farmer, principal_name: 'Ram', lot_no: 'L2', item_name: 'Mustard', unit: 'QTL', packages: 1, qty: 10 } as never);
  cancelArrival(b.id, 'wrong lot', localDb.invoices.getAll());
  assert.match(liveDocTrackingIssues(doc(1, b.id)).errors[0], /L2 .* is cancelled/);
});

test('QA8 T15: the editor lets the owner override the lot check with a reason (audited)', () => {
  const src = readFileSync(new URL('../src/pages/InvoiceCreator.tsx', import.meta.url), 'utf8');
  assert.match(src, /issues\.lots\?\.length/);
  assert.match(src, /can\('settings\.manage'\)/);
  assert.match(src, /action: 'override'/);
});

/* ── T16: pack off keeps the snapshot reconcilers ── */

test('QA8 T16: the discount, weight and charge reconcilers mount for a saved document that carries the snapshots', () => {
  const items = readFileSync(new URL('../src/components/creator/ItemsTable.tsx', import.meta.url), 'utf8');
  assert.match(items, /\(tradeOn \|\| !!item\.disc_chain\?\.length \|\| !!item\.disc_per_unit\) && priced/);
  assert.match(items, /\(weighOn \|\| !!item\.wt\) && <Suspense/);
  const summary = readFileSync(new URL('../src/components/creator/SummaryPanel.tsx', import.meta.url), 'utf8');
  assert.match(summary, /const tradeOn = packOn \|\| hasCharges;/);
  assert.match(summary, /\{tradeOn && <Suspense fallback=\{null\}><ChargesStrip/);
});
