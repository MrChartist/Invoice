/**
 * QA round 13 (agriculture vertical, Round 12 AG-A / AG-B / AG-C): one regression per finding G1…Gn
 * (docs/prd/qa-round-13.md).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { saveFarmer } from '../src/lib/agri/ag-farmers.ts';
import { closeCycle, loadCycles, payCycle, reopenCycle, saveCycleDraft } from '../src/lib/agri/ag-cycle-post.ts';
import { saveChart } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry, closeShift, loadShifts, reopenShift } from '../src/lib/agri/ag-shifts.ts';
import { closeMilkCycle, makeMilkCycle } from '../src/lib/agri/ag-milk-cycle.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const bin = () => getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
const cyclePurchases = (id: string) => getTable<PurchaseRecord>('purchases').filter((p) => p.ag?.cycle_id === id);

/* ── G1: a cycle with a carried / over-deducted farmer can be paid, and the pooled bill ends settled ── */

test('G1: deductions above one farmer\'s milk money: pay works, the bill is settled; next cycle\'s carry settles too', () => {
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const sita = saveFarmer({ name: 'Sita', ag: { code: 'F-0002' } });
  const d1 = saveCycleDraft({ period_from: '2026-10-01', period_to: '2026-10-10', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 20, unit: 'KG', amount: 1000, deductions: [{ kind: 'advance', amount: 1500 }], net: 0, mode: 'cash' },
    { farmer_id: sita.id, name: 'Sita', qty: 20, unit: 'KG', amount: 1000, deductions: [], net: 0, mode: 'cash' },
  ] });
  closeCycle(d1.id);
  payCycle(d1.id, '2026-10-12');
  const b1 = purchasesDb.get(cyclePurchases(d1.id)[0].id)!;
  assert.equal(b1.amount_paid, b1.total, 'cycle 1 bill settled (deductions + carry + cash)');
  const d2 = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 20, unit: 'KG', amount: 1000, carried: -500, deductions: [], net: 0, mode: 'cash' },
  ] });
  closeCycle(d2.id);
  payCycle(d2.id, '2026-10-22');
  const b2 = purchasesDb.get(cyclePurchases(d2.id)[0].id)!;
  assert.equal(b2.amount_paid, b2.total, 'cycle 2 bill settled: the carried-in recovery is not left as a payable');
});

/* ── G2: a reopened cycle's old bill / set-off receipt / deductions journal never come back next to the re-close ── */

test('G2: after reopen + close again, the old pooled bill, set-off receipt and journal stay in the bin', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const client = { ...clientMH, id: 'c-ram', name: 'Ram', ag: { code: 'F-0001' } };
  const feed = createViaStore({ client, date: '2026-10-05', lines: [{ name: 'Cattle feed', qty: 1, rate: 400, tax: 0, hsn: '2309' }] });
  const d = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 50, unit: 'KG', amount: 2500, deductions: [{ kind: 'feed', ref_id: feed.id, amount: 400 }, { kind: 'share', amount: 100 }], net: 0, mode: 'cash' },
  ] });
  const first = closeCycle(d.id);
  reopenCycle(d.id);
  const again = closeCycle(d.id);
  assert.notEqual(again.purchase_id, first.purchase_id);
  const entry = (table: string, id?: string) => bin().find((x) => x.table === table && x.row_id === id);
  assert.throws(() => restoreEntry(entry('purchases', first.purchase_id)!.id), /closed again|cycle/i, 'old pooled bill');
  assert.throws(() => restoreEntry(entry('transactions', first.receipt_ids![0])!.id), /closed again|cycle|gone/i, 'old set-off receipt');
  assert.throws(() => restoreEntry(entry('vouchers', first.journal_id)!.id), /twice|again/i, 'old deductions journal');
  assert.equal(cyclePurchases(d.id).length, 1);
  assert.equal(getTable<Payment>('transactions').filter((p) => p.invoice_id === feed.id).length, 1);
  assert.equal(loadVouchers().filter((v) => v.voucher_class === 'Farmer cycle deductions').length, 1);
  // A stray delete of the live pooled bill (cycle still closed and naming it) still restores.
  purchasesDb.remove(again.purchase_id!, { confirmStock: true });
  restoreEntry(entry('purchases', again.purchase_id)!.id);
  assert.ok(purchasesDb.get(again.purchase_id!));
});

test('G3b: a deleted milk draft does not come back next to the milk bill made again for that centre and period', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const { deleteCycle } = await import('../src/lib/agri/ag-cycle-post.ts');
  saveChart(cowMatrix());
  const f = vendorsDb.save({ name: 'Ramesh', ag: { code: 'F-0001', centre_id: 'c1' } }) as Vendor;
  const { shift } = addEntry({ centre_id: 'c1', date: '2026-11-02', shift: 'M' }, { farmer_id: f.id, name: f.name, milk: 'cow', qty: 10, unit: 'L', fat: 3.7, snf: 8.6 });
  closeShift(shift.id);
  const old = makeMilkCycle('c1', '2026-11-01', '2026-11-10');
  deleteCycle(old.id);
  makeMilkCycle('c1', '2026-11-01', '2026-11-10');
  assert.throws(() => restoreEntry(bin().find((x) => x.table === 'farmer_cycles' && x.row_id === old.id)!.id), /twice/);
});

