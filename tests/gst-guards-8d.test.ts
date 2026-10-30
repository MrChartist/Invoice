/**
 * 8D — GST guards 2025–26: IRP 30-day window (+ bell day 20 / 27), e-invoice mandate, three-year time bar,
 * GSTR-1 snapshot → GSTR-1A diff and Table 3.2 comparison (incl. the date-keyed lock), vendor follow-up from the
 * 2B match and the pushed ITC, the IRN / EWB cancel flow, the date-keyed slab table and the exceptions list.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_KA, BUYER_MH, SELLER, SELLER_GSTIN, clientKA, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import {
  IRP_REPORTING_WINDOW_RULES,
  addYears,
  aatoFor,
  einvoiceMandatory,
  gstExceptions,
  gstr1aAvailable,
  gstr1aDiff,
  irnWindowList,
  irpWindow,
  rateInSlabs,
  snapshotFromReport,
  saveSnapshot,
  snapshotFor,
  table32Diff,
  table32Locked,
  timeBarFor,
  timeBarList,
} from '../src/lib/gst-guards.ts';
import { gstGuardNotices } from '../src/lib/gst-guard-alerts.ts';
import { buildGstReport, periodForDate } from '../src/lib/gst-reports.ts';
import { cancelPlan, cancelState, ewbCancelJson, irnCancelJson, withCancel } from '../src/lib/einvoice-cancel.ts';
import { followUpText, followUps, loadFollowUps, markFollowUp, pushItc, pushedItc } from '../src/lib/gst-followup.ts';
import { ggT } from '../src/i18n/areas/gst-guards.ts';
import type { MatchResult } from '../src/lib/gstr2b.ts';
import type { ReturnDue } from '../src/lib/compliance.ts';

beforeEach(() => resetStorage());

const doc = (over: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    id: 'i1', invoice_number: 'INV/FY25-26/0001', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2025-06-01',
    place_of_supply: '29', gst_mode: 'IGST', total: 1180, sender: { ...SELLER }, client: { ...clientKA },
    items: [{ id: 'l1', name: 'Widget', hsn: '8471', quantity: 1, rate: 1000, tax_rate: 18 }], ...over,
  }) as unknown as InvoiceRecord;

/* ── IRP window ── */

test('IRP window: AATO ≥ ₹10 crore from 1 Apr 2025, day 1 = document date, last day = day 30', () => {
  const d = doc({ issue_date: '2025-04-01' });
  // GSTN example: a document dated 1 April must be reported by 30 April.
  const w = irpWindow(d, 1e8, '2025-04-01')!;
  assert.equal(w.deadline, '2025-04-30');
  assert.equal(w.day, 1);
  assert.equal(w.daysLeft, 29);
  assert.equal(w.stage, 'open');
  assert.equal(irpWindow(d, 1e8, '2025-04-20')!.stage, 'day20');
  assert.equal(irpWindow(d, 1e8, '2025-04-27')!.stage, 'day27');
  assert.equal(irpWindow(d, 1e8, '2025-04-30')!.daysLeft, 0);
  assert.equal(irpWindow(d, 1e8, '2025-05-01')!.stage, 'closed');
  // Below ₹10 crore: no window; unknown AATO: none.
  assert.equal(irpWindow(d, 9.99e7, '2025-04-10'), null);
  assert.equal(irpWindow(d, undefined, '2025-04-10'), null);
});

test('IRP window is date-keyed by reporting day: before 1 Apr 2025 only ₹100 crore+, invoices only', () => {
  assert.equal(IRP_REPORTING_WINDOW_RULES.length, 3);
  const inv = doc({ issue_date: '2025-03-01' });
  assert.equal(irpWindow(inv, 2e8, '2025-03-10'), null, '₹20 crore: no limit before 1 Apr 2025');
  assert.ok(irpWindow(inv, 2e9, '2025-03-10'), '₹200 crore: 30-day limit from 1 Nov 2023');
  const cn = doc({ doc_type: 'CREDIT_NOTE', issue_date: '2025-03-01' });
  assert.equal(irpWindow(cn, 2e9, '2025-03-10'), null, 'notes outside the 2023 rule');
  assert.ok(irpWindow({ ...cn, issue_date: '2025-04-05' }, 1e8, '2025-04-10'), 'notes inside from 1 Apr 2025');
  assert.equal(irpWindow(doc({ doc_type: 'QUOTATION' }), 1e9, '2025-06-02'), null);
});

