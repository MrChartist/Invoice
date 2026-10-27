/** CN-D2: labour-contractor hold until proved; manpower supply bill preset; site muster → weekly wage sheet and payment. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { LAB, siteWorld } from './helpers/site-ops.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { saveConstructionSettings } from '../src/lib/construction/cn-settings.ts';
import { labourBills, manpowerBill, manpowerItems, saveCompliance, withholdFor } from '../src/lib/construction/cn-labour-compliance.ts';
import { loadMuster, markDay, saveLabour, settleWeek, undoSettlement, wageSheet, loadLabour } from '../src/lib/construction/cn-muster.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

let w: ReturnType<typeof siteWorld>;
beforeEach(() => { w = siteWorld(); });

const bill = { id: 'b1', kind: 'PURCHASE', vendor_id: LAB.id, vendor_name: LAB.name, bill_number: 'SL/7', date: '2026-07-31', category: 'Labour contract', lines: [], taxable: 100000, cgst: 0, sgst: 0, igst: 0, total: 100000, amount_paid: 0 } as unknown as PurchaseRecord;

test('hold until the month is proved: 10% or PF + ESI, whichever is higher; a warning, never a block', () => {
  assert.deepEqual(withholdFor(bill, [], 10), { hold: 10000, status: 'missing' });
  const pack = { vendor_id: LAB.id, vendor_name: LAB.name, month: '2026-07', headcount: 40, wages: 400000, pf: { amount: 12000 }, esi: { amount: 3000 } };
  saveCompliance(pack);
  const rows = [saveCompliance(pack)];
  assert.equal(rows.length, 1);
  assert.deepEqual(withholdFor(bill, rows, 10), { hold: 15000, status: 'pending' }, 'PF + ESI is higher');
  assert.throws(() => saveCompliance({ ...pack, status: 'proved' }), /TRRN/);
  const proved = saveCompliance({ ...pack, pf: { trrn: '1234567890123', amount: 12000 }, esi: { challan: 'ESI-77', amount: 3000 }, status: 'proved' });
  assert.deepEqual(withholdFor(bill, [proved], 10), { hold: 0, status: 'proved' });
  // Settings percentage; the payment proposal on a stored bill.
  saveCompliance({ ...pack, month: '2026-08', pf: {}, esi: {} });
  saveConstructionSettings({ labour_withhold_pct: 20 });
  const [row] = labourBills([{ ...bill, date: '2026-08-31' }]);
  assert.deepEqual([row.hold, row.payNow, row.status], [20000, 80000, 'pending']);
});

test('manpower supply bill: SAC 998519 at 18%, wages + statutory + service charge as one supply (a draft invoice)', () => {
  const items = manpowerItems(300000, 45000, 25000, '2026-07-31');
  assert.deepEqual(items.map((i) => [i.name, i.hsn, i.tax_rate, i.rate]), [['Wages', '998519', 18, 300000], ['Statutory contributions (PF / ESI)', '998519', 18, 45000], ['Service charge', '998519', 18, 25000]]);
  const inv = manpowerBill('c-pwd', 300000, 45000, 25000, '2026-07-31');
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.taxable_value, 370000);
  assert.equal(inv.tax_amount, 66600);
  assert.ok(localDb.invoices.getById(inv.id));
});

test('muster: one row per site per day, half days and OT → weekly sheet; settlement pays once (MUS) and locks the days', () => {
  const a = saveLabour({ name: 'Ramu', trade: 'Mason', daily_rate: 800, ot_rate: 100, site_id: w.site.id });
  const b = saveLabour({ name: 'Shyam', trade: 'Helper', daily_rate: 600, ot_rate: 75, min_wage: 650, site_id: w.site.id });
  markDay(w.site.id, '2026-07-06', [{ labour_id: a.id, present: 1 }, { labour_id: b.id, present: 1 }]);
  markDay(w.site.id, '2026-07-06', [{ labour_id: a.id, present: 1, ot_hours: 2 }, { labour_id: b.id, present: 0.5 }]);
  markDay(w.site.id, '2026-07-07', [{ labour_id: a.id, present: 0.5 }, { labour_id: b.id, present: 0 }]);
  assert.equal(loadMuster().filter((d) => d.date === '2026-07-06').length, 1, 'one row per site per day');
  const sheet = wageSheet(loadMuster(), loadLabour(), w.site.id, '2026-07-06', '2026-07-12', { [a.id]: 300 });
  assert.deepEqual(sheet.map((r) => [r.labour.name, r.days, r.ot, r.gross, r.advance, r.net, r.minWageWarn]), [['Ramu', 1.5, 2, 1400, 300, 1100, false], ['Shyam', 0.5, 0, 300, 0, 300, true]]);
  const s = settleWeek(w.site, '2026-07-06', '2026-07-12', { date: '2026-07-12', method: 'Cash', advances: { [a.id]: 300 } });
  assert.equal(s.number, 'MUS/FY26-27/0001');
  const v = loadVouchers().find((x) => x.id === s.voucher.id)!;
  assert.equal(v.type, 'PAYMENT');
  assert.deepEqual(v.lines.map((l) => [l.dr, l.cr]), [[170000, 0], [0, 30000], [0, 140000]]);
  assert.equal(v.lines[0].cost_centre_id, w.cc.id);
  assert.throws(() => markDay(w.site.id, '2026-07-06', []), /settled in MUS/);
  assert.equal(wageSheet(loadMuster(), loadLabour(), w.site.id, '2026-07-06', '2026-07-12').length, 0, 'settled days are not paid twice');
  undoSettlement(s.number);
  assert.equal(loadVouchers().length, 0);
  assert.equal(wageSheet(loadMuster(), loadLabour(), w.site.id, '2026-07-06', '2026-07-12').length, 2);
});

test('cash-limit warning above ₹10,000 to one person in a day (Sec 40A(3)); none when paid by bank', () => {
  const c = saveLabour({ name: 'Crane operator', trade: 'Operator', daily_rate: 2000, ot_rate: 0, site_id: w.site.id });
  for (const d of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11']) markDay(w.site.id, d, [{ labour_id: c.id, present: 1 }]);
  assert.equal(wageSheet(loadMuster(), loadLabour(), w.site.id, '2026-07-06', '2026-07-12', {}, true)[0].cashWarn, true);
  assert.equal(wageSheet(loadMuster(), loadLabour(), w.site.id, '2026-07-06', '2026-07-12', {}, false)[0].cashWarn, false);
});
