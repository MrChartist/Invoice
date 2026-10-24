/**
 * Bulk e-Invoice / e-Way files (preflight per invoice, blocked ones listed with reasons) and
 * the IRP bulk-response import into `einvoice_meta`.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  applyIrpResponse,
  buildBulkEInvoice,
  buildBulkEway,
  bulkCandidates,
  decodeSignedQr,
  importIrpResponse,
  normaliseIrpDate,
  parseIrpResponse,
} from '../src/lib/einvoice-bulk.ts';
import { getAllEInvoiceMeta, saveEInvoiceMeta, type EInvoiceMeta } from '../src/lib/einvoice.ts';
import { setTable } from '../src/lib/storage.ts';
import { BUYER_KA, invoice, item, sender } from './einvoice-fixtures.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const NOW = new Date(2025, 5, 20);
beforeEach(() => resetStorage());

const inv = (n: number, over: Partial<InvoiceRecord> = {}) =>
  invoice({ id: `inv-${n}`, invoice_number: `INV/FY25-26/${String(n).padStart(4, '0')}`, sender, ...over });

const IRN = (c: string) => c.repeat(64);

function jwt(data: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ data: JSON.stringify(data), iss: 'NIC' })}.c2lnbmF0dXJl`;
}

/* ── bulk e-Invoice ── */

test('bulk e-Invoice JSON holds every valid selected invoice and skips blocked ones with reasons', () => {
  const ok1 = inv(1);
  const ok2 = inv(2, { client: { ...inv(2).client, gstin: BUYER_KA, state_code: '29' }, place_of_supply: '29', gst_mode: 'IGST' });
  const b2c = inv(3, { client: { ...inv(3).client, gstin: '' } });
  const draft = inv(4, { status: 'Draft' });
  const quote = inv(5, { doc_type: 'QUOTATION' });
  const done = inv(6);
  const dup = inv(7, { id: 'inv-7', invoice_number: ok1.invoice_number });
  const meta: EInvoiceMeta[] = [{ invoice_id: done.id, irn: IRN('a'), ack_no: '1' }];

  const res = buildBulkEInvoice([ok1, ok2, b2c, draft, quote, done, dup], { now: NOW, meta });
  assert.deepEqual(res.included.map((x) => x.invoiceId), ['inv-1', 'inv-2']);
  const parsed = JSON.parse(res.json) as { DocDtls: { No: string }; TranDtls: { SupTyp: string } }[];
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(parsed.map((p) => p.DocDtls.No), [ok1.invoice_number, ok2.invoice_number]);
  const why = Object.fromEntries(res.blocked.map((b) => [b.invoiceId, b.reasons.join(' | ')]));
  assert.deepEqual(Object.keys(why).sort(), ['inv-3', 'inv-4', 'inv-5', 'inv-6', 'inv-7']);
  assert.match(why['inv-3'], /GSTIN/i);
  assert.match(why['inv-4'], /Draft/);
  assert.match(why['inv-5'], /tax invoices/);
  assert.match(why['inv-6'], /IRN already recorded/);
  assert.match(why['inv-7'], /same document number/);
  // includeDone lets a regenerated file contain the one with an IRN.
  assert.ok(buildBulkEInvoice([done], { now: NOW, meta, includeDone: true }).included.length === 1);
});

test('credit note in a bulk file gets its original invoice as the preceding document', () => {
  const orig = inv(1);
  const cn = inv(2, { doc_type: 'CREDIT_NOTE', invoice_number: 'CN/FY25-26/0001' });
  const res = buildBulkEInvoice([cn], { now: NOW, links: [{ from_id: orig.id, to_id: cn.id, relation: 'credit_note' }], allInvoices: [orig, cn] });
  assert.equal(res.included.length, 1);
  const p = res.payloads[0];
  assert.equal(p.DocDtls.Typ, 'CRN');
  assert.deepEqual(p.PrecDocDtls, [{ InvNo: orig.invoice_number, InvDt: '18/06/2025' }]);
});

test('bulkCandidates: period, tax docs only, preselects B2B without IRN', () => {
  const list = bulkCandidates(
    [inv(1), inv(2, { issue_date: '2025-08-01' }), inv(3, { status: 'Draft' }), inv(4, { client: { ...inv(4).client, gstin: '' } }), inv(5)],
    { from: '2025-06-01', to: '2025-06-30' },
    [{ invoice_id: 'inv-5', irn: IRN('b') }],
  );
  assert.deepEqual(list.map((c) => c.invoice.id), ['inv-1', 'inv-4', 'inv-5']);
  assert.deepEqual(list.map((c) => c.preselect), [true, false, false]);
  assert.equal(list[2].hasIrn, true);
});

/* ── bulk e-Way ── */