test('irnWindowList skips documents with an IRN, B2C and drafts; aatoFor prefers the live profile by GSTIN', () => {
  const profiles = [{ ...SELLER, einvoice_aato: 1.5e8 }];
  const a = doc({ id: 'a', issue_date: '2025-06-01' });
  const b = doc({ id: 'b', issue_date: '2025-06-02' });
  const c = doc({ id: 'c', client: { ...clientRetail }, place_of_supply: '27' });
  const dr = doc({ id: 'd', status: 'Draft' });
  assert.equal(aatoFor(a, profiles, null), 1.5e8);
  const list = irnWindowList([a, b, c, dr], new Set(['b']), (i) => aatoFor(i, profiles, null), '2025-06-21');
  assert.deepEqual(list.map((x) => x.invoice.id), ['a']);
  assert.equal(list[0].window.stage, 'day20');
});

test('bell: day-20 warning, day-27 critical, ids fingerprint the documents', () => {
  const p = (id: string, issue: string, today: string) => ({ invoice: doc({ id, invoice_number: id, issue_date: issue }), window: irpWindow(doc({ issue_date: issue }), 1e8, today)! });
  const n = gstGuardNotices({ at: '2025-06-27T00:00:00Z', timeBars: [], pending: [p('A', '2025-06-08', '2025-06-27'), p('B', '2025-06-01', '2025-06-27')] });
  assert.equal(n.length, 2);
  const c = n.find((x) => x.severity === 'critical')!;
  assert.equal(c.id, 'irp-day27:B');
  assert.match(c.title, /day 27/);
  assert.ok(n.some((x) => x.id.startsWith('irp-day20:') && x.severity === 'warning'));
});

test('e-invoice mandate thresholds by document date (Notification 10/2023-CT: above ₹5 crore from 1 Aug 2023)', () => {
  assert.equal(einvoiceMandatory(6e7, '2023-07-31'), false);
  assert.equal(einvoiceMandatory(6e7, '2023-08-01'), true);
  assert.equal(einvoiceMandatory(5e7, '2024-01-01'), false, 'exactly ₹5 crore is not above');
  assert.equal(einvoiceMandatory(1e12, '2020-09-30'), false);
});

/* ── Time bar ── */

test('time bar: three years from the due date, never before the portal enforcement (1 Aug 2025)', () => {
  assert.equal(addYears('2024-02-29', 3), '2027-02-28');
  const g1Jun22 = { form: 'GSTR1', due: '2022-07-11', optional: false } as ReturnDue;
  const t = timeBarFor(g1Jun22, '2025-07-01')!;
  assert.equal(t.lastDay, '2025-07-11');
  assert.equal(t.barredOn, '2025-08-01', 'GSTN advisory: June 2022 GSTR-1 barred from 1 Aug 2025');
  assert.equal(t.barred, false);
  const later = timeBarFor({ form: 'GSTR3B', due: '2023-01-20', optional: false } as ReturnDue, '2026-01-21')!;
  assert.equal(later.barredOn, '2026-01-21');
  assert.equal(later.barred, true);
  assert.equal(timeBarFor({ form: 'IFF', due: '2022-01-13', optional: true } as ReturnDue, '2025-09-01'), null);
  assert.equal(timeBarFor(g1Jun22, '2023-09-30'), null, 'no time bar before Finance Act 2023 came into force');
});

test('timeBarList: unfiled returns barred within a year, filed ones dropped', () => {
  const rows = timeBarList({ frequency: 'monthly', stateCode: '27', today: '2026-10-25', since: '2023-04-01' }, [], SELLER_GSTIN);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.bar.daysLeft <= 365));
  const first = rows.find((r) => r.r.id === 'GSTR1:2023-04')!;
  assert.equal(first.bar.barredOn, '2026-05-12');
  assert.equal(first.bar.barred, true);
  const filed = [{ id: 'x', form: 'GSTR1' as const, period_key: '2023-04', gstin: '', filed_on: '2023-05-10', marked_at: '' }];
  assert.ok(!timeBarList({ frequency: 'monthly', stateCode: '27', today: '2026-10-25', since: '2023-04-01' }, filed).some((r) => r.r.id === 'GSTR1:2023-04'));
  const n = gstGuardNotices({ at: 'now', pending: [], timeBars: rows });
  assert.ok(n.some((x) => x.id.startsWith('time-bar:')));
});

