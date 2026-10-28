/** R5-A2: channel master, clearing account, SKU map and the clearing-free pickers. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AMZ_MH, mugId, setupWorld } from './helpers/marketplace.ts';
import { ensureClearingAccount, loadChannels, saveChannel, validateChannel } from '../src/lib/marketplace/channels.ts';
import { loadSkuMap, lookupSku, matchListing, saveSkuRows, unmappedList, type CatalogueRow } from '../src/lib/marketplace/sku-map.ts';
import { bankAccountsDb, pickableBankAccounts } from '../src/lib/bank-accounts.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { SalesChannel } from '../src/types/marketplace-r5.ts';

let ch: SalesChannel;
beforeEach(() => { ch = setupWorld(); });

test('operator GSTIN / TAN validation (TCS "C" expected, a "Z" GSTIN is only a note)', () => {
  assert.deepEqual(validateChannel({ name: 'A', gstins: [{ state: '27', gstin: AMZ_MH }], tan: 'MUMA12345B' }).errors, []);
  const bad = validateChannel({ name: 'A', gstins: [{ state: '27', gstin: '27AAICA3918J1CX' }], tan: 'MUM12345B' });
  assert.equal(bad.errors.length, 2);
  const z = validateChannel({ name: 'A', gstins: [{ state: '27', gstin: '27AABCU9603R1ZX' }] });
  assert.ok(z.errors.length || z.notes.length);
  assert.throws(() => saveChannel({ name: 'Bad', platform: 'other', gstins: [{ state: '27', gstin: 'NOPE' }] }));
});

test('saving creates the operator party and ONE clearing account; saving again is idempotent', () => {
  const party = localDb.clients.getById(ch.party_id);
  assert.equal(party?.name, 'Amazon Seller Services Pvt Ltd');
  const clearing = bankAccountsDb.all().find((a) => a.id === ch.clearing_bank_id);
  assert.equal(clearing?.clearing, true);
  assert.equal(clearing?.name, 'Amazon settlement clearing');
  const before = bankAccountsDb.all().length;
  const again = saveChannel({ ...ch, name: 'Amazon', platform: 'amazon' });
  assert.equal(again.clearing_bank_id, ch.clearing_bank_id);
  assert.equal(bankAccountsDb.all().length, before);
  assert.equal(ensureClearingAccount(again).id, ch.clearing_bank_id);
  assert.equal(loadChannels().length, 1);
  assert.throws(() => saveChannel({ name: 'amazon', platform: 'other' }), /already exists/);
});

test('clearing accounts are left out of the cheque, e-payment and BRS pickers', () => {
  for (const p of ['cheque', 'epay', 'brs'] as const) assert.ok(!pickableBankAccounts(p).some((a) => a.clearing), p);
  assert.ok(pickableBankAccounts('any').some((a) => a.clearing));
});

test('SKU lookup by channel SKU and listing id, pack-of-N quantity, catalogue SKU fallback', () => {
  const map = loadSkuMap(ch.id);
  const cat = localDb.items.getAll() as CatalogueRow[];
  assert.deepEqual(lookupSku(map, ch.id, { sku: 'mug-3pk' }, cat), { item_id: mugId(), qty_per_unit: 3, via: 'map' });
  assert.equal(lookupSku(map, ch.id, { listingId: 'B0MUG3' }, cat)?.qty_per_unit, 3);
  assert.equal(lookupSku(map, ch.id, { sku: 'MUG-RED' }, cat)?.via, 'catalogue');
  assert.equal(lookupSku(map, ch.id, { sku: 'UNKNOWN' }, cat), undefined);
  assert.equal(lookupSku(map, 'other-channel', { sku: 'MUG-3PK' }, []), undefined);
  assert.throws(() => saveSkuRows([{ channel_id: ch.id, channel_sku: 'X', item_id: mugId(), qty_per_unit: 0 }]));
});

test('a kit item maps once like any item (kits explode in the stock engine)', () => {
  localDb.items.upsert({ name: 'Mug gift kit', sku: 'KIT-1', type: 'Product' });
  const kit = localDb.items.getAll().find((i) => i.name === 'Mug gift kit')!;
  saveSkuRows([{ channel_id: ch.id, channel_sku: 'AMZ-KIT', item_id: kit.id, qty_per_unit: 1 }]);
  saveSkuRows([{ channel_id: ch.id, channel_sku: 'amz-kit', item_id: kit.id, qty_per_unit: 2 }]);
  const rows = loadSkuMap(ch.id).filter((r) => r.item_id === kit.id);
  assert.equal(rows.length, 1, 'the same channel SKU is updated, not duplicated');
  assert.equal(rows[0].qty_per_unit, 2);
});

test('listing-file match order: sku → barcode → short code → title (suggestion only)', () => {
  const cat = localDb.items.getAll() as CatalogueRow[];
  const m = matchListing([
    { sku: 'MUG-RED' }, { sku: '8901234567890' }, { sku: 'BM' }, { sku: 'ZZZ', title: 'Blue Mug ceramic' }, { sku: 'NONE', title: 'Laptop' },
  ], cat);
  assert.deepEqual(m.map((x) => x.how), ['sku', 'barcode', 'short_code', 'title', undefined]);
  assert.equal(m[3].suggestion, true);
  assert.equal(m[0].suggestion, undefined);
  assert.deepEqual(unmappedList([{ sku: 'A' }, { sku: 'a' }, { sku: 'B' }]).map((u) => [u.sku, u.count]), [['A', 2], ['B', 1]]);
});