/* ── G3: a milk draft whose shifts changed since it was made is not closed with stale lines ── */

test('G3: shift reopened and changed after the draft → closing the stale draft is refused; remade it closes', () => {
  saveChart(cowMatrix());
  const f = vendorsDb.save({ name: 'Ramesh', ag: { code: 'F-0001', centre_id: 'c1' } }) as Vendor;
  const k = { centre_id: 'c1', date: '2026-11-02', shift: 'M' as const };
  const { shift } = addEntry(k, { farmer_id: f.id, name: f.name, milk: 'cow', qty: 10, unit: 'L', fat: 3.7, snf: 8.6 });
  closeShift(shift.id);
  const c = makeMilkCycle('c1', '2026-11-01', '2026-11-10');
  reopenShift(shift.id);
  addEntry(k, { farmer_id: f.id, name: f.name, milk: 'cow', qty: 5, unit: 'L', fat: 3.7, snf: 8.6 }, { allowDuplicate: true });
  closeShift(shift.id);
  assert.throws(() => closeMilkCycle(c.id), /changed|again/i);
  assert.throws(() => closeCycle(c.id), /changed|again/i, 'Farm → Cycles close too');
  makeMilkCycle('c1', '2026-11-01', '2026-11-10', c.id);
  const done = closeMilkCycle(c.id);
  assert.equal(done.lines[0].qty, 15);
  assert.ok(loadShifts().every((s) => s.cycle_id === c.id));
  assert.equal(loadCycles().length, 1);
});

/* ── G4: a milk dispatch bill does not take the milk out of stock a second time ── */

test('G4: shift 50 L → dispatch 40 L → bill the union: stock stays 10 L; a milk-card bill still moves stock', async () => {
  const { localDb } = await import('../src/lib/localDb.ts');
  const { loadPositions } = await import('../src/lib/inventory.ts');
  const { billDispatch, saveDispatch } = await import('../src/lib/agri/ag-dispatch.ts');
  const { billCard, saveCard } = await import('../src/lib/agri/ag-milk-cards.ts');
  saveChart(cowMatrix());
  const union = localDb.clients.upsert({ name: 'District Milk Union' });
  saveChart(cowMatrix({ name: 'Union cow', buyer_id: union, basis: 'flat', unit: 'KG', flat_rate: 40, matrix: undefined }));
  const { shift } = addEntry({ centre_id: 'c1', date: '2026-11-05', shift: 'M' }, { farmer_id: 'f1', milk: 'cow', qty: 50, unit: 'L', fat: 4, snf: 8.5 });
  closeShift(shift.id);
  const milk = () => loadPositions().find((p) => p.item.name === 'Cow milk')?.qty;
  const d = saveDispatch({ date: '2026-11-05', shift: 'M', centre_id: 'c1', buyer_id: union, milk: 'cow', sent: { qty: 40, unit: 'L', fat: 4, snf: 8.5 } });
  assert.equal(milk(), 10);
  billDispatch(d.id);
  assert.equal(milk(), 10, 'the bill (in kg, on the union\'s figures) moves no stock');
  const home = localDb.clients.upsert({ name: 'Sharma household' });
  const card = saveCard({ client_id: home, client_name: 'Sharma', month: '2026-11', milk: 'cow', rate: 60, default_qty: 0, days: { 6: 2 } });
  billCard(card.id, '2026-11-30');
  assert.equal(milk(), 8, 'local sale on a card still leaves stock');
});

/* ── G5: the e-Way preflight says "may not be needed" for exempt-only goods (AG-C4 leftover) ── */

test('G5: exempt-only goods → EWB_EXEMPT note (same text as ewayHint); taxable goods → none', async () => {
  const { preflightEway } = await import('../src/lib/einvoice-validate.ts');
  const { EXEMPT_EWAY_NOTE } = await import('../src/lib/agri/ag-packing.ts');
  const { invoice, item } = await import('./einvoice-fixtures.ts');
  const road = { mode: 'road' as const, vehicle: 'MH12AB1234', distance: 120 };
  const paddy = preflightEway(invoice({ items: [item({ name: 'Paddy', hsn: '1006', quantity: 100, rate: 2300, tax_rate: 0 })] }), { transport: road, now: new Date(2025, 5, 20) });
  const w = paddy.warnings.find((x) => x.code === 'EWB_EXEMPT');
  assert.equal(w?.message, EXEMPT_EWAY_NOTE);
  const taxed = preflightEway(invoice({ items: [item({ quantity: 10, rate: 10000 })] }), { transport: road, now: new Date(2025, 5, 20) });
  assert.ok(!taxed.warnings.some((x) => x.code === 'EWB_EXEMPT'));
});

