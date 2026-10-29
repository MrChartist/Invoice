/**
 * R17-D2 TDS receivable by client (pure): per client × FY quarter (by the bill date) — manpower bills and arrears notes
 * (documents with `mp.month`), their taxable value, the expected client TDS snapshotted on each (`mp.tds`, B4: the
 * contractor limb from 1 Apr 2026, a client's typed 194J before it accepted without alarm), TDS booked on the bill
 * (`tds_amount`) and the difference. Credit notes and cancelled bills are left out. The Form 16A / Form 131 chase list
 * is R14's (`TdsChasePanel`). Working papers — verify with your CA (MP14, MP15, MP42).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { round2 } from '../invoice-calc';

export interface TdsRecvRow { key: string; client: string; fy: number; q: number; bills: number; base: number; expected: number; booked: number; diff: number; label: string }

/** FY start year and quarter (Apr–Jun = 1) of a `YYYY-MM-DD` day. */
export function fyQuarter(day: string): { fy: number; q: number } {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  return { fy: m >= 4 ? y : y - 1, q: m >= 4 ? Math.ceil((m - 3) / 3) : 4 };
}

export function tdsReceivable(invoices: readonly InvoiceRecord[]): TdsRecvRow[] {
  const by = new Map<string, TdsRecvRow>();
  for (const i of invoices) {
    if (!i.mp?.month || i.status === 'Cancelled' || i.doc_type === 'CREDIT_NOTE' || !/^\d{4}-\d{2}/.test(i.issue_date ?? '')) continue;
    const { fy, q } = fyQuarter(i.issue_date);
    const client = i.client?.name || '-';
    const key = `${i.client?.id || client}|${fy}|${q}`;
    const r = by.get(key) ?? { key, client, fy, q, bills: 0, base: 0, expected: 0, booked: 0, diff: 0, label: '' };
    r.bills += 1;
    r.base = round2(r.base + (Number(i.taxable_value) || 0));
    r.expected = round2(r.expected + (i.mp.tds?.expected ?? 0));
    r.booked = round2(r.booked + (Number(i.tds_amount) || 0));
    r.diff = round2(r.expected - r.booked);
    r.label = i.mp.tds?.label || r.label;
    by.set(key, r);
  }
  return [...by.values()].sort((a, b) => a.fy - b.fy || a.q - b.q || a.client.localeCompare(b.client));
}
