/**
 * 8I — filing & capture UX: the preflight check before a GSTR-1 / 3B / IFF JSON download (missing HSN → dialog,
 * clean → straight download), the grouped GST tabs (every old `?tab=` id still resolves, arrow keys walk them all)
 * and the live-QR capture helper used by "Scan bill".
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { SELLER_GSTIN, clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { buildGstReport, periodForDate, periodRange } from '../src/lib/gst-reports.ts';
import { gstExceptions } from '../src/lib/gst-guards.ts';
import { seriesGaps } from '../src/lib/invoice-number.ts';
import { buildPreflight, issueText, needsPreflight, preflightCount } from '../src/lib/gst-preflight.ts';
import { GST_TABS, GST_TAB_GROUPS, GST_TAB_ORDER, groupOfTab, resolveGstTab, tabForKey } from '../src/lib/gst-tabs.ts';
import { fiT } from '../src/i18n/areas/filing.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());
const readInvoices = (): InvoiceRecord[] => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') ?? '[]');

/** What the GST page computes for the JSON buttons. */
function preflightFor(invoices: InvoiceRecord[], date: string) {
  const period = periodForDate('month', date);
  const { issues } = buildGstReport(JSON.parse(JSON.stringify(invoices)), [], { period, gstin: SELLER_GSTIN });
  const exceptions = gstExceptions(invoices, { ...periodRange(period), irnIds: new Set(), aato: () => undefined, today: date, gstin: SELLER_GSTIN });
  const fy = `${String(period.fyStart).slice(2)}-${String(period.fyStart + 1).slice(2)}`;
  const gaps = seriesGaps(invoices.filter((i) => i.status !== 'Draft').map((i) => i.invoice_number), fy);
  return buildPreflight({ exceptions, issues, gaps });
}

test('preflight: a clean period downloads straight away (no dialog)', () => {
  installSettings();
  createViaStore({ client: clientMH, date: '2025-08-05', lines: [{ qty: 1, rate: 1000, tax: 18, hsn: '998311' }] });
  createViaStore({ client: clientMH, date: '2025-08-06', lines: [{ qty: 2, rate: 500, tax: 18, hsn: '998311' }] });
  const groups = preflightFor(readInvoices(), '2025-08-10');
  assert.deepEqual(groups, []);
  assert.equal(needsPreflight(groups), false);
  assert.equal(preflightCount(groups), 0);
});

test('preflight: missing HSN on B2B lines → dialog with one grouped row and Fix links to the invoice', () => {
  installSettings();
  const ok = createViaStore({ client: clientMH, date: '2025-08-05', lines: [{ qty: 1, rate: 1000, tax: 18 }] });
  const bad = createViaStore({ client: clientMH, date: '2025-08-06', lines: [{ qty: 1, rate: 100, tax: 18, hsn: '' }, { qty: 1, rate: 200, tax: 18, hsn: '' }] });
  const groups = preflightFor(readInvoices(), '2025-08-10');
  assert.equal(needsPreflight(groups), true);
  const hsn = groups.find((g) => g.id === 'ex:B2B_NO_HSN');
  assert.ok(hsn, 'missing-HSN group');
  assert.equal(hsn.count, 1);
  assert.equal(hsn.vars.lines, 2);
  assert.deepEqual(hsn.items.map((i) => i.link), [`/invoice/${bad.id}`]);
  // The report's own HSN_MISSING for the same invoice is not listed twice.
  assert.equal(groups.some((g) => g.id === 'issue:HSN_MISSING'), false);
  assert.equal(groups.some((g) => g.items.some((i) => i.link === `/invoice/${ok.id}`)), false);
  assert.equal(fiT('g_B2B_NO_HSN', hsn.vars), 'Missing HSN / SAC on 2 B2B line(s) in 1 document(s)');
  assert.equal(preflightCount(groups), groups.reduce((s, g) => s + g.count, 0));
});

