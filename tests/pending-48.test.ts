/**
 * PENDING 48 (8.46, 8C follow-ups): payment approval inside the e-payment batch, memory for receipts / vouchers,
 * the multi-line GST split from the supplier's full e-invoice JSON, and QR reading from images embedded in a PDF.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER_GSTIN } from './helpers/world.ts';
import { setActorProvider, type Role } from '../src/lib/access.ts';
import { savePurchaseApprovalPolicy, purchaseApprovalHistory } from '../src/lib/purchase-approvals.ts';
import { decideEpayBatch, epayBatchCleared, loadEpayBatches, matchResponse, parseBankResponse, recordConfirmed, saveEpayBatch } from '../src/lib/epay-confirm.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { buildActionMemory, suggestCategorisations } from '../src/lib/bank-rules.ts';
import type { BankLine, BankStatement } from '../src/lib/bank-recon.ts';
import { decodeEinvoiceJson, encodeEinvoiceQrForTest } from '../src/lib/einvoice-qr.ts';
import { draftFromEinvoiceJson } from '../src/lib/bill-capture.ts';
import { pdfImages } from '../src/lib/pdf-images.ts';

const as = (role: Role, name: string = role) => setActorProvider(() => ({ id: name, name, role }));
beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

/* ── e-payment batch approval ─────────────────────────────────── */

test('e-payment: a clerk batch above the payment limit is held for approval, no file, nothing recordable', () => {
  as('owner');
  savePurchaseApprovalPolicy({ bills: false, billAbove: 0, payments: true, paymentAbove: 1000 });
  const v = vendorsDb.save({ name: 'Acme' } as never);
  as('clerk', 'Ravi');
  const input = { date: '2026-06-10', preset: 'generic' as const, rows: [{ vendorId: v.id, vendorName: 'Acme', amount: 5000, mode: 'NEFT' as const, reference: 'Bills due' }] };
  assert.throws(() => saveEpayBatch(input), /approval/, 'refused without forApproval');
  const b = saveEpayBatch(input, { forApproval: true });
  assert.equal(b.approval?.state, 'pending');
  assert.equal(b.approval?.requested_by, 'Ravi');
  assert.equal(epayBatchCleared(b), false);
  const m = matchResponse(b, parseBankResponse('Reference,Amount,Status\nBills due,5000,Paid\n'));
  assert.throws(() => recordConfirmed(b.id, m.matches), /not been approved/);
  assert.throws(() => decideEpayBatch(b.id, 'approved'), /not allowed|permission|access/i, 'a clerk cannot approve');
  as('owner');
  assert.throws(() => decideEpayBatch(b.id, 'rejected'), /reason/);
  const ok = decideEpayBatch(b.id, 'approved');
  assert.equal(ok.approval?.state, 'approved');
  assert.equal(loadEpayBatches()[0].approval?.decided_by, 'owner');
  assert.equal(purchaseApprovalHistory().find((r) => r.doc_id === b.id)?.doc_type, 'PAYMENT');
  assert.equal(recordConfirmed(b.id, m.matches).paid, 1);
});

test('e-payment: under the limit, or made by the owner, saves as before without an approval', () => {
  as('owner');
  savePurchaseApprovalPolicy({ bills: false, billAbove: 0, payments: true, paymentAbove: 1000 });
  const row = { vendorName: 'Acme', amount: 5000, mode: 'NEFT' as const, reference: 'x' };
  assert.equal(saveEpayBatch({ date: '2026-06-10', preset: 'generic', rows: [row] }).approval, undefined);
  as('clerk');
  assert.equal(saveEpayBatch({ date: '2026-06-10', preset: 'generic', rows: [{ ...row, amount: 900 }] }).approval, undefined);
});

/* ── memory for receipts / vouchers ───────────────────────────── */

const line = (id: string, narration: string, debit: number, credit = 0, extra: Partial<BankLine> = {}): BankLine => ({ id, date: '2026-05-10', narration, ref: '', debit, credit, ...extra });

test('memory: a credit received against a customer and a line posted as a voucher are remembered', () => {
  const past: BankStatement = {
    id: 's0', imported_at: '', bank_label: 'HDFC', file_name: 'a.csv',
    lines: [
      line('p1', 'NEFT-SHARMA TRADERS-INV 12', 0, 1180, { matched_to: { type: 'payment', id: 'pay1' } }),
      line('p2', 'NEFT-SHARMA TRADERS-INV 15', 0, 500, { matched_to: { type: 'payment', id: 'pay2' } }),
      line('v1', 'ACH-LIC PREMIUM-123', 2400, 0, { matched_to: { type: 'manual' }, note: 'PV/FY26-27/0003 (bank statement)' }),
    ],
  };
  const mem = buildActionMemory(
    [past],
    [{ id: 'pay1', invoice_id: 'i1' }, { id: 'pay2', client_id: 'c9' }],
    [{ id: 'i1', client: { id: 'c9' } }],
    [{ number: 'PV/FY26-27/0003', type: 'PAYMENT', lines: [{ account_id: 'insurance' }, { account_id: 'bank' }] }],
    (id) => id === 'bank',
  );
  const open = [line('n1', 'NEFT-SHARMA TRADERS-INV 20', 0, 800), line('n2', 'ACH-LIC PREMIUM-456', 2400, 0)];
  const sug = suggestCategorisations(open, [], new Map(), { accountOf: () => undefined }, new Set(), mem);
  assert.deepEqual(sug.find((s) => s.lineId === 'n1')?.action, { kind: 'receipt', client_id: 'c9' });
  assert.equal(sug.find((s) => s.lineId === 'n1')?.count, 2);
  assert.equal(sug.find((s) => s.lineId === 'n2')?.action.ledger_id, 'insurance');
  assert.equal(sug.find((s) => s.lineId === 'n2')?.source, 'memory');
});

