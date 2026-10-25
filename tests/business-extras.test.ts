/** WP-9: loyalty accrual / redemption, AMC schedules and reminders, catalogue HTML, dashboard tiles, backup. */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, getTable } from '../src/lib/storage.ts';
import {
  adjustmentsDb, applyRedemption, pointsBalance, pointsEarned, pointsLedger, readProgram, removeRedemption, ruleOn, saveProgram, topBalances,
} from '../src/lib/loyalty.ts';
import { addMonthsIso, amcDb, amcReminders, contractStatus, renewContract, visitSchedule } from '../src/lib/amc.ts';
import { buildCatalogueHtml, cataloguePrice, waNumber } from '../src/lib/catalogue-html.ts';
import { computeTiles, forBranch, loadTilePrefs, saveTilePrefs, topItems, DEFAULT_TILES } from '../src/lib/dashboard-tiles.ts';
import { loadBooksData } from '../src/lib/books.ts';
import { branchesDb } from '../src/lib/branch.ts';
import { posReturnsDb } from '../src/lib/pos-returns.ts';
import { applyBackup, buildBackup, parseBackup, validateBackupData, wipeAppData } from '../src/lib/backup.ts';
import { buildPosRecord, savePosBill } from '../src/lib/pos.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  thawDate();
  setActorProvider(null);
});

