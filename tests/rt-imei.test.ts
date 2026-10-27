/** RT-D1: IMEI scan lookup (in-stock serial → item + serial), dual IMEI, Luhn, printing both, blocked-IMEI check log. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { findByCode, serialScan } from '../src/lib/scan.ts';
import { imeiIssues, joinPairs, lastCheck, logImeiCheck, loadImeiChecks, luhnOk, pairIndex, pairsOf, resaleCheckIssue, serialHit, serialIndex, splitPairs } from '../src/lib/retail/rt-imei.ts';
import { trackingText } from '../src/components/templates/paper-helpers.ts';

const DAY = '2026-07-20';
const A1 = '490154203237518'; // valid Luhn
const A2 = '356938035643809'; // valid Luhn
const B1 = '353918052034572';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => {
  thawDate();
  serialScan.find = undefined;
});

function phones() {
  const item = blankStockItem({ name: 'Redmi 13 5G 8/128 Black', hsn: '8517', track_serials: true, serial_kind: 'imei', warranty_months: 12, sale_rate: 13999, tax_rate: 18 });
  stockDb.saveItem(item);
  const { serials, pairs } = splitPairs([`${A1} / ${A2}`, B1]);
  purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Distributor', bill_number: 'D-1', date: '2026-07-01', category: 'Purchases',
    lines: [{ id: 'l1', name: item.name, item_id: item.id, hsn: '8517', quantity: 2, rate: 11000, tax_rate: 18, serials, serial_pairs: pairs }],
    taxable: 22000, cgst: 1980, sgst: 1980, igst: 0, total: 25960, amount_paid: 0, itc_eligible: true,
  });
  return item;
}

test('Luhn: valid IMEIs pass, a changed digit fails; only imei items are checked, never blocking', () => {
  assert.ok(luhnOk(A1) && luhnOk(A2) && luhnOk(B1));
  assert.equal(luhnOk('490154203237519'), false);
  assert.deepEqual(imeiIssues({ serial_kind: 'imei' }, [A1, '490154203237519', 'SN-ABC']), ['490154203237519']);
  assert.deepEqual(imeiIssues({ serial_kind: 'serial' }, ['490154203237519']), [], 'not an IMEI item');
});

test('dual IMEI: "IMEI1 / IMEI2" rows split into the tracked serial and its pair; other "/" serials untouched', () => {
  const r = splitPairs([`${A1} / ${A2}`, 'AB/12', B1]);
  assert.deepEqual(r.serials, [A1, 'AB/12', B1]);
  assert.deepEqual(r.pairs, { [A1]: A2 });
  assert.deepEqual(joinPairs(r.serials, r.pairs), [`${A1} / ${A2}`, 'AB/12', B1]);
});

test('scan an in-stock IMEI → the item with that serial picked; IMEI 2 finds IMEI 1; a sold IMEI is not found', () => {
  const item = phones();
  const pairs = pairIndex(purchasesDb.all());
  serialScan.find = (code) => {
    const s = serialHit(serialIndex(loadTracking(), pairs), code);
    return s ? { item: s, via: 'serial' } : null;
  };
  const one = findByCode(A1, [], stockDb.items());
  assert.equal(one?.via, 'serial');
  assert.deepEqual([one?.item.name, one?.item.serials, one?.item.warranty_months, one?.item.quantity], [item.name, [A1], 12, 1]);
  const two = findByCode(A2, [], stockDb.items());
  assert.deepEqual(two?.item.serials, [A1], 'scanning IMEI 2 picks IMEI 1');
  // Sell A1 on a saved bill → it leaves stock and the lookup no longer finds it.
  const sold = createViaStore({ client: clientRetail, date: DAY, lines: [{ name: item.name, hsn: '8517', qty: 1, rate: 13999, tax: 18 }] });
  localDb.invoices.save({ ...sold, items: sold.items.map((l) => ({ ...l, serials: [A1] })) });
  assert.equal(findByCode(A1, [], stockDb.items()), null, 'a sold IMEI is not found');
  assert.equal(findByCode(A2, [], stockDb.items()), null);
  assert.deepEqual(findByCode(B1, [], stockDb.items())?.item.serials, [B1]);
});

test('the sale line prints both IMEIs', () => {
  phones();
  const pairs = pairsOf(purchasesDb.all(), [A1]);
  assert.deepEqual(pairs, { [A1]: A2 });
  assert.equal(trackingText({ serials: [A1], serial_pairs: pairs, warranty_months: 12 }), `S/N: ${A1} / ${A2} · Warranty 12 months`);
  assert.equal(trackingText({ serials: [B1] }), `S/N: ${B1}`);
});

test('blocked-IMEI check log: resale warns without a clear check in 30 days, blocked is a stop', () => {
  assert.match(resaleCheckIssue([], A1, DAY), /no "clear" blocked-IMEI check in the last 30 days/);
  logImeiCheck({ date: '2026-06-01', imei: A1, result: 'clear', portal_ref: 'REQ-1' });
  assert.match(resaleCheckIssue(loadImeiChecks(), A1, DAY), /last 30 days/, 'older than 30 days');
  logImeiCheck({ date: '2026-07-10', imei: A2, result: 'clear' });
  assert.equal(resaleCheckIssue(loadImeiChecks(), A1, DAY, A2), '', 'a check of either IMEI of the pair counts');
  logImeiCheck({ date: '2026-07-19', imei: A1, result: 'blocked' });
  assert.equal(lastCheck(loadImeiChecks(), A1)?.result, 'blocked');
  assert.match(resaleCheckIssue(loadImeiChecks(), A1, DAY), /BLOCKED/);
  assert.throws(() => logImeiCheck({ date: DAY, imei: '', result: 'clear' }), /IMEI/);
});
