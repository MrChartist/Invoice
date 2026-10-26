/**
 * R4-A3 batch genealogy: two-level BOM with batch splits (mixed batch, every edge kept), backward trace to the supplier
 * bills, forward trace to invoice + challan + POS bill + transfer, a credit-note return, a job-work processed batch,
 * cycle safety, the recall list and the 10,000-event timing guard (soft).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { stockVoucherInputs } from '../src/lib/inventory.ts';
import { batchesOnDocument, buildGenealogy, recallCsvRows, recallList, recallMessageLinks, traceBackward, traceForward, traceSerial } from '../src/lib/production/genealogy.ts';
import type { ManufacturingVoucher } from '../src/types/manufacturing.ts';

const item = (id: string, name: string, extra: Partial<StockItem> = {}): StockItem => ({ id, name, unit: 'KG', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, track_batches: true, ...extra });
const bill = (id: string, no: string, vendor: string, date: string, lines: { name: string; qty: number; batch: string }[]) => ({
  id, kind: 'PURCHASE', bill_number: no, vendor_name: vendor, date, status: 'Unpaid', total: 1, taxable: 1,
  lines: lines.map((l, i) => ({ id: `${id}-${i}`, name: l.name, quantity: l.qty, rate: 10, batch_no: l.batch })),
});
const mfg = (id: string, number: string, date: string, itemId: string, qty: number, batch: string, components: { item_id: string; qty: number; batch_no?: string }[]): ManufacturingVoucher => ({
  id, number, date, item_id: itemId, qty, batch_no: batch, components: components.map((c, i) => ({ id: `${id}-${i}`, ...c })), outputs: [], costs: [],
});
const sale = (id: string, no: string, docType: string, client: string, date: string, qty: number, extra: Record<string, unknown> = {}) => ({
  id, invoice_number: no, doc_type: docType, status: 'Sent', issue_date: date, client: { name: client, phone: '9876543210', email: `${client.toLowerCase()}@x.in` },
  items: [{ id: `${id}-l`, name: 'Biscuit', quantity: qty, rate: 50, batch_no: 'K1' }], ...extra,
});

function world(): StockInputs {
  const items = [item('flour', 'Flour'), item('sugar', 'Sugar'), item('dough', 'Dough'), item('biscuit', 'Biscuit', { unit: 'PKT' }), item('roast', 'Roasted nuts'), item('nuts', 'Nuts')];
  return {
    items, moves: [], includeChallans: true, includeTransfers: true,
    purchases: [
      bill('p1', 'MA/1', 'Mill A', '2026-04-01', [{ name: 'Flour', qty: 100, batch: 'F1' }]),
      bill('p2', 'MB/7', 'Mill B', '2026-04-02', [{ name: 'Flour', qty: 100, batch: 'F2' }, { name: 'Nuts', qty: 50, batch: 'N1' }]),
      bill('p3', 'SG/3', 'Sugar Co', '2026-04-02', [{ name: 'Sugar', qty: 50, batch: 'S1' }]),
    ],
    vouchers: stockVoucherInputs([
      mfg('v1', 'MFG/FY26-27/0001', '2026-04-05', 'dough', 80, 'D1', [{ item_id: 'flour', qty: 40, batch_no: 'F1' }, { item_id: 'flour', qty: 30, batch_no: 'F2' }, { item_id: 'sugar', qty: 10, batch_no: 'S1' }]),
      mfg('v2', 'MFG/FY26-27/0002', '2026-04-06', 'biscuit', 100, 'K1', [{ item_id: 'dough', qty: 50, batch_no: 'D1' }, { item_id: 'roast', qty: 5, batch_no: 'R1' }]),
    ]),
    invoices: [
      sale('i1', 'INV/FY26-27/0001', 'TAX_INVOICE', 'Ravi', '2026-04-10', 10),
      sale('c1', 'DC/FY26-27/0001', 'DELIVERY_CHALLAN', 'Meena', '2026-04-11', 5),
      sale('pos1', 'POS/FY26-27/0001', 'TAX_INVOICE', 'Walk-in', '2026-04-11', 2, { pos: true }),
      sale('cn1', 'CN/FY26-27/0001', 'CREDIT_NOTE', 'Ravi', '2026-04-12', 2, { goods_returned: true }),
    ] as never,
    transfers: [{ id: 't1', transfer_number: 'STR/FY26-27/0001', date: '2026-04-12', from_godown: 'main', to_godown: 'g2', lines: [{ id: 't1l', item_id: 'biscuit', qty: 3, batch_no: 'K1' }] }],
    jobWorkDocs: {
      outs: [{ id: 'jo1', number: 'JWC/FY26-27/0001', date: '2026-04-03', party_name: 'Roaster', job_worker_godown: 'jw', lines: [{ id: 'jo1l', item_id: 'nuts', qty: 10, batch_no: 'N1' }] }],
      ins: [{ id: 'ji1', number: 'JWR/FY26-27/0001', date: '2026-04-04', party_name: 'Roaster', job_worker_godown: 'jw', consumed: [{ id: 'c', item_id: 'nuts', qty: 10, batch_no: 'N1' }], received: [{ id: 'r', item_id: 'roast', qty: 9, kind: 'processed', batch_no: 'R1' }] }],
      rejections: [],
    } as never,
  };
}

test('backward from a finished batch: two levels, mixed dough batch, every flour edge kept, suppliers found', () => {
  const idx = buildGenealogy(collectEvents(world()));
  const t = traceBackward(idx, 'biscuit', 'K1');
  assert.equal(t.madeBy.length, 1);
  assert.equal(t.madeBy[0].ref.refNumber, 'MFG/FY26-27/0002');
  const dough = t.madeBy[0].components.find((c) => c.itemId === 'dough')!;
  assert.equal(dough.mixed, true, 'dough D1 used two flour batches');
  const flours = dough.madeBy[0].components.filter((c) => c.itemId === 'flour');
  assert.deepEqual(flours.map((f) => [f.batch, f.qty, f.sources[0].refNumber, f.sources[0].party]), [['F1', 40, 'MA/1', 'Mill A'], ['F2', 30, 'MB/7', 'Mill B']]);
  // Job-work processed batch: roasted nuts R1 ← nuts N1 ← bill MB/7.
  const roast = t.madeBy[0].components.find((c) => c.itemId === 'roast')!;
  assert.equal(roast.madeBy[0].ref.refType, 'job_work_in');
  assert.equal(roast.madeBy[0].components[0].sources[0].refNumber, 'MB/7');
});

test('forward from a bad flour batch reaches every outward document, and the credit note came back', () => {
  const idx = buildGenealogy(collectEvents(world()));
  const f = traceForward(idx, [{ itemId: 'flour', batch: 'F2' }]);
  assert.deepEqual(f.batches.map((b) => `${b.itemId}|${b.batch}|${b.depth}|${b.mixed}`), ['flour|F2|0|false', 'dough|D1|1|true', 'biscuit|K1|2|false']);
  assert.deepEqual(f.outward.map((o) => [o.refNumber, o.qty, o.kind]).sort(), [
    ['DC/FY26-27/0001', 5, 'sale'], ['INV/FY26-27/0001', 10, 'sale'], ['POS/FY26-27/0001', 2, 'sale'], ['STR/FY26-27/0001', 3, 'transfer'],
  ]);
  assert.deepEqual(f.returned.map((r) => [r.refNumber, r.qty]), [['CN/FY26-27/0001', 2]]);
  const contacts = new Map([['i1', { phone: '9876543210', email: 'ravi@x.in' }]]);
  const list = recallList(f, (_party, refId) => contacts.get(refId));
  const ravi = list.find((r) => r.party === 'Ravi')!;
  assert.deepEqual([ravi.qty, ravi.returned, ravi.phone], [10, 2, '9876543210']);
  assert.equal(list.length, 3, 'Ravi, Meena (challan) and the walk-in POS bill');
  assert.equal(recallCsvRows(list, (id) => id).length, 4);
  const links = recallMessageLinks(ravi, 'Recall');
  assert.match(links.whatsapp ?? '', /^https:\/\/wa\.me\/919876543210\?text=Recall$/);
  assert.match(links.mail ?? '', /^mailto:ravi@x\.in\?/);
  // A job-worked purchase batch reaches the biscuits too, and the job-work challan counts as outward.
  const n = traceForward(idx, [{ itemId: 'nuts', batch: 'N1' }]);
  assert.ok(n.batches.some((b) => b.itemId === 'biscuit'));
  assert.ok(n.outward.some((o) => o.kind === 'job_work' && o.refNumber === 'JWC/FY26-27/0001'));
});

test('trace back from a sales line and from a serial', () => {
  const idx = buildGenealogy(collectEvents(world()));
  assert.deepEqual(batchesOnDocument(idx, 'i1'), [{ itemId: 'biscuit', batch: 'K1', qty: 10 }]);
  const w = world();
  w.items.push({ ...item('phone', 'Phone', { unit: 'NOS', track_batches: false, track_serials: true }) });
  (w.purchases as unknown[]).push({ id: 'p9', kind: 'PURCHASE', bill_number: 'PH/1', vendor_name: 'Phone Co', date: '2026-04-02', status: 'Unpaid', total: 1, taxable: 1, lines: [{ id: 'p9l', name: 'Phone', quantity: 1, rate: 100, serials: ['IMEI1'] }] });
  const s = traceSerial(buildGenealogy(collectEvents(w)), 'phone', 'IMEI1');
  assert.equal(s.sources[0].refNumber, 'PH/1');
});

test('cycle safety: a batch made from itself does not loop', () => {
  const w = world();
  w.vouchers = [...(w.vouchers ?? []), ...stockVoucherInputs([mfg('v3', 'MFG/FY26-27/0003', '2026-04-07', 'dough', 5, 'D1', [{ item_id: 'biscuit', qty: 1, batch_no: 'K1' }])])];
  const idx = buildGenealogy(collectEvents(w));
  const t = traceBackward(idx, 'biscuit', 'K1');
  const json = JSON.stringify(t);
  assert.ok(json.includes('"repeat":true'));
  const f = traceForward(idx, [{ itemId: 'dough', batch: 'D1' }]);
  assert.equal(new Set(f.batches.map((b) => `${b.itemId}|${b.batch}`)).size, f.batches.length);
});

test('10,000 events trace quickly (soft guard: logs, never fails on a slow machine)', () => {
  const items = [item('raw', 'Raw'), item('fin', 'Finished')];
  const purchases = Array.from({ length: 2500 }, (_, i) => bill(`b${i}`, `B/${i}`, `V${i % 20}`, '2026-04-01', [{ name: 'Raw', qty: 10, batch: `R${i}` }]));
  const vouchers = stockVoucherInputs(Array.from({ length: 2500 }, (_, i) => mfg(`m${i}`, `MFG/${i}`, '2026-04-02', 'fin', 5, `FB${i}`, [{ item_id: 'raw', qty: 5, batch_no: `R${i}` }])));
  const invoices = Array.from({ length: 2500 }, (_, i) => ({ id: `s${i}`, invoice_number: `S/${i}`, doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-04-03', client: { name: `C${i % 50}` }, items: [{ id: 'l', name: 'Finished', quantity: 5, rate: 1, batch_no: `FB${i}` }] }));
  const events = collectEvents({ items, moves: [], purchases, vouchers, invoices: invoices as never });
  const count = [...events.values()].reduce((s, l) => s + l.length, 0);
  assert.ok(count >= 10000);
  const t0 = performance.now();
  const idx = buildGenealogy(events);
  const f = traceForward(idx, Array.from({ length: 200 }, (_, i) => ({ itemId: 'raw', batch: `R${i}` })));
  const ms = performance.now() - t0;
  assert.equal(f.outward.length, 200);
  if (ms > 200) console.log(`genealogy: ${count} events indexed + traced in ${ms.toFixed(0)} ms (target < 200 ms)`);
});
