/**
 * QA round 10 (docs/prd/qa-round-10.md): regression tests for the Round 9 retail findings R1–R17, built from the QA10
 * probes (`zz-qa10-*`). One test (or more) per finding, named after it.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientMH, clientRetail, createViaStore, installSettings, reload, SELLER_GSTIN } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { balanceOf, payablesOutstanding, paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { billOfDraft, draftsDb } from '../src/lib/purchase-drafts.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A, chartOf, loadUserAccounts } from '../src/lib/ledger/accounts.ts';
import { deleteVoucher } from '../src/lib/ledger/vouchers.ts';
import { applyExchange, buyBackOf, marginLines, openVouchers, recordBuyBack, undoExchange } from '../src/lib/retail/rt-buyback.ts';
import { urdLeft } from '../src/lib/retail/rt-doc-hooks.ts';
import { dealOpen, loadDeals, recordDisbursement, recordFinance } from '../src/lib/retail/rt-finance.ts';
import { restoreEntries, restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import { cashFromCustomer, liveSaleGuards, sameDayCash } from '../src/lib/retail/rt-cash-guard.ts';
import { oldGoldVouchers, recordOldGold } from '../src/lib/retail/rt-old-gold.ts';
import { addAlteration, deleteAlteration, loadAlterations, makeTailorBill, moveAlteration, tailorJobs } from '../src/lib/retail/rt-alterations.ts';
import { karigarLine, recordKarigar } from '../src/lib/retail/rt-karigar.ts';
import { ensureJewelItem } from '../src/lib/retail/rt-jewel-tags.ts';
import { blankStockItem, loadPositions, stockDb } from '../src/lib/inventory.ts';
import { buildGstReport, isMarginCostLine } from '../src/lib/gst-reports.ts';
import { turnoverOf } from '../src/lib/institutions/common-credit.ts';
import { calcInputFromRecord, calculateInvoice } from '../src/lib/invoice-calc.ts';
import { MARGIN_B2B, saveGates, liveMrpIssues } from '../src/lib/stock-tracking.ts';
import { saveRetailSettings } from '../src/lib/retail/rt-settings.ts';
import { addJob, billJob, deleteJob, loadJobs, setClaim, updateJob } from '../src/lib/retail/rt-service-jobs.ts';
import { liveCashWithRiders, loadSettlements, moveDelivery, saveRider, settleRider, undoSettlement } from '../src/lib/retail/rt-delivery.ts';
import { buildVouchers, cashBook, fyPeriod, loadBooksData } from '../src/lib/books.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { receipts } from '../src/lib/accounting-export.ts';
import type { Client, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';

const DAY = '2026-07-20';
const OLD = '356938035643809';
const walkIn: Client = { id: 'c-ravi', name: 'Ravi Kumar', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000009' } as Client;
beforeEach(() => { resetStorage(); installSettings(); freezeDate(`${DAY}T10:00:00`); });
afterEach(() => thawDate());

const net = (account: string, party?: string) => loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === account && (party === undefined || l.party === party)).reduce((s, l) => s + l.dr - l.cr, 0) / 100;
const bin = () => getTable<BinEntry & { row: Record<string, unknown> }>('recycle_bin');
const pays = () => getTable<Payment>('transactions');
const buyBack = () => recordBuyBack({ date: DAY, customer: 'Ravi Kumar', phone: '9800000009', model: 'iPhone 12', serial: OLD, value: 18000, hsn: '8517', taxRate: 18 });
const phoneSale = () => createViaStore({ client: walkIn, date: DAY, lines: [{ name: 'iPhone 15', hsn: '8517', qty: 1, rate: 50000, tax: 18 }], status: 'Sent' });

/* ── R1 / R6 / R7: one root — the URD voucher's settled amount is derived from live rows ── */

test('R1: a buy-back paid in cash is never offered or used again as an exchange (customer paid once)', () => {
  const p = buyBack();
  paymentsDb.record(p.id, { amount: 18000, date: DAY, method: 'Cash' });
  assert.deepEqual(openVouchers(purchasesDb.all(), pays()), [], 'not offered at the POS / desks');
  const sale = phoneSale();
  assert.throws(() => applyExchange(sale.id, p.id), /Nothing left to adjust: .* already settled/);
  assert.equal(reload(sale.id).balance_due, 59000);
  assert.equal(purchasesDb.get(p.id)?.amount_paid, 18000, 'never above the voucher');
  assert.equal(net(A.creditors, 'Ravi Kumar'), 0);
});

