/**
 * GSTR-9C reconciliation statement — WORKING PAPER (WP-6, P1-16). Part II tables in a simplified shape:
 *  - Table 5: turnover as per audited financial statements (books), the usual adjustments, vs annual turnover
 *    in GSTR-9 (Table 5N);
 *  - Table 7: taxable turnover (5O less exempt / nil / non-GST, zero-rated without tax and outward reverse-charge
 *    supplies) vs GSTR-9 taxable turnover (4N less 4G);
 *  - Table 9: tax paid per head — books vs GSTR-9 Table 9 (rate-wise Table 9 and Table 14: gstr9c-extra.ts, 7R);
 *  - Table 12: ITC as per books (with the earlier-year / later-year adjustments) vs GSTR-9 Table 7J.
 * Since FY 2020-21 GSTR-9C is self-certified (Notifications 29/2021 and 30/2021-CT) and filed only above ₹5 crore
 * aggregate turnover — verify the current threshold and form with your CA. Nothing here is certified or filed.
 */

import { round2 } from './invoice-calc';
import type { Gstr9Report } from './gstr9';

export const GSTR9C_DISCLAIMER =
  'GSTR-9C working paper: books vs GSTR-9 differences only — not the certified / filed reconciliation statement. Verify every figure and the applicability threshold with your CA.';

/** Aggregate turnover above which GSTR-9C is filed (₹5 crore, Notification 30/2021-CT onwards — verify). */
export const GSTR9C_THRESHOLD = 5_00_00_000;

export interface Gstr9cAdjustments {
  /** 5B: unbilled revenue at the beginning of the FY (+). */
  unbilledOpening?: number;
  /** 5C: unadjusted advances at the end of the FY (+). */
  advancesClosing?: number;
  /** 5D: deemed supply under Schedule I (+). */
  deemedSupply?: number;
  /** 5E: credit notes issued after the end of the FY but reflected in the annual return (−). */
  creditNotesAfterFy?: number;
  /** 5F: trade discounts accounted in the books but not permissible under GST (+). */
  tradeDiscounts?: number;
  /** 5H: unbilled revenue at the end of the FY (−). */
  unbilledClosing?: number;
  /** 5I: unadjusted advances at the beginning of the FY (−). */
  advancesOpening?: number;
  /** 5J: credit notes accounted in the books but not admissible under GST (+). */
  creditNotesNotGst?: number;
  /** 5K–5N: other adjustments, signed (+ adds to turnover). */
  other?: number;
  /** 12B: ITC booked in an earlier FY claimed in this one (+). */
  itcEarlierFy?: number;
  /** 12C: ITC booked in this FY to be claimed in later FYs (−). */
  itcLaterFy?: number;
}

export interface Gstr9cBooks {
  /** 5A: turnover (net of GST) as per the audited financial statements. */
  turnover: number;
  /** Tax booked for the FY, by head (output tax net of credit notes + reverse charge). */
  tax: { igst: number; cgst: number; sgst: number; cess: number };
  /** 12A: ITC availed as per the audited financial statements. */
  itc: number;
  /**
   * Additive (7R, 7.127): ITC given back by supplier notes / purchase returns of the FY (`notesItcForFy`). Books'
   * ITC (`gstSummary`) is gross of them while GSTR-9 7J nets them (through each month's 3B), so Table 12 shows them
   * as their own line between 12A and 12D. Absent = not split (pre-7R behaviour).
   */
  notesItc?: number;
}

export interface Gstr9cLine {
  id: string;
  label: string;
  amount: number;
  total?: boolean;
}

export interface Gstr9cHeadRow {
  head: 'IGST' | 'CGST' | 'SGST' | 'Cess';
  books: number;
  returns: number;
  diff: number;
}