/* ── full e-invoice JSON → multi-line GST split ───────────────── */

const SUPPLIER = '27AAPFU0939F1ZV';
const invJson = {
  Version: '1.1',
  DocDtls: { Typ: 'INV', No: 'AS/77', Dt: '12/05/2026' },
  SellerDtls: { Gstin: SUPPLIER, LglNm: 'Acme Supplies Pvt Ltd' },
  BuyerDtls: { Gstin: SELLER_GSTIN, Pos: '27' },
  ItemList: [
    { SlNo: '1', PrdDesc: 'Copier paper', HsnCd: '48025690', Qty: 10, Unit: 'BOX', UnitPrice: 250, AssAmt: 2500, GstRt: 12 },
    { SlNo: '2', PrdDesc: 'Toner', HsnCd: '84439959', Qty: 2, Unit: 'NOS', UnitPrice: 1000, AssAmt: 2000, GstRt: 18, CesAmt: 20 },
  ],
  ValDtls: { AssVal: 4500, CgstVal: 330, SgstVal: 330, TotInvVal: 5180 },
};

test('e-invoice JSON: every line with its own rate, cess and place of supply; also inside the IRP signed invoice', () => {
  const r = decodeEinvoiceJson(JSON.stringify(invJson));
  assert.equal(r.ok, true);
  if (r.ok !== true) return;
  assert.equal(r.data.lines.length, 2);
  assert.equal(r.data.qr.docNo, 'AS/77');
  const d = draftFromEinvoiceJson(r.data, { vendors: [], ourGstins: [SELLER_GSTIN], businessState: '27', today: '2026-06-01' });
  const b = d.bill!;
  assert.equal(b.lines.length, 2);
  assert.deepEqual(b.lines.map((l) => [l.quantity, l.rate, l.tax_rate, l.hsn]), [[10, 250, 12, '48025690'], [2, 1000, 18, '84439959']]);
  assert.equal(b.taxable, 4500);
  assert.equal(b.cgst, 330);
  assert.equal(b.cess_amount, 20);
  assert.equal(b.total, 5180);
  assert.equal(b.vendor_name, 'Acme Supplies Pvt Ltd');
  assert.ok(!b.draft.review?.includes('gst'), 'no "check the GST split" flag when the lines add up');
  assert.equal(b.itc_eligible, true);

  const signed = { Irn: 'b'.repeat(64), AckDt: '2026-05-12 10:30:00', SignedInvoice: encodeEinvoiceQrForTest(invJson) };
  const s = decodeEinvoiceJson(JSON.stringify(signed));
  assert.equal(s.ok, true);
  if (s.ok === true) assert.equal(s.data.qr.irn, 'b'.repeat(64));
  const bad = decodeEinvoiceJson('{"foo":1}');
  assert.equal(bad.ok, false);
  const qrOnly = decodeEinvoiceJson(encodeEinvoiceQrForTest({ SellerGstin: SUPPLIER, DocNo: 'X' }));
  assert.equal(qrOnly.ok, false, 'a QR payload (no ItemList) is left to the QR path');
});

/* ── QR images embedded in a PDF ──────────────────────────────── */

function pdfWith(objs: { dict: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode('%PDF-1.4\n')];
  objs.forEach((o, i) => {
    parts.push(enc.encode(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`), o.data, enc.encode('\nendstream\nendobj\n'));
  });
  parts.push(enc.encode('trailer\n<< >>\n%%EOF\n'));
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

test('PDF images: JPEG kept as is, Flate gray / RGB (with PNG predictors) decoded to pixels, others skipped', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  // 2×2 gray with the PNG "Up" predictor (filter byte 2 on each row).
  const grayRows = new Uint8Array([2, 10, 20, 2, 5, 5]);
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]); // 2×1 RGB, no predictor
  const pdf = pdfWith([
    { dict: '/Type /XObject /Subtype /Image /Width 40 /Height 40 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode', data: jpeg },
    { dict: '/Type /XObject /Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /DecodeParms << /Predictor 12 /Colors 1 /Columns 2 >>', data: deflateSync(grayRows) },
    { dict: '/Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode', data: deflateSync(rgb) },
    { dict: '/Type /XObject /Subtype /Image /Width 8 /Height 8 /BitsPerComponent 1 /ImageMask true /Filter /CCITTFaxDecode', data: new Uint8Array([0]) },
    { dict: '/Type /XObject /Subtype /Form', data: new Uint8Array([1]) },
  ]);
  const imgs = await pdfImages(pdf, 12, 1);
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0].kind, 'jpeg');
  if (imgs[0].kind === 'jpeg') assert.deepEqual([...imgs[0].bytes], [...jpeg]);
  assert.equal(imgs[1].kind, 'pixels');
  if (imgs[1].kind === 'pixels') {
    assert.equal(imgs[1].width, 2);
    // Up predictor: row 2 = row 1 + delta → 15, 25 (RGBA, gray copied to R, G, B).
    assert.deepEqual([...imgs[1].rgba].filter((_, i) => i % 4 === 0), [10, 20, 15, 25]);
  }
  if (imgs[2].kind === 'pixels') assert.deepEqual([...imgs[2].rgba.slice(0, 8)], [255, 0, 0, 255, 0, 255, 0, 255]);
});