test('preflight: series gaps and report issues are grouped; info issues are not', () => {
  const groups = buildPreflight({
    exceptions: [],
    issues: [
      { id: 'GSTIN_INVALID:a', severity: 'error', code: 'GSTIN_INVALID', message: 'INV/1: client GSTIN "X" is invalid.', invoiceId: 'a', invoiceNumber: 'INV/1', link: '/clients' },
      { id: 'GSTIN_INVALID:b', severity: 'error', code: 'GSTIN_INVALID', message: 'INV/2: client GSTIN "Y" is invalid.', invoiceId: 'b', invoiceNumber: 'INV/2', link: '/clients' },
      { id: 'DRAFTS', severity: 'info', code: 'DRAFTS', message: '1 draft document(s) …' },
    ],
    gaps: [{ prefix: 'INV', fy: '25-26', highest: 5, missing: [2, 4], missingCount: 2, missingNumbers: ['INV/FY25-26/0002', 'INV/FY25-26/0004'] }],
  });
  assert.deepEqual(groups.map((g) => g.id), ['issue:GSTIN_INVALID', 'gaps'], 'errors first, info dropped');
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].vars.message, 'client GSTIN "X" is invalid.');
  assert.equal(groups[1].vars.missing, 2);
  assert.equal(groups[1].items[0].link, '/gst-reports?tab=docs');
  assert.equal(issueText({ message: 'INV/9: no HSN', invoiceNumber: 'INV/9' }), 'no HSN');
});

/* ── Grouped tabs ── */

/** Every `?tab=` id the page accepted before 8I (deep links, Gateway, bell, docs). */
const LEGACY_TABS = [
  'overview', 'compliance', 'b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'at', 'txpd', 'hsn', 'docs', 'amend', 'eco',
  'gstr3b', 'gstr2b', 'composition', 'setoff', 'purhsn', 'recon', 'hsnmaster', 'gstr9c', 'rcmdocs', 'cashref', 'isd', 'ewbcons',
  'bygstin', 'guards',
];
/** Tabs added later (R3-C4 portal files, R3-C5 e-Way desk, R4-C2 export desk). */
const ADDED_TABS = ['portal-files', 'eway-desk', 'export-desk', 'common-credit', 'hotel-gst']; // + R5-C2 common credit, R7-C1 hotel

test('tabs: every previous ?tab= id still resolves and sits in exactly one group', () => {
  for (const id of LEGACY_TABS) assert.equal(resolveGstTab(id), id, id);
  assert.equal(resolveGstTab('nope'), null);
  assert.equal(resolveGstTab(null), null);
  const grouped = GST_TAB_GROUPS.flatMap((g) => g.tabs);
  assert.equal(new Set(grouped).size, grouped.length, 'no tab in two groups');
  assert.deepEqual([...grouped].sort(), [...LEGACY_TABS, ...ADDED_TABS].sort());
  assert.deepEqual(GST_TABS.map((t) => t.id).sort(), [...LEGACY_TABS, ...ADDED_TABS].sort());
  assert.equal(groupOfTab('b2b'), 'gstr1');
  assert.equal(groupOfTab('setoff'), 'gstr3b');
  assert.equal(groupOfTab('gstr2b'), 'recon');
  assert.equal(groupOfTab('compliance'), 'tools');
});

test('tabs: arrow keys walk every tab across groups and wrap; Home / End jump', () => {
  let t = GST_TAB_ORDER[0];
  const seen = new Set([t]);
  for (let i = 0; i < GST_TAB_ORDER.length; i++) {
    t = tabForKey(t, 'ArrowRight')!;
    seen.add(t);
  }
  assert.equal(seen.size, GST_TAB_ORDER.length);
  assert.equal(t, GST_TAB_ORDER[0], 'wraps');
  assert.equal(tabForKey('overview', 'ArrowLeft'), GST_TAB_ORDER.at(-1));
  assert.equal(tabForKey('eco', 'ArrowRight'), 'gstr3b', 'crosses into the next group');
  assert.equal(tabForKey('b2b', 'End'), GST_TAB_ORDER.at(-1));
  assert.equal(tabForKey('b2b', 'Home'), 'overview');
  assert.equal(tabForKey('b2b', 'Enter'), null);
});