test('R1: a part-paid voucher offers only what is left; old-gold list and exchange agree', () => {
  const p = buyBack();
  paymentsDb.record(p.id, { amount: 10000, date: DAY, method: 'Cash' });
  assert.equal(openVouchers(purchasesDb.all(), pays())[0].left, 8000);
  const sale = phoneSale();
  assert.throws(() => applyExchange(sale.id, p.id, 9000), /Only ₹8000.00/);
  applyExchange(sale.id, p.id);
  const v = purchasesDb.get(p.id)!;
  assert.equal(v.amount_paid, 18000);
  assert.equal(balanceOf(v), 0);
  assert.equal(urdLeft(v, pays()), 0);
  assert.equal(reload(sale.id).balance_due, 51000);
  assert.equal(net(A.creditors, 'Ravi Kumar'), 0, 'cash 10,000 + exchange 8,000 settle the 18,000 voucher');
  const g = recordOldGold({ date: DAY, customer: { name: 'Meena', phone: '9800000012' }, metal: 'gold', gross: 10, purity_pct: 100, rate: 10000 });
  paymentsDb.record(g.id, { amount: 40000, date: DAY, method: 'Bank transfer' });
  assert.equal(oldGoldVouchers(purchasesDb.all(), pays()).find((x) => x.id === g.id)?.open, 60000);
  assert.equal(openVouchers(purchasesDb.all(), pays()).find((x) => x.purchase.id === g.id)?.left, 60000, 'the two screens agree');
});

test('R6: deleting a sale settled by exchange frees the voucher; restoring the sale with its receipts settles it again', () => {
  const p = buyBack();
  const sale = phoneSale();
  applyExchange(sale.id, p.id);
  localDb.invoices.remove(sale.id);
  let v = purchasesDb.get(p.id)!;
  assert.equal(v.amount_paid, 0);
  assert.equal(balanceOf(v), 18000, 'payables: owed to the customer again');
  assert.equal(net(A.creditors, 'Ravi Kumar'), -18000, 'ledger agrees');
  assert.equal(openVouchers(purchasesDb.all(), pays())[0].left, 18000, 'offered for exchange again (no double count)');
  const e = bin().find((b) => b.table === 'invoices' && b.row_id === sale.id)!;
  restoreEntry(e.id, { withChildren: true });
  v = purchasesDb.get(p.id)!;
  assert.equal(v.amount_paid, 18000);
  assert.equal(reload(sale.id).balance_due, 41000);
  assert.equal(net(A.creditors, 'Ravi Kumar'), 0);
});

test('R6: cancelling a sale settled by exchange frees the voucher too', () => {
  const p = buyBack();
  const sale = phoneSale();
  applyExchange(sale.id, p.id);
  localDb.invoices.setStatus(sale.id, 'Cancelled');
  assert.equal(pays().filter((x) => x.exchange_purchase_id).length, 0);
  assert.equal(balanceOf(purchasesDb.get(p.id)!), 18000);
});

test('R7: restoring an undone exchange receipt settles the voucher again; refused once the voucher was paid', () => {
  const p = buyBack();
  const sale = phoneSale();
  const x = applyExchange(sale.id, p.id);
  undoExchange(x.id);
  assert.equal(balanceOf(purchasesDb.get(p.id)!), 18000);
  const e = bin().find((b) => b.table === 'transactions' && b.row_id === x.id)!;
  restoreEntry(e.id);
  const v = purchasesDb.get(p.id)!;
  assert.equal(v.amount_paid, 18000);
  assert.equal(balanceOf(v), 0, 'payables no longer ask to pay the customer');
  assert.equal(reload(sale.id).balance_due, 41000);
  assert.equal(net(A.creditors, 'Ravi Kumar'), 0);
  // Undo again, pay the customer in cash, then try to restore: refused (it would settle the voucher twice).
  undoExchange(x.id);
  paymentsDb.record(p.id, { amount: 18000, date: DAY, method: 'Cash' });
  const e2 = [...bin()].reverse().find((b) => b.table === 'transactions' && b.row_id === x.id)!;
  assert.throws(() => restoreEntry(e2.id), /was paid or used in another exchange/);
  assert.equal(purchasesDb.get(p.id)?.amount_paid, 18000);
});