test('bulk e-Way JSON: shared transport, saved transport wins, services-only and missing vehicle are blocked', () => {
  const a = inv(1);
  const b = inv(2);
  const services = inv(3, { items: [item({ hsn: '998311', name: 'Consulting', type: 'service' })] });
  const done = inv(4);
  const meta: EInvoiceMeta[] = [
    { invoice_id: b.id, vehicle: 'KA01AB1234', transport: 'ROAD', distance: 50 },
    { invoice_id: done.id, eway_no: '123456789012' },
  ];
  const res = buildBulkEway([a, b, services, done], { now: NOW, meta, transport: { mode: 'ROAD', vehicle: 'MH12 AB 1234', distance: 120 } });
  assert.deepEqual(res.included.map((x) => x.invoiceId), ['inv-1', 'inv-2']);
  const json = JSON.parse(res.json) as { version: string; billLists: { docNo: string; vehicleNo: string; transDistance: number | string }[] };
  assert.equal(json.billLists.length, 2);
  assert.equal(json.billLists[0].vehicleNo, 'MH12AB1234');
  assert.equal(json.billLists[1].vehicleNo, 'KA01AB1234', 'transport saved with the invoice is used');
  const why = Object.fromEntries(res.blocked.map((x) => [x.invoiceId, x.reasons.join(' | ')]));
  assert.ok(why['inv-3'], 'services-only invoice is blocked');
  assert.match(why['inv-4'], /already recorded/);

  const noVehicle = buildBulkEway([a], { now: NOW });
  assert.equal(noVehicle.included.length, 0);
  assert.equal(noVehicle.blocked.length, 1);
  assert.ok(noVehicle.blocked[0].reasons.length > 0);
});

/* ── IRP response import ── */

test('parse: JSON array, API-style wrapped Data string, signed-QR-only row', () => {
  const qr = jwt({ SellerGstin: sender.companyGstin, DocNo: 'INV/FY25-26/0003', DocDt: '18/06/2025', Irn: IRN('c') });
  const text = JSON.stringify([
    { DocNo: 'INV/FY25-26/0001', AckNo: 112010000001, AckDt: '2025-06-18 14:32:10', Irn: IRN('a'), SignedQRCode: 'x.y.z', Status: 'ACT' },
    { Status: 1, Data: JSON.stringify({ AckNo: 112010000002, AckDt: '18/06/2025 02:05:00 PM', Irn: IRN('b'), SignedQRCode: 'p.q.r', DocDtls: { No: 'INV/FY25-26/0002' }, EwbNo: 331000000001 }) },
    { AckNo: '112010000003', AckDt: '2025-06-18 15:00:00', SignedQRCode: qr },
    { Status: 0, ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }], DocNo: 'INV/FY25-26/0009' },
  ]);
  const p = parseIrpResponse(text);
  assert.equal(p.format, 'json');
  assert.equal(p.rows.length, 4);
  assert.equal(p.rows[0].ackNo, '112010000001');
  assert.equal(p.rows[1].docNo, 'INV/FY25-26/0002');
  assert.equal(p.rows[1].ewbNo, '331000000001');
  assert.equal(p.rows[2].docNo, 'INV/FY25-26/0003', 'read from the signed QR');
  assert.equal(p.rows[2].irn, IRN('c'));
  assert.equal(p.rows[3].error, 'Duplicate IRN');
  assert.deepEqual(decodeSignedQr('not-a-jwt'), null);
  // Wrapped in an object.
  assert.equal(parseIrpResponse(JSON.stringify({ results: [{ DocNo: 'A1', Irn: IRN('d') }] })).rows.length, 1);
  assert.match(parseIrpResponse('{oops').errors[0], /could not be read/);
});

test('parse: Excel result sheet saved as CSV (header names vary)', () => {
  const csv = [
    'Sl No,Doc No,Doc Date,Ack No,Ack Date,IRN,Signed QR Code,EWB No,EWB Valid Till,Status,Error Message',
    `1,INV/FY25-26/0001,18/06/2025,112010000001,18/06/2025 14:32:10,${IRN('a')},a.b.c,331000000001,20/06/2025 23:59:00,Success,`,
    '2,INV/FY25-26/0002,18/06/2025,,,,,,,Failed,GSTIN of buyer is invalid',
  ].join('\r\n');
  const p = parseIrpResponse(csv);
  assert.equal(p.format, 'csv');
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].irn, IRN('a'));
  assert.equal(p.rows[0].ewbValidTill, '20/06/2025 23:59:00');
  assert.equal(p.rows[1].error, 'GSTIN of buyer is invalid');
});

test('dates: dd/mm/yyyy with AM/PM, ISO, date-only', () => {
  assert.equal(normaliseIrpDate('18/06/2025 02:05:00 PM'), '2025-06-18 14:05:00');
  assert.equal(normaliseIrpDate('2025-06-18T09:01'), '2025-06-18 09:01:00');
  assert.equal(normaliseIrpDate('20/06/2025 23:59:00', true), '2025-06-20');
  assert.equal(normaliseIrpDate('5-6-2025'), '2025-06-05');
});

