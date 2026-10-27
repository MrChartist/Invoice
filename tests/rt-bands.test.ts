/** RT-C1 price-band GST: boundary (≤), discounts and the invoice discount share, tax-inclusive MRP, the 22 Sep 2025 change. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable, getTable } from '../src/lib/storage.ts';
import { PRICE_BAND_RULES, ALTERATION_RULES } from '../src/lib/retail-rules.ts';
import { bandExceptions, bandForHsn, bandLookup, bandRate, liveBandExceptions, syncBands } from '../src/lib/retail/rt-bands.ts';
import { setBands } from '../src/lib/retail/rt-matrix.ts';
import { gstExceptions, loadBandCheck } from '../src/lib/gst-guards.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const NEW = '2025-09-22';
const line = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: 'l1', name: 'Kurta', type: 'Goods', hsn: '6211', unit: 'PCS', quantity: 1, rate: 2799, tax_rate: 18, discount_percent: 0, amount: 0, band_rate: { kind: 'apparel', value_per_piece: 0 }, ...over });
const doc = (items: InvoiceItem[], over: Partial<InvoiceRecord> = {}) => ({ id: 'd1', doc_type: 'INVOICE' as const, issue_date: '2026-07-01', gst_mode: 'CGST_SGST' as const, discount_type: 'PERCENT' as const, discount_rate: 0, items, ...over });

test('exactly ₹2,500 per piece → 5%; ₹2,500.01 → 18%', () => {
  assert.equal(bandRate('apparel', 2500, NEW).rate, 5);
  assert.equal(bandRate('apparel', 2500.01, NEW).rate, 18);
  assert.equal(syncBands(doc([line({ rate: 2500 })]))[0].tax_rate, 5);
  assert.equal(syncBands(doc([line({ rate: 2500.01 })]))[0].tax_rate, 18);
});

test('a line discount crosses the band (₹2,799 less 15% → 5%; without it 18%)', () => {
  const [l] = syncBands(doc([line({ discount_percent: 15 })]));
  assert.equal(l.tax_rate, 5);
  assert.deepEqual(l.band_rate, { kind: 'apparel', value_per_piece: 2379.15, rate: 5 });
  const [back] = syncBands(doc([{ ...l, discount_percent: 0 }]));
  assert.equal(back.tax_rate, 18);
  assert.equal(back.band_rate?.value_per_piece, 2799);
  // A ₹2,600 jacket stays at 18%.
  assert.equal(syncBands(doc([line({ rate: 2600 })]))[0].tax_rate, 18);
  // Quantity does not change the per-piece value; pieces in another unit do (3-pack at ₹6,000 = ₹2,000 a piece).
  assert.equal(syncBands(doc([line({ quantity: 4, rate: 2600 })]))[0].tax_rate, 18);
  assert.equal(syncBands(doc([line({ unit: 'PACK', unit_factor: 3, rate: 6000 })]))[0].band_rate?.value_per_piece, 2000);
});

test('the invoice amount discount (offer / loyalty) is shared pro rata before the band', () => {
  const items = [line({ id: 'a', rate: 2600 }), line({ id: 'b', rate: 2600 })];
  assert.deepEqual(syncBands(doc(items)).map((l) => l.tax_rate), [18, 18]);
  // ₹400 off the bill → ₹200 a line → ₹2,400 a piece → 5%.
  const out = syncBands(doc(items, { discount_type: 'AMOUNT', discount_rate: 400 }));
  assert.deepEqual(out.map((l) => [l.tax_rate, l.band_rate?.value_per_piece]), [[5, 2400], [5, 2400]]);
});

test('tax-inclusive (MRP) prices: the 5% band is tested first, the price stays', () => {
  const inc = { price_includes_tax: true };
  // ₹2,625 ÷ 1.05 = ₹2,500 → 5%.
  const [a] = syncBands(doc([line({ rate: 2625 })], inc));
  assert.equal(a.tax_rate, 5);
  assert.equal(a.rate, 2625);
  assert.equal(a.band_rate?.value_per_piece, 2500);
  // ₹2,626 ÷ 1.05 > ₹2,500 → 18% (taxable ₹2,225.42 — below the limit, still 18%: no loop).
  const [b] = syncBands(doc([line({ rate: 2626 })], inc));
  assert.deepEqual([b.tax_rate, b.band_rate?.value_per_piece], [18, 2225.42]);
  assert.equal(bandRate('apparel', 2625, NEW, true).rate, 5);
});

test('rate change date: 21 Sep 2025 uses ₹1,000 / 12%, 22 Sep 2025 ₹2,500 / 18%', () => {
  assert.equal(bandRate('apparel', 1000, '2025-09-21').rate, 5);
  assert.equal(bandRate('apparel', 1200, '2025-09-21').rate, 12);
  assert.equal(bandRate('apparel', 1200, '2025-09-22').rate, 5);
  assert.equal(bandRate('apparel', 2600, '2025-09-21').rate, 12);
  assert.equal(bandRate('apparel', 2600, '2025-09-22').rate, 18);
  assert.equal(syncBands(doc([line({ rate: 1200 })], { issue_date: '2025-09-21' }))[0].tax_rate, 12);
  assert.equal(bandRate('made_ups', 1200, '2025-09-21').rate, 12);
});

test('footwear rows: ₹500 (2017), ₹1,000 (27 Jul 2018), ₹2,500 (22 Sep 2025), else 18%', () => {
  assert.equal(bandRate('footwear', 600, '2018-07-26').rate, 18);
  assert.equal(bandRate('footwear', 600, '2018-07-27').rate, 5);
  assert.equal(bandRate('footwear', 1000, '2025-01-01').rate, 5);
  assert.equal(bandRate('footwear', 1001, '2025-01-01').rate, 18);
  assert.equal(bandRate('footwear', 2500, NEW).rate, 5);
  assert.equal(bandRate('footwear', 2501, NEW).rate, 18);
});

test('a rate typed on the line is kept (manual); credit notes keep the original rate', () => {
  const [l] = syncBands(doc([line({ discount_percent: 15 })]));
  const [typed] = syncBands(doc([{ ...l, tax_rate: 12 }]));
  assert.equal(typed.tax_rate, 12);
  assert.equal(typed.band_rate?.manual, true);
  // Still manual after a discount change.
  assert.equal(syncBands(doc([{ ...typed, discount_percent: 0 }]))[0].tax_rate, 12);
  // The exceptions view flags it.
  assert.deepEqual(bandExceptions(doc([typed])).map((f) => f.code).sort(), ['BAND_DISCOUNT', 'BAND_RATE']);
  // Credit note of the discounted sale: 5% stays although the line has no discount.
  const cn = doc([{ ...l, discount_percent: 0 }], { doc_type: 'CREDIT_NOTE' });
  assert.equal(syncBands(cn)[0].tax_rate, 5);
  assert.deepEqual(bandExceptions(cn), []);
  // Not banded: nothing changes (same array back).
  const plain = doc([line({ band_rate: undefined })]);
  assert.equal(syncBands(plain), plain.items);
});

test('kind by item name (POS), HSN chapters, bulk set on a style and its children', () => {
  const look = bandLookup([{ name: 'Kurta', gst_band: 'apparel' }]);
  assert.equal(syncBands(doc([line({ band_rate: undefined, discount_percent: 15 })]), look)[0].tax_rate, 5);
  assert.deepEqual(['6109', '6211', '6302', '6403', '8517', ''].map(bandForHsn), ['apparel', 'apparel', 'made_ups', 'footwear', undefined, undefined]);
  setTable('stock_items', [{ id: 'p', name: 'Style', hsn: '6211' }, { id: 'c', name: 'Style - M', variant_of: 'p' }, { id: 'x', name: 'Other' }]);
  assert.equal(setBands([{ id: 'p', band: 'apparel' }]), 2);
  assert.deepEqual(getTable<{ id: string; gst_band?: string }>('stock_items').map((i) => i.gst_band), ['apparel', 'apparel', undefined]);
  assert.equal(setBands([{ id: 'p' }]), 2);
  assert.ok(getTable<{ gst_band?: string }>('stock_items').every((i) => !i.gst_band));
});

test('exceptions: near the limit (±₹50), a discount decided the band; through gst-guards once loaded', async () => {
  assert.deepEqual(bandExceptions(doc([line({ rate: 2540, tax_rate: 5 })])).map((f) => f.code), ['BAND_RATE', 'BAND_EDGE']);
  const [ok] = syncBands(doc([line({ rate: 2540 })]));
  assert.deepEqual(bandExceptions(doc([ok])).map((f) => f.code), ['BAND_EDGE']);
  const inv = { ...doc([{ ...line({ discount_percent: 15 }), tax_rate: 18, band_rate: { kind: 'apparel' as const, value_per_piece: 2379.15, rate: 18 } }]), invoice_number: 'INV/1', status: 'Sent', client: { name: 'A' }, total: 1 } as unknown as InvoiceRecord;
  assert.deepEqual(liveBandExceptions(inv).map((f) => f.code), ['BAND_RATE', 'BAND_DISCOUNT']);
  assert.equal(await loadBandCheck([], false, () => import('../src/lib/retail/rt-bands.ts')), false, 'nothing loads without band lines');
  assert.equal(await loadBandCheck([inv], false, () => import('../src/lib/retail/rt-bands.ts')), true);
  const ex = gstExceptions([inv], { from: '2026-07-01', to: '2026-07-31', irnIds: new Set(), aato: () => undefined, today: '2026-07-31' });
  assert.ok(ex.some((e) => e.code === 'BAND_RATE' && e.severity === 'warning'));
});

test('every rule row has a date, a source and verified', () => {
  for (const rows of [...Object.values(PRICE_BAND_RULES), ALTERATION_RULES]) {
    assert.ok(rows.length > 0);
    for (const r of rows) assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.from) && r.source && typeof r.verified === 'boolean', JSON.stringify(r));
  }
});
