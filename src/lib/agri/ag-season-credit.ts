/**
 * AG-D4 credit till harvest: a dealer's credit sale takes a season due date (`agri_settings.seasons`: Kharif, Rabi,
 * Zaid or custom, each `YYYY-MM-DD` or `MM-DD` = the next one on / after the sale) instead of credit days. The bill
 * snapshots `ag.inputs.season` / `season_due` and its due date; interest after the due date comes from the existing
 * interest notes (`tr-interest.ts` starts a season bill's interest at its season due date, whatever the basis;
 * AG32: interest follows each bill's line rates). The khata shows "due at harvest". Pure.
 */
import type { AgriSeason } from '../../types/agri-r12d';
import type { AgInputsSnap } from '../../types/agri-r12';
import type { InvoiceRecord } from '../../types/invoice';
import { num } from '../invoice-calc';

export const DEFAULT_SEASONS: readonly AgriSeason[] = [{ name: 'Kharif', due: '11-15' }, { name: 'Rabi', due: '04-30' }, { name: 'Zaid', due: '07-15' }];

/** The due date of season `name` for a sale on `saleDate` ('' when the season is unknown). */
export function seasonDue(seasons: readonly AgriSeason[] | undefined, name: string, saleDate: string): string {
  const s = (seasons?.length ? seasons : DEFAULT_SEASONS).find((x) => x.name === name);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.due)) return s.due;
  if (!/^\d{2}-\d{2}$/.test(s.due)) return '';
  const d = `${saleDate.slice(0, 4)}-${s.due}`;
  return d >= saleDate ? d : `${+saleDate.slice(0, 4) + 1}-${s.due}`;
}

/** The record fields a season credit sale carries: due date + the `ag.inputs` season snapshot (merged with any PoS fields). */
export function withSeason<T extends Pick<InvoiceRecord, 'issue_date' | 'due_date'> & { ag?: InvoiceRecord['ag'] }>(doc: T, seasons: readonly AgriSeason[] | undefined, name: string): T {
  const due = seasonDue(seasons, name, doc.issue_date);
  if (!due) return doc;
  const inputs: AgInputsSnap = { ...(doc.ag?.inputs ?? {}), season: name, season_due: due };
  return { ...doc, due_date: due, ag: { ...(doc.ag ?? { kind: 'inputs' }), kind: doc.ag?.kind ?? 'inputs', inputs } };
}

export interface SeasonCreditRow { invoice: InvoiceRecord; season: string; due: string; balance: number; overdueDays: number }

/** Open season-credit bills (issued, balance due), oldest due first, with days past the season due date. */
export function seasonCredit(invoices: readonly InvoiceRecord[], today: string): SeasonCreditRow[] {
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  return invoices
    .filter((i) => i?.ag?.inputs?.season_due && i.status !== 'Draft' && i.status !== 'Cancelled' && num(i.balance_due) > 0.005)
    .map((i) => ({ invoice: i, season: i.ag!.inputs!.season ?? '', due: i.ag!.inputs!.season_due!, balance: num(i.balance_due), overdueDays: Math.max(day(today) - day(i.ag!.inputs!.season_due!), 0) }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

/** The interest start of a bill: its season due date when it has one (one branch in `tr-interest.ts`). */
export const seasonStart = (inv: { ag?: { inputs?: AgInputsSnap } } | undefined): string | undefined => inv?.ag?.inputs?.season_due || undefined;