const sale = (id: string, name: string, taxable: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  ({ id, invoice_number: `INV/${id}`, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-01', taxable_value: taxable, total: taxable, currency: 'INR', client: { name }, sender: SELLER, items: [], ...extra }) as InvoiceRecord;

test('loyalty: date-keyed accrual, credit notes, cancelled bills, walk-ins, adjustments', () => {
  assert.equal(readProgram().enabled, false);
  saveProgram({ enabled: true, points_per_100: 1, point_value: 0.5, min_redeem: 10 }, '2026-04-01');
  saveProgram({ enabled: true, points_per_100: 2, point_value: 0.5, min_redeem: 10 }, '2026-06-01');
  const p = readProgram();
  assert.equal(ruleOn(p, '2026-05-15').points_per_100, 1);
  assert.equal(ruleOn(p, '2026-06-15').points_per_100, 2);
  const invs = [
    sale('a', 'Asha', 2550), // 25
    sale('b', 'asha ', 1000, { issue_date: '2026-06-10' }), // 20 at the new rate
    sale('c', 'Asha', 500, { doc_type: 'CREDIT_NOTE' }), // −5
    sale('d', 'Asha', 9999, { status: 'Cancelled' }),
    sale('e', 'Walk-in customer', 5000),
    sale('f', 'Asha', 400, { loyalty_redeem: { points: 10, value: 5 } }), // +4 −10
  ];
  assert.equal(pointsEarned(invs[4], p), 0);
  adjustmentsDb.add('Asha', 6, '2026-05-02', 'Welcome bonus');
  const ledger = pointsLedger('ASHA', invs, adjustmentsDb.all(), p);
  assert.equal(ledger[ledger.length - 1].balance, 25 + 20 - 5 + 4 - 10 + 6);
  assert.deepEqual(topBalances(invs, adjustmentsDb.all(), p), [{ name: 'Asha', points: 40 }]);
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => adjustmentsDb.add('Asha', 1, '2026-05-02', ''), isAccessDeniedError);
});

test('loyalty redemption at the POS: amount discount before GST, balance and minimum checks', () => {
  saveProgram({ enabled: true, points_per_100: 10, point_value: 1, min_redeem: 5 }, '2000-01-01');
  const client = { id: 'c1', name: 'Ravi', state_code: '27' } as InvoiceRecord['client'];
  const item = { id: 'l', name: 'Rice', type: 'Product' as const, hsn: '1006', unit: 'KG', quantity: 1, rate: 1000, tax_rate: 5, amount: 1000 };
  const mk = () => buildPosRecord({ items: [item], party: { client }, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: '2026-05-10' });
  // First bill earns 100 points.
  assert.ok(savePosBill({ record: mk(), tenders: [{ method: 'Cash', amount: 1050 }] }).ok);
  const bal = pointsBalance('Ravi', localDb.invoices.getAll(), [], readProgram());
  assert.equal(bal, 100);
  assert.match(applyRedemption(mk(), 200, bal, readProgram()).errors[0], /Only 100/);
  assert.match(applyRedemption(mk(), 3, bal, readProgram()).errors[0], /at least 5/);
  const r = applyRedemption(mk(), 50, bal, readProgram());
  assert.deepEqual(r.errors, []);
  assert.equal(r.record!.taxable_value, 950, 'discount reduces the taxable value');
  assert.equal(r.record!.total, 998, '950 + 5% = 997.5 → 998');
  assert.equal(removeRedemption(r.record!).taxable_value, 1000);
  assert.ok(savePosBill({ record: r.record!, tenders: [{ method: 'Cash', amount: 998 }] }).ok);
  // 100 − 50 + floor(950 × 10%) = 145
  assert.equal(pointsBalance('Ravi', localDb.invoices.getAll(), [], readProgram()), 145);
  assert.equal(localDb.invoices.getAll()[1].loyalty_redeem?.points, 50, 'stored on the bill');
});

test('AMC: schedule, next visit, reminders, renewal', () => {
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  const c = amcDb.save({ client_name: 'Hotel Sea View', title: 'AC maintenance', start: '2025-06-01', end: '2026-05-31', value: 12000, visits_per_year: 4 });
  assert.deepEqual(visitSchedule(c), ['2025-06-01', '2025-09-01', '2025-12-01', '2026-03-01']);
  amcDb.recordVisit(c.id, { date: '2025-06-02' });
  amcDb.recordVisit(c.id, { date: '2025-09-03' });
  const s = contractStatus(amcDb.all()[0], '2026-05-10');
  assert.equal(s.nextVisit, '2025-12-01');
  assert.equal(s.overdue, true);
  assert.equal(s.state, 'expiring');
  const rem = amcReminders(amcDb.all(), '2026-05-10');
  assert.deepEqual(rem.map((r) => r.kind), ['visit', 'renewal']);
  assert.equal(rem[0].overdue, true);
  const next = renewContract(c.id, 13000);
  assert.equal(next.start, '2026-06-01');
  assert.equal(next.end, '2027-05-31');
  assert.equal(next.renewed_from, c.id);
  assert.deepEqual(next.visits, []);
  assert.throws(() => renewContract(c.id), /already renewed/);
  assert.ok(!amcReminders(amcDb.all(), '2026-05-10').some((r) => r.kind === 'renewal' && r.contract_id === c.id));
  assert.throws(() => amcDb.save({ client_name: '', title: 'x', start: '2026-01-01', end: '2025-01-01' }), /customer/);
});

test('catalogue HTML: escaped, prices with GST, order links, no scripts', () => {
  assert.equal(waNumber('98765 43210'), '919876543210');
  assert.equal(cataloguePrice({ rate: 100, tax_rate: 18 }, true), 118);
  const html = buildCatalogueHtml(
    [
      { id: '1', name: 'Soap <b>', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, mrp: 150 },
      { id: '2', name: 'Comb', type: 'Product', hsn: '9615', unit: 'PCS', quantity: 1, rate: 50, tax_rate: 12, amount: 0 },
    ],
    { business: 'A & B Stores', phone: '9876543210', stock: new Map([['comb', 0]]) },
  );
  assert.ok(!/<script/i.test(html));
  assert.match(html, /Soap &lt;b&gt;/);
  assert.match(html, /A &amp; B Stores/);
  assert.match(html, /₹118\.00/);
  assert.match(html, /MRP ₹150\.00/);
  assert.match(html, /wa\.me\/919876543210\?text=Order%3A%20Comb/);
  assert.match(html, /Out of stock/);
});

test('dashboard tiles: prefs per user, branch filter, figures', () => {
  assert.deepEqual(loadTilePrefs(), [...DEFAULT_TILES]);
  saveTilePrefs(['approvals', 'receivables'], 'u1');
  assert.deepEqual(loadTilePrefs('u1'), ['receivables', 'approvals']);
  assert.deepEqual(loadTilePrefs('u2'), [...DEFAULT_TILES]);

  const ka = branchesDb.save({ name: 'KA', state_code: '29' });
  localDb.invoices.save({ ...sale('x1', 'Acme', 1000), total: 1180, balance_due: 1180, items: [{ id: 'l', name: 'Pen', type: 'Product', hsn: '', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18, amount: 1000 }] } as InvoiceRecord);
  localDb.invoices.save({ ...sale('x2', 'Bharat', 500), branch_id: ka.id, total: 590, balance_due: 590, items: [{ id: 'l', name: 'Ink', type: 'Product', hsn: '', unit: 'NOS', quantity: 1, rate: 500, tax_rate: 18, amount: 500 }] } as InvoiceRecord);
  const data = { books: loadBooksData(), links: [], branches: branchesDb.all(), stock: [{ name: 'Pen', qty: 1, unit: 'NOS', reorder: 5, isLow: true }] };
  const all = computeTiles(data, '2026-05-10');
  assert.equal(all.receivables.outstanding, 1770);
  assert.deepEqual(all.topItems.map((t) => t.name), ['Pen', 'Ink']);
  assert.equal(all.lowStock[0].name, 'Pen');
  assert.ok(all.gstDue.payable >= 0);
  const kaOnly = computeTiles(forBranch(data, ka.id), '2026-05-10');
  assert.equal(kaOnly.receivables.outstanding, 590);
  assert.deepEqual(topItems(forBranch(data, ka.id).books.invoices, '2026-04-01', '2026-05-10').map((t) => t.name), ['Ink']);
  assert.equal(all.branches.find((b) => b.id === ka.id)?.sales, 500);
});

test('backup round-trip carries every WP-9 table and the policy keys', () => {
  const ka = branchesDb.save({ name: 'KA', state_code: '29' });
  amcDb.save({ client_name: 'X', title: 'AMC', start: '2026-01-01', end: '2026-12-31', value: 1, visits_per_year: 2 });
  adjustmentsDb.add('Asha', 5, '2026-05-01', '');
  saveProgram({ enabled: true, points_per_100: 1, point_value: 1, min_redeem: 0 }, '2026-04-01');
  const { setTable } = { setTable: (n: string, v: unknown[]) => localStorage.setItem(DB_PREFIX + n, JSON.stringify(v)) };
  setTable('pos_returns', [{ id: 'r1', day: '2026-05-10', bill_id: 'b', bill_number: 'INV/1', credit_note_id: 'c', credit_note_number: 'CN/1', amount: 1, settlement: 'account', refunds: [], reason: 'x', created_at: '' }]);
  setTable('approvals', [{ id: 'a1', doc_id: 'd', decision: 'approved' }]);
  const { data } = parseBackup(JSON.stringify(buildBackup()));
  validateBackupData(data);
  for (const t of ['branches', 'amc_contracts', 'loyalty_adjustments', 'pos_returns', 'approvals', 'loyalty_program']) assert.ok(data[DB_PREFIX + t], `${t} in backup`);
  wipeAppData();
  applyBackup(data);
  assert.equal(branchesDb.get(ka.id)?.name, 'KA');
  assert.equal(amcDb.all().length, 1);
  assert.equal(posReturnsDb.all().length, 1);
  assert.equal(getTable('approvals').length, 1);
  assert.equal(readProgram().enabled, true);
  assert.throws(() => validateBackupData({ ...data, [DB_PREFIX + 'branches']: JSON.stringify([{ name: 'no id' }]) }), /branches/);
});
