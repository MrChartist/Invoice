/** R5-A5: GST TCS / TDS credit — expected, withheld, portal rows, differences, accept / reject, 194-O → 26AS. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AMZ_MH, AMZ_TAN, fixture, importMtr, setupWorld } from './helpers/marketplace.ts';
import { acceptCredit, creditRows, estimated194o, expectedGstTds, expectedTcs, loadEcoCredits, parseMonth, parsePortalRows, rejectCredit, savePortalRows, splitHeads, tds194oExpectedLines, withheldTcs } from '../src/lib/marketplace/tcs-credit.ts';
import { importSettlement, loadSettlements, parseSettlement } from '../src/lib/marketplace/settlement-import.ts';
import { loadChannels } from '../src/lib/marketplace/channels.ts';
import { periodOf, tds194oRate } from '../src/lib/marketplace/tds-194o.ts';
import { sectionText } from '../src/lib/ita2025.ts';
import { buildTdsRegister, parseTdsCsv, reconcileTds, tdsPeriodOf } from '../src/lib/tds-register.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { SalesChannel } from '../src/types/marketplace-r5.ts';

let ch: SalesChannel;
beforeEach(() => { ch = setupWorld(); });
const portalText = () => readFileSync(new URL('./fixtures/marketplace/portal-tcs.csv', import.meta.url), 'utf8');

test('expected TCS: 1% before 10 Jul 2024, 0.5% after; returns reduce the base; IGST vs CGST + SGST', () => {
  const sender = localDb.settings.activeProfile();
  const doc = (date: string, pos: string, taxable: number, type: InvoiceRecord['doc_type'] = 'INVOICE') =>
    ({ id: date + pos + type, invoice_number: 'X', doc_type: type, status: 'Sent', issue_date: date, place_of_supply: pos, taxable_value: taxable, eco_gstin: AMZ_MH, eco_section: 'TCS_52', sender }) as unknown as InvoiceRecord;
  const before = expectedTcs([doc('2024-07-09', '29', 1000)]);
  assert.equal(before[0].heads.igst, 10);
  const after = expectedTcs([doc('2024-07-10', '27', 1000), doc('2024-07-20', '27', 200, 'CREDIT_NOTE')]);
  assert.equal(after[0].net, 800);
  assert.deepEqual(after[0].heads, { igst: 0, cgst: 2, sgst: 2 });
  assert.deepEqual(splitHeads(4.51, false), { igst: 0, cgst: 2.26, sgst: 2.25 });
  assert.equal(expectedTcs([{ ...doc('2026-10-01', '27', 1000), eco_section: 'PAY_9_5' } as InvoiceRecord]).length, 0, '9(5) supplies carry no TCS');
});

test('three columns: books, withheld (settlements) and portal (pasted) agree for the month', () => {
  importMtr(ch);
  importSettlement(ch, parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2'), 'v2.csv');
  const expected = expectedTcs(localDb.invoices.getAll());
  const oct = expected.find((e) => e.gstin === AMZ_MH && e.month === '2026-10')!;
  assert.deepEqual(oct.heads, { igst: 5, cgst: 2.25, sgst: 2.25 });
  assert.equal(oct.gross, 2400);
  assert.equal(oct.returns, 500);
  const withheld = withheldTcs(loadChannels(), loadSettlements(), '27');
  assert.equal(withheld.get(`${AMZ_MH}|2026-10`), 12);
  const { rows, skipped } = parsePortalRows(portalText(), 'tcs');
  assert.deepEqual(skipped, []);
  assert.equal(rows[0].month, '2026-10');
  assert.equal(rows[0].net, 1900);
  savePortalRows(rows);
  const view = creditRows('tcs', expected, withheld, loadEcoCredits('tcs'));
  assert.equal(view.find((r) => r.month === '2026-10')!.reason, 'ok');
});

test('difference reasons: value mismatch, month shift, missing portal / books rows', () => {
  const e = [{ gstin: AMZ_MH, month: '2026-10', gross: 0, returns: 0, net: 0, heads: { igst: 10, cgst: 0, sgst: 0 } }, { gstin: AMZ_MH, month: '2026-11', gross: 0, returns: 0, net: 0, heads: { igst: 7, cgst: 0, sgst: 0 } }];
  const p = (month: string, igst: number) => ({ id: month, kind: 'tcs' as const, operator_gstin: AMZ_MH, month, gross: 0, returns: 0, net: 0, igst, cgst: 0, sgst: 0, source: 'paste' as const });
  const rows = creditRows('tcs', e, new Map(), [p('2026-10', 20), p('2026-11', 10), p('2026-12', 3)]);
  const by = Object.fromEntries(rows.map((r) => [r.month, r.reason]));
  assert.equal(by['2026-10'], 'value_mismatch');
  assert.equal(by['2026-11'], 'month_shift', '₹10 matches October books');
  assert.equal(by['2026-12'], 'missing_books');
  assert.equal(creditRows('tcs', e, new Map(), []).every((r) => r.reason === 'missing_portal'), true);
  assert.equal(parseMonth('102026'), '2026-10');
  assert.equal(parseMonth('October 2026'), '2026-10');
  assert.equal(parseMonth('2026-13'), '');
});

test('accept posts one balanced journal into the cash ledger (2360) and is idempotent; reject posts nothing', () => {
  savePortalRows(parsePortalRows(portalText(), 'tcs').rows);
  const row = loadEcoCredits('tcs')[0];
  const a = acceptCredit(row.id);
  assert.equal(a.decision, 'accepted');
  assert.equal(a.decided_on, '2026-10-31');
  const v = loadVouchers();
  assert.equal(v.length, 1);
  assert.equal(v[0].lines.find((l) => l.account_id === A.gstCash)!.dr, 950);
  assert.equal(v[0].lines.reduce((s, l) => s + l.dr - l.cr, 0), 0);
  assert.equal(acceptCredit(row.id).journal_id, a.journal_id);
  assert.equal(loadVouchers().length, 1, 'idempotent');
  savePortalRows([{ kind: 'tcs', operator_gstin: AMZ_MH, month: '2026-09', gross: 0, returns: 0, net: 0, igst: 1, cgst: 0, sgst: 0, source: 'typed' }]);
  const r2 = loadEcoCredits('tcs').find((r) => r.month === '2026-09')!;
  assert.equal(rejectCredit(r2.id, '2026-10-20').decision, 'rejected');
  assert.equal(loadVouchers().length, 1);
  // A decided row is not overwritten by a later paste.
  assert.equal(savePortalRows(parsePortalRows(portalText(), 'tcs').rows).kept, 1);
});

test('GST TDS rows (Sec 51) read ra_deductions by field name', () => {
  const inv = { id: 'w1', invoice_number: 'RA/1', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-10-05', place_of_supply: '27', taxable_value: 100000, client: { gstin: '27AAAGM0289C1ZJ' }, sender: localDb.settings.activeProfile(), ra_deductions: [{ kind: 'gst_tds', amount: 2000 }] } as unknown as InvoiceRecord;
  const rows = expectedGstTds([inv]);
  assert.deepEqual(rows[0].heads, { igst: 0, cgst: 1000, sgst: 1000 });
});

test('194-O: settlement lines become expected TDS lines that reconcile with a 26AS row under the operator TAN', () => {
  importMtr(ch);
  const s = importSettlement(ch, parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2'), 'v2.csv');
  const lines = tds194oExpectedLines(loadChannels(), loadSettlements(), localDb.clients.getAll());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].tds, 2.83);
  assert.equal(lines[0].tan, AMZ_TAN);
  assert.equal(lines[0].quarter, 3);
  const input = { invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: localDb.clients.getAll(), extraExpected: lines };
  assert.equal(buildTdsRegister(input, { today: '2026-12-31' }).totals.tdsExpected, 2.83);
  const csv = `Name of Deductor,TAN of Deductor,Section,Transaction Date,Amount Paid / Credited,Tax Deducted\nAmazon Seller Services Pvt Ltd,${AMZ_TAN},194O,16-Oct-2026,2832,2.83\n`;
  const rec = reconcileTds(parseTdsCsv(csv).credits, input);
  assert.equal(rec.matched.length, 1);
  assert.equal(rec.onlyBooks.length, 0);
  // Without the extra lines the register is unchanged (existing callers).
  assert.equal(buildTdsRegister({ invoices: localDb.invoices.getAll() }, { today: '2026-12-31' }).totals.tdsExpected, 0);
  for (const d of ['2026-04-01', '2026-06-30', '2026-10-16', '2027-01-01', '2027-03-31', 'x']) assert.deepEqual(periodOf(d), tdsPeriodOf(d), d);
  assert.equal(tds194oRate('2024-09-30'), 1);
  assert.equal(tds194oRate('2024-10-01'), 0.1);
  assert.equal(tds194oRate('2020-12-01'), 0.75, 'the existing tax-rules history is reused');
  assert.match(sectionText('194O', '2026-10-16'), /393\(1\).*8\(v\).*\[old 194-O\]/);
  assert.equal(sectionText('194O', '2026-03-31'), '194O');
  assert.equal(estimated194o(s), 2.83);
});
