/**
 * PENDING 13 (R15-C cut 3 leftovers), pure:
 *  - the ticket annexure page: one row per ticket line of the document (`tv.lines[lineId].tkt`, snapshot only), in line
 *    order, printed as a following page when `tv.ticket_annexure` is set ('list'; 'fares' adds the fare split columns);
 *  - the CSV of a supplier statement's differences: every row not plainly matched (diff, missing, ours only) or
 *    flagged (ADM, refund to pass on), with our amount less theirs.
 * Working papers — verify with your CA.
 */
import type { StatementRow, SupplierStatement, TvSnapshot, TvTicket } from '../../types/travel-r15';

export interface TicketAnnexRow extends TvTicket { line_id: string; fare: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Ticket rows of a document, in line order (tickets of lines no longer on the document are left out). */
export function ticketAnnexRows(items: readonly { id?: string }[] | undefined, tv: TvSnapshot | undefined): TicketAnnexRow[] {
  const out: TicketAnnexRow[] = [];
  for (const it of items ?? []) {
    const k = it.id ? tv?.lines?.[it.id]?.tkt : undefined;
    if (k) out.push({ ...k, line_id: it.id!, fare: r2(n(k.basic) + n(k.taxes) + n(k.airline_gst)) });
  }
  return out;
}

/** The page prints only when ticked on the document and it has a ticket. */
export const showTicketAnnexure = (items: readonly { id?: string }[] | undefined, tv: TvSnapshot | undefined): boolean =>
  !!tv?.ticket_annexure && ticketAnnexRows(items, tv).length > 0;

/** Totals of the fare split. */
export function ticketAnnexTotals(rows: readonly TicketAnnexRow[]) {
  return rows.reduce((t, r) => ({ basic: r2(t.basic + n(r.basic)), taxes: r2(t.taxes + n(r.taxes)), airline_gst: r2(t.airline_gst + n(r.airline_gst)), fare: r2(t.fare + r.fare) }), { basic: 0, taxes: 0, airline_gst: 0, fare: 0 });
}

export const DIFF_HEAD = ['Doc no', 'Type', 'Date', 'Passenger', 'Gross + taxes', 'Commission', 'Net', 'Status', 'Difference (ours − theirs)', 'Flag', 'Disputed'];

/** A row the CSV of differences carries. */
export const isDifference = (r: StatementRow): boolean => (!!r.status && r.status !== 'matched') || !!r.flag;

/** CSV rows (header first) of a statement's differences. */
export function statementDiffRows(st: Pick<SupplierStatement, 'rows'>): (string | number)[][] {
  return [DIFF_HEAD, ...st.rows.filter(isDifference).map((r) => [
    r.doc_no, r.type, r.date ?? '', r.pax ?? '', r2(n(r.gross) + n(r.taxes)), r2(n(r.commission)), r2(n(r.net)), r.status ?? '',
    r.status === 'diff' ? r2(n(r.diff)) : '', r.flag === 'adm' ? 'ADM' : r.flag === 'refund' ? 'Refund to pass on' : '', r.disputed ? 'Yes' : '',
  ])];
}
