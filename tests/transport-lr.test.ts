/** R5-B1: consignment notes, GTA option and the person liable. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTransport } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { cancelLr, canMove, derivedLiable, effectiveStatus, freightOf, loadLrs, nextLrNumber, recordPod, saveLr, type LrInput } from '../src/lib/transport/consignment-notes.ts';
import { liablePerson, nextFy, optionFor, saveGtaOption } from '../src/lib/transport/gta-option.ts';
import { lrHtml, LR_COPIES } from '../src/lib/transport/lr-print.ts';
import { collectFreight } from '../src/lib/transport/freight-bill.ts';
import { gtaRate, inGtaWindow } from '../src/lib/transport-works-rules.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import type { ConsignmentNote } from '../src/types/transport-works-r5.ts';

beforeEach(() => setupTransport());

const parties = () => localDb.clients.getAll();
const lrIn = (over: Partial<LrInput> = {}): LrInput => ({
  date: '2026-06-10', from: { place: 'Pune', state: '27' }, to: { place: 'Bengaluru', state: '29' },
  consignor_id: 'c-mh', consignee_id: 'c-ka', lines: [{ description: 'Machine parts', packages: 10, actual_weight: 900, charged_weight: 1000, value: 250000 }],
  vehicle_no: 'mh 12 ab 1234', basis: 'per_kg', rate: 5, charges: [{ kind: 'loading', amount: 200 }, { kind: 'detention', amount: 500 }],
  payment_basis: 'tbb', ...over,
});

test('numbering: LR/FY…/0001 per FY, branch prefix has its own series, never reused after cancel', () => {
  const a = saveLr(lrIn(), parties());
  const b = saveLr(lrIn({ prefix: 'LR-DEL' }), parties());
  const c = saveLr(lrIn({ date: '2027-04-02' }), parties());
  assert.equal(a.number, 'LR/FY26-27/0001');
  assert.equal(b.number, 'LR-DEL/FY26-27/0001');
  assert.equal(c.number, 'LR/FY27-28/0001');
  assert.equal(a.vehicle_no, 'MH12AB1234');
  cancelLr(a.id, 'Party cancelled', []);
  assert.equal(nextLrNumber('2026-06-11'), 'LR/FY26-27/0002', 'a cancelled number stays used');
  assert.equal(saveLr(lrIn(), parties()).number, 'LR/FY26-27/0002');
});

test('freight by each basis plus charges (detention on its own line)', () => {
  const base = { lines: [{ description: 'x', packages: 4, charged_weight: 2500 }], charges: [{ kind: 'hamali', amount: 100 }, { kind: 'detention', amount: 300 }] };
  assert.deepEqual(freightOf({ ...base, basis: 'fixed', rate: 9000 }), { freight: 9000, charges: 100, ownLine: 300, total: 9400 });
  assert.equal(freightOf({ ...base, basis: 'per_kg', rate: 3 }).freight, 7500);
  assert.equal(freightOf({ ...base, basis: 'per_ton', rate: 2000 }).freight, 5000);
  assert.equal(freightOf({ ...base, basis: 'per_package', rate: 250 }).freight, 1000);
  assert.equal(freightOf({ ...base, basis: 'per_trip', rate: 12000 }).freight, 12000);
});

test('person liable: option × recipient kind × date; rates by option before / after 22 Sep 2025', () => {
  assert.equal(liablePerson('rcm', 'registered', '2026-06-10'), 'recipient');
  assert.equal(liablePerson('rcm', 'factory', '2026-06-10'), 'recipient');
  assert.equal(liablePerson('rcm', 'unregistered', '2026-06-10'), 'gta');
  assert.equal(liablePerson('fcm_5', 'registered', '2026-06-10'), 'gta');
  assert.equal(gtaRate('fcm_18', '2025-09-21').rate, 12);
  assert.equal(gtaRate('fcm_18', '2025-09-22').rate, 18);
  assert.equal(gtaRate('rcm', '2026-06-10').rcm, true);
  // No option row = reverse charge; the FY's row decides.
  assert.equal(optionFor('2026-06-10'), 'rcm');
  saveGtaOption({ fy: '26-27', option: 'fcm_5' });
  assert.equal(optionFor('2026-06-10'), 'fcm_5');
  assert.equal(optionFor('2027-06-10'), 'rcm');
  assert.equal(derivedLiable({ date: '2026-06-10', payment_basis: 'tbb', consignor_id: 'c-mh', consignee_id: 'c-ka' }, parties()), 'gta');
  // Paid by an unregistered consignee under RCM → the GTA.
  assert.equal(derivedLiable({ date: '2027-06-10', payment_basis: 'to_pay', consignor_id: 'c-mh', consignee_id: 'c-retail' }, parties()), 'gta');
  assert.equal(derivedLiable({ date: '2027-06-10', payment_basis: 'to_pay', consignor_id: 'c-mh', consignee_id: 'c-retail' }, parties(), 'factory'), 'recipient');
  assert.ok(inGtaWindow('2027-02-15') && !inGtaWindow('2027-04-02'));
  assert.equal(nextFy('26-27'), '27-28');
});

test('override of the person liable needs a reason and is written to the audit trail', () => {
  assert.throws(() => saveLr(lrIn({ liable_override: 'gta' }), parties()), /reason/);
  const lr = saveLr(lrIn({ liable_override: 'gta', liable_override_reason: 'Consignor is an exempt unit' }), parties());
  assert.equal(lr.liable, 'gta');
  assert.equal(lr.liable_override_reason, 'Consignor is an exempt unit');
  const log = getTable<{ action: string; summary: string }>('audit_log');
  assert.ok(log.some((r) => r.action === 'override' && /person liable/.test(r.summary)));
});

test('status machine: booked → delivered (POD) → billed; billed cannot be cancelled; cancelling the bill frees the LR', () => {
  const lr = saveLr(lrIn(), parties());
  assert.equal(effectiveStatus(lr, []), 'booked');
  assert.ok(canMove('booked', 'in_transit') && !canMove('billed', 'cancelled') && !canMove('cancelled', 'booked'));
  assert.throws(() => recordPod(lr.id, { delivered_on: '2026-06-01' }), /before the LR date/);
  const d = recordPod(lr.id, { delivered_on: '2026-06-12', received_by: 'Store', shortage_qty: 1 });
  assert.equal(effectiveStatus(d, []), 'delivered');
  const billed: ConsignmentNote = { ...d, bill_id: 'inv1' };
  assert.equal(effectiveStatus(billed, [{ id: 'inv1', status: 'Sent' }]), 'billed');
  assert.equal(effectiveStatus(billed, [{ id: 'inv1', status: 'Cancelled' }]), 'delivered');
  assert.throws(() => cancelLr(lr.id, '', []), /reason/);
});

test('print: three copies with the person liable and the option line', () => {
  const lr = saveLr(lrIn(), parties());
  const html = lrHtml(lr, { company: { name: 'Speedy Roadways' }, consignor: { name: 'Bharat Traders' }, consignee: { name: 'Karnataka Tech' } });
  for (const c of LR_COPIES) assert.ok(html.includes(c));
  assert.equal(html.match(/Person liable to pay GST/g)?.length, 3);
  assert.match(html, /Recipient of the service \(reverse charge\)/);
  assert.match(html, /GTA option FY 26-27: reverse charge/);
  assert.ok(!/<script/i.test(html));
});

test('paid / to-pay: "Collect freight" creates one tax document and its receipt; a second collect is refused', () => {
  saveGtaOption({ fy: '26-27', option: 'fcm_18' });
  const lr = saveLr(lrIn({ payment_basis: 'paid' }), parties());
  const { bill } = collectFreight(lr.id, { date: '2026-06-10', method: 'Cash' });
  assert.equal(bill.doc_type, 'TAX_INVOICE');
  assert.equal(bill.items[0].tax_rate, 18);
  assert.deepEqual(bill.lr_ids, [lr.id]);
  assert.equal(bill.status, 'Paid');
  assert.equal(localDb.payments.listFor(bill.id).length, 1);
  assert.equal(loadLrs()[0].bill_id, bill.id);
  assert.throws(() => collectFreight(lr.id, { date: '2026-06-10', method: 'Cash' }), /already collected/);
});

test('period lock: an LR dated inside the lock is refused', () => {
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' });
  assert.throws(() => saveLr(lrIn(), parties()), (e) => isPeriodLockedError(e));
});
