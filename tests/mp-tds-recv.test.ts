/** R17-D2 TDS receivable by client × FY quarter: bills and arrears notes, expected (snapshot) vs booked, credit notes out. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fyQuarter, tdsReceivable } from '../src/lib/manpower/mp-tds-recv.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const inv = (id: string, date: string, o: Partial<InvoiceRecord> = {}): InvoiceRecord => ({ id, doc_type: 'INVOICE', status: 'Sent', issue_date: date, client: { id: 'c', name: 'Sunrise' }, taxable_value: 128600, mp: { month: date.slice(0, 7), tds: { section: '194C-1', rate: 1, expected: 1286, label: 'Sec 393(1) Table Sl. 6(i)' } }, ...o }) as InvoiceRecord;

test('quarters by the bill date (Indian FY)', () => {
  assert.deepEqual([fyQuarter('2026-04-01'), fyQuarter('2026-10-31'), fyQuarter('2027-03-31')], [{ fy: 2026, q: 1 }, { fy: 2026, q: 3 }, { fy: 2026, q: 4 }]);
});

test('per client × quarter: expected from the snapshots, booked from the bill; notes in, credit notes / cancelled / non-manpower out', () => {
  const rows = tdsReceivable([
    inv('a', '2026-10-31', { tds_amount: 1000 }),
    inv('dn', '2026-11-15', { doc_type: 'DEBIT_NOTE', taxable_value: 3978, mp: { month: '2026-10', tds: { section: '194C-1', rate: 1, expected: 39.78 } } }),
    inv('cn', '2026-11-16', { doc_type: 'CREDIT_NOTE' }),
    inv('x', '2026-11-17', { status: 'Cancelled' }),
    inv('o', '2026-11-18', { mp: undefined }),
    inv('b', '2026-03-31', { mp: { month: '2026-03', tds: { section: '194J', rate: 2, expected: 2000 } } }),
  ]);
  assert.deepEqual(rows.map((r) => [r.fy, r.q, r.client, r.bills, r.base, r.expected, r.booked, r.diff]), [[2025, 4, 'Sunrise', 1, 128600, 2000, 0, 2000], [2026, 3, 'Sunrise', 2, 132578, 1325.78, 1000, 325.78]]);
  assert.match(rows[1].label, /393/);
});