/* ── R2 karigar ── */

test('R2: a karigar receipt brings the pieces in at the consumed metal cost (closing stock kept), by weight and by tags', () => {
  installSettings({ business_type: 'kirana', retail_kind: 'jewellery', industry_packs: ['jewellery'] } as never);
  const total = () => Math.round(loadPositions().reduce((s, p) => s + p.value, 0));
  const salim = { id: 'v-salim', name: 'Salim' };
  const metal = blankStockItem({ name: 'Fine gold 24K', unit: 'GMS', opening_qty: 100, opening_rate: 10000 });
  stockDb.saveItem(metal);
  const bangles = blankStockItem({ name: 'Bangles 22K (by g)', unit: 'GMS', hsn: '7113', tax_rate: 3 });
  stockDb.saveItem(bangles);
  recordKarigar({ date: '2026-07-01', karigar: salim, kind: 'issue', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 50, touch_pct: 100 })] });
  assert.equal(total(), 1000000);
  recordKarigar({ date: '2026-07-10', karigar: salim, kind: 'receipt', lines: [karigarLine({ item_id: bangles.id, item_name: bangles.name, metal: 'gold', purity: '22K', gross_wt: 52.1, touch_pct: 91.6 })], wastage_pct: 1.5, consume_item_id: metal.id });
  assert.equal(total(), 1000000, 'K1: was ₹5,15,600');
  assert.equal(Math.round(loadPositions().find((p) => p.item.id === bangles.id)!.value), 484400, '48.44 g of fine gold at ₹10,000');
  // K2: four tags.
  const chains = ensureJewelItem('Chains 22K');
  recordKarigar({ date: '2026-07-11', karigar: salim, kind: 'issue', lines: [karigarLine({ item_id: metal.id, item_name: metal.name, metal: 'gold', purity: '24K', gross_wt: 50, touch_pct: 100 })] });
  const line = karigarLine({ item_id: chains.id, item_name: chains.name, metal: 'gold', purity: '22K', gross_wt: 52.1, touch_pct: 91.6, pieces: 4 });
  recordKarigar({ date: '2026-07-20', karigar: salim, kind: 'receipt', lines: [line], wastage_pct: 1.5, consume_item_id: metal.id, tags: [13.0, 13.1, 13.0, 13.0].map((g) => ({ item_id: chains.id, metal: 'gold' as const, purity: '22K', gross_wt: g })) });
  assert.equal(total(), 1000000, 'K2: tags too');
  assert.ok(loadPositions().find((p) => p.item.id === chains.id)!.value > 484000);
});

/* ── R3 / R17 rider cash ── */

const codOrder = () => createViaStore({ date: DAY, lines: [{ name: 'Rice', qty: 2, rate: 620, tax: 0 }], status: 'Sent', patch: { pos: true, delivery: { address: '12 Park Lane', status: 'packed', cod: true, phone: '9800000002' } } as never });

test('R3: COD cash reaches the Books cash book once — through the rider settlement (cash book = ledger cash)', () => {
  const rider = saveRider({ name: 'Raju' });
  const a = codOrder();
  moveDelivery(a.id, 'out', DAY, rider.id);
  moveDelivery(a.id, 'delivered', DAY);
  assert.equal(cashBook(buildVouchers(loadBooksData()), [], 'cash', fyPeriod(2026)).closing, 0, 'with the rider: not in the cash book yet');
  settleRider({ riderId: rider.id, day: DAY, counted: 1240 });
  const cb = cashBook(buildVouchers(loadBooksData()), [], 'cash', fyPeriod(2026));
  assert.equal(cb.closing, 1240, 'was ₹2,480');
  assert.equal(cb.closing, net(A.cash));
  assert.ok(buildVouchers(loadBooksData()).some((v) => v.type === 'Receipt' && v.invoice_id === a.id && !v.account), 'the receipt stays in the day book, in no cash book');
});

