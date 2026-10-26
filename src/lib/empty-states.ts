/**
 * R6-B3: when a main screen is "empty" (nothing fills it for the chosen period), so it shows one sentence and the one
 * button that starts it instead of zero-filled tables. Pure; each screen passes what it already loaded.
 */

export interface DayRange {
  start: string;
  end: string;
}

const day = (d: unknown): string => (typeof d === 'string' ? d.slice(0, 10) : '');
const within = (d: unknown, r: DayRange): boolean => {
  const x = day(d);
  return !!x && x >= r.start && x <= r.end;
};

export interface BooksFacts {
  /** Dates of the vouchers Books builds from documents (invoices, receipts, bills …). */
  voucherDates: readonly string[];
  /** Hand-entered ledger vouchers (Gateway / journal). */
  manualVouchers: readonly { date?: string }[];
  /** Cash / bank openings. */
  openings: readonly { amount?: number }[];
  /** Rows of `ledger_openings` and `opening_bills`. */
  ledgerOpenings: number;
  openingBills: number;
}

/** Books: no voucher in the period and no opening balance anywhere. */
export function booksEmpty(f: BooksFacts, period: DayRange): boolean {
  if (f.ledgerOpenings > 0 || f.openingBills > 0) return false;
  if (f.openings.some((o) => Number(o.amount) !== 0 && Number.isFinite(Number(o.amount)))) return false;
  return !f.voucherDates.some((d) => within(d, period)) && !f.manualVouchers.some((v) => within(v.date, period));
}

/** Reports: no sales document dated in the period. */
export const reportsEmpty = (docDates: readonly string[], period: DayRange): boolean => !docDates.some((d) => within(d, period));

export type ExportsState = 'ok' | 'empty' | 'drafts-only';

/**
 * Exports: is there anything to export in the range (open ends allowed)? Drafts count only when the user includes
 * them; a company whose only documents are drafts is told to include them.
 */
export function exportsState(
  invoices: readonly { status?: string; issue_date?: string }[],
  purchases: readonly { date?: string }[],
  range: Partial<DayRange> = {},
  includeDrafts = false,
): ExportsState {
  const inRange = (d: unknown) => {
    const x = day(d);
    return !!x && (!range.start || x >= range.start) && (!range.end || x <= range.end);
  };
  const docs = invoices.filter((i) => inRange(i.issue_date));
  const live = docs.filter((i) => i.status !== 'Draft');
  if (live.length || purchases.some((p) => inRange(p.date)) || (includeDrafts && docs.length)) return 'ok';
  return docs.length ? 'drafts-only' : 'empty';
}

/** Practice desk: only this company on the device. */
export const practiceEmpty = (registrySize: number): boolean => registrySize <= 1;

/** Distribution masters: no area, beat or route yet. */
export const distributionEmpty = (areas: number, beats: number, routes: number): boolean => areas + beats + routes === 0;

/** Bank reconcile: no statement imported. */
export const reconcileEmpty = (statements: number): boolean => statements === 0;
