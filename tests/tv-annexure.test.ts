/** PENDING 13 (R15-C cut 3): ticket annexure page and the CSV of supplier-statement differences. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIFF_HEAD, isDifference, showTicketAnnexure, statementDiffRows, ticketAnnexRows, ticketAnnexTotals } from '../src/lib/travel/tv-annexure.ts';
import { toCsv } from '../src/lib/download.ts';
import type { StatementRow, TvSnapshot } from '../src/types/travel-r15.ts';

const tv: TvSnapshot = {
  lines: {
    f1: { tkt: { pax: 'Asha Rao', airline: '6E', ticket_no: '0981234567890', pnr: 'AB12CD', sector: 'BOM-DEL', basic: 5000, taxes: 900, airline_gst: 250 } },
    f2: { tkt: { pax: 'Ravi Rao', airline: '6E', ticket_no: '0981234567891', pnr: 'AB12CD', sector: 'BOM-DEL', basic: 5000, taxes: 900 } },
    gone: { tkt: { pax: 'Removed line', basic: 99 } },
  },
};
const items = [{ id: 'f2' }, { id: 'svc' }, { id: 'f1' }];

test('PENDING 13: ticket rows follow the line order, from the snapshot; removed lines are left out', () => {
  const rows = ticketAnnexRows(items, tv);
  assert.deepEqual(rows.map((r) => [r.line_id, r.pax, r.fare]), [['f2', 'Ravi Rao', 5900], ['f1', 'Asha Rao', 6150]]);
  assert.deepEqual(ticketAnnexTotals(rows), { basic: 10000, taxes: 1800, airline_gst: 250, fare: 12050 });
});

test('PENDING 13: the page prints only when ticked and the document has a ticket', () => {
  assert.equal(showTicketAnnexure(items, tv), false, 'not ticked');
  assert.equal(showTicketAnnexure(items, { ...tv, ticket_annexure: 'list' }), true);
  assert.equal(showTicketAnnexure([{ id: 'svc' }], { ...tv, ticket_annexure: 'fares' }), false, 'no ticket line left');
  assert.equal(showTicketAnnexure(items, undefined), false);
});

test('PENDING 13: CSV of differences — diff / missing / ours only / flagged rows, ours less theirs', () => {
  const R = (doc_no: string, status: StatementRow['status'], over: Partial<StatementRow> = {}): StatementRow => ({ doc_no, type: 'TKTT', gross: 5000, taxes: 900, commission: 0, net: 5900, status, ...over });
  const rows = [R('1', 'matched'), R('2', 'diff', { diff: -120.5 }), R('3', 'missing'), R('4', 'ours_only'), R('5', 'matched', { type: 'ADMA', flag: 'adm', disputed: true }), R('6', 'matched', { type: 'RFND', flag: 'refund' })];
  assert.deepEqual(rows.map(isDifference), [false, true, true, true, true, true]);
  const out = statementDiffRows({ rows });
  assert.deepEqual(out[0], DIFF_HEAD);
  assert.deepEqual(out.slice(1).map((r) => [r[0], r[7], r[8], r[9], r[10]]), [['2', 'diff', -120.5, '', ''], ['3', 'missing', '', '', ''], ['4', 'ours_only', '', '', ''], ['5', 'matched', '', 'ADM', 'Yes'], ['6', 'matched', '', 'Refund to pass on', '']]);
  assert.match(toCsv(out), /^Doc no,Type,Date/);
});

test('PENDING 13: wired — paper page (lazy, not on receipts), editor select, statements CSV button, en + hi strings', () => {
  const eng = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(eng, /lazy\(\(\) => import\('\.\/parts\/travel\/TicketAnnexurePage'\)\)/);
  assert.match(eng, /invoice\.tv\?\.ticket_annexure && layout !== 'receipt'/);
  const ed = readFileSync(new URL('../src/components/travel/TravelRows.tsx', import.meta.url), 'utf8');
  assert.match(ed, /ticket_annexure: \(e\.target\.value \|\| undefined\)/);
  const sv = readFileSync(new URL('../src/components/travel/StatementsView.tsx', import.meta.url), 'utf8');
  assert.match(sv, /toCsv\(statementDiffRows\(sel\)\)/);
  const area = readFileSync(new URL('../src/i18n/areas/travel-r15c.ts', import.meta.url), 'utf8');
  for (const k of ['annexPage', 'annexList', 'annexFares', 'diffCsv']) assert.equal((area.match(new RegExp(`${k}:`, 'g')) ?? []).length, 2, k);
});