test('R17: the rider-settlement journal is not deleted on its own; Undo settlement removes both and the bin restores both', () => {
  const rider = saveRider({ name: 'Raju' });
  const a = codOrder();
  moveDelivery(a.id, 'out', DAY, rider.id);
  moveDelivery(a.id, 'delivered', DAY);
  const s = settleRider({ riderId: rider.id, day: DAY, counted: 1240 });
  assert.throws(() => deleteVoucher(s.voucher_id), /Undo the settlement/);
  const riderAcc = chartOf(loadUserAccounts()).find((x) => x.name === 'Cash with riders')!.id;
  undoSettlement(s.id);
  assert.equal(liveCashWithRiders(DAY), 1240, 'the rider holds the cash again');
  assert.equal(net(riderAcc), 1240, 'Z report and ledger agree');
  const e = bin().find((b) => b.table === 'rider_settlements' && b.row_id === s.id)!;
  const voucherEntry = bin().find((b) => b.table === 'vouchers' && b.row_id === s.voucher_id)!;
  assert.throws(() => restoreEntry(voucherEntry.id), /restore the rider settlement itself/);
  restoreEntries([e.id]);
  assert.equal(loadSettlements().length, 1);
  assert.equal(liveCashWithRiders(DAY), 0);
  assert.equal(net(riderAcc), 0);
  // Re-settling after an undo is possible (and then restoring the old one is refused).
  undoSettlement(s.id);
  settleRider({ riderId: rider.id, day: DAY, counted: 1240 });
  const again = [...bin()].reverse().find((b) => b.table === 'rider_settlements' && b.row_id === s.id)!;
  assert.throws(() => restoreEntries([again.id]), /settled again since/);
});

/* ── R4 / R12 margin scheme ── */

test('R4: the margin-scheme cost part is in no GST table (Table 8, 3.1(c), HSN 0%, Rule 42 exempt turnover)', () => {
  buyBack();
  const bb = buyBackOf(OLD, purchasesDb.all())!;
  const draft = createViaStore({ client: { ...walkIn, id: 'c2', name: 'Asha' } as Client, date: DAY, lines: [{ name: 'iPhone 12 (used)', hsn: '8517', qty: 1, rate: 22000, tax: 18 }], inclusive: true, asDraft: true });
  const items = marginLines({ ...draft.items[0], serials: [OLD] }, { id: bb.purchase.id, value: bb.value }, true, () => 'm1');
  assert.ok(items.some(isMarginCostLine));
  const rec = { ...draft, items };
  const saved = localDb.invoices.save({ ...rec, ...calculateInvoice(calcInputFromRecord(rec)), status: 'Sent' } as never);
  assert.equal(reload(saved.id).total, 22000);
  const r = buildGstReport(localDb.invoices.getAll(), purchasesDb.all(), { period: { kind: 'month', fyStart: 2026, month: 7 } as never, gstin: SELLER_GSTIN });
  assert.deepEqual(r.gstr1.nil, [], 'Table 8: was INTRAB2C nil 18,000');
  assert.deepEqual(r.gstr1.hsn.map((h) => [h.hsn, (h as never as { rate: number }).rate]), [['8517', 18]], 'no 8517 @ 0% row');
  assert.equal(r.gstr1.b2cs[0].txval, 3389.83);
  assert.deepEqual(r.gstr3b.outward.nilExempt, { inter: 0, intra: 0 }, '3.1(c)');
  assert.deepEqual(turnoverOf(r.gstr3b as never), { E: 0, F: 3389.83 }, 'Rule 42: no exempt turnover');
  const note = r.issues.find((i) => i.code === 'MARGIN_SCHEME');
  assert.match(note?.message ?? '', /Rule 32\(5\).*verify with your CA/);
});

test('R12: margin lines to a registered (GSTIN) buyer are refused on issue (editor save gate and the counter)', () => {
  const items = [{ id: 'a', name: 'x', quantity: 1, rate: 18000, tax_rate: 0, amount: 18000, margin: { purchase_id: 'p', purchase_value: 18000, part: 'cost' } }] as never;
  const run = (client: Client) => [...saveGates].flatMap((g) => g({ doc_type: 'INVOICE', total: 22000, issue_date: DAY, items, client } as never));
  assert.deepEqual(run(clientMH), [MARGIN_B2B]);
  assert.deepEqual(run(walkIn), []);
  assert.deepEqual([...saveGates].flatMap((g) => g({ doc_type: 'INVOICE', total: 1, issue_date: DAY, items: [{ id: 'b', name: 'y', quantity: 1, rate: 1, tax_rate: 18, amount: 1 }], client: clientMH } as never)), [], 'ordinary lines pass');
});