/* ── Scan bill: live camera QR → inbox + draft bill ── */

test('scan bill: a camera QR drafts the bill and returns the inbox route; junk text is an error', async () => {
  installSettings();
  const { captureFromQrText } = await import('../src/lib/capture-browser.ts');
  const { encodeEinvoiceQrForTest } = await import('../src/lib/einvoice-qr.ts');
  const { inboxDb } = await import('../src/lib/doc-inbox.ts');
  const { draftsDb } = await import('../src/lib/purchase-drafts.ts');
  assert.equal(captureFromQrText('8901234567890').tone, 'error');
  const qr = encodeEinvoiceQrForTest({
    SellerGstin: '29AAPFU0939F1ZV', BuyerGstin: SELLER_GSTIN, DocNo: 'AS/2026/0042', DocTyp: 'INV', DocDt: '12/05/2026',
    TotInvVal: 11800, ItemCnt: 1, MainHsnCode: '84713010', Irn: 'a'.repeat(32) + '0123456789abcdef0123456789abcdef', IrnDt: '2026-05-12 10:30:00',
  });
  const r = captureFromQrText(qr, 'camera');
  assert.notEqual(r.tone, 'error', r.message);
  const row = inboxDb.open().find((d) => d.source === 'camera');
  assert.ok(row?.draft_id, 'inbox row linked to a draft');
  assert.equal(r.route, `/expenses?tab=inbox&doc=${encodeURIComponent(row.id)}`);
  assert.equal(draftsDb.all().find((d) => d.id === row.draft_id)?.bill_number, 'AS/2026/0042');
});

/* ── R6-C4: the filing strip follows the period and the filer; "downloaded" survives a reload ── */

test('R6-C4 strip forms: monthly → GSTR-1 + 3B; QRMP month 1–2 → IFF, month 3 → the quarter; composition → CMP-08', async () => {
  const { stripForms, stripReturn } = await import('../src/lib/compliance.ts');
  const may = periodForDate('month', '2026-05-10');
  const jun = periodForDate('month', '2026-06-10');
  const q1 = periodForDate('quarter', '2026-05-10');
  assert.deepEqual(stripForms(may, 'monthly'), ['GSTR1', 'GSTR3B']);
  assert.deepEqual(stripForms(may, 'qrmp'), ['IFF'], 'QRMP month 1–2 shows IFF');
  assert.deepEqual(stripForms(jun, 'qrmp'), ['GSTR1', 'GSTR3B']);
  assert.deepEqual(stripForms(q1, 'composition'), ['CMP08'], 'a composition quarter shows CMP-08');
  assert.deepEqual(stripForms(may, 'composition'), []);
  assert.deepEqual(stripForms(periodForDate('fy', '2026-05-10'), 'monthly'), []);
  // Same ids as the Compliance calendar.
  assert.equal(stripReturn(may, 'IFF', 'qrmp', periodRange(may), 'May').id, 'IFF:2026-05');
  assert.equal(stripReturn(jun, 'GSTR3B', 'qrmp', periodRange(jun), 'Jun').id, 'GSTR3B:2026-Q1');
  assert.equal(stripReturn(q1, 'CMP08', 'composition', periodRange(q1), 'Q1').id, 'CMP08:2026-Q1');
  assert.equal(stripReturn(may, 'GSTR1', 'monthly', periodRange(may), 'May').id, 'GSTR1:2026-05');
});

