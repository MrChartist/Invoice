/**
 * R18-C1 / C3 dues of a unit (pure; family `f-society`): what each of its live society bills still owes on a day —
 * receipts and credit notes reduce it from their date, the interest line first (receipts settle interest first, HS37),
 * then the interest-bearing principal, then the pass-through dues — and simple interest on the open principal
 * (`computeInterest`'s balance segments, passed in by the bridge; 365 days) from the day after the due date (+ grace)
 * at `min(society rate, State cap on that day)`: a cap change splits the period by day (MH 21 % → 12 % from
 * 2026-06-22, HS26). Never on interest (HS38) and never on pass-through (`rule33`) lines (HS6). Days up to the
 * `hs.interest.through` of a live bill were charged already and are never charged again. Working papers — verify
 * with your CA.
 */
import { round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { stateRuleAt } from '../society-rules';
import type { InterestInput, InterestResult, LateFeeConfig } from '../interest';
import type { InvoiceRecord } from '../../types/invoice';
import type { HsSnapshot, SocietySettings } from '../../types/society-r18';

export type Ev = { date: string; amount: number };
export type InterestFn = (i: InterestInput, c: LateFeeConfig, asOf: string) => InterestResult;
/** The live society bills of each unit (oldest first) and what reduced each bill (receipts, credit notes). */
export interface DuesIndex { bills: Map<string, InvoiceRecord[]>; events: Map<string, Ev[]> }

/** Index once per read (pure): `links` are `doc_links` rows; credit notes count from their date. */
export function duesIndex(invoices: readonly InvoiceRecord[], payments: readonly { invoice_id?: string; date?: string; amount: number }[], links: readonly { from_id: string; to_id: string; relation: string }[]): DuesIndex {
  const bills = new Map<string, InvoiceRecord[]>(), events = new Map<string, Ev[]>(), byId = new Map(invoices.map((i) => [i.id, i]));
  const add = (id: string | undefined, date: string | undefined, amount: number) => { if (id && date && amount > 0) events.set(id, [...(events.get(id) ?? []), { date: date.slice(0, 10), amount }]); };
  for (const i of invoices) if (i.hs?.unit && i.status !== 'Cancelled' && i.status !== 'Draft' && i.doc_type !== 'CREDIT_NOTE' && i.doc_type !== 'DEBIT_NOTE') bills.set(i.hs.unit.id, [...(bills.get(i.hs.unit.id) ?? []), i]);
  for (const b of bills.values()) b.sort((x, y) => x.issue_date.localeCompare(y.issue_date));
  for (const p of payments) add(p.invoice_id, p.date, p.amount);
  for (const l of links) { const n = byId.get(l.to_id); if (l.relation === 'credit_note' && n?.status !== 'Cancelled' && n?.status !== 'Draft') add(l.from_id, n?.issue_date, n?.total ?? 0); }
  return { bills, events };
}

export interface BillDue { bill: InvoiceRecord; open: number; interest: number; base: number; baseEvents: Ev[] }

/** One bill on `asOf`: open total, open interest part, open interest-bearing principal, and the events that reduced that principal. */
export function billDue(bill: InvoiceRecord, events: readonly Ev[] = [], asOf: string): BillDue {
  const line = bill.items.find((l) => l.id === bill.hs?.heads?.find((h) => h.head_id === 'interest')?.line_id);
  let int = line ? round2(line.amount * (1 + (line.tax_rate || 0) / 100)) : 0;
  const pass = bill.items.reduce((t, l) => t + (l.charge_head_id === 'rule33' ? l.amount : 0), 0);
  let base = round2(bill.total - pass - int), open = bill.total;
  const baseEvents: Ev[] = [];
  for (const e of [...events].filter((x) => x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))) {
    const i = Math.min(e.amount, int), b = Math.min(e.amount - i, base);
    int = round2(int - i);
    base = round2(base - b);
    open = round2(open - e.amount);
    if (b > 0) baseEvents.push({ date: e.date, amount: b });
  }
  return { bill, open: Math.max(0, open), interest: int, base: Math.max(0, base), baseEvents };
}

/** The interest rate on a day: the society's rate capped by the State row (a cap alone applies when no rate is set). */
export function rateOn(s: SocietySettings, day: string): number {
  const cap = stateRuleAt(s.state, day, s.confirmed)?.value.interest_cap_pct ?? null, pct = s.interest?.pct;
  return pct == null ? cap ?? 0 : cap == null ? pct : Math.min(pct, cap);
}

