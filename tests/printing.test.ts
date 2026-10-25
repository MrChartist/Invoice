/**
 * WP-4 Printing & documents output: copies (Rule 48), transport details, voucher print,
 * ZIP of PDFs, confirmation-of-accounts letter.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  copyLabel,
  defaultCopies,
  printCopies,
  resolveCopies,
  sanitizeCopies,
  supplyNature,
  toggleCopy,
} from '../src/lib/print-copies.ts';
import { applyPreset, resolveDesignFrom, sanitizeDesign, sanitizePreprinted } from '../src/lib/design-prefs.ts';
import { cleanVehicle, ewayPrefillAvailable, normalizeTransport, transportFromEway, transportRows } from '../src/lib/transport.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { RECORD_KEYS } from '../src/store/useInvoiceStore.ts';
import { buildVoucherPrint, voucherAmount, voucherHtml } from '../src/lib/voucher-print.ts';
import { invoicePdfName, placePaper, uniqueFileNames, zipFiles } from '../src/lib/pdf-batch.ts';
import { openZip } from '../src/lib/zip.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { billsOnDate, buildConfirmationLetter, confirmationLettersHtml } from '../src/lib/confirmation-letter.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

/* ── Copies ─────────────────────────────────────────────────────── */

test('supply nature: goods by type or non-99 HSN, services otherwise, challans always goods', () => {
  assert.equal(supplyNature({ doc_type: 'TAX_INVOICE', items: [{ type: 'Goods', hsn: '' }] }), 'goods');
  assert.equal(supplyNature({ doc_type: 'TAX_INVOICE', items: [{ type: 'Service', hsn: '490110' }] }), 'goods');
  assert.equal(supplyNature({ doc_type: 'TAX_INVOICE', items: [{ type: 'Service', hsn: '998314' }] }), 'services');
  assert.equal(supplyNature({ doc_type: 'TAX_INVOICE', items: [{ type: 'Service' }] }), 'services');
  assert.equal(supplyNature({ doc_type: 'DELIVERY_CHALLAN', items: [{ type: 'Service' }] }), 'goods');
});