test('apply: writes meta for matching numbers, reports unmatched / rejected / conflicts, keeps transport', () => {
  const invoices = [inv(1), inv(2), inv(3), inv(4)];
  const existing: EInvoiceMeta[] = [
    { invoice_id: 'inv-1', vehicle: 'MH12AB1234', distance: 20 },
    { invoice_id: 'inv-3', irn: IRN('e'), ack_no: '9' },
  ];
  const rows = parseIrpResponse(
    JSON.stringify([
      { DocNo: 'inv/fy25-26/0001', AckNo: '112010000001', AckDt: '18/06/2025 14:32', Irn: IRN('A'), SignedQRCode: 'x.y.z', EwbNo: '331000000001', EwbValidTill: '20/06/2025 23:59:00' },
      { DocNo: 'INV/FY25-26/0002', AckNo: '112010000002', Irn: IRN('b') },
      { DocNo: 'INV/FY25-26/0003', AckNo: '112010000003', Irn: IRN('c') },
      { DocNo: 'INV/FY25-26/0099', AckNo: '112010000099', Irn: IRN('d') },
      { DocNo: 'INV/FY25-26/0002', Status: 'Failed', ErrorMessage: 'Invalid buyer' },
      { DocNo: 'INV/FY25-26/0004', AckNo: 'ABC', Irn: IRN('f') },
    ]),
  ).rows;
  const res = applyIrpResponse(rows, invoices, existing, { now: '2025-06-20T00:00:00Z' });
  assert.deepEqual(res.written.map((w) => w.invoiceId), ['inv-1', 'inv-2']);
  const m1 = res.meta.find((m) => m.invoice_id === 'inv-1')!;
  assert.equal(m1.irn, IRN('a'), 'IRN stored lower-case');
  assert.equal(m1.ack_no, '112010000001');
  assert.equal(m1.ack_date, '2025-06-18 14:32:00');
  assert.equal(m1.signed_qr, 'x.y.z');
  assert.equal(m1.eway_no, '331000000001');
  assert.equal(m1.eway_valid_upto, '2025-06-20');
  assert.equal(m1.vehicle, 'MH12AB1234', 'transport details already saved are kept');
  assert.deepEqual(res.unmatched.map((u) => u.docNo), ['INV/FY25-26/0099']);
  const failed = res.failed.map((f) => `${f.line}:${f.reason}`);
  assert.equal(res.failed.length, 3);
  assert.ok(failed.some((f) => f.startsWith('3:') && /different IRN/.test(f)), 'existing different IRN is not overwritten');
  assert.ok(failed.some((f) => f.startsWith('5:') && /Invalid buyer/.test(f)));
  assert.ok(failed.some((f) => f.startsWith('6:') && /Ack No/.test(f)));
  assert.equal(res.meta.find((m) => m.invoice_id === 'inv-3')!.irn, IRN('e'));

  const over = applyIrpResponse(rows.slice(2, 3), invoices, existing, { overwrite: true });
  assert.equal(over.written[0].replaced, true);
  assert.equal(over.meta.find((m) => m.invoice_id === 'inv-3')!.irn, IRN('c'));
});

test('apply: a repeated number is resolved by seller GSTIN, else reported', () => {
  const other = { ...sender, companyGstin: '29AABCU9603R1ZJ' };
  const a = inv(1);
  const b = inv(2, { invoice_number: a.invoice_number, sender: other });
  const row = parseIrpResponse(JSON.stringify([{ DocNo: a.invoice_number, Irn: IRN('a'), AckNo: '1', SellerGstin: sender.companyGstin }])).rows;
  assert.equal(applyIrpResponse(row, [a, b], []).written[0].invoiceId, 'inv-1');
  const amb = parseIrpResponse(JSON.stringify([{ DocNo: a.invoice_number, Irn: IRN('a'), AckNo: '1' }])).rows;
  assert.match(applyIrpResponse(amb, [a, b], []).unmatched[0].reason, /share this number/);
});

test('importIrpResponse writes einvoice_meta in storage (only when something matched)', () => {
  setTable('invoices', [inv(1)]);
  saveEInvoiceMeta({ invoice_id: 'inv-1', vehicle: 'MH12AB1234' });
  const none = importIrpResponse(JSON.stringify([{ DocNo: 'NOPE/1', Irn: IRN('a'), AckNo: '1' }]));
  assert.equal(none.result.written.length, 0);
  assert.equal(getAllEInvoiceMeta()[0].irn, undefined);
  const { result } = importIrpResponse(JSON.stringify([{ DocNo: 'INV/FY25-26/0001', Irn: IRN('a'), AckNo: '1' }]));
  assert.equal(result.written.length, 1);
  const stored = getAllEInvoiceMeta();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].irn, IRN('a'));
  assert.equal(stored[0].vehicle, 'MH12AB1234');
});