export interface UnitDues { arrears: number; interest: number; on: number; from: string; to: string; pct: number; bills: BillDue[] }

/**
 * A unit's dues on `asOf` (inclusive): open bills dated up to it, and interest not yet charged up to it. `owner` (QA21
 * W3): only that member's bills — after a transfer the outgoing member's bills stay his receivable and never bring
 * arrears or interest onto the incoming member's bill, receipt split or dues row (a dues certificate reads them all).
 */
export function unitDues(unitId: string, asOf: string, ix: DuesIndex, s: SocietySettings, fn: InterestFn, owner?: string): UnitDues {
  const bills = (ix.bills.get(unitId) ?? []).filter((b) => b.issue_date <= asOf && (!owner || b.client?.id === owner)).map((b) => billDue(b, ix.events.get(b.id), asOf));
  const through = bills.reduce((t, b) => ((b.bill.hs as HsSnapshot).interest?.through ?? '') > t ? b.bill.hs!.interest!.through : t, '');
  const grace = Math.max(0, s.interest?.grace_days ?? 0);
  let exact = 0, on = 0, from = '';
  if (s.interest) for (const d of bills) {
    if (!(d.base > 0) && !d.baseEvents.length) continue;
    const start = s.interest.from === 'bill' ? d.bill.issue_date : d.bill.due_date;
    const base = round2(d.base + d.baseEvents.reduce((t, e) => t + e.amount, 0));
    const r = fn({ doc_type: d.bill.doc_type, status: d.bill.status, due_date: start, total: base, payments: d.baseEvents }, { enabled: true, mode: 'annual', rate: 100, grace_days: grace }, asOf);
    let used = false;
    for (const g of r.segments) for (let day = g.from; day <= g.to; day = shiftDay(day, 1)) {
      if (day <= through) continue;
      exact += (g.balance * rateOn(s, day)) / 36500;
      if (!from || day < from) from = day;
      used = true;
    }
    if (used) on = round2(on + d.base);
  }
  return { arrears: round2(bills.reduce((t, b) => t + b.open, 0)), interest: round2(exact), on, from, to: asOf, pct: rateOn(s, asOf), bills };
}

/** A receipt split over the unit's open bills (pure): interest parts first, oldest first, then the rest oldest first (HS37). */
export function allocate(amount: number, bills: readonly BillDue[], mode: SocietySettings['allocation'] = 'interest_first'): { bill_id: string; amount: number }[] {
  const out = new Map<string, number>();
  let left = round2(amount);
  const take = (b: BillDue, cap: number) => { const a = round2(Math.min(left, cap - (out.get(b.bill.id) ?? 0))); if (a > 0) { out.set(b.bill.id, round2((out.get(b.bill.id) ?? 0) + a)); left = round2(left - a); } };
  if (mode !== 'oldest_first') for (const b of bills) take(b, b.interest);
  for (const b of bills) take(b, b.open);
  return [...out].map(([bill_id, a]) => ({ bill_id, amount: a }));
}

export interface DuesRow { unitId: string; open: number; billed: number; accrued: number; months: number; oldest?: string; first?: InvoiceRecord }

/** Defaulters on `asOf` (C3): open dues, billed interest still open, interest accrued since the last bill, months overdue. */
export function duesRow(unitId: string, asOf: string, ix: DuesIndex, s: SocietySettings, fn: InterestFn, owner?: string): DuesRow {
  const d = unitDues(unitId, asOf, ix, s, fn, owner), late = d.bills.filter((b) => b.open > 0 && b.bill.due_date < asOf);
  const oldest = late[0]?.bill.due_date;
  const months = oldest ? Math.max(0, (+asOf.slice(0, 4) - +oldest.slice(0, 4)) * 12 + +asOf.slice(5, 7) - +oldest.slice(5, 7) + (asOf.slice(8) > oldest.slice(8) ? 1 : 0)) : 0;
  return { unitId, open: d.arrears, billed: round2(d.bills.reduce((t, b) => t + b.interest, 0)), accrued: d.interest, months, ...(oldest ? { oldest } : {}), first: d.bills.find((b) => b.open > 0)?.bill };
}
