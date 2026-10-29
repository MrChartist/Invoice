/**
 * AG-D1 gate pass out (`GPO/FY…`, stored on the lot's `outs`): refuses more bags than the lot's balance; an open loan
 * with a lien on the lot (D3) blocks the pass unless the loan is cleared, the bags left still cover it at the release
 * LTV (setting), or the owner overrides with a reason (audited); unpaid rent bills of the lot warn. With the plan billing
 * at release (default) the rent bill for the bags released is raised as a draft (`ag-cold-rent.ts`). The pass prints with
 * the balance bags. Pure above "Storage".
 */
import './ag-registry';
import type { AgriLoan, ColdGateOut, ColdLot } from '../../types/agri-r12d';
import type { InvoiceRecord } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { can, requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { audit } from '../audit';
import { AG_SERIES } from './ag-shared';
import { LOTS_TABLE, bagsOut, depositorLots, loadLots, lotBalance, lotStatus, q3, smallPaper, writeLots } from './ag-cold-lots';
import { liensOn, loadLoans, loanState, releaseCovered } from './ag-loans';
import { loadPlans, raiseRentBill } from './ag-cold-rent';
import { localDb } from '../localDb';
import { readAgriSettings } from './ag-settings';

const liveInvoices = () => localDb.invoices.getAll();
const readLtv = () => readAgriSettings().cold?.release_ltv_pct;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface PassCheck {
  errors: string[];
  warnings: string[];
  /** Loans whose lien blocks this release (an owner may override with a reason). */
  liens: AgriLoan[];
}

/** Pure: may `bags` leave the lot on `date`? */
export function checkGatePass(lot: ColdLot, bags: number, date: string, ctx: { loans: readonly AgriLoan[]; lots: readonly ColdLot[]; invoices: readonly InvoiceRecord[]; releaseLtv?: number }): PassCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bal = lotBalance(lot);
  if (!DAY.test(date)) errors.push('Choose the gate pass date.');
  else if (date < lot.date_in) errors.push('The gate pass is before the date in.');
  if (!(q3(bags) > 0)) errors.push('Enter the bags going out.');
  else if (q3(bags) > bal) errors.push(`Only ${bal} bags are in lot ${lot.number}.`);
  const liens = liensOn(lot.id, ctx.loans, date).filter((l) => !releaseCovered(l, ctx.lots, lot.id, bags, date, ctx.releaseLtv));
  for (const l of liens) errors.push(`Loan ${l.number} has a lien on this lot: ₹${loanState(l, date).total.toFixed(2)} due, clear it first, or the owner may override with a reason.`);
  const unpaid = ctx.invoices.filter((i) => i?.ag?.rent?.lot_id === lot.id && i.status !== 'Draft' && i.status !== 'Cancelled' && num(i.balance_due) > 0.005);
  if (unpaid.length) warnings.push(`Rent due on ${unpaid.map((i) => i.invoice_number).join(', ')}: ₹${unpaid.reduce((s, i) => s + num(i.balance_due), 0).toFixed(2)}.`);
  return { errors, warnings, liens };
}

/** The gate pass paper with the balance bags. */
export function gatePassHtml(lot: ColdLot, out: ColdGateOut, company: string): string {
  const upTo = lot.outs.slice(0, lot.outs.findIndex((o) => o.id === out.id) + 1).reduce((s, o) => s + num(o.bags), 0) + (lot.transfers ?? []).filter((t) => t.date <= out.date).reduce((s, t) => s + num(t.bags), 0);
  return smallPaper(`Gate pass ${out.number}`, company, [
    ['Lot / receipt', lot.number], ['Depositor', lot.depositor_name], ['Commodity', [lot.commodity, lot.variety].filter(Boolean).join(', ')], ['Date', out.date],
    ['Bags released', out.bags], ['Weight (kg)', out.weight_kg ?? ''], ['Balance bags', q3(num(lot.bags) - upTo)], ['To / vehicle', [out.to, out.vehicle].filter(Boolean).join(' · ')],
    ['Taken by', out.by ?? ''], ['Loan check', out.loan_check === 'override' ? `Overridden: ${out.override_reason}` : 'Clear'],
  ], 'Goods released against this pass only.');
}

/** Pure: a depositor's statement on `day` — lots (bags in / out / balance), rent billed and due (issued bills), open loans with what is due. */
export function depositorStatement(lots: readonly ColdLot[], invoices: readonly InvoiceRecord[], loans: readonly AgriLoan[], id: string, day: string) {
  const bills = invoices.filter((i) => i?.ag?.rent && i.client?.id === id && i.status !== 'Cancelled');
  const open = loans.filter((l) => l.borrower_id === id && l.status !== 'closed').map((loan) => ({ loan, due: loanState(loan, day).total }));
  return {
    ...depositorLots(lots, id), loans: open, loansDue: round2(open.reduce((s, x) => s + x.due, 0)),
    billed: round2(bills.reduce((s, i) => s + num(i.total), 0)), due: round2(bills.filter((i) => i.status !== 'Draft').reduce((s, i) => s + num(i.balance_due), 0)),
  };
}

