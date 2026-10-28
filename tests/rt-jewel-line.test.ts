/** RT-E2 jewellery bill line: the ring example to the paisa, making bases, wastage in g, loose weight, rounding,
 * typed amount clears, GST 3% on the full value, job work 5%, HUID warning only, e-Way chapter 71, printed text. */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyJewel, huidWarning, jewelAmount, jewelGst, jwHolds, netWeight, validHuid } from '../src/lib/retail/rt-jewel-line.ts';
import { ewayChapterNote } from '../src/lib/retail/rt-cash-guard.ts';
import { purityLabel } from '../src/lib/retail/rt-jewel-rates.ts';
import { bisText, jewelText, trackingText } from '../src/components/templates/paper-helpers.ts';
import { calculateInvoice, calcInputFromRecord, mulRound2 } from '../src/lib/invoice-calc.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { JewelLine } from '../src/types/retail-r9.ts';

const ring: JewelLine = {
  tag: 'JW-0001', metal: 'gold', purity: '22K', gross_wt: 6.42, stone_wt: 0.38, net_wt: 6.04, rate: 9350, wastage_pct: 2,
  making: { basis: 'per_gram', value: 650 }, stone_value: 4800, hallmark_charge: 45, huid: 'AB12CD',
};
const line: InvoiceItem = { id: 'l1', name: 'Ring R-12', type: 'Goods', hsn: '7113', unit: 'PCS', quantity: 1, rate: 0, tax_rate: 3, discount_percent: 0, amount: 0 };

test('the ring example to the paisa: 6.040 g × ₹9,350 + 2% + ₹650/g + stones + hallmarking = ₹66,374.48', () => {
  assert.equal(netWeight(6.42, 0.38), 6.04);
  assert.deepEqual(jewelAmount(ring), { metal: 56474, wastage: 1129.48, making: 3926, total: 66374.48 });
  assert.equal(jewelAmount(ring, true).total, 66374, 'rupee rounding (setting)');
  const l = applyJewel(line, ring, '2026-10-27');
  assert.deepEqual([l.quantity, l.unit, l.rate, l.amount, l.tax_rate, l.serials], [1, 'PCS', 66374.48, 66374.48, 3, ['JW-0001']]);
  assert.match(l.jw!.bis!, /BIS-recognised A&H centre/);
  assert.ok(jwHolds(l));
});

test('making per gram / % of metal / fixed; wastage in grams', () => {
  assert.equal(jewelAmount({ ...ring, making: { basis: 'percent', value: 10 } }).making, 5647.4);
  assert.equal(jewelAmount({ ...ring, making: { basis: 'fixed', value: 2500 } }).making, 2500);
  assert.equal(jewelAmount({ ...ring, wastage_g: 0.25 }).wastage, 2337.5, '0.250 g × ₹9,350');
});

test('a loose chain by weight: quantity = net g in GMS, rate = amount ÷ g, calc gives the amount back', () => {
  const chain: JewelLine = { ...ring, tag: undefined, gross_wt: 12.345, stone_wt: 0, net_wt: 12.345, stone_value: 0, hallmark_charge: 0, making: { basis: 'per_gram', value: 400 } };
  const l = applyJewel({ ...line, name: 'Chain (loose)' }, chain, '2026-10-27');
  assert.deepEqual([l.quantity, l.unit, l.serials], [12.345, 'GMS', undefined]);
  assert.equal(mulRound2(l.quantity, l.rate), jewelAmount(chain).total);
  assert.equal(l.amount, 122672.27, '115,425.75 + 2,308.52 wastage + 4,938 making');
});

test('a typed rate or quantity no longer gives the amount: the line is manual', () => {
  const l = applyJewel(line, ring, '2026-10-27');
  assert.equal(jwHolds({ ...l, rate: 60000 }), false);
  assert.equal(jwHolds({ ...l, quantity: 2 }), false);
});

test('GST 3% on the WHOLE value (making, wastage, stones, hallmarking inside); job work on the customer\'s metal 5% SAC 9988', () => {
  const l = applyJewel(line, ring, '2026-10-27');
  const rec = { doc_type: 'INVOICE', issue_date: '2026-10-27', items: [l], gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 0 } as unknown as InvoiceRecord;
  const t = calculateInvoice(calcInputFromRecord(rec));
  assert.equal(t.taxable_value, 66374.48);
  assert.equal(Math.round((t.cgst_amount + t.sgst_amount) * 100) / 100, 1991.23, '3% of ₹66,374.48');
  assert.deepEqual(jewelGst('2026-10-27', true), { rate: 5, sac: '9988' });
  const jw = applyJewel(line, { ...ring, tag: undefined, job_work: true, stone_value: 0, hallmark_charge: 0 }, '2026-10-27');
  assert.deepEqual([jw.amount, jw.tax_rate, jw.hsn, jw.type], [3926, 5, '9988', 'Service'], 'making only, no metal value');
  assert.match(jewelText(jw.jw), /Customer's metal 6\.040 g \(memo\)/);
});

test('HUID: 6 characters; missing on gold is a warning (from 1 Apr 2023), never a block', () => {
  assert.ok(validHuid('ab12cd') && !validHuid('AB12C') && !validHuid('AB12CD7'));
  assert.match(huidWarning({ name: 'Ring', jw: { ...ring, huid: undefined } }, '2026-10-27'), /no valid 6-character HUID/);
  assert.equal(huidWarning({ name: 'Ring', jw: { ...ring, huid: undefined } }, '2023-03-31'), '', 'before the mandate row');
  assert.equal(huidWarning({ name: 'Anklet', jw: { ...ring, metal: 'silver', purity: '925', huid: undefined } }, '2026-10-27'), '');
});

test('e-Way: suppressed with a note for an all-chapter-71 bill, not for a mixed bill; services ignored', () => {
  assert.match(ewayChapterNote(['7113', '711319', '998716'], '2026-10-27'), /Chapter 71 .* verify with your CA/);
  assert.equal(ewayChapterNote(['7113', '8517'], '2026-10-27'), '');
  assert.equal(ewayChapterNote([], '2026-10-27'), '');
});

test('printing: net weight, "22K (916)", HUID, rate, wastage, making, stones and hallmarking; the BIS line under the totals', () => {
  assert.equal(purityLabel('gold', '22K'), '22K (916)');
  assert.equal(purityLabel('silver', '925'), '925');
  const l = applyJewel(line, ring, '2026-10-27');
  const s = trackingText(l);
  for (const part of ['Tag JW-0001', 'Gross 6.420 g · Stones 0.380 g', 'Net 6.040 g', '22K (916)', 'HUID AB12CD', '₹9,350/g', 'Wastage 2%', 'Making ₹650/g', 'Stones ₹4,800', 'Hallmarking ₹45']) assert.ok(s.includes(part), part);
  assert.match(bisText({ items: [line, l] } as InvoiceRecord), /verified at any BIS-recognised A&H centre/);
  assert.equal(bisText({ items: [line] } as InvoiceRecord), '');
});
