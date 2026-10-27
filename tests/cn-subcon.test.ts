/** CN-D1: work orders back-to-back from the BOQ, measured sub-contractor bills → purchase bill, deductions, TDS, cancel. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { siteWorld, SUB } from './helpers/site-ops.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { balanceOf, purchasesDb } from '../src/lib/purchases.ts';
import { billwisePayables } from '../src/lib/billwise.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import { boqMargins, fromBoq, loadWorkOrders, saveWorkOrder } from '../src/lib/construction/cn-subcon.ts';
import { cancelSubBill, loadSubBills, measureLines, previousQty, releaseRetention, retentionPayable, saveSubBill, subDeductions } from '../src/lib/construction/cn-subcon-bill.ts';
import type { SubWorkOrder } from '../src/types/construction-r11.ts';

let w: ReturnType<typeof siteWorld>;
let wo: SubWorkOrder;
beforeEach(() => {
  w = siteWorld();
  wo = saveWorkOrder({ date: '2026-06-01', vendor_id: SUB.id, vendor_name: SUB.name, boq_id: w.boq.id, site_id: w.site.id, cost_centre_id: w.cc.id, lines: fromBoq(w.boq, ['l2'], 90), deductions: [{ kind: 'retention', rate: 5 }, { kind: 'advance_recovery', rate: 10 }] });
});

test('back-to-back copy: chosen BOQ lines at a % of our rate (or typed); SWO series', () => {
  assert.equal(wo.number, 'SWO/FY26-27/0001');
  assert.deepEqual(wo.lines.map((l) => [l.boq_line_id, l.ref, l.description, l.unit, l.qty, l.rate, l.sac]), [['l2', '2.2', 'PCC 1:4:8', 'CUM', 200, 4050, '9954']]);
  assert.equal(fromBoq(w.boq, ['l1'], 90, { l1: 200 })[0].rate, 200, 'a typed rate wins');
  assert.equal(loadWorkOrders().length, 1);
});

test('measurement → bill lines; 194C on the value before GST; retention liability; material recovery; net payable ages', () => {
  const { measurement: m, bill } = saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: wo.lines[0].id, cumulative: 50, mb_ref: '12/4' }], material: [{ item_id: w.cement.id, label: 'Cement', qty: 20, rate: 400 }] });
  assert.equal(m.number, 'SCB/FY26-27/0001');
  assert.equal(bill.bill_number, m.number);
  assert.deepEqual(bill.lines.map((l) => [l.quantity, l.rate, l.tax_rate, l.hsn]), [[50, 4050, 18, '9954']]);
  assert.deepEqual([bill.taxable, bill.cgst + bill.sgst, bill.total], [202500, 36450, 238950]);
  assert.deepEqual([bill.tds_section, bill.tds_base, bill.tds_amount], ['194C-1', 202500, 2025], 'individual PAN: 1% on the value excluding GST');
  assert.equal(bill.cost_centre_id, w.cc.id);
  const cn = bill.cn_sub!;
  assert.deepEqual(cn.deductions!.map((d) => [d.kind, d.amount]), [['retention', 10125], ['advance_recovery', 0], ['material_recovery', 8000]].filter((x) => x[1] !== 0));
  assert.equal(cn.net, 238950 - 2025 - 10125 - 8000);
  // One journal Dr creditors (the sub-contractor) | Cr retention payable, Cr material recovered — rolled into amount_paid.
  const jv = loadVouchers().find((v) => v.id === cn.jv_id)!;
  assert.equal(jv.voucher_class, 'Sub-contractor deductions');
  assert.deepEqual(jv.lines.map((l) => [l.dr, l.cr]), [[1812500, 0], [0, 1012500], [0, 800000]]);
  assert.equal(jv.lines[0].party, SUB.name);
  assert.equal(bill.amount_paid, 18125);
  assert.equal(balanceOf(bill), cn.net);
  const party = billwisePayables({ purchases: purchasesDb.all(), payments: [], vendorPayments: [], asOf: '2026-07-31' })[0];
  assert.equal(party.billsTotal, cn.net, 'payables show the net due');
  assert.deepEqual(party.bills[0].allocations.map((a) => [a.kind, a.ref]), [['adjustment', 'Sub-contract deductions (journal)']]);
  assert.deepEqual(retentionPayable().map((r) => [r.vendor, r.due]), [[SUB.name, 10125]]);
  releaseRetention(SUB.name, 5000, '2027-06-30', 'Bank transfer');
  assert.equal(retentionPayable()[0].due, 5125);
  assert.throws(() => releaseRetention(SUB.name, 9000, '2027-06-30', 'Cash'), /Retention due/);
  // Purchase contract: the bill reads like any other.
  const c = readPurchase(bill)!;
  assert.deepEqual([c.taxable, c.itcEligible, c.tdsSection], [202500, true, '194C-1']);
});

test('cumulative → this quantity; advance recovery adjusts his open advance; second bill', () => {
  setTable('vendor_payments', [{ id: 'vp1', vendor_id: SUB.id, vendor_name: SUB.name, date: '2026-05-15', amount: 50000, method: 'Bank transfer', kind: 'ADVANCE' }]);
  const line = wo.lines[0].id;
  saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: line, cumulative: 50 }] });
  const { bill, measurement } = saveSubBill(wo.id, { date: '2026-07-31', qty: [{ line_id: line, cumulative: 80 }] });
  assert.equal(measurement.lines[0].this_qty, 30);
  assert.equal(previousQty(wo.id).get(line), 80);
  const adv = bill.cn_sub!.deductions!.find((d) => d.kind === 'advance_recovery')!;
  assert.equal(adv.amount, Math.min(12150, 50000 - 20250));
  const vp = getTable<{ allocations?: { purchase_id: string; amount: number }[] }>('vendor_payments')[0];
  assert.deepEqual(vp.allocations!.map((a) => a.amount), [20250, 12150]);
  assert.deepEqual(measureLines(new Map([[line, 80]]), [{ line_id: line, this_qty: 5 }]).map((l) => [l.cumulative_qty, l.this_qty]), [[85, 5]]);
  // Margin per BOQ item: (our 4500 − his 4050) × 80.
  assert.deepEqual(boqMargins(w.boq, loadWorkOrders(), loadSubBills()).map((x) => [x.ref, x.qty, x.margin]), [['2.2', 80, 36000]]);
});

test('cancel: the purchase bill and the deductions journal go (recycle bin), quantities free again; refused with payments', () => {
  const { measurement: m, bill } = saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: wo.lines[0].id, cumulative: 50 }] });
  cancelSubBill(m.id);
  assert.equal(purchasesDb.get(bill.id), undefined);
  assert.equal(loadVouchers().length, 0);
  assert.equal(loadSubBills()[0].status, 'cancelled');
  assert.equal(previousQty(wo.id).size, 0);
  assert.ok(getTable<{ table: string }>('recycle_bin').some((e) => e.table === 'purchases'), 'the bill reached the recycle bin');
  assert.throws(() => cancelSubBill(m.id), /already cancelled/);
});

test('deduction rules: rate on the value before GST, fixed amounts, hire recovery; nothing measured is refused', () => {
  const d = subDeductions({ deductions: [{ kind: 'retention', rate: 5 }, { kind: 'other', amount: 700, label: 'Water' }] }, 100000, { hire: 6000 });
  assert.deepEqual(d.map((x) => [x.kind, x.amount]), [['retention', 5000], ['other', 700], ['hire_recovery', 6000]]);
  assert.throws(() => saveSubBill(wo.id, { date: '2026-06-30', qty: [] }), /quantities/);
});