/* ── G6: the 25 kg rule and the class notice reach lines typed in the editor / POS (class from the stock item) ── */

test('G6: a labelled 25 kg rice bag sold at nil is flagged (5%); 5 kg loose from the bag is not', async () => {
  const { agExceptions } = await import('../src/lib/agri/ag-hooks.ts');
  const { blankStockItem, stockDb } = await import('../src/lib/inventory.ts');
  stockDb.saveItem(blankStockItem({ name: 'Sona rice 25 kg', unit: 'BAG', hsn: '1006', ag_class: 'cereal_loose', ag_pack_kg: 25, ag_labelled: true }));
  const inv = (lines: { quantity: number; unit: string; tax_rate: number; unit_factor?: number }[]) =>
    ({ issue_date: '2026-10-05', items: lines.map((l, i) => ({ id: `l${i}`, name: 'Sona rice 25 kg', hsn: '1006', rate: 1500, amount: 0, ...l })) }) as never;
  const bag = agExceptions(inv([{ quantity: 2, unit: 'BAG', tax_rate: 0 }]));
  assert.equal(bag.length, 1, 'a whole labelled 25 kg bag at nil is flagged');
  assert.equal(bag[0].vars.want, 5);
  assert.deepEqual(agExceptions(inv([{ quantity: 5, unit: 'KG', tax_rate: 0 }])), [], 'loose 5 kg from the bag (counter sale) stays nil');
  assert.deepEqual(agExceptions(inv([{ quantity: 0.2, unit: 'BAG', tax_rate: 0 }])), [], 'a fifth of a bag is loose too');
  assert.equal(agExceptions(inv([{ quantity: 2, unit: 'BAG', tax_rate: 5 }])).length, 0, 'right rate → no notice');
});

/* ── G7: opening an agri document in the editor keeps each line's class ── */

test('G7: normalizeRecord keeps ag_class on lines (milk bill, milling charges, cattle-feed invoice)', async () => {
  const { normalizeRecord } = await import('../src/store/invoice-defaults.ts');
  const rec = normalizeRecord({ id: 'x', doc_type: 'BILL_OF_SUPPLY', issue_date: '2026-10-05', items: [{ id: 'a', name: 'Cow milk', quantity: 1, rate: 50, tax_rate: 0, ag_class: 'milk_fresh' }, { id: 'b', name: 'Feed', quantity: 1, rate: 50, tax_rate: 0, ag_class: 'cattle_feed' }] });
  assert.deepEqual(rec.items.map((i) => i.ag_class), ['milk_fresh', 'cattle_feed']);
});

/* ── G8: one feed invoice is never set off twice (two drafts, or paid since the draft) ── */

test('G8: two drafts pulling the same feed invoice → the second close is refused; a partly paid invoice too', async () => {
  const { inputDeductions } = await import('../src/lib/agri/ag-cycles.ts');
  const { localDb } = await import('../src/lib/localDb.ts');
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const client = { ...clientMH, id: 'c-ram', name: 'Ram', ag: { code: 'F-0001' } };
  const feed = createViaStore({ client, date: '2026-10-05', lines: [{ name: 'Cattle feed', qty: 1, rate: 400, tax: 0, hsn: '2309' }] });
  const ded = inputDeductions('F-0001', [client], getTable('invoices'), getTable('transactions'), 5000);
  const line = { farmer_id: ram.id, name: 'Ram', qty: 50, unit: 'KG', amount: 2500, deductions: ded, net: 0, mode: 'cash' as const };
  const a = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [line] });
  const b = saveCycleDraft({ period_from: '2026-10-21', period_to: '2026-10-31', source: 'produce', lines: [line] });
  closeCycle(a.id);
  assert.throws(() => closeCycle(b.id), /only 0\.00 left/);
  assert.equal(loadCycles().find((c) => c.id === b.id)?.status, 'draft', 'rolled back');
  assert.deepEqual(getTable<Payment>('transactions').filter((p) => p.invoice_id === feed.id).map((p) => p.amount), [400]);
  // Paid ₹100 in cash after the draft was made → the stale ₹400 set-off is refused.
  const feed2 = createViaStore({ client, date: '2026-10-06', lines: [{ name: 'Cattle feed', qty: 1, rate: 400, tax: 0, hsn: '2309' }] });
  const d2 = inputDeductions('F-0001', [client], getTable('invoices'), getTable('transactions'), 5000);
  const c = saveCycleDraft({ period_from: '2026-11-01', period_to: '2026-11-10', source: 'produce', lines: [{ ...line, deductions: d2 }] });
  localDb.payments.record({ invoiceId: feed2.id, amount: 100, method: 'Cash', date: '2026-11-02' });
  assert.throws(() => closeCycle(c.id), /only 300\.00 left/);
});
