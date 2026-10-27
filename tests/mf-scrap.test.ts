/** MF-B3 scrap: register sums, class rates by date, TCS preset and the declaration, GST TDS note, RCM on unregistered metal scrap. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, clientMH, clientRetail } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { localDb } from '../src/lib/localDb.ts';
import { scrapRegister, scrapSaleDraft, makeScrapSale } from '../src/lib/mfg/mf-scrap.ts';
import { gstTdsNote, scrapClassOf, scrapClassRate, scrapRcm, scrapTcsPreset } from '../src/lib/mfg/mf-scrap-tax.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

const items = [
  { id: 'turn', name: 'MS turnings', unit: 'KG', hsn: '7204', tax_rate: 18, mf_scrap_class: 'metal_ferrous', track_stock: true, sale_rate: 32 },
  { id: 'brass', name: 'Brass chips', unit: 'KG', hsn: '7404', tax_rate: 18, mf_scrap_class: 'metal_nonferrous', track_stock: true },
  { id: 'paper', name: 'Paper waste', unit: 'KG', hsn: '4707', mf_scrap_class: 'paper_waste', track_stock: true },
  { id: 'pp', name: 'PP lumps', unit: 'KG', hsn: '3915', mf_scrap_class: 'plastic_waste', track_stock: true },
] as never[];

test('register: made from journals (BOM / job-card / QC scrap), pending job-card kg counted once, sold net of credit notes', () => {
  const rows = scrapRegister({
    items,
    mfg: [
      { date: '2026-10-05', production_order_id: 'o1', outputs: [{ id: 'a', item_id: 'turn', qty: 3.4, kind: 'scrap', mf_jc: true }, { id: 'b', item_id: 'turn', qty: 10, kind: 'scrap' }] },
    ] as never,
    journals: [{ date: '2026-10-09', produce: [{ id: 'c', item_id: 'brass', qty: 0.24, unit_factor: 1000 }] }] as never,
    cards: [{ order_id: 'o1', entries: [{ id: 'e1', date: '2026-10-04', scrap_kg: 3.4, scrap_item_id: 'turn' }, { id: 'e2', date: '2026-10-20', scrap_kg: 1.2, scrap_item_id: 'turn' }] }] as never,
    invoices: [
      { doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-28', items: [{ name: 'MS turnings', hsn: '7204', quantity: 9, amount: 288 }] },
      { doc_type: 'CREDIT_NOTE', status: 'Sent', issue_date: '2026-10-29', items: [{ name: 'MS turnings', hsn: '7204', quantity: 1, amount: 32 }] },
      { doc_type: 'INVOICE', status: 'Draft', issue_date: '2026-10-28', items: [{ name: 'MS turnings', hsn: '7204', quantity: 50, amount: 1 }] },
    ] as never,
  });
  const turn = rows.find((r) => r.item_id === 'turn')!;
  assert.deepEqual([turn.made, turn.pending, turn.sold, turn.sold_value], [13.4, 1.2, 8, 256], 'the posted 3.4 kg is not pending; the 1.2 kg is');
  assert.equal(rows.find((r) => r.item_id === 'brass')!.made, 240, 'grams typed as 0.24 t → base kg by the unit factor');
});

test('classes by date: metal 18%, paper waste 12% → 5% on 22 Sep 2025, plastic waste no suggestion (MF8)', () => {
  assert.equal(scrapClassRate('metal_ferrous', '2026-10-27').rate, 18);
  assert.equal(scrapClassRate('paper_waste', '2025-09-21').rate, 12);
  assert.equal(scrapClassRate('paper_waste', '2025-09-22').rate, 5);
  assert.equal(scrapClassRate('plastic_waste', '2026-10-27').rate, null);
  assert.equal(scrapClassOf({ hsn: '72044900' }), 'metal_ferrous', 'by HSN without a class');
  assert.equal(scrapClassOf({ hsn: '76020010' }), 'metal_nonferrous');
  assert.equal(scrapClassOf({ hsn: '3915' }), undefined);
});

test('TCS 206C(1) scrap preset: 1% before / 2% from 1 Apr 2026; dropped by the buyer\'s declaration', () => {
  assert.equal(scrapTcsPreset('2026-03-31', false)!.rate, 1);
  assert.equal(scrapTcsPreset('2026-04-01', false)!.rate, 2);
  assert.equal(scrapTcsPreset('2026-04-01', true), null);
  const d = scrapSaleDraft({ date: '2026-10-27', client_name: 'Kabadi', lines: [{ item_id: 'turn', net_kg: 300, rate: 32, gross_kg: 4300, tare_kg: 4000 }] }, items);
  assert.equal(d.tcs_enabled, true);
  assert.equal(d.tcs_rate, 2);
  assert.match(d.tcs_label!, /206C\(1\) scrap 2%/);
  assert.equal(d.items[0].tax_rate, 18);
  assert.deepEqual(d.mf!.scrap!.rows, [{ item: 'MS turnings', gross_kg: 4300, tare_kg: 4000, net_kg: 300 }]);
  assert.equal(d.mf!.scrap!.tcs, true);
  const dec = scrapSaleDraft({ date: '2026-10-27', client_name: 'Foundry', declaration: 'Form 127 dt 01-10-2026', lines: [{ item_id: 'turn', net_kg: 300, rate: 32 }] }, items);
  assert.equal(dec.tcs_enabled, false);
  assert.equal(dec.mf!.scrap!.declaration, 'Form 127 dt 01-10-2026');
  assert.match(dec.notes!, /TCS not collected/);
  const saved = makeScrapSale({ date: '2026-10-27', client_name: 'Kabadi', lines: [{ item_id: 'pp', net_kg: 10, rate: 20 }] }, items);
  assert.equal(localDb.invoices.getById(saved.id)!.status, 'Draft');
  assert.equal(saved.items[0].tax_rate, 0, 'plastic waste: no suggested rate (type it)');
});

test('GST TDS u/s 51 note: registered buyers of metal scrap above ₹2.5 lakh only, from 10 Oct 2024', () => {
  assert.match(gstTdsNote('2026-10-27', { buyerGstin: '27AAACB2230M1ZX', metal: true, taxable: 250001 }), /GST TDS 2% u\/s 51/);
  assert.equal(gstTdsNote('2026-10-27', { buyerGstin: '27AAACB2230M1ZX', metal: true, taxable: 250000 }), '');
  assert.equal(gstTdsNote('2026-10-27', { buyerGstin: '', metal: true, taxable: 900000 }), '', 'unregistered buyer');
  assert.equal(gstTdsNote('2026-10-27', { buyerGstin: 'X', metal: false, taxable: 900000 }), '', 'not metal');
  assert.equal(gstTdsNote('2024-10-09', { buyerGstin: 'X', metal: true, taxable: 900000 }), '', 'before 10 Oct 2024');
  const reg = scrapSaleDraft({ date: '2026-10-27', client_id: undefined, client_name: 'x', lines: [{ item_id: 'turn', net_kg: 10000, rate: 32 }] }, items);
  assert.equal(reg.mf!.scrap!.gst_tds, undefined, 'no GSTIN on a typed buyer');
  localDb.clients.upsert({ ...clientMH, id: 'b2b' } as never);
  localDb.clients.upsert({ ...clientRetail, id: 'b2c' } as never);
  assert.equal(scrapSaleDraft({ date: '2026-10-27', client_id: 'b2b', lines: [{ item_id: 'turn', net_kg: 10000, rate: 32 }] }, items).mf!.scrap!.gst_tds, true);
  assert.equal(scrapSaleDraft({ date: '2026-10-27', client_id: 'b2c', lines: [{ item_id: 'turn', net_kg: 10000, rate: 32 }] }, items).mf!.scrap!.gst_tds, undefined);
});

test('RCM prompt: metal scrap from an unregistered supplier after 10 Oct 2024 only', () => {
  const byId = (id: string) => (items as { id: string }[]).find((i) => i.id === id) as never;
  assert.deepEqual(scrapRcm([{ hsn: '7204' }], { gstin: '' }, '2026-10-27'), { ref: 'N 6/2024-CT(R)' });
  assert.deepEqual(scrapRcm([{ item_id: 'brass' }], { gstin: '' }, '2026-10-27', byId), { ref: 'N 6/2024-CT(R)' }, 'by the item class');
  assert.equal(scrapRcm([{ hsn: '7204' }], { gstin: '27AAACB2230M1ZX' }, '2026-10-27'), null, 'registered');
  assert.equal(scrapRcm([{ hsn: '7204' }], { gstin: '' }, '2024-10-09'), null, 'before the notification');
  assert.equal(scrapRcm([{ item_id: 'paper' }], { gstin: '' }, '2026-10-27', byId), null, 'paper waste');
});
