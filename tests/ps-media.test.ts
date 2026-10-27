/** R14 PS-B5 media: principal vs agent lines and their GSTR effect, commission line, RO print fields, 194C, import RCM. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';
import { generateId } from '../src/lib/storage.ts';
import { byMedium, commissionLine, mediaLines, mediaSchedule, mediaTds, unbilledMedia } from '../src/lib/prof/ps-media.ts';
import { roFields, roHtml } from '../src/lib/prof/ps-ro.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const bill = (id: string, total: number, media: Record<string, unknown>, over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id, kind: 'BILL' as never, vendor_name: id === 'np' ? 'Times of India' : 'Meta Platforms', bill_number: `B-${id}`, date: '2026-10-15', category: 'Media',
  lines: [{ id: 'l', name: 'Space', quantity: 1, rate: total, tax_rate: 0 }], taxable: total, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total, amount_paid: 0,
  ps: { media: { client_id: 'c-mh', medium: 'print', mode: 'principal', ...media } }, ...over,
} as PurchaseRecord);

test('the user story: newspaper space as principal (+15 % fee, all taxable), Meta spend as pure agent (+ fee)', () => {
  purchasesDb.save(bill('np', 300000, { publication: 'Times of India, Delhi', ro: 'PO/FY26-27/0042' }));
  purchasesDb.save(bill('meta', 120000, { medium: 'digital', mode: 'agent', publication: 'Meta ads (client account)' }));
  const rows = unbilledMedia(purchasesDb.all(), 'c-mh', () => false);
  assert.equal(rows.length, 2);
  assert.deepEqual(byMedium(rows).map((g) => [g.medium, g.cost]), [['print', 300000], ['digital', 120000]]);
  const lines = mediaLines(rows, { fee_pct: 15, sac: '998361', gst_rate: 18 });
  assert.deepEqual(lines.map((l) => [l.rate, l.tax_rate, l.charge_head_id ?? '']), [[300000, 18, ''], [45000, 18, ''], [120000, 0, 'rule33'], [18000, 18, '']]);
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-31', lines: [{ name: 'Monthly retainer', hsn: '998361', qty: 1, rate: 100000, tax: 18 }] });
  localDb.invoices.save({ ...inv, items: [...inv.items, ...lines.map((l) => ({ ...l, id: generateId(), amount: l.rate, type: 'Service' }) as InvoiceItem)] });
  const rec = localDb.invoices.getById(inv.id) as InvoiceRecord;
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.hsn.map((h: { hsn: string; taxable: number }) => [h.hsn, h.taxable]), [['998361', 463000]], 'the agent spend is not a supply');
  assert.deepEqual(r.gstr1.nil, []);
  assert.deepEqual(mediaSchedule(rows).map((s) => [s.medium, s.mode]), [['print', 'principal'], ['digital', 'agent']]);
  assert.deepEqual(unbilledMedia(purchasesDb.all(), 'c-mh', (id) => id === 'np').map((x) => x.id), ['meta']);
});

test('principal at the media class instead of the service rate; commission line; 194C and the levy', () => {
  purchasesDb.save(bill('np', 100000, {}));
  const [l] = mediaLines(unbilledMedia(purchasesDb.all(), 'c-mh', () => false), { fee_pct: 0, sac: '998361', gst_rate: 18, media_rate: 5, media_hsn: '998363' });
  assert.deepEqual([l.hsn, l.tax_rate], ['998363', 5]);
  assert.deepEqual(commissionLine('Times of India', 200000, 15, { sac: '998363', gst_rate: 18 }), { name: 'Media commission 15% — Times of India', hsn: '998363', unit: 'NOS', quantity: 1, rate: 30000, tax_rate: 18, discount_percent: 0 });
  assert.deepEqual(mediaTds('2026-10-01'), { section: '194C', levy: false });
  assert.equal(mediaTds('2024-10-01').levy, true);
});

test('release order: a PO with ps.media prints as a release order', () => {
  const po = { id: 'p', po_number: 'PO/FY26-27/0042', date: '2026-10-01', vendor_name: 'Times of India', lines: [{ id: 'l', name: 'Front page solus, 12 Oct', quantity: 1, unit: '8x12 cm', rate: 300000, tax_rate: 5 }], taxable: 300000, cgst: 7500, sgst: 7500, igst: 0, total: 315000, ps: { media: { client_id: 'c-mh', medium: 'print', mode: 'principal', publication: 'Times of India, Delhi', insert_from: '2026-10-12', client_ref: 'BT/MKT/77' } } };
  assert.deepEqual(roFields(po, 'Bharat Traders')!.map(([k]) => k), ['RO no.', 'Medium', 'Publication / platform', 'Schedule', 'Client', 'Client reference']);
  const html = roHtml(po as never, { name: 'Ad Agency LLP' }, undefined, 'Bharat Traders');
  assert.match(html, /<h1>Release order<\/h1>/);
  assert.match(html, /BT\/MKT\/77/);
  assert.match(html, /Size \/ duration/);
  assert.equal(roFields({ po_number: 'x' }), null);
  assert.match(roHtml({ ...po, ps: undefined } as never, { name: 'X' }), /<h1>Purchase order<\/h1>/);
});

test('a foreign platform bill keeps the existing import-of-services RCM reading', () => {
  const b = bill('meta', 50000, { medium: 'digital', mode: 'principal' }, { import_type: 'SERVICES', reverse_charge: true } as never);
  const p = readPurchase(b)!;
  assert.deepEqual([p.importType, p.reverseCharge], ['SERVICES', true]);
});

test('the media snapshot for the paper', async () => {
  const { mediaSnap } = await import('../src/lib/prof/ps-media.ts');
  purchasesDb.save(bill('np', 300000, { publication: 'Times of India, Delhi', ro: 'PO/FY26-27/0042', insert_from: '2026-10-12' }));
  assert.deepEqual(mediaSnap(unbilledMedia(purchasesDb.all(), 'c-mh', () => false), 15), { rows: [{ ro: 'PO/FY26-27/0042', media: 'print', edition: 'Times of India, Delhi', date: '2026-10-12', amount: 300000 }], commission_pct: 15 });
});