test('Rule 48 labels by supply type and document', () => {
  const g = { nature: 'goods' as const, docType: 'TAX_INVOICE' as const };
  const s = { nature: 'services' as const, docType: 'TAX_INVOICE' as const };
  assert.deepEqual(defaultCopies('goods').map((k) => copyLabel(k, g)), ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier']);
  assert.deepEqual(defaultCopies('services').map((k) => copyLabel(k, s)), ['Original for Recipient', 'Duplicate for Supplier']);
  assert.equal(copyLabel('extra', g), 'Extra Copy');
  assert.equal(copyLabel('original', { nature: 'goods', docType: 'DELIVERY_CHALLAN' }), 'Original for Consignee');
  assert.equal(copyLabel('triplicate', { nature: 'goods', docType: 'DELIVERY_CHALLAN' }), 'Triplicate for Consigner');
  assert.equal(copyLabel('duplicate', { nature: 'goods', docType: 'QUOTATION' }), 'Duplicate');
  assert.equal(copyLabel('duplicate', { nature: 'goods', docType: 'BILL_OF_SUPPLY' }), 'Duplicate for Transporter');
});

test('copies selection: single is legacy (one paper, no banner); auto follows the supply; toggles keep order', () => {
  const goods = { doc_type: 'TAX_INVOICE' as const, items: [{ type: 'Goods', hsn: '610910' }] };
  assert.deepEqual(printCopies(goods, undefined), [{ kind: 'original', label: '', key: 'single' }]);
  assert.deepEqual(printCopies(goods, 'auto').map((c) => c.label), ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier']);
  assert.equal(resolveCopies('auto', 'services').length, 2);
  assert.deepEqual(sanitizeCopies(['triplicate', 'bogus', 'original', 'original', 'extra', 'extra']), ['original', 'triplicate', 'extra', 'extra']);
  assert.equal(sanitizeCopies([]), 'single');
  assert.equal(sanitizeCopies('weird'), 'single');
  let s = toggleCopy('single', 'duplicate', true, 'goods');
  assert.deepEqual(s, ['duplicate']);
  s = toggleCopy(s, 'original', true, 'goods');
  s = toggleCopy(s, 'extra', true, 'goods');
  assert.deepEqual(s, ['original', 'duplicate', 'extra']);
  assert.deepEqual(printCopies(goods, s).map((c) => c.key), ['original', 'duplicate', 'extra-1']);
  assert.deepEqual(toggleCopy(s, 'extra', false, 'goods'), ['original', 'duplicate']);
  assert.equal(toggleCopy(['original'], 'original', false, 'goods'), 'single');
  assert.ok(sanitizeCopies(Array(10).fill('extra')).length <= 6);
});

test('design prefs: copies / preprinted are additive and survive sanitise, resolve and presets', () => {
  assert.equal('copies' in sanitizeDesign({}), false, 'legacy design has no copies key');
  assert.equal('preprinted' in sanitizeDesign({}), false);
  const d = resolveDesignFrom([{ profile_id: '__global__', copies: 'auto' }, { profile_id: 'p1', copies: ['original', 'duplicate'] }], 'p1');
  assert.deepEqual(d.copies, ['original', 'duplicate']);
  assert.equal(resolveDesignFrom([{ profile_id: '__global__', copies: 'auto' }], 'p2').copies, 'auto');
  assert.equal(applyPreset({ ...d, copies: 'auto' }, 'compact').copies, 'auto');
  assert.deepEqual(sanitizePreprinted({ on: true, top_mm: 500, left_mm: -99 }), { on: true, top_mm: 120, left_mm: -20 });
  assert.equal(sanitizePreprinted('x'), undefined);
});

test('every layout mounts the copy banner through TemplateEngine, coloured by the accent variable only', () => {
  const engine = src('components/templates/TemplateEngine.tsx');
  assert.match(engine, /<CopyBanner label=\{copyLabel\} \/>\s*\{body\}/, 'banner sits above every layout body');
  const css = src('components/templates/invoice-paper.module.css');
  const block = css.slice(css.indexOf('.copyBanner {'), css.indexOf('.paper[data-paper=\'thermal80\'] .copyBanner'));
  assert.match(block, /var\(--tpl-accent\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, 'no raw colours in the banner');
  const preview = src('components/preview/InvoicePreview.tsx');
  assert.match(preview, /data-print-copy=\{c\.key\}/);
  assert.match(preview, /copyLabel=\{c\.label\}/);
  assert.match(preview, /invoice\.sender \?\? localDb\.settings\.activeProfile\(\)/, 'preview reads the snapshot first');
});

/* ── Transport ──────────────────────────────────────────────────── */

const T = { mode: 'ROAD', vehicle_no: 'mh 12-ab 1234', transporter_name: 'Speedy Roadways', transporter_id: '27aaacs1234a1z5', lr_no: 'LR-77', lr_date: '2026-05-02', eway_bill_no: '3210 0012 3456', distance_km: 42.4 };

test('transport fields: normalised, persisted by normalizeRecord, listed in RECORD_KEYS; legacy rows gain nothing', () => {
  assert.ok((RECORD_KEYS as readonly string[]).includes('transport'));
  const n = normalizeTransport(T);
  assert.deepEqual(n, { mode: 'ROAD', vehicle_no: 'MH12AB1234', transporter_name: 'Speedy Roadways', transporter_id: '27AAACS1234A1Z5', lr_no: 'LR-77', lr_date: '2026-05-02', eway_bill_no: '321000123456', distance_km: 42 });
  const r = normalizeRecord({ id: 'x', doc_type: 'TAX_INVOICE', transport: T, items: [] });
  assert.deepEqual(r.transport, n);
  assert.deepEqual(normalizeRecord(r).transport, n, 'round-trips');
  assert.equal('transport' in normalizeRecord({ id: 'y', items: [] }), false);
  assert.equal(normalizeTransport({ mode: 'ROAD' }), undefined, 'a bare mode is not a transport block');
  assert.equal(normalizeTransport({ lr_date: '02/05/2026', vehicle_no: 'x' })?.lr_date, undefined);
  assert.equal(cleanVehicle(' ka-01 ab 0001 '), 'KA01AB0001');
});

test('transport rows printed (string level), e-Way not repeated when the IRN block prints it', () => {
  const n = normalizeTransport(T);
  const rows = transportRows(n, (d) => `D(${d})`);
  const text = rows.map((r) => `${r.label}: ${r.value}`).join(' | ');
  assert.equal(text, 'Mode of transport: Road | Dispatched through: Speedy Roadways · ID 27AAACS1234A1Z5 | Vehicle no.: MH12AB1234 | LR no. & date: LR-77 dt. D(2026-05-02) | e-Way bill no.: 321000123456 | Distance: 42 km');
  assert.equal(transportRows(n, (d) => d, { skipEway: '321000123456' }).some((r) => r.key === 'eway'), false);
  assert.deepEqual(transportRows(undefined, (d) => d), []);
  assert.equal(transportRows({ ...n, mode: 'RAIL' }, (d) => d).find((r) => r.key === 'lr')?.label, 'RR no. & date');
  // Every layout gets it: the GST grid cells, the free-form block, the receipt.
  assert.match(src('components/templates/parts/GstBody.tsx'), /transportRows\(invoice\.transport/);
  assert.match(src('components/templates/TemplateEngine.tsx'), /<TransportBlock invoice=\{invoice\}/);
  assert.match(src('components/templates/parts/ReceiptBody.tsx'), /<TransportBlock invoice=\{invoice\} compact \/>/);
});

test('transport prefill from saved e-Way data: typed fields win', () => {
  const meta = { transport: 'RAIL', vehicle: 'GJ01XY9999', transporter_name: 'Rail Co', transport_doc_no: 'RR-1', transport_doc_date: '2026-06-01', eway_no: '111' };
  const merged = transportFromEway(meta, { vehicle_no: 'MH12AB1234' });
  assert.equal(merged?.vehicle_no, 'MH12AB1234');
  assert.equal(merged?.transporter_name, 'Rail Co');
  assert.equal(merged?.lr_no, 'RR-1');
  assert.equal(merged?.mode, 'RAIL');
  assert.equal(ewayPrefillAvailable(meta, merged), false);
  assert.equal(ewayPrefillAvailable(meta, undefined), true);
  assert.equal(ewayPrefillAvailable(undefined, undefined), false);
});

test('a duplicate / credit note / debit note / late fee does not inherit the dispatch details', () => {
  assert.match(src('pages/Transactions.tsx'), /transport: undefined/);
  assert.equal((src('lib/documents.ts').match(/transport: undefined/g) ?? []).length, 2);
  assert.match(src('lib/late-fee.ts'), /transport: undefined/);
});

/* ── Voucher print ──────────────────────────────────────────────── */

test('voucher print: Dr before Cr, totals, words, signatures, everything escaped, no script', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const m = buildVoucherPrint(
    { kind: 'Journal', number: 'JV/FY26-27/0001', date: '2026-05-04', narration: `Rent ${evil}`, lines: [{ account: 'bank', dr: 0, cr: 1250000 }, { account: 'rent', dr: 1250000, cr: 0, party: `"Landlord" & Co` }] },
    (id) => (id === 'rent' ? `Rent <b>` : 'HDFC Bank'),
    { name: `Acme <script>alert(1)</script>`, address: 'Pune', gstin: '27AAAAA0000A1Z5' },
  );
  assert.equal(m.lines[0].dr, 1250000, 'debit first');
  assert.deepEqual(voucherAmount(m.lines), { dr: 1250000, cr: 1250000 });
  const html = voucherHtml([m, m]);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /Acme &lt;script&gt;/);
  assert.match(html, /&quot;Landlord&quot; &amp; Co/);
  assert.match(html, /By Rent &lt;b&gt;/);
  assert.match(html, /To HDFC Bank/);
  assert.match(html, /Journal Voucher/);
  assert.match(html, /12,500\.00/);
  assert.match(html, /Twelve Thousand Five Hundred/);
  assert.match(html, /Prepared by.*Checked by.*Authorised signatory/s);
  assert.match(html, /verify with your CA/);
  assert.equal((html.match(/<section class="v">/g) ?? []).length, 2, 'one voucher per page');
});

/* ── Batch PDF / ZIP ────────────────────────────────────────────── */

test('ZIP of PDFs round-trips through the reader; names are unique and safe', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.3\n' + 'x'.repeat(500));
  const blob = await zipFiles([
    { name: 'Tax_Invoice_INV-FY26-27-0001.pdf', data: pdf },
    { name: 'tax_invoice_INV-FY26-27-0001.pdf', data: pdf },
    { name: 'Tax_Invoice_INV-FY26-27-0002.pdf', data: new Uint8Array([1, 2, 3]) },
  ]);
  assert.equal(blob.type, 'application/zip');
  const z = openZip(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(z.entries.map((e) => e.name), ['Tax_Invoice_INV-FY26-27-0001.pdf', 'tax_invoice_INV-FY26-27-0001 (2).pdf', 'Tax_Invoice_INV-FY26-27-0002.pdf']);
  assert.ok(z.entries.every((e) => e.method === 0), 'STORE mode');
  assert.deepEqual(await z.read('Tax_Invoice_INV-FY26-27-0001.pdf'), pdf);
  assert.deepEqual(uniqueFileNames(['a.pdf', 'A.pdf', 'a (2).pdf']), ['a.pdf', 'A (2).pdf', 'a (2) (2).pdf']);
  assert.equal(invoicePdfName({ doc_type: 'TAX_INVOICE', invoice_number: 'INV/FY26-27/0001' }), 'Tax_Invoice_INV-FY26-27-0001.pdf');
  assert.equal(invoicePdfName({ doc_type: 'QUOTATION', invoice_number: '' }), 'Quotation_draft.pdf');
});

test('page placement: copies multiply pages; A4 slices, thermal is one page', () => {
  assert.equal(placePaper(1123, { paper: 'A4' }).pages, 1);
  assert.equal(placePaper(2300, { paper: 'A4' }).pages, 3);
  assert.equal(placePaper(1500, { paper: 'thermal80' }).pages, 1);
  assert.equal(placePaper(10, null).pages, 1, 'short papers still fill one page');
});

/* ── Confirmation of accounts ───────────────────────────────────── */

function inv(id: string, n: string, date: string, total: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return { id, invoice_number: n, doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: date, due_date: date, currency: 'INR', total, balance_due: total, amount_paid: 0, client: { id: 'c1', name: 'Ravi Traders' }, items: [], ...extra } as unknown as InvoiceRecord;
}

test('confirmation letter: opening, period totals, closing, open bills on the date reconcile', () => {
  const report = buildReceivables({
    invoices: [inv('a', 'INV/1', '2026-03-10', 1000), inv('b', 'INV/2', '2026-04-15', 5000), inv('c', 'INV/3', '2026-05-20', 2000), inv('d', 'INV/4', '2026-07-01', 700)],
    payments: [
      { id: 'p1', invoice_id: 'a', amount: 1000, date: '2026-04-05', method: 'UPI' },
      { id: 'p2', invoice_id: 'b', amount: 3000, date: '2026-05-01', method: 'Bank' },
      { id: 'p3', invoice_id: 'b', amount: 2000, date: '2026-07-10', method: 'Bank' },
      { id: 'p4', amount: 500, date: '2026-06-01', method: 'Cash', client_id: 'c1', client_name: 'Ravi Traders' },
    ] as never,
    clients: [{ id: 'c1', name: 'Ravi Traders', address: '1 MG Road', city: 'Pune', gstin: '27BBBBB1111B1Z5' } as never],
  }, { now: new Date(2026, 7, 1) });
  const party = report.parties[0];
  const l = buildConfirmationLetter(party, '2026-04-01', '2026-06-30', { client: { id: 'c1', name: 'Ravi Traders', address: '1 MG Road', city: 'Pune', gstin: '27BBBBB1111B1Z5' } as never });
  assert.equal(l.opening, 1000);
  assert.equal(l.totalDebit, 7000);
  assert.equal(l.totalCredit, 1000 + 3000 + 500);
  assert.equal(l.closing, 1000 + 7000 - 4500);
  // On 30 Jun: INV/2 has 2,000 left (the July receipt is not counted), INV/3 2,000; INV/4 is after the date.
  assert.deepEqual(l.bills.map((b) => [b.number, b.outstanding]), [['INV/2', 2000], ['INV/3', 2000]]);
  assert.equal(l.billsTotal, 4000);
  assert.equal(l.unadjusted, 500, 'the on-account receipt explains bills total − closing');
  assert.equal(l.billsTotal - l.unadjusted, l.closing);
  assert.deepEqual(billsOnDate(party, '').map((b) => b.number), ['INV/3', 'INV/4']);
  assert.match(l.closingWords, /Three Thousand Five Hundred.*\(Dr\)/);
  const html = confirmationLettersHtml([l, { ...l, party: '<b>X</b>' }], { companyName: 'Acme & Sons', companyAddress: 'Pune', companyGstin: '', pan: '' } as never, '2026-07-05');
  assert.match(html, /Confirmation of accounts for the period 1 Apr 2026 to 30 Jun 2026/);
  assert.match(html, /Acme &amp; Sons/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /3,500\.00 Dr/);
  assert.match(html, /verify with your CA/);
  assert.equal((html.match(/<section class="l">/g) ?? []).length, 2);
});
