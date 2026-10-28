import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  EWAY_EXTENSION_RULES, EWAY_VALIDITY_RULES, computeValidity, effectiveValidity, extensionHours, hoursLeft, inExtensionWindow, kmPerDay, localDay,
  parseLocal, validityDays,
} from '../src/lib/eway-validity.ts';
import {
  applyTransporterUpdate, applyVehicleUpdate, buildEwayRows, filterRows, recordBulkUpdate, transporterUpdateCsv, transporterUpdateJson, vehicleIssues,
  vehicleUpdateCsv, vehicleUpdateJson,
} from '../src/lib/eway-desk.ts';
import { ewayNotices } from '../src/lib/eway-alerts.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { EInvoiceMeta } from '../src/lib/einvoice.ts';

test('days: 1–200 km = 1, 201 = 2; ODC 21 km = 2; multimodal with ship uses 20 km', () => {
  assert.equal(validityDays(0, 'normal', '2026-05-01'), 1);
  assert.equal(validityDays(200, 'normal', '2026-05-01'), 1);
  assert.equal(validityDays(201, 'normal', '2026-05-01'), 2);
  assert.equal(validityDays(1000, undefined, '2026-05-01'), 5);
  assert.equal(validityDays(20, 'odc', '2026-05-01'), 1);
  assert.equal(validityDays(21, 'odc', '2026-05-01'), 2);
  assert.equal(validityDays(41, 'multimodal_ship', '2026-05-01'), 3);
});

test('rule change on 1 Jan 2021 (100 km → 200 km); tables are append-only and date-ordered', () => {
  assert.equal(kmPerDay('normal', '2020-12-31'), 100);
  assert.equal(kmPerDay('normal', '2021-01-01'), 200);
  assert.equal(validityDays(150, 'normal', '2020-12-31'), 2);
  assert.equal(validityDays(150, 'normal', '2021-01-01'), 1);
  for (const t of [EWAY_VALIDITY_RULES, EWAY_EXTENSION_RULES]) {
    const days = t.map((r) => r.from);
    assert.deepEqual(days, [...days].sort());
  }
});

test('local-day expiry: midnight of the last day, across month end and 31 Mar', () => {
  const v = computeValidity(new Date(2026, 4, 5, 22, 30), 150);
  assert.equal(v.day, '2026-05-06');
  assert.equal(v.expiresAt.getHours(), 23);
  assert.equal(v.expiresAt.getMinutes(), 59);
  assert.equal(computeValidity(new Date(2026, 2, 31, 9, 0), 450).day, '2026-04-03', 'FY boundary is just a date');
  assert.equal(computeValidity(new Date(2026, 1, 28, 1, 0), 10).day, '2026-03-01');
  // Bare day strings are local, never UTC.
  const d = parseLocal('2026-03-31');
  assert.equal(d && localDay(d), '2026-03-31');
  assert.equal(parseLocal('2026-03-31', true)?.getHours(), 23);
  assert.equal(parseLocal('2026-03-31 14:05')?.getHours(), 14);
  assert.equal(parseLocal('2026-02-30'), null);
  assert.equal(parseLocal(''), null);
});

test('typed / imported valid-upto wins; both shown when they differ', () => {
  const meta = { eway_no: '321000000001', eway_generated_at: '2026-05-05T10:00', distance: 450 };
  const c = effectiveValidity(meta);
  assert.equal(c.source, 'computed');
  assert.equal(c.computedDay, '2026-05-08');
  const t = effectiveValidity({ ...meta, eway_valid_upto: '2026-05-07' });
  assert.equal(t.source, 'typed');
  assert.equal(localDay(t.expiresAt!), '2026-05-07');
  assert.equal(t.differs, true);
  assert.equal(effectiveValidity({ eway_no: '1' }).source, 'none');
  assert.equal(effectiveValidity({ eway_date: '2026-05-05', eway_distance_km: 10, distance: 900 }).computedDay, '2026-05-06', 'desk distance wins over the JSON distance');
});