export interface Gstr9cReport {
  fyLabel: string;
  table5: Gstr9cLine[];
  table7: Gstr9cLine[];
  table9: Gstr9cHeadRow[];
  table12: Gstr9cLine[];
  unreconciled: { turnover: number; taxable: number; tax: number; itc: number };
  /** Aggregate turnover used for the threshold check and whether 9C is required. */
  required: boolean;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const r9 = (r: Gstr9Report, table: 'table4' | 'table5', id: string) => r[table].find((x) => x.id === id);
const heads = (x?: { igst: number; cgst: number; sgst: number; cess: number }) => (x ? x.igst + x.cgst + x.sgst + x.cess : 0);

export function buildGstr9c(g9: Gstr9Report, books: Gstr9cBooks, adj: Gstr9cAdjustments = {}): Gstr9cReport {
  /* Table 5 — turnover */
  const t5A = round2(n(books.turnover));
  const plus = [n(adj.unbilledOpening), n(adj.advancesClosing), n(adj.deemedSupply), n(adj.tradeDiscounts), n(adj.creditNotesNotGst)];
  const minus = [n(adj.creditNotesAfterFy), n(adj.unbilledClosing), n(adj.advancesOpening)];
  const t5O = round2(t5A + plus.reduce((a, b) => a + b, 0) - minus.reduce((a, b) => a + b, 0) + n(adj.other));
  const t5P = round2(g9.turnover.computed);
  const t5Q = round2(t5O - t5P);
  const table5: Gstr9cLine[] = [
    { id: '5A', label: 'Turnover (including exports) as per audited financial statements', amount: t5A },
    { id: '5B', label: 'Unbilled revenue at the beginning of the FY (+)', amount: round2(n(adj.unbilledOpening)) },
    { id: '5C', label: 'Unadjusted advances at the end of the FY (+)', amount: round2(n(adj.advancesClosing)) },
    { id: '5D', label: 'Deemed supply under Schedule I (+)', amount: round2(n(adj.deemedSupply)) },
    { id: '5E', label: 'Credit notes issued after the end of the FY but reflected in the annual return (−)', amount: round2(n(adj.creditNotesAfterFy)) },
    { id: '5F', label: 'Trade discounts accounted in the books but not permissible under GST (+)', amount: round2(n(adj.tradeDiscounts)) },
    { id: '5H', label: 'Unbilled revenue at the end of the FY (−)', amount: round2(n(adj.unbilledClosing)) },
    { id: '5I', label: 'Unadjusted advances at the beginning of the FY (−)', amount: round2(n(adj.advancesOpening)) },
    { id: '5J', label: 'Credit notes accounted in the books but not admissible under GST (+)', amount: round2(n(adj.creditNotesNotGst)) },
    { id: '5K-N', label: 'Other adjustments (±)', amount: round2(n(adj.other)) },
    { id: '5O', label: 'Turnover after adjustments', amount: t5O, total: true },
    { id: '5P', label: 'Annual turnover as declared in GSTR-9 (Table 5N)', amount: t5P },
    { id: '5Q', label: 'Unreconciled turnover (O − P)', amount: t5Q, total: true },
  ];

  /* Table 7 — taxable turnover */
  const exempt = round2(['5D', '5E', '5F'].reduce((s, id) => s + n(r9(g9, 'table5', id)?.taxable), 0));
  const zero = round2(n(r9(g9, 'table5', '5A')?.taxable) + n(r9(g9, 'table5', '5B')?.taxable));
  const rcm = round2(n(r9(g9, 'table5', '5C')?.taxable));
  const t7E = round2(t5O - exempt - zero - rcm);
  // Taxable turnover in GSTR-9: 4N without inward reverse-charge supplies (4G is tax on purchases, not turnover).
  const t7F = round2(n(r9(g9, 'table4', '4N')?.taxable) - n(r9(g9, 'table4', '4G')?.taxable));
  const t7G = round2(t7E - t7F);
  const table7: Gstr9cLine[] = [
    { id: '7A', label: 'Annual turnover after adjustments (5O)', amount: t5O },
    { id: '7B', label: 'Value of exempted, nil rated, non-GST and no-supply turnover (GSTR-9 5D–5F)', amount: exempt },
    { id: '7C', label: 'Zero rated supplies without payment of tax (GSTR-9 5A + 5B)', amount: zero },
    { id: '7D', label: 'Supplies on which tax is paid by the recipient on reverse charge (GSTR-9 5C)', amount: rcm },
    { id: '7E', label: 'Taxable turnover as per adjustments (A − B − C − D)', amount: t7E, total: true },
    { id: '7F', label: 'Taxable turnover as per GSTR-9 (4N less 4G)', amount: t7F },
    { id: '7G', label: 'Unreconciled taxable turnover (E − F)', amount: t7G, total: true },
  ];

  /* Table 9 — tax paid by head */
  const paid = (id: string) => g9.table9.find((r) => r.id === id)?.payable ?? 0;
  const table9: Gstr9cHeadRow[] = (
    [
      ['IGST', n(books.tax.igst), paid('9-IGST')],
      ['CGST', n(books.tax.cgst), paid('9-CGST')],
      ['SGST', n(books.tax.sgst), paid('9-SGST')],
      ['Cess', n(books.tax.cess), paid('9-CESS')],
    ] as const
  ).map(([head, b, r]) => ({ head, books: round2(b), returns: round2(r), diff: round2(b - r) }));

  /* Table 12 — ITC */
  const t12A = round2(n(books.itc));
  const t12N = round2(n(books.notesItc));
  const t12D = round2(t12A - t12N + n(adj.itcEarlierFy) - n(adj.itcLaterFy));
  const t7J = g9.table7.find((r) => r.id === '7J');
  const t12E = round2(heads(t7J));
  const table12: Gstr9cLine[] = [
    { id: '12A', label: 'ITC availed as per audited financial statements', amount: t12A },
    ...(books.notesItc !== undefined ? [{ id: '12A-N', label: 'ITC reversed by supplier notes / purchase returns of the FY (−)', amount: t12N }] : []),
    { id: '12B', label: 'ITC booked in earlier FYs claimed in this FY (+)', amount: round2(n(adj.itcEarlierFy)) },
    { id: '12C', label: 'ITC booked in this FY to be claimed in later FYs (−)', amount: round2(n(adj.itcLaterFy)) },
    { id: '12D', label: 'ITC availed as per books after adjustments', amount: t12D, total: true },
    { id: '12E', label: 'ITC claimed in GSTR-9 (Table 7J)', amount: t12E },
    { id: '12F', label: 'Unreconciled ITC (D − E)', amount: round2(t12D - t12E), total: true },
  ];

  return {
    fyLabel: g9.fyLabel,
    table5,
    table7,
    table9,
    table12,
    unreconciled: {
      turnover: t5Q,
      taxable: t7G,
      tax: round2(table9.reduce((s, r) => s + r.diff, 0)),
      itc: round2(t12D - t12E),
    },
    required: g9.turnover.used > GSTR9C_THRESHOLD,
  };
}
