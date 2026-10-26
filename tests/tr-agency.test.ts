/** TR-C1 commission-agent desk: arrivals in a consignment godown, agency sales, bikri patti maths and journal, indents. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { consignmentGodowns, nonSaleableGodowns } from '../src/lib/godowns.ts';
import { saleLimitGate } from '../src/lib/pharma-gate.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import { agencySales, cancelArrival, loadArrivals, lotBalances, lotShortage, saveArrival } from '../src/lib/trade/tr-arrivals.ts';
import { buildPatti, cancelPatti, loadPattis, pattiJournal, postPatti, savePatti, unsettledLots } from '../src/lib/trade/tr-patti.ts';
import { billCommission, commissionOf, indentStatus, indentSummary, loadIndents, markIndent, saveIndent } from '../src/lib/trade/tr-indents.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { buildLedger, loadLedgerInput, trialBalance } from '../src/lib/ledger/index.ts';
import { applyTotals } from '../src/lib/demo-data.ts';
import type { Godown } from '../src/types/stock.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

let farmer = '';
beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['agency', 'commodity'], business_type: 'wholesale', trade_kind: 'agent' } as never);
  localDb.clients.upsert({ ...clientMH });
  localDb.clients.upsert({ ...clientKA });
  farmer = vendorsDb.save({ name: 'Ram Singh (farmer)', principal_kind: 'agriculturist' }).id;
});

const arrive = (over: Record<string, unknown> = {}) =>
  saveArrival({ date: '2026-10-01', principal_id: farmer, principal_name: 'Ram Singh (farmer)', principal_kind: 'agriculturist', lot_no: 'L-1', item_name: 'Mustard', hsn: '1207', unit: 'QTL', packages: 80, qty: 40, produce: 'agricultural', ...over });

const sell = (id: string, date: string, lines: { arrival: string; qty: number; rate: number; godown?: string }[], client = clientMH) =>
  localDb.invoices.save(applyTotals({
    id, invoice_number: '', doc_type: 'INVOICE', issue_date: date, due_date: date, status: 'Sent', currency: 'INR', template_id: 't', client: { ...client }, sender: localDb.settings.activeProfile(),
    items: lines.map((l, i) => ({ id: `${id}-${i}`, name: 'Mustard', type: 'Goods', hsn: '1207', unit: 'QTL', quantity: l.qty, rate: l.rate, tax_rate: 0, discount_percent: 0, amount: l.qty * l.rate, arrival_id: l.arrival, godown_id: l.godown })),
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, agency: true,
  } as InvoiceRecord));

test('an arrival is numbered ARR/FY…, sits in a consignment godown (non-saleable, agency-only) and never in our stock engine', () => {
  const a = arrive();
  assert.match(a.number, /^ARR\/FY26-27\/0*1$/);
  const godowns = getTable<Godown>('godowns');
  const g = godowns.find((x) => x.id === a.godown_id)!;
  assert.equal(g.kind, 'consignment');
  assert.ok(nonSaleableGodowns(godowns).has(g.id), 'consignment is non-saleable for our own sales');
  assert.ok(consignmentGodowns(godowns).has(g.id));
  // Own sale from it refused; agency sale allowed.
  const ns = nonSaleableGodowns(godowns);
  const own = saleLimitGate({ errors: [], warnings: [], expired: [] }, { doc_type: 'INVOICE', items: [{ name: 'Mustard', quantity: 1, godown_id: g.id }] }, { nonSaleable: ns, godownName: () => g.name, agencyOk: consignmentGodowns(godowns) });
  assert.equal(own.errors.length, 1);
  const agency = saleLimitGate({ errors: [], warnings: [], expired: [] }, { doc_type: 'INVOICE', items: [{ name: 'Mustard', quantity: 1, godown_id: g.id, arrival_id: a.id }] }, { nonSaleable: ns, godownName: () => g.name, agencyOk: consignmentGodowns(godowns) });
  assert.equal(agency.errors.length, 0);
  // The stock engine skips agency lines even when the item is a tracked stock item.
  const inv = sell('s1', '2026-10-02', [{ arrival: a.id, qty: 10, rate: 5800, godown: g.id }]);
  const ev = collectEvents({ items: [{ id: 'm', name: 'Mustard', hsn: '1207', unit: 'QTL', track_stock: true, opening_qty: 0 } as never], moves: [], invoices: [inv] });
  assert.equal(ev.get('m')!.length, 0);
});

test('lot balances, shortage and the advance voucher; cancel keeps the number and is refused while sold', () => {
  const a = arrive({ advance: 20000 });
  assert.ok(a.advance_voucher_id);
  const v = loadVouchers().find((x) => x.id === a.advance_voucher_id)!;
  assert.equal(v.type, 'PAYMENT');
  assert.equal(v.voucher_class, 'Arrival advance');
  sell('s1', '2026-10-02', [{ arrival: a.id, qty: 25, rate: 5800 }]);
  const sales = agencySales(localDb.invoices.getAll());
  const [lot] = lotBalances(loadArrivals(), sales);
  assert.deepEqual([lot.sold, lot.balance, lot.amount], [25, 15, 145000]);
  assert.match(lotShortage(a, sales, 16), /only 15 QTL/);
  assert.equal(lotShortage(a, sales, 15), '');
  assert.throws(() => cancelArrival(a.id, 'wrong', localDb.invoices.getAll()), /agency sales/);
  const b = arrive({ lot_no: 'L-2', advance: 500 });
  const c = cancelArrival(b.id, 'typed twice', localDb.invoices.getAll());
  assert.equal(c.status, 'cancelled');
  assert.ok(!loadVouchers().some((x) => x.id === b.advance_voucher_id), 'advance voucher removed');
  assert.match(arrive({ lot_no: 'L-3' }).number, /\/0*3$/, 'a cancelled number is never reused');
});

test('bikri patti maths: gross, aadat %, per-bag hamali, advance → net payable; journal balanced, P&L keeps only commission', () => {
  const a = arrive({ advance: 20000 });
  sell('s1', '2026-10-02', [{ arrival: a.id, qty: 25, rate: 5800 }]);
  sell('s2', '2026-10-03', [{ arrival: a.id, qty: 15, rate: 6000 }], clientKA);
  const ctx = { arrivals: loadArrivals(), sales: agencySales(localDb.invoices.getAll()) };
  const p = buildPatti({ date: '2026-10-04', principalId: farmer, arrivalIds: [a.id], deductions: [{ label: 'Aadat', basis: 'percent', rate: 2.5, aadat: true }, { label: 'Hamali', basis: 'per_package', rate: 4 }, { label: 'Freight', basis: 'fixed', rate: 1500 }] }, { ...ctx, existing: [] });
  assert.equal(p.gross, 235000);
  assert.deepEqual(p.deductions.map((d) => d.amount), [5875, 320, 1500]);
  assert.equal(p.total_deductions, 7695);
  assert.equal(p.advance, 20000);
  assert.equal(p.net_payable, 207305);
  assert.equal(p.commission_gst, 'exempt');
  const j = pattiJournal(p);
  assert.equal(j.reduce((t, l) => t + l.dr, 0), j.reduce((t, l) => t + l.cr, 0));
  assert.deepEqual(j.find((l) => l.account === 'principal'), { account: 'principal', dr: 0, cr: 227305 });
  const saved = savePatti({ date: '2026-10-04', principalId: farmer, arrivalIds: [a.id], deductions: [{ label: 'Aadat', basis: 'percent', rate: 2.5, aadat: true }] }, ctx);
  assert.match(saved.number, /^PAT\/FY26-27\//);
  assert.throws(() => savePatti({ date: '2026-10-04', principalId: farmer, arrivalIds: [a.id], deductions: [] }, ctx), /no agency sales left/, 'a sale is never settled twice');
  assert.equal(unsettledLots(loadArrivals(), ctx.sales, loadPattis()).length, 1, 'a draft patti does not settle');
  const posted = postPatti(saved.id);
  assert.equal(posted.status, 'posted');
  assert.equal(unsettledLots(loadArrivals(), ctx.sales, loadPattis()).length, 0);
  const tb = trialBalance(buildLedger(loadLedgerInput(undefined, '2026-10-31')), { start: '2026-04-01', end: '2026-10-31' });
  assert.ok(Math.abs(tb.totals.debit - tb.totals.credit) < 0.01, 'books balance');
  const bal = (re: RegExp) => tb.rows.filter((r) => re.test(r.account.name)).reduce((t, r) => t - r.closing, 0) / 100; // paise, credit positive
  assert.ok(Math.abs(bal(/^Sales$|Agency sales/i)) < 0.01, 'sales less the agency transfer nets to zero');
  assert.ok(Math.abs(bal(/aadat/i) - 5875) < 0.01, `only the commission stays in income (${bal(/aadat/i)})`);
  cancelPatti(saved.id, 'redo');
  assert.equal(loadPattis()[0].status, 'cancelled');
  assert.ok(!loadVouchers().some((v) => v.id === posted.voucher_id));
});

test('taxable aadat (non-agricultural goods) is left out of the patti journal', () => {
  const a = arrive({ produce: 'other' });
  sell('s1', '2026-10-02', [{ arrival: a.id, qty: 10, rate: 1000 }]);
  const p = buildPatti({ date: '2026-10-04', principalId: farmer, arrivalIds: [a.id], deductions: [{ label: 'Aadat', basis: 'percent', rate: 2, aadat: true }] }, { arrivals: loadArrivals(), sales: agencySales(localDb.invoices.getAll()), existing: [] });
  assert.equal(p.commission_gst, 'taxable');
  assert.deepEqual(pattiJournal(p), [{ account: 'transfer', dr: 10000, cr: 0 }, { account: 'principal', dr: 0, cr: 10000 }]);
});

test('indents: commission, statuses, one draft commission invoice per principal (SAC 996111, 18%, 194H preset)', () => {
  const mill = localDb.clients.getAll()[0];
  const i1 = saveIndent({ date: '2026-10-01', buyer_name: 'B1', principal_id: mill.id!, principal_name: mill.name, item: 'Yarn', qty: 500, rate: 300, commission_basis: 'percent', commission_rate: 1 });
  const i2 = saveIndent({ date: '2026-10-02', buyer_name: 'B2', principal_id: mill.id!, principal_name: mill.name, item: 'Fabric', qty: 1000, rate: 80, commission_basis: 'per_unit', commission_rate: 0.5 });
  assert.match(i1.number, /^IND\/FY26-27\//);
  assert.equal(commissionOf(i1), 1500);
  assert.equal(commissionOf(i2), 500);
  assert.throws(() => billCommission([i1.id], '2026-10-10'), /only dispatched or paid/);
  markIndent(i1.id, 'dispatched', { date: '2026-10-05', ref: 'MILL/1' });
  markIndent(i2.id, 'paid', { date: '2026-10-06' });
  assert.deepEqual(indentSummary(loadIndents(), []), { pending: 0, due: 2000 });
  const [bill] = billCommission([i1.id, i2.id], '2026-10-10');
  assert.equal(bill.items.length, 2);
  assert.ok(bill.items.every((l) => l.hsn === '996111' && l.tax_rate === 18));
  assert.equal(bill.tds_section, '194H');
  assert.equal(bill.taxable_value, 2000);
  assert.ok(loadIndents().every((i) => indentStatus(i, localDb.invoices.getAll()) === 'billed'));
  // Cancelling the invoice frees the indents.
  localDb.invoices.save({ ...localDb.invoices.getById(bill.id)!, status: 'Cancelled' });
  assert.ok(loadIndents().every((i) => indentStatus(i, localDb.invoices.getAll()) !== 'billed'));
});