/* ── R5 Tally ── */

test('R5: Tally exports an exchange as a journal between the customer\'s creditor and debtor ledgers (nets to ₹41,000 due)', () => {
  const p = buyBack();
  const sale = phoneSale();
  applyExchange(sale.id, p.id);
  const src = { invoices: localDb.invoices.getAll(), payments: pays(), clients: [walkIn], items: [], purchases: purchasesDb.all(), vendors: vendorsDb.all() };
  const b = buildTallyModel(src as never, { companyName: 'X', includeReceipts: true, includePurchases: true } as never);
  const ledgers = b.ledgers.filter((l) => /Ravi|exchange/i.test(l.name));
  assert.deepEqual(Object.fromEntries(ledgers.map((l) => [l.name, l.parent])), { 'Ravi Kumar': 'Sundry Debtors', 'Ravi Kumar (Creditor)': 'Sundry Creditors' });
  const bal = (name: string) => b.vouchers.flatMap((v) => v.entries).filter((e) => e.ledger === name).reduce((s, e) => s + (e.side === 'Dr' ? e.paise : -e.paise), 0) / 100;
  assert.equal(bal('Ravi Kumar'), 41000, 'the customer owes the balance of the bill');
  assert.equal(bal('Ravi Kumar (Creditor)'), 0, 'the URD voucher is settled by the exchange');
  const j = b.vouchers.find((v) => v.type === 'Journal')!;
  assert.deepEqual(j.entries.map((e) => [e.ledger, e.side, e.paise]), [['Ravi Kumar (Creditor)', 'Dr', 1800000], ['Ravi Kumar', 'Cr', 1800000]]);
  assert.ok(!b.vouchers.some((v) => v.type === 'Receipt' && v.entries.some((e) => /exchange/i.test(e.ledger))));
  const csv = receipts(src as never);
  assert.equal(csv.rows[0][5], 'Ravi Kumar (Creditor)', 'receipts CSV: deposited to the creditor ledger');
});

/* ── R8 finance ── */

const tvSale = () => createViaStore({ client: clientRetail, date: DAY, lines: [{ name: 'TV', hsn: '8528', qty: 1, rate: 42000, tax: 0 }], status: 'Sent' });
const clearingNet = () => loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => String(l.account).startsWith('bank:')).reduce((s, l) => s + l.dr - l.cr, 0) / 100;

test('R8: deleting a finance sale cancels its DO and transfer journal; restoring the bill brings them back together', () => {
  const inv = tvSale();
  const deal = recordFinance({ invoiceId: inv.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-1' });
  localDb.invoices.remove(inv.id);
  assert.equal(loadDeals().length, 0);
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 0, 'was 33,600');
  assert.equal(clearingNet(), 0, 'was −33,600');
  const e = bin().find((b) => b.table === 'invoices' && b.row_id === inv.id)!;
  restoreEntry(e.id, { withChildren: true });
  assert.equal(loadDeals().length, 1);
  assert.equal(loadDeals()[0].id, deal.id);
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 33600);
  assert.equal(net(A.debtors, clientRetail.name), 8400);
  assert.equal(clearingNet(), 0);
});