/* ── Slabs & exceptions ── */

test('slab table is date-keyed: 12% gone and 40% added from 22 Sep 2025', () => {
  assert.equal(rateInSlabs(12, '2025-09-21'), true);
  assert.equal(rateInSlabs(12, '2025-09-22'), false);
  assert.equal(rateInSlabs(40, '2025-09-21'), false);
  assert.equal(rateInSlabs(40, '2025-09-22'), true);
  assert.equal(rateInSlabs(7, '2024-01-01'), false);
});

test('exceptions: missing HSN, POS vs GSTIN state, rate not in slabs, B2CL edge, missing IRN', () => {
  const aato = () => 6e7;
  const list = gstExceptions(
    [
      doc({ id: 'hsn', items: [{ id: 'x', name: 'A', hsn: '', quantity: 1, rate: 100, tax_rate: 18 }] as never, place_of_supply: '27' }),
      doc({ id: 'rate', issue_date: '2025-10-01', items: [{ id: 'x', name: 'A', hsn: '1234', quantity: 1, rate: 100, tax_rate: 12 }] as never }),
      doc({ id: 'edge', client: { ...clientRetail }, place_of_supply: '29', total: 99000 }),
      doc({ id: 'far', client: { ...clientRetail }, place_of_supply: '29', total: 50000 }),
    ],
    { from: '2025-06-01', to: '2025-10-31', irnIds: new Set(['rate', 'edge', 'far']), aato, today: '2025-06-05' },
  );
  const codes = (id: string) => list.filter((e) => e.invoiceId === id).map((e) => e.code).sort();
  assert.deepEqual(codes('hsn'), ['B2B_NO_HSN', 'IRN_MISSING', 'POS_STATE_MISMATCH']);
  assert.deepEqual(codes('rate'), ['RATE_NOT_IN_SLABS']);
  assert.deepEqual(codes('edge'), ['B2CL_EDGE']);
  assert.equal(list.find((e) => e.code === 'B2CL_EDGE')!.vars.section, 'B2CS');
  assert.deepEqual(codes('far'), []);
  assert.equal(list[0].severity, 'error', 'errors first');
  // Closed window: AATO ≥ ₹10 crore and no IRN after day 30.
  const closed = gstExceptions([doc({ id: 'old', issue_date: '2025-05-01' })], { from: '2025-05-01', to: '2025-05-31', irnIds: new Set(), aato: () => 2e8, today: '2025-06-15' });
  assert.equal(closed[0].code, 'IRP_WINDOW_CLOSED');
  assert.equal(closed[0].vars.deadline, '2025-05-30');
});

/* ── GSTR-1A and Table 3.2 ── */

