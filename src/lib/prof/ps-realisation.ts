/**
 * PS-A4 realisation, per period and by timekeeper / partner / client / matter / work type. Definitions (printed under
 * the table, because vendors define realisation two ways):
 *  - worked = standard value of billable time dated in the period;
 *  - billed = what fee notes issued in the period billed for their time (fee lines spread by standard value);
 *  - billing realisation = billed ÷ standard of the time those notes billed — WIP written off in the period counts as
 *    standard billed at 0;
 *  - collected = billed × the note's collected share (receipts + TDS deducted, less credit notes, ÷ total);
 *  - collection realisation = collected ÷ billed; overall = collected ÷ standard.
 * Volume: only entries billed by the period's notes, dated in the period or written off in it are read (`read`), never
 * the whole table — a 25-person firm logs ≈ 40,000 entries a year. Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { TimeEntry, TimePrefs } from '../../types/time';
import type { CostCentre } from '../cost-centres';
import { num, round2 } from '../invoice-calc';
import { docBilling } from './ps-writedown';
import { entryStandard } from './ps-staff';

export type RealDim = 'staff' | 'partner' | 'client' | 'matter' | 'work_type';

export interface RealRow { key: string; worked: number; standard: number; billed: number; collected: number; billing: number | null; collection: number | null; overall: number | null }

const ratio = (a: number, b: number): number | null => (b > 0 ? round2((a / b) * 100) : null);

/** Collected share of a note: (paid + TDS deducted, capped at the total less credit notes) ÷ total. */
export function collectedShare(inv: Pick<InvoiceRecord, 'total' | 'amount_paid' | 'tds_amount'>, credited = 0): number {
  const total = num(inv.total);
  if (total <= 0) return 0;
  return Math.max(Math.min(num(inv.amount_paid) + num(inv.tds_amount), total - credited), 0) / total;
}

export interface RealInput {
  from: string;
  to: string;
  by: RealDim;
  prefs: TimePrefs;
  /** Live fee notes (non-cancelled invoices). */
  invoices: readonly InvoiceRecord[];
  /** Entry lookup by id (the stored table); only the ids needed are touched. */
  entryById: (id: string) => TimeEntry | undefined;
  /** Entries dated in the period, and entries written off in it (from the caller's date index). */
  dated: readonly TimeEntry[];
  writtenOff: readonly TimeEntry[];
  centres: readonly CostCentre[];
  /** Credit notes against a note (total, rupees). */
  credited?: (invoiceId: string) => number;
  clientName?: (id: string) => string;
}

export function realisation(i: RealInput): { rows: RealRow[]; total: RealRow; read: number } {
  const centre = new Map(i.centres.map((c) => [c.id, c]));
  const keyOf = (e: TimeEntry): string => {
    switch (i.by) {
      case 'staff': return e.staff_id ?? '';
      case 'partner': return (e.cost_centre_id && centre.get(e.cost_centre_id)?.ps?.responsible_id) || '';
      case 'matter': return e.cost_centre_id ?? '';
      case 'work_type': return e.work_type_id ?? '';
      default: return e.client_id || e.client_name || '';
    }
  };
  const map = new Map<string, RealRow>();
  const row = (k: string) => {
    const r = map.get(k) ?? { key: k, worked: 0, standard: 0, billed: 0, collected: 0, billing: null, collection: null, overall: null };
    map.set(k, r);
    return r;
  };
  const read = new Set<string>();
  for (const inv of i.invoices) {
    if (inv.issue_date < i.from || inv.issue_date > i.to) continue;
    const refs = (inv.items ?? []).flatMap((it) => it.bill_refs ?? []);
    const ents = new Map<string, TimeEntry>();
    for (const r of refs) {
      const e = i.entryById(r);
      if (e) { ents.set(r, e); read.add(r); }
    }
    const b = docBilling(inv, ents, i.prefs);
    if (!b) continue;
    const share = collectedShare(inv, i.credited?.(inv.id) ?? 0);
    for (const s of b.entries) {
      const r = row(keyOf(ents.get(s.id)!));
      r.standard += s.standard;
      r.billed += s.billed;
      r.collected += s.billed * share;
    }
  }
  for (const e of i.writtenOff) {
    if (!e.ps?.wo || e.ps.wo.date < i.from || e.ps.wo.date > i.to) continue;
    read.add(e.id);
    row(keyOf(e)).standard += entryStandard(e, i.prefs);
  }
  for (const e of i.dated) {
    if (e.date < i.from || e.date > i.to) continue;
    read.add(e.id);
    row(keyOf(e)).worked += entryStandard(e, i.prefs);
  }
  const fin = (r: RealRow): RealRow => {
    const x = { ...r, worked: round2(r.worked), standard: round2(r.standard), billed: round2(r.billed), collected: round2(r.collected) };
    return { ...x, billing: ratio(x.billed, x.standard), collection: ratio(x.collected, x.billed), overall: ratio(x.collected, x.standard) };
  };
  const rows = [...map.values()].map(fin).sort((a, b) => b.standard - a.standard);
  const total = fin(rows.reduce((t, r) => ({ ...t, worked: t.worked + r.worked, standard: t.standard + r.standard, billed: t.billed + r.billed, collected: t.collected + r.collected }), { key: '', worked: 0, standard: 0, billed: 0, collected: 0, billing: null, collection: null, overall: null } as RealRow));
  return { rows, total, read: read.size };
}

/** A client's (or engagement's) billing realisation over the notes given (the year-end paper's expected write-down). */
export function billingRealisation(invoices: readonly InvoiceRecord[], entryById: (id: string) => TimeEntry | undefined, prefs: TimePrefs): number | null {
  let std = 0;
  let billed = 0;
  for (const inv of invoices) {
    const ents = new Map<string, TimeEntry>();
    for (const r of (inv.items ?? []).flatMap((it) => it.bill_refs ?? [])) { const e = entryById(r); if (e) ents.set(r, e); }
    const b = docBilling(inv, ents, prefs);
    if (b) { std += b.standard; billed += b.billed; }
  }
  return std > 0 ? billed / std : null;
}
