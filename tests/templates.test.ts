import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { resetStorage } from './helpers/shim.ts';
import {
  MAX_SIGNED_QR_BYTES,
  buildIrnPrint,
  irnQrSize,
  resolveEInvoiceMeta,
} from '../src/lib/einvoice-print.ts';
import { saveEInvoiceMeta, type EInvoiceMeta } from '../src/lib/einvoice.ts';
import { TEMPLATES } from '../src/components/templates/registry.ts';
import { isSingleTax, isTaxed } from '../src/components/templates/paper-helpers.ts';
import type { CalcTotals } from '../src/lib/invoice-calc.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const IRN = 'a'.repeat(64);
const JWT = 'eyJhbGciOiJSUzI1NiJ9.' + 'x'.repeat(1100) + '.sig';

const full: EInvoiceMeta = {
  invoice_id: 'inv-1',
  irn: IRN,
  ack_no: '112510012345678',
  ack_date: '2025-06-18 14:32:10',
  signed_qr: JWT,
  eway_no: '321000123456',
  eway_valid_upto: '2025-06-20',
};

test('nothing stored -> nothing printed (layout untouched)', () => {
  assert.equal(buildIrnPrint(undefined), null);
  assert.equal(buildIrnPrint(null), null);
  assert.equal(buildIrnPrint({ invoice_id: 'x' }), null);
  assert.equal(buildIrnPrint({ invoice_id: 'x', irn: '   ', ack_no: '', signed_qr: ' ' }), null);
  // vehicle/transport details alone are not printed
  assert.equal(buildIrnPrint({ invoice_id: 'x', vehicle: 'MH12AB1234', distance: 40 }), null);
});

test('full meta prints IRN, ack, QR and e-way line', () => {
  const m = buildIrnPrint(full);
  assert.ok(m);
  assert.equal(m.irn, IRN);
  assert.equal(m.ackNo, '112510012345678');
  assert.equal(m.ackDate, '2025-06-18 14:32:10');
  assert.equal(m.qr, JWT);
  assert.equal(m.ewayNo, '321000123456');
  assert.equal(m.ewayValidUpto, '2025-06-20');
});

test('partial meta: e-way only, IRN without QR', () => {
  const eway = buildIrnPrint({ invoice_id: 'x', eway_no: '99', eway_valid_upto: '2025-01-01' });
  assert.deepEqual(eway, { ewayNo: '99', ewayValidUpto: '2025-01-01' });
  const noQr = buildIrnPrint({ invoice_id: 'x', irn: IRN });
  assert.deepEqual(noQr, { irn: IRN });
  // valid-upto without a number is meaningless and is dropped
  assert.equal(buildIrnPrint({ invoice_id: 'x', eway_valid_upto: '2025-01-01' }), null);
});

test('QR payload is kept verbatim and oversize payloads are dropped, not crashed on', () => {
  const m = buildIrnPrint({ invoice_id: 'x', irn: IRN, signed_qr: `  ${JWT}\n` });
  assert.equal(m?.qr, JWT);
  const huge = 'y'.repeat(MAX_SIGNED_QR_BYTES + 1);
  const big = buildIrnPrint({ invoice_id: 'x', irn: IRN, signed_qr: huge });
  assert.equal(big?.qr, undefined);
  assert.equal(big?.irn, IRN);
  // multi-byte text counts bytes, not characters
  const multi = buildIrnPrint({ invoice_id: 'x', irn: IRN, signed_qr: '₹'.repeat(1000) });
  assert.equal(multi?.qr, undefined);
});

test('the largest allowed payload (and a realistic one) really encode as a QR', () => {
  for (const value of [JWT, 'z'.repeat(MAX_SIGNED_QR_BYTES)]) {
    const html = renderToStaticMarkup(createElement(QRCodeSVG, { value, size: 118, level: 'L' }));
    assert.match(html, /^<svg[^>]*width="118"/);
    assert.ok(html.length > 1000);
  }
});

test('QR scales with paper and thermal gets the largest', () => {
  assert.ok(irnQrSize('A5') < irnQrSize('A4'));
  assert.ok(irnQrSize('thermal80') > irnQrSize('A4'));
  assert.equal(irnQrSize(undefined), irnQrSize('A4'));
  // thermal roll is 302px wide with 12px side padding: the QR must fit
  assert.ok(irnQrSize('thermal80') <= 302 - 24 - 12);
  // A5 is 559px wide with side padding: QR must leave room for text beside it
  assert.ok(irnQrSize('A5') < 559 / 2);
});

test('lookup: by invoice id, none for unsaved invoices, follows later saves', () => {
  resetStorage();
  assert.equal(resolveEInvoiceMeta('inv-1'), undefined);
  assert.equal(resolveEInvoiceMeta(''), undefined);
  assert.equal(resolveEInvoiceMeta(undefined), undefined);
  saveEInvoiceMeta(full);
  assert.equal(resolveEInvoiceMeta('inv-1')?.irn, IRN);
  assert.equal(resolveEInvoiceMeta('other'), undefined);
  assert.equal(resolveEInvoiceMeta(''), undefined);
  saveEInvoiceMeta({ ...full, irn: 'b'.repeat(64) });
  assert.equal(resolveEInvoiceMeta('inv-1')?.irn, 'b'.repeat(64));
  resetStorage();
  assert.equal(resolveEInvoiceMeta('inv-1'), undefined);
});

test('engine wiring: all 26 templates share the one IRN hook, outside every layout body', () => {
  assert.equal(TEMPLATES.length, 26);
  const engine = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  // the block is appended after the layout-specific body, unconditional on layout/paper
  assert.match(engine, /\{body\}\s*\{irn && <IrnBlock model=\{irn\} \/>\}/);
  assert.match(engine, /einvoiceMeta === undefined \? resolveEInvoiceMeta\(invoice\.id\)/);
});

test('CGST/SGST rows only for intra-state invoices; IGST invoices print an IGST line', () => {
  const totals = (tax: number) => ({ tax_amount: tax }) as CalcTotals;
  const inv = (gst_mode: InvoiceRecord['gst_mode']) => ({ gst_mode }) as InvoiceRecord;
  assert.equal(isTaxed(inv('CGST_SGST'), totals(180)), true);
  assert.equal(isTaxed(inv('IGST'), totals(180)), false); // used to be true: printed CGST 0 / SGST 0 and no IGST
  assert.equal(isTaxed(inv('SINGLE'), totals(180)), false);
  assert.equal(isTaxed(inv('NONE'), totals(0)), false);
  assert.equal(isTaxed(inv('CGST_SGST'), totals(0)), false);
  assert.equal(isSingleTax(inv('SINGLE'), totals(180)), true);
});