test('GSTR-1 snapshot → GSTR-1A diff (added / changed / removed) and Table 3.2 per POS', () => {
  installSettings();
  const period = periodForDate('month', '2025-08-10');
  const a = createViaStore({ client: clientKA, date: '2025-08-05', lines: [{ qty: 1, rate: 1000, tax: 18 }] });
  createViaStore({ client: clientRetail, date: '2025-08-06', pos: '29', lines: [{ qty: 1, rate: 500, tax: 18 }] });
  const rep1 = buildGstReport(JSON.parse(JSON.stringify(readInvoices())), [], { period, gstin: SELLER_GSTIN });
  const snap = snapshotFromReport(rep1.gstr1, rep1.gstr3b.interStateUnreg, SELLER_GSTIN, new Date('2025-09-11T10:00:00'));
  saveSnapshot(snap);
  assert.equal(snapshotFor(rep1.gstr1.fp, SELLER_GSTIN.toLowerCase())?.id, snap.id);

  // After filing: one B2B invoice added, one changed, one B2C inter-state added.
  createViaStore({ client: { ...clientKA, gstin: BUYER_KA }, date: '2025-08-20', lines: [{ qty: 2, rate: 1000, tax: 18 }] });
  const all = readInvoices().map((i) => (i.id === a.id ? { ...i, items: i.items.map((it) => ({ ...it, rate: 1500 })) } : i));
  createViaStore({ client: clientRetail, date: '2025-08-21', pos: '29', lines: [{ qty: 1, rate: 200, tax: 18 }] });
  const rep2 = buildGstReport([...all, ...readInvoices().filter((i) => !all.some((x) => x.id === i.id))], [], { period, gstin: SELLER_GSTIN });
  const paper = gstr1aDiff(snap, rep2.gstr1);
  assert.deepEqual(paper.docs.map((d) => d.kind).sort(), ['added', 'changed']);
  assert.ok(paper.docs.find((d) => d.kind === 'changed')!.fields.includes('taxable'));
  assert.equal(paper.b2cs.length, 1);
  assert.equal(paper.b2cs[0].kind, 'changed');

  const t32 = table32Diff(snap, rep2.gstr3b.interStateUnreg);
  assert.equal(t32.length, 1);
  assert.equal(t32[0].pos, '29');
  assert.equal(t32[0].gstr1Taxable, 500);
  assert.equal(t32[0].booksTaxable, 700);
  assert.equal(t32[0].diffTaxable, 200);
  assert.equal(table32Diff(null, rep2.gstr3b.interStateUnreg)[0].gstr1Taxable, null);
  void BUYER_MH;
});

const readInvoices = (): InvoiceRecord[] => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') ?? '[]');

test('GSTR-1A from the July 2024 period; Table 3.2 lock follows the advisories (on 11 Apr 2025, off 16 May 2025)', () => {
  assert.equal(gstr1aAvailable('2024-06-01'), false);
  assert.equal(gstr1aAvailable('2024-07-01'), true);
  assert.equal(table32Locked('2025-04-01', '2025-05-01'), true);
  assert.equal(table32Locked('2025-03-01', '2025-05-01'), false, 'March 2025 period stays editable');
  assert.equal(table32Locked('2025-04-01', '2025-05-20'), false, 'kept editable until further notice');
});

/* ── Vendor follow-up ── */

const bill = (id: string, gstin: string, tax: number) => ({ id, number: id, date: '2025-08-03', partyName: 'Supplier ' + gstin.slice(0, 2), gstin, taxable: tax * 10, igst: tax, cgst: 0, sgst: 0, tax, itcEligible: true, reverseCharge: false, importType: '' as const, boeNumber: '', in4a5: true });
const line = (n: string, gstin: string, tax: number) => ({ key: n, section: 'B2B' as const, ctin: gstin, tradeName: 'Trade ' + gstin.slice(0, 2), number: n, date: '2025-08-03', docType: 'INV' as const, sign: 1 as const, value: tax * 11, taxable: tax * 10, igst: tax, cgst: 0, sgst: 0, cess: 0, pos: '27', reverseCharge: false, itcAvailable: true, reason: '' });