test('R6-C4 downloaded_at round-trips on the compliance row, is not a filed mark, and survives filing / un-filing', async () => {
  const { downloadedFor, filedFor, loadFiled, rememberDownload, setFiled, saveFiled, stripReturn, pendingReturns } = await import('../src/lib/compliance.ts');
  const may = periodForDate('month', '2026-05-10');
  const iff = stripReturn(may, 'IFF', 'qrmp', periodRange(may), 'May 2026');
  assert.equal(rememberDownload(iff, SELLER_GSTIN), true);
  // "Reload": read the table back.
  let rows = loadFiled();
  assert.ok(downloadedFor(rows, iff, SELLER_GSTIN), 'downloaded_at survives a reload');
  assert.equal(filedFor(rows, iff, SELLER_GSTIN), undefined, 'a download is not a filed mark');
  const g3 = stripReturn(periodForDate('month', '2026-06-10'), 'GSTR3B', 'qrmp', periodRange(periodForDate('month', '2026-06-10')), 'Q1');
  rememberDownload(g3, SELLER_GSTIN);
  assert.equal(pendingReturns({ frequency: 'qrmp', today: '2026-08-30', since: '2026-04-01', monthsBack: 6 }, loadFiled(), SELLER_GSTIN).overdue.some((r) => r.id === g3.id), true, 'still overdue until marked filed');
  saveFiled(setFiled(loadFiled(), iff, SELLER_GSTIN, '2026-06-11'));
  rows = loadFiled();
  assert.equal(filedFor(rows, iff, SELLER_GSTIN)?.filed_on, '2026-06-11');
  assert.ok(downloadedFor(rows, iff, SELLER_GSTIN), 'filing keeps the download');
  saveFiled(setFiled(loadFiled(), iff, SELLER_GSTIN, null));
  rows = loadFiled();
  assert.equal(filedFor(rows, iff, SELLER_GSTIN), undefined);
  assert.ok(downloadedFor(rows, iff, SELLER_GSTIN), 'clearing the mark keeps the download');
  // The amendment check and the GSTR-4 late-fee reader never treat a download-only row as filed.
  const { amendmentCheck } = await import('../src/lib/amendments.ts');
  const inv = { id: 'x', doc_type: 'TAX_INVOICE', status: 'Sent', invoice_number: 'A/1', issue_date: '2026-05-05', sender: { companyGstin: SELLER_GSTIN }, client: { name: 'B', gstin: '27AAACB2230M1ZT' }, items: [] };
  assert.notEqual(amendmentCheck(inv as never, { filed: rows, lockUntil: '' }).reason, 'filed');
});

test('R6-C4 per-form preflight: IFF skips the HSN checks; CMP-08 runs only the composition checks', () => {
  installSettings();
  createViaStore({ client: clientMH, date: '2025-08-06', lines: [{ qty: 1, rate: 100, tax: 18, hsn: '' }] });
  const period = periodForDate('month', '2025-08-10');
  const invoices = readInvoices();
  const { issues } = buildGstReport(JSON.parse(JSON.stringify(invoices)), [], { period, gstin: SELLER_GSTIN });
  const exceptions = gstExceptions(invoices, { ...periodRange(period), irnIds: new Set(), aato: () => undefined, today: '2025-08-10', gstin: SELLER_GSTIN });
  const input = { exceptions, issues, gaps: [] };
  assert.ok(buildPreflight(input, 'GSTR1').some((g) => g.code === 'B2B_NO_HSN'));
  assert.equal(buildPreflight(input, 'IFF').some((g) => ['B2B_NO_HSN', 'HSN_MISSING', 'HSN_DIGITS'].includes(String(g.code))), false, 'the IFF preflight has no HSN rule');
  assert.deepEqual(buildPreflight(input, 'CMP08').filter((g) => !['COMPOSITION_DOCS', 'BOS_TAXED_LINES', 'DRAFTS', 'SERIES_GAP', 'SERIES_CANCELLED', 'CANCELLED'].includes(String(g.code))), []);
});
