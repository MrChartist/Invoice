/**
 * R15-C2 statement match (pure): each row of a BSP / consolidator / bed-bank statement against our tickets (invoice
 * lines with `tv.lines[lineId].tkt`, by ticket no. or PNR) and bookings (by PNR / booking ref.), reading only the
 * documents dated in the billing period ± 45 days (an invoice outside it is never opened). A difference over ₹1 →
 * `diff`; ADMA → an ADM to record or dispute; RFND whose invoice has no credit note → a refund to pass on (C3); a row
 * we cannot find → `missing`; our tickets (BSP) or this supplier's bookings in the period that the statement does not
 * list → `ours_only` rows. Nothing posts here. Working papers — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { StatementRow, SupplierStatement, TravelBooking } from '../../types/travel-r15';
import { shiftDay } from '../dates';
import { round2 } from '../invoice-calc';
import { costInr } from './tv-bookings';
import { fareOf } from './tv-air-value';

export const MATCH_DAYS = 45;
type Doc = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'issue_date' | 'items' | 'tv'>;
export interface MatchSource { invoices: readonly Doc[]; bookings: readonly TravelBooking[]; /** Invoice ids with a live credit note. */ credited: ReadonlySet<string> }
interface Ours { kind: 'invoice_line' | 'booking'; id: string; ref: string; amount: number; date: string; inv?: string; cn?: boolean; vendor?: string }

const alnum = (s?: string) => (s ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();
/** A ticket number by its last 10 digits (BSP prints the serial with or without the airline's 3-digit prefix). */
const tkKey = (s?: string) => { const d = (s ?? '').replace(/\D/g, ''); return d.length >= 10 ? `T${d.slice(-10)}` : ''; };

export const matchWindow = (st: Pick<SupplierStatement, 'period_start' | 'period_end'>) => ({ from: shiftDay(st.period_start, -MATCH_DAYS), to: shiftDay(st.period_end, MATCH_DAYS) });

/** The statement's rows matched (statement rows first, then `ours_only`). */
export function matchStatement(st: Pick<SupplierStatement, 'kind' | 'vendor_id' | 'period_start' | 'period_end' | 'rows'>, src: MatchSource): StatementRow[] {
  const { from, to } = matchWindow(st);
  const idx = new Map<string, Ours>();
  const put = (k: string, o: Ours) => { if (k && !idx.has(k)) idx.set(k, o); };
  for (const inv of src.invoices) {
    const d = inv.issue_date;
    if (!(d >= from && d <= to) || inv.status === 'Cancelled' || !['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY'].includes(inv.doc_type)) continue;
    const L = inv.tv?.lines;
    if (!L) continue;
    for (const l of inv.items ?? []) {
      const t = L[l.id]?.tkt;
      if (!t) continue;
      const o: Ours = { kind: 'invoice_line', id: `${inv.id}:${l.id}`, ref: t.ticket_no || t.pnr || '', amount: fareOf(t), date: d, inv: inv.id };
      put(tkKey(t.ticket_no), o);
      put(alnum(t.pnr), o);
    }
  }
  for (const b of src.bookings) {
    if (!(b.start >= from && b.start <= to) || b.status === 'cancelled' || !b.ref) continue;
    put(alnum(b.ref), { kind: 'booking', id: b.id, ref: b.ref, amount: costInr(b), date: b.start, cn: !!b.cancel?.credit_note_id, vendor: b.vendor_id });
  }
  const seen = new Set<Ours>();
  const rows: StatementRow[] = st.rows.filter((r) => r.status !== 'ours_only').map((r0) => {
    const { match: _m, status: _s, diff: _d, flag: _f, ...r } = r0;
    void _m; void _s; void _d; void _f;
    const type = r.type.toUpperCase();
    if (type.startsWith('ADM')) return { ...r, status: 'diff', flag: 'adm' };
    const o = idx.get(tkKey(r.doc_no)) ?? idx.get(alnum(r.doc_no));
    if (!o) return { ...r, status: 'missing' };
    seen.add(o);
    const match = { kind: o.kind, id: o.id };
    if (type.startsWith('RF')) return { ...r, match, status: 'matched', ...((o.inv ? !src.credited.has(o.inv) : !o.cn) ? { flag: 'refund' as const } : {}) };
    const diff = round2(o.amount - (r.gross + r.taxes));
    return Math.abs(diff) > 1 ? { ...r, match, status: 'diff', diff } : { ...r, match, status: 'matched' };
  });
  const ours = [...new Set(idx.values())].filter((o) => !seen.has(o) && o.date >= st.period_start && o.date <= st.period_end && (st.kind === 'bsp' ? o.kind === 'invoice_line' : o.vendor === st.vendor_id));
  for (const o of ours) rows.push({ doc_no: o.ref, type: 'OURS', date: o.date, gross: o.amount, taxes: 0, commission: 0, net: 0, match: { kind: o.kind, id: o.id }, status: 'ours_only' });
  return rows;
}