test('R8: cancelling a finance sale cancels its DO; refused once the financier paid', () => {
  const inv = tvSale();
  recordFinance({ invoiceId: inv.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-1' });
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  assert.equal(net(A.debtors, 'Bajaj Finserv'), 0);
  assert.equal(net(A.debtors, clientRetail.name), 0, 'was −33,600');
  const inv2 = tvSale();
  const d = recordFinance({ invoiceId: inv2.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-2' });
  recordDisbursement(d.id, { date: DAY, amount: 33600 });
  assert.throws(() => localDb.invoices.remove(inv2.id), /Undo that disbursement/);
  assert.throws(() => localDb.invoices.setStatus(inv2.id, 'Cancelled'), /Undo that disbursement/);
  assert.notEqual(reload(inv2.id).status, 'Cancelled');
  assert.equal(dealOpen(loadDeals().find((x) => x.id === d.id)!), 0);
});

/* ── R9 repairs ── */

test('R9: an all-warranty repair job is billed once (zero-value stamp); deleting it returns the parts, restoring re-issues them', () => {
  const part = blankStockItem({ name: 'Display Redmi 13', unit: 'NOS', opening_qty: 5, opening_rate: 1500 });
  stockDb.saveItem(part);
  const j = addJob({ date: DAY, customer: clientRetail.name, phone: '9800000010', asset: { model: 'Redmi 13', serial: '1' }, complaint: 'Broken screen' });
  updateJob(j.id, { parts: [{ id: '', item_id: part.id, name: 'Display Redmi 13', qty: 1, rate: 1500, tax_rate: 18, warranty: true }] as never });
  setClaim(j.id, { vendor_name: 'Xiaomi', status: 'sent' } as never);
  setClaim(j.id, { vendor_name: 'Xiaomi', status: 'approved' } as never);
  const qty = () => loadPositions().find((p) => p.item.id === part.id)?.qty;
  assert.equal(billJob(j.id, DAY), undefined, 'nothing chargeable');
  assert.throws(() => billJob(j.id, DAY), /already billed/);
  assert.throws(() => billJob(j.id, DAY), /already billed/);
  assert.equal(qty(), 4, 'was 2 after three clicks');
  assert.equal(loadJobs()[0].billed_on, DAY);
  assert.throws(() => updateJob(j.id, { labour: 100 }), /billed/);
  deleteJob(j.id);
  assert.equal(qty(), 5, 'the warranty issue goes with the job');
  const e = bin().find((b) => b.table === 'service_jobs' && b.row_id === j.id)!;
  restoreEntry(e.id);
  assert.equal(qty(), 4, 'and comes back with it');
});

/* ── R10 / R13 / R14 cash and PAN guards ── */

const asha: Client = { id: 'c-asha', name: 'Asha', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000011' } as Client;

test('R10: Sec 269ST adds the bill\'s own cash on earlier days (single transaction), in block mode', () => {
  setJson(`${DB_PREFIX}retail_settings`, { cash_guard: 'block', require_pan: true });
  const inv = createViaStore({ client: asha, date: '2026-07-19', lines: [{ name: 'Necklace', hsn: '7113', qty: 1, rate: 300000, tax: 0 }], status: 'Sent', patch: { kyc: { pan: 'ABCDE1234F' } } as never });
  localDb.payments.record({ invoiceId: inv.id, amount: 190000, method: 'Cash', date: '2026-07-19' });
  const g = liveSaleGuards(reload(inv.id), 50000, DAY);
  assert.equal(g[0]?.level, 'error');
  assert.match(g[0].message, /₹2,40,000/);
  assert.deepEqual(liveSaleGuards(reload(inv.id), 9999, DAY), [], '₹1,99,999 on the bill passes');
  // Another bill of the same customer on another day does not count (per person: same day only).
  const other = createViaStore({ client: asha, date: DAY, lines: [{ name: 'Ring', hsn: '7113', qty: 1, rate: 50000, tax: 0 }], status: 'Sent' });
  assert.equal(cashFromCustomer(pays(), localDb.invoices.getAll(), reload(other.id), DAY), 0);
});

test('R13: the counter strip and the payment dialog count the day\'s cash the same way (refunds never net)', () => {
  const a = createViaStore({ client: asha, date: DAY, lines: [{ name: 'TV', hsn: '8528', qty: 1, rate: 150000, tax: 0 }], status: 'Sent' });
  localDb.payments.record({ invoiceId: a.id, amount: 150000, method: 'Cash', date: DAY });
  const rows = [...pays(), { id: 'r1', invoice_id: a.id, amount: -100000, method: 'Cash', date: DAY } as Payment];
  const invoices = getTable<InvoiceRecord>('invoices');
  assert.equal(sameDayCash(asha, DAY, invoices, rows), 150000, 'was 50,000');
  assert.equal(cashFromCustomer(rows, invoices, { id: 'new', client: asha }, DAY), 150000);
});

test('R14: an old-gold voucher needs PAN only ABOVE ₹2 lakh, as a sale does (one rule)', () => {
  assert.doesNotThrow(() => recordOldGold({ date: DAY, customer: { name: 'Meena', phone: '9800000012' }, metal: 'gold', gross: 20, purity_pct: 100, rate: 10000 }));
  assert.throws(() => recordOldGold({ date: DAY, customer: { name: 'Meena', phone: '9800000012' }, metal: 'gold', gross: 20.001, purity_pct: 100, rate: 10000 }), /PAN/);
});

/* ── R11 MRP per alternate unit ── */

test('R11: a batch MRP typed on a strip line is per strip (stored per tablet), so the guard sees a strip sold above it', () => {
  saveRetailSettings({ mrp_guard: 'block' });
  setTable('stock_items', [{ id: 's1', name: 'Paracetamol 500', unit: 'TAB', track_stock: true, track_batches: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, alt_units: [{ unit: 'STRIP', factor: 10 }] }]);
  setTable('purchases', [{ id: 'p1', kind: 'PURCHASE', vendor_name: 'V', bill_number: 'B1', date: '2026-07-01', status: 'unpaid', lines: [{ id: 'pl', name: 'Paracetamol 500', unit: 'STRIP', unit_factor: 10, quantity: 10, rate: 40, tax_rate: 0, batch_no: 'B1', mrp: 62 }], taxable: 400, cgst: 0, sgst: 0, igst: 0, total: 400, amount_paid: 0, itc_eligible: true }]);
  const doc = (rate: number) => ({ doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-07-10', items: [{ id: 'l1', name: 'Paracetamol 500', unit: 'STRIP', unit_factor: 10, quantity: 1, rate, tax_rate: 0, amount: rate, batch_no: 'B1' }] }) as never;
  const flagged = (rate: number) => { const r = liveMrpIssues(doc(rate)); return [...r.errors, ...r.warnings, ...r.confirm].join(' '); };
  assert.equal(flagged(62), '', 'a strip at its MRP passes');
  assert.match(flagged(90), /MRP ₹6\.20/, 'a strip at ₹90 is above ₹62 a strip (was silent until ₹621)');
});

/* ── R15 / R16 ── */

test('R15: the financier\'s fee bill shows as settled by the disbursement voucher once posted', () => {
  const inv = tvSale();
  const d = recordFinance({ invoiceId: inv.id, financier: 'Bajaj Finserv', loan: 33600, doNo: 'D-1' });
  const after = recordDisbursement(d.id, { date: DAY, amount: 32420, fee: 1180 });
  const draft = draftsDb.get(after.disbursements[0].draft_id!)!;
  const bill = purchasesDb.save({ ...billOfDraft(draft), id: draft.id, amount_paid: 0 });
  draftsDb.remove(draft.id, { keepFiles: true });
  assert.equal(balanceOf(bill), 0, 'was 1,180');
  assert.equal(payablesOutstanding(purchasesDb.all()), 0);
  assert.equal(net(A.creditors, 'Bajaj Finserv'), 0, 'ledger agrees');
  assert.throws(() => paymentsDb.record(bill.id, { amount: 1180, date: DAY, method: 'Cash' }));
});

test('R16: discarding a tailor-bill draft frees its alteration slips (billable again, deletable)', async () => {
  const j = addAlteration({ date: DAY, customer: 'Asha', garment: 'Kurta', due: DAY, tailor_id: 't1', tailor_name: 'Ramesh', tailor_rate: 120 });
  moveAlteration(j.id, 'with_tailor', DAY); moveAlteration(j.id, 'ready', DAY); moveAlteration(j.id, 'delivered', DAY);
  const r = await makeTailorBill({ id: 't1', name: 'Ramesh' }, '2026-07-01', '2026-07-31');
  assert.equal(tailorJobs(loadAlterations(), 't1', '2026-07-01', '2026-07-31').length, 0, 'billed while the draft lives');
  assert.throws(() => deleteAlteration(j.id), /delete the tailor bill first/);
  draftsDb.remove(r.id);
  assert.equal(tailorJobs(loadAlterations(), 't1', '2026-07-01', '2026-07-31').length, 1, 'was 0');
  const again = await makeTailorBill({ id: 't1', name: 'Ramesh' }, '2026-07-01', '2026-07-31');
  // Posted as a bill (same id): still billed.
  const d = draftsDb.get(again.id)!;
  purchasesDb.save({ ...billOfDraft(d), id: d.id });
  draftsDb.remove(d.id, { keepFiles: true });
  assert.equal(tailorJobs(loadAlterations(), 't1', '2026-07-01', '2026-07-31').length, 0);
  assert.throws(() => deleteAlteration(j.id), /delete the tailor bill first/);
  purchasesDb.remove(d.id);
  assert.doesNotThrow(() => deleteAlteration(j.id), 'was refused');
});
