/** R5-B2: freight bills from LRs (RCM / forward charge), links, annexure and the GTA ITC caution. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTransport } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { cancelDocument } from '../src/lib/documents.ts';
import { effectiveStatus, loadLrs, recordPod, saveLr, type LrInput } from '../src/lib/transport/consignment-notes.ts';
import { saveGtaOption } from '../src/lib/transport/gta-option.ts';
import { annexureRows, createFreightBills, groupForBills, pickableLrs } from '../src/lib/transport/freight-bill.ts';
import { buildGstr1 } from '../src/lib/gst-reports.ts';
import { billWarnings } from '../src/lib/bill-guard.ts';
import { receivableBalance } from '../src/lib/rcm.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => setupTransport());

const parties = () => localDb.clients.getAll();
const lrIn = (over: Partial<LrInput> = {}): LrInput => ({
  date: '2026-06-10', from: { place: 'Pune', state: '27' }, to: { place: 'Nashik', state: '27' },
  consignor_id: 'c-mh', consignee_id: 'c-ka', billing_party_id: 'c-mh', lines: [{ description: 'Cartons', packages: 20, charged_weight: 2000 }],
  basis: 'per_kg', rate: 4, charges: [{ kind: 'loading', amount: 500 }, { kind: 'detention', amount: 1000 }], payment_basis: 'tbb', ...over,
});

test('grouping by billing party and person liable; pickable = tbb + delivered to-pay', () => {
  const a = saveLr(lrIn(), parties());
  const b = saveLr(lrIn({ date: '2026-06-20', billing_party_id: 'c-ka' }), parties());
  const c = saveLr(lrIn({ payment_basis: 'to_pay', consignee_id: 'c-ka' }), parties());
  const d = saveLr(lrIn({ liable_override: 'gta', liable_override_reason: 'Exempt recipient' }), parties());
  assert.deepEqual(pickableLrs(loadLrs(), [], {}).map((l) => l.id).sort(), [a.id, b.id, d.id].sort(), 'to-pay waits for delivery');
  recordPod(c.id, { delivered_on: '2026-06-12' });
  assert.equal(pickableLrs(loadLrs(), [], { from: '2026-06-01', to: '2026-06-15' }).length, 3, 'period filter');
  const groups = groupForBills(loadLrs());
  assert.equal(groups.length, 3, 'c-mh recipient, c-mh GTA, c-ka');
  assert.equal(groups.find((g) => g.partyId === 'c-ka')!.lrs.length, 2);
});

test('RCM bill: tax excluded from the total, GSTR-1 B2B marks rchrg Y; detention on its own line', () => {
  const a = saveLr(lrIn(), parties());
  const [bill] = createFreightBills([a.id], '2026-06-30');
  assert.equal(bill.reverse_charge, true);
  assert.equal(bill.rcm_tax_excluded, true);
  assert.equal(bill.items.length, 2);
  assert.equal(bill.items[0].hsn, '996791');
  assert.equal(bill.items[0].amount, 8500);
  assert.equal(bill.items[1].amount, 1000);
  assert.equal(bill.taxable_value, 9500);
  assert.equal(bill.total, 9500, 'the recipient pays the GST');
  assert.equal(receivableBalance(bill), 9500);
  assert.deepEqual(bill.lr_ids, [a.id]);
  assert.equal(loadLrs()[0].bill_id, bill.id);
  const g1 = buildGstr1(localDb.invoices.getAll(), { period: { kind: 'month', fyStart: 2026, month: 6 } });
  const row = g1.gstr1.b2b.find((r) => r.invoiceId === bill.id);
  assert.equal(row?.rchrg, 'Y');
});

test('forward charge: 5% under fcm_5, 18% under fcm_18 (12% before 22 Sep 2025)', () => {
  saveGtaOption({ fy: '26-27', option: 'fcm_5' });
  const a = saveLr(lrIn(), parties());
  const [b5] = createFreightBills([a.id], '2026-06-30');
  assert.equal(b5.reverse_charge, false);
  assert.equal(b5.items[0].tax_rate, 5);
  assert.equal(b5.total, 9975);
  saveGtaOption({ fy: '26-27', option: 'fcm_18' });
  const b = saveLr(lrIn(), parties());
  assert.equal(createFreightBills([b.id], '2026-06-30')[0].items[0].tax_rate, 18);
  saveGtaOption({ fy: '25-26', option: 'fcm_18' });
  const c = saveLr(lrIn({ date: '2025-09-01' }), parties());
  assert.equal(createFreightBills([c.id], '2025-09-15')[0].items[0].tax_rate, 12);
});

test('mixed liability splits into two bills; an LR cannot be on two live bills; cancelling the bill frees it', () => {
  const a = saveLr(lrIn(), parties());
  const b = saveLr(lrIn({ liable_override: 'gta', liable_override_reason: 'Exempt recipient' }), parties());
  const bills = createFreightBills([a.id, b.id], '2026-06-30');
  assert.equal(bills.length, 2);
  assert.deepEqual(bills.map((x) => x.reverse_charge).sort(), [false, true]);
  assert.throws(() => createFreightBills([a.id], '2026-06-30'), /already on a live bill/);
  cancelDocument(bills.find((x) => x.lr_ids?.includes(a.id))!, 'Wrong party');
  const lr = loadLrs().find((l) => l.id === a.id)!;
  assert.equal(effectiveStatus(lr, localDb.invoices.getAll()), 'booked');
  assert.equal(createFreightBills([a.id], '2026-07-01').length, 1, 'billable again');
});

test('annexure rows list the LRs with POD and shortage', () => {
  const a = saveLr(lrIn(), parties());
  recordPod(a.id, { delivered_on: '2026-06-12', received_by: 'Gate', shortage_qty: 2 });
  const rows = annexureRows(loadLrs());
  assert.equal(rows[0][0], 'LR no.');
  assert.deepEqual(rows[1].slice(0, 10), [a.number, '2026-06-10', 'Pune', 'Nashik', 20, 2000, '2026-06-12', 'Gate', 2, '']);
  assert.equal(rows[1][10], 9500);
});

test('ITC caution: a GTA under fcm_5 sees a warning on a bill claiming ITC (pack on only)', () => {
  const bill = { kind: 'PURCHASE', vendor_name: 'Tyre Co', bill_number: 'T1', date: '2026-07-01', category: 'Repairs', lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, itc_eligible: true, amount_paid: 0 } as Omit<PurchaseRecord, 'id'>;
  assert.equal(billWarnings(bill, []).length, 0);
  saveGtaOption({ fy: '26-27', option: 'fcm_5' });
  assert.match(billWarnings(bill, []).join(' '), /5% without ITC/);
  assert.equal(billWarnings({ ...bill, itc_eligible: false }, []).length, 0);
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: [] });
  assert.equal(billWarnings(bill, []).length, 0, 'pack off: no warning');
});