/** The depositor statement paper (A5): one row per lot, then rent and each open loan. */
export function statementHtml(st: ReturnType<typeof depositorStatement>, name: string, company: string, day: string): string {
  return smallPaper(`Depositor statement: ${name}`, `${company} · as at ${day}`, [
    ...st.lots.map((l): [string, unknown] => [`${l.number} · ${l.commodity}`, `in ${l.bags} · out ${bagsOut(l)} · balance ${lotBalance(l)} bags`]),
    ['Total bags', `in ${st.in} · out ${st.out} · balance ${st.balance}`], ['Rent billed / due', `₹${st.billed.toFixed(2)} / ₹${st.due.toFixed(2)}`],
    ...st.loans.map((x): [string, unknown] => [`Loan ${x.loan.number}`, `₹${x.due.toFixed(2)} due (principal + interest)`]),
  ], 'Goods held in custody for the depositor: never our stock. Working paper; verify with your CA.');
}

/* ── Storage ── */

export interface PassInput {
  date: string;
  bags: number;
  weight_kg?: number;
  to?: string;
  vehicle?: string;
  by?: string;
  /** Owner only: release over a lien with this reason (audited). */
  override_reason?: string;
  /** Raise the rent bill for the released bags when the plan bills at release (default true). */
  bill?: boolean;
}

/**
 * Issue a gate pass. Returns the lot, the pass and the draft rent bill (when one was raised). The rent bill is made
 * in the same step (all or nothing).
 */
export function issueGatePass(lotId: string, p: PassInput, chamber?: string): { lot: ColdLot; out: ColdGateOut; bill?: InvoiceRecord; warnings: string[] } {
  requireAccess('doc.create');
  const lots = loadLots();
  const lot = lots.find((l) => l.id === lotId);
  if (!lot) throw new Error('Lot not found.');
  const check = checkGatePass(lot, p.bags, p.date, { loans: loadLoans(), lots, invoices: liveInvoices(), releaseLtv: readLtv() });
  const reason = p.override_reason?.trim();
  const blockers = check.errors.filter((e) => !(reason && check.liens.length && / has a lien /.test(e)));
  if (blockers.length) throw new Error(blockers[0]);
  if (reason && check.liens.length && !can('settings.manage')) throw new Error('Only the owner may release goods over a lien.');
  const number = nextSeriesNumberFor(AG_SERIES.gpo, p.date, lots.flatMap((l) => l.outs.map((o) => o.number)));
  assertUnlocked({ issue_date: p.date, invoice_number: number }, 'create');
  const out: ColdGateOut = {
    id: generateId(), number, date: p.date, bags: q3(p.bags), loan_check: check.liens.length ? 'override' : 'clear',
    ...(num(p.weight_kg) > 0 ? { weight_kg: q3(p.weight_kg) } : {}), ...(p.to?.trim() ? { to: p.to.trim() } : {}), ...(p.vehicle?.trim() ? { vehicle: p.vehicle.trim() } : {}), ...(p.by?.trim() ? { by: p.by.trim() } : {}),
    ...(check.liens.length ? { override_reason: reason } : {}),
  };
  const next: ColdLot = { ...lot, outs: [...lot.outs, out], updated_at: new Date().toISOString() };
  next.status = lotStatus(next);
  return withTablesRollback([LOTS_TABLE, 'series_counters', 'invoices', 'clients', 'items_catalog'], () => {
    writeLots(lots.map((l) => (l.id === lotId ? next : l)));
    recordSeries(number);
    if (check.liens.length) {
      try {
        audit.record({ entity: 'invoice', entity_id: lot.id, action: 'update', summary: `Gate pass ${number} released ${out.bags} bags of ${lot.number} over the lien of ${check.liens.map((l) => l.number).join(', ')}: ${reason}` });
      } catch {
        /* logging never blocks */
      }
    }
    let bill: InvoiceRecord | undefined;
    const plan = loadPlans().find((x) => x.id === lot.rent_plan_id);
    if (p.bill !== false && plan && plan.bill_at === 'out') {
      try {
        bill = raiseRentBill(next, { kind: 'out', out }, chamber);
      } catch (e) {
        if (!/Nothing to bill/.test((e as Error).message)) throw e;
      }
    }
    return { lot: next, out, ...(bill ? { bill } : {}), warnings: check.warnings };
  });
}

/** Undo the lot's latest gate pass (its rent bill, if any, is left for the user to delete). */
export function undoGatePass(lotId: string): ColdLot {
  requireAccess('doc.create');
  const lots = loadLots();
  const lot = lots.find((l) => l.id === lotId);
  const last = lot?.outs[lot.outs.length - 1];
  if (!lot || !last) throw new Error('No gate pass to undo.');
  assertUnlocked({ issue_date: last.date, invoice_number: last.number }, 'delete');
  // QA13 G12: its rent bill goes first (else a gate pass issued again bills the release a second time).
  const bill = liveInvoices().find((i) => i?.ag?.rent?.out_id === last.id && i.status !== 'Cancelled');
  if (bill) throw new Error(`Rent bill ${bill.invoice_number || '(draft)'} bills this gate pass: delete or cancel it first.`);
  const next: ColdLot = { ...lot, outs: lot.outs.slice(0, -1) };
  next.status = lotStatus(next);
  writeLots(lots.map((l) => (l.id === lotId ? next : l)));
  return next;
}