test('alert windows: expiring within 12 h, expired today; extension window from the constant', () => {
  const now = new Date(2026, 4, 6, 14, 0);
  const meta: EInvoiceMeta[] = [
    { invoice_id: 'a', eway_no: '111111111111', eway_valid_upto: '2026-05-06', vehicle: 'MH12AB1234' }, // ends 23:59 today: 9 h left
    { invoice_id: 'b', eway_no: '222222222222', eway_valid_upto: '2026-05-06 08:00' }, // expired this morning
    { invoice_id: 'c', eway_no: '333333333333', eway_valid_upto: '2026-05-09' },
    { invoice_id: 'd', eway_no: '444444444444', eway_valid_upto: '2026-04-01' }, // long expired: off the desk
    { invoice_id: 'e', eway_no: '555555555555', eway_valid_upto: '2026-05-06', ewb_cancel: { status: 'done', reason: 'other', remark: '', prepared_at: '' } },
    { invoice_id: 'f' },
  ];
  const rows = buildEwayRows(meta, [{ id: 'a', invoice_number: 'INV/1', client: { name: 'A' } as never, status: 'Sent' }], now);
  assert.deepEqual(rows.map((r) => r.ewayNo), ['222222222222', '111111111111', '333333333333']);
  assert.deepEqual(filterRows(rows, 'expired').map((r) => r.ewayNo), ['222222222222']);
  assert.deepEqual(filterRows(rows, 'expiring24').map((r) => r.ewayNo), ['111111111111']);
  assert.deepEqual(filterRows(rows, 'noPartB').map((r) => r.ewayNo), ['222222222222', '333333333333']);
  assert.equal(hoursLeft(rows[1].expiresAt!, now), 9);
  assert.equal(extensionHours('2026-05-06'), 8);
  assert.equal(rows[0].extension, true, 'expired 6 h ago: inside the 8 h window');
  assert.equal(rows[2].extension, false);
  assert.equal(inExtensionWindow(new Date(2026, 4, 6, 8, 0), new Date(2026, 4, 6, 16, 1)), false);
  const n = ewayNotices(rows, now);
  assert.equal(n.length, 2);
  assert.match(n[0].id, /^eway-soon:111111111111$/);
  assert.match(n[1].id, /^eway-expired:2026-05-06:222222222222$/);
  assert.equal(n[1].severity, 'critical');
});

test('vehicle normalisation and validation', () => {
  const base = { vehicle: 'mh-12 ab 1234', place: 'Nashik', stateCode: '27', reason: 'transhipment' as const };
  assert.deepEqual(vehicleIssues(base, 1), []);
  assert.deepEqual(vehicleIssues({ ...base, vehicle: 'XYZ', place: ' ', stateCode: '270', reason: 'others' }, 0).sort(), ['none', 'place', 'remark', 'state', 'vehicle']);
});

test('bulk payload shapes (snapshot) and history on einvoice_meta', () => {
  const input = { vehicle: 'mh12 ab 1234', place: 'Nashik', stateCode: '27', reason: 'breakdown' as const, docNo: 'LR9', docDate: '2026-05-06' };
  assert.deepEqual(vehicleUpdateJson(['321000000001'], input), {
    version: '1.0.0621',
    vehicleUpdtList: [{ ewbNo: 321000000001, vehicleNo: 'MH12AB1234', fromPlace: 'Nashik', fromState: 27, reasonCode: '1', reasonRem: 'Due to break down', transDocNo: 'LR9', transDocDate: '06/05/2026', transMode: '1', vehicleType: 'R' }],
  });
  assert.equal(vehicleUpdateCsv(['321000000001'], input).split('\n')[1], '321000000001,MH12AB1234,Nashik,27,1,Due to break down,LR9,06/05/2026,1');
  assert.deepEqual(transporterUpdateJson(['321000000001'], '27aabcu9603r1zx'), { version: '1.0.0621', transporterUpdtList: [{ ewbNo: 321000000001, transporterId: '27AABCU9603R1ZX' }] });
  assert.equal(transporterUpdateCsv(['1'], 'x').trim(), 'ewbNo,transporterId\n1,X');
  // QA5-2 F8: free text is neutralised against spreadsheet formula injection, like every other export.
  const evil = vehicleUpdateCsv(['321000000001'], { ...input, reason: 'others', remark: '=HYPERLINK("http://x","Click")', docNo: '@SUM(A1)' }).split('\n')[1];
  assert.ok(evil.includes(`"'=HYPERLINK(""http://x"",""Click"")"`), evil);
  assert.ok(evil.includes("'@SUM(A1)"), evil);
  assert.ok(!/,=|,@/.test(evil), 'no cell starts with = or @');
  assert.ok(!/(^|,)[=@]/.test(transporterUpdateCsv(['1'], '=cmd').split('\n')[1]));

  resetStorage();
  const meta: EInvoiceMeta[] = [{ invoice_id: 'a', eway_no: '321000000001', vehicle: 'KA01AA0001' }, { invoice_id: 'b', eway_no: '321000000002' }, { invoice_id: 'c' }];
  setTable('einvoice_meta', meta);
  const now = new Date('2026-05-06T10:00:00Z');
  const next = applyVehicleUpdate(meta, new Set(['a', 'c']), input, now);
  assert.equal(next[0].vehicle, 'MH12AB1234');
  assert.equal(next[0].vehicle_history?.[0].reason, 'breakdown');
  assert.equal(next[0].vehicle_history?.[0].state_code, '27');
  assert.equal(next[1].vehicle, undefined);
  assert.equal(next[2].vehicle_history, undefined, 'no e-Way Bill, no change');
  recordBulkUpdate('vehicle', next, 1, 'MH12AB1234');
  assert.equal(getTable<EInvoiceMeta>('einvoice_meta')[0].vehicle_history?.length, 1);
  const t = applyTransporterUpdate(next, new Set(['b']), '27aabcu9603r1zx', now, 'Fast Roadways');
  assert.equal(t[1].transporter_id, '27AABCU9603R1ZX');
  assert.equal(t[1].transporter_history?.[0].transporter_name, 'Fast Roadways');
});
