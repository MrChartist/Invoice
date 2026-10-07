import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEway, buildEwayBulk, normaliseVehicle, VEHICLE_REGEX, EWAY_VERSION } from '../src/lib/eway.ts';
import { preflightEway } from '../src/lib/einvoice-validate.ts';
import { BUYER_KA, SELLER_GSTIN, invoice, item } from './einvoice-fixtures.ts';

const NOW = new Date(2025, 5, 20);
const big = () => invoice({ items: [item({ quantity: 10, rate: 10000 })] });
const road = { vehicle: 'mh 12 ab-1234', distance: 150 };

test('bill shape for intra-state road movement', () => {
  const { payload, bill } = buildEway(big(), { transport: road });
  assert.equal(payload.version, EWAY_VERSION);
  assert.equal(payload.billLists.length, 1);
  assert.equal(bill.userGstin, SELLER_GSTIN);
  assert.equal(bill.supplyType, 'O');
  assert.equal(bill.subSupplyType, 1);
  assert.equal(bill.docType, 'INV');
  assert.equal(bill.docDate, '18/06/2025');
  assert.equal(bill.fromPincode, 400001);
  assert.equal(bill.toPincode, 400002);
  assert.equal(bill.fromStateCode, 27);
  assert.equal(bill.toStateCode, 27);
  assert.equal(bill.totalValue, 100000);
  assert.equal(bill.cgstValue, 9000);
  assert.equal(bill.totInvValue, 118000);
  assert.equal(bill.vehicleNo, 'MH12AB1234');
  assert.equal(bill.transDistance, '150');
  assert.equal(bill.transMode, 1);
  const [it] = bill.itemList;
  assert.equal(it.hsnCode, 847130);
  assert.equal(it.cgstRate, 9);
  assert.equal(it.sgstRate, 9);
  assert.equal(it.igstRate, 0);
  assert.equal(it.qtyUnit, 'NOS');
  const r = preflightEway(big(), { transport: road, now: NOW });
  assert.deepEqual(r.errors, []);
  assert.ok(!r.warnings.some((w) => w.code === 'EWB_BELOW_THRESHOLD'));
});

test('inter-state uses IGST rates', () => {
  const rec = invoice({
    gst_mode: 'IGST',
    place_of_supply: '29',
    items: [item({ quantity: 10, rate: 10000 })],
    client: { ...invoice().client, gstin: BUYER_KA, state_code: '29', zip: '560001', city: 'Bengaluru' },
  });
  const { bill } = buildEway(rec, { transport: road });
  assert.equal(bill.toStateCode, 29);
  assert.equal(bill.igstValue, 18000);
  assert.equal(bill.itemList[0].igstRate, 18);
  assert.equal(bill.itemList[0].cgstRate, 0);
});

test('threshold hint at or below Rs 50,000', () => {
  const r = preflightEway(invoice(), { transport: road, now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'EWB_BELOW_THRESHOLD'));
});

test('vehicle regex: valid and invalid plates', () => {
  for (const ok of ['MH12AB1234', 'DL1CAB1234', 'KA01A1234', '22BH1234AA', 'TN09BC0001']) {
    assert.ok(VEHICLE_REGEX.test(ok), ok);
  }
  for (const bad of ['MH12', '1234AB', 'MH-12-AB', 'MH12AB12345A', '']) {
    assert.ok(!VEHICLE_REGEX.test(bad), bad);
  }
  assert.equal(normaliseVehicle(' mh-12 ab 1234 '), 'MH12AB1234');
});

test('transport validation: bad vehicle, distance, missing part B, transporter GSTIN', () => {
  const errs = (transport: NonNullable<Parameters<typeof preflightEway>[1]>['transport']) =>
    preflightEway(big(), { transport, now: NOW }).errors.map((e) => e.code);
  assert.ok(errs({ vehicle: 'XX', distance: 10 }).includes('EWB_VEHICLE'));
  assert.ok(errs({ vehicle: 'MH12AB1234', distance: 5000 }).includes('EWB_DISTANCE'));
  assert.ok(errs({ vehicle: 'MH12AB1234', distance: -1 }).length === 0); // clamped to 0 (auto-calc)
  assert.ok(errs({ distance: 10 }).includes('EWB_PARTB'));
  assert.ok(errs({ transporterId: '27AAAAA0000A1Z5', distance: 10 }).includes('EWB_TRANSPORTER'));
  assert.equal(errs({ transporterId: SELLER_GSTIN, distance: 10 }).length, 0);
});

test('services are excluded; services-only is blocked', () => {
  const mixed = invoice({ items: [item({ quantity: 10, rate: 10000 }), item({ hsn: '998314', rate: 5000 })] });
  const r = preflightEway(mixed, { transport: road, now: NOW });
  assert.equal(r.skippedServiceLines, 1);
  assert.equal(r.bill.itemList.length, 1);
  assert.ok(r.warnings.some((w) => w.code === 'EWB_SERVICES_SKIPPED'));
  const only = preflightEway(invoice({ items: [item({ hsn: '998314' })] }), { transport: road, now: NOW });
  assert.ok(only.errors.some((e) => e.code === 'EWB_NO_GOODS'));
});

test('unregistered buyer => URP; credit note => CNT; export state', () => {
  const unreg = invoice({ client: { ...invoice().client, gstin: '' }, items: big().items });
  assert.equal(buildEway(unreg, { transport: road }).bill.toGstin, 'URP');
  assert.equal(buildEway(big(), { transport: road }).bill.toGstin, big().client.gstin);
  assert.equal(buildEway({ ...big(), doc_type: 'CREDIT_NOTE' }, { transport: road }).bill.docType, 'CNT');
  const exp = buildEway(invoice({ place_of_supply: '99', gst_mode: 'IGST', items: big().items }), { transport: road }).bill;
  assert.equal(exp.toStateCode, 99);
  assert.equal(exp.subSupplyType, 3);
});

test('bulk wrapper and ship-to override', () => {
  const a = buildEway(big(), { transport: road }).bill;
  const bulk = buildEwayBulk([a, a]);
  assert.equal(bulk.billLists.length, 2);
  const shipped = buildEway(big(), {
    transport: road,
    shipTo: { addr1: 'Warehouse 9', place: 'Pune', pin: 411001, stateCode: '27' },
  }).bill;
  assert.equal(shipped.transType, 4);
  assert.equal(shipped.toPincode, 411001);
  assert.equal(shipped.toPlace, 'Pune');
});