test('follow-up: grouped per supplier, ITC at risk, note text, marks and the pushed 3B ITC', () => {
  const match: MatchResult = {
    counts: { matched: 1, mismatch: 1, missing_in_books: 1, not_in_2b: 1, itc_unavailable: 0 },
    rows: [
      { key: 'm', cls: 'matched', line: line('M1', BUYER_KA, 18), bill: bill('M1', BUYER_KA, 18), diffs: [], taxDiff: 0 },
      { key: 'x', cls: 'mismatch', line: line('X1', BUYER_KA, 10), bill: bill('X1', BUYER_KA, 18), diffs: ['tax'], taxDiff: -8 },
      { key: 'BOOKS|n', cls: 'not_in_2b', bill: bill('N1', BUYER_KA, 50), diffs: [], taxDiff: 0 },
      { key: 'o', cls: 'missing_in_books', line: line('O1', BUYER_MH, 5), diffs: [], taxDiff: 0 },
    ],
  };
  const list = followUps(match);
  assert.deepEqual(list.map((f) => f.ctin), [BUYER_KA, BUYER_MH]);
  assert.equal(list[0].taxAtRisk, 58, '50 not in 2B + 8 short on the mismatch');
  assert.deepEqual(list[0].items.map((i) => i.kind), ['not_in_2b', 'mismatch']);
  const w = {
    greeting: (n: string) => `Dear ${n},`, intro: (p: string, g: string) => `${p} ${g}`, notIn2b: 'NOT IN 2B', mismatch: 'MISMATCH', missingInBooks: 'MISSING',
    books: 'books', in2b: '2B', taxable: 'taxable', tax: 'tax', diffs: { taxable: 'tv', tax: 'tax differs', heads: 'h', date: 'd', number: 'n' }, closing: 'Thanks',
  };
  const text = followUpText(list[0], 'August 2025', SELLER_GSTIN, w, 'Mr Chartist');
  assert.match(text, /NOT IN 2B\n1\. N1 \(03-08-2025\): books: taxable ₹500\.00, tax ₹50\.00/);
  assert.match(text, /tax differs/);
  assert.ok(text.endsWith('Mr Chartist'));
  // Marks
  markFollowUp('082025', list[0], '2025-09-02', 'whatsapp');
  assert.equal(loadFollowUps()[0].channel, 'whatsapp');
  markFollowUp('082025', list[0], null);
  assert.equal(loadFollowUps().length, 0);
  // Push → GSTR-3B view
  const h = (n: number) => ({ igst: n, cgst: 0, sgst: 0 });
  pushItc('082025', SELLER_GSTIN, { books: h(100), restricted: h(60), atRisk: h(40), per2b: h(70) });
  assert.equal(pushedItc('082025', SELLER_GSTIN)?.restricted.igst, 60);
  assert.equal(pushedItc('092025', SELLER_GSTIN), null);
});

/* ── Cancel flow ── */

test('cancel flow: 24-hour deadlines, EWB first, credit note after the window, status tracking', () => {
  const meta = { invoice_id: 'i1', irn: 'a'.repeat(64), ack_date: '2025-06-10 14:30:00', eway_no: '123456789012', eway_date: '2025-06-10' };
  const p = cancelPlan(meta, new Date(2025, 5, 11, 10, 0));
  assert.equal(p.ewbFirst, true);
  assert.equal(p.irn.open, true);
  assert.equal(p.irn.minutesLeft, 270);
  assert.equal(p.ewb.open, false, 'EWB date without time counts from 00:00 (conservative)');
  assert.equal(p.ewb.approximate, true);
  assert.equal(p.creditNoteOnly, false);
  assert.equal(cancelPlan(meta, new Date(2025, 5, 11, 15, 0)).creditNoteOnly, true);
  assert.deepEqual(JSON.parse(irnCancelJson(meta.irn, 'data_entry', 'Wrong rate')), { Irn: meta.irn, CnlRsn: '2', CnlRem: 'Wrong rate' });
  assert.deepEqual(JSON.parse(ewbCancelJson(meta.eway_no, 'data_entry', '')), { ewbNo: 123456789012, cancelRsnCode: 3, cancelRmrk: 'Cancelled' });
  let m = withCancel(meta, 'ewb', { status: 'prepared', reason: 'order_cancelled', remark: '' });
  assert.equal(cancelState(m), 'pending');
  m = withCancel(m, 'ewb', { status: 'done', done_on: '2025-06-10' });
  m = withCancel(m, 'irn', { status: 'done', done_on: '2025-06-10' });
  assert.equal(cancelState(m), 'done');
  assert.equal(m.irn_cancel?.reason, 'order_cancelled', 'reason carried from the first step');
});

/* ── wiring ── */

test('storage wiring: new tables in both backup lists, TABLE_ACTIONS; area strings complete', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/lib/backup.ts', import.meta.url), 'utf8');
  const access = fs.readFileSync(new URL('../src/lib/access.ts', import.meta.url), 'utf8');
  for (const t of ['gst_followups', 'gstr2b_itc', 'gstr1_snapshots']) {
    assert.equal(src.split(`'${t}'`).length - 1, 2, `${t} in both backup lists`);
    assert.match(access, new RegExp(`${t}: 'books.edit'`));
  }
  assert.ok(Object.keys(ggT.en).length > 100);
});
