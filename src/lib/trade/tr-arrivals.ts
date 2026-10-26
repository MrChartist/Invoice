/**
 * TR-C1 commission-agent desk: arrivals (lots of a principal's goods) and the agency sales that sell them.
 *
 *  - An arrival (`arrivals`, `ARR/FY…`) records a farmer's / trader's goods received for sale on their behalf (kachi
 *    aadat). The goods sit in a godown of kind `consignment` (created on first use): non-saleable for our own sales,
 *    saleable only on agency lines. They are the principal's, so they never enter our stock valuation — the stock
 *    engine skips lines that name an arrival (`arrival_id`), and the lot balance is derived here.
 *  - An agency sale is an ordinary invoice in our name (Schedule I para 3 agent, TR10) marked `agency: true`, whose
 *    lines carry `arrival_id`. It posts as Sales; the bikri patti (`tr-patti.ts`) later moves the gross to the principal.
 *  - An advance paid on arrival posts a payment voucher (Dr Sundry creditors — principal, Cr cash / bank).
 * Guards: role (`doc.create`; the advance voucher needs `books.edit`), period lock, series counter, audit (watched
 * table). A cancelled arrival keeps its number. Working paper — verify with your CA (TR9, TR10).
 */
import './tr-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { Godown } from '../../types/stock';
import type { Arrival, PrincipalKind } from '../../types/trade-r8';
import { calcInputFromRecord, calculateInvoice, isExcludedLine, num, round2 } from '../invoice-calc';
import { inrTotals } from '../fx';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { GODOWNS_TABLE, godownsDb } from '../godowns';
import { A } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { TR_SERIES, TR_TABLES } from './tr-shared';

export const ARRIVALS_TABLE = TR_TABLES.arrivals;
export const CONSIGNMENT_GODOWN_NAME = 'Agency (principals’ goods)';
export const PRINCIPAL_KINDS: readonly PrincipalKind[] = ['agriculturist', 'registered', 'unregistered'];

export class AgencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgencyError';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

export const loadArrivals = (): readonly Arrival[] => peekTable<Arrival>(ARRIVALS_TABLE).filter((r) => r && typeof r.id === 'string');

/* ── Pure ─────────────────────────────────────────────────────── */

/** One agency line of a live sales document (credit notes that return goods count back, negative). */
export interface AgencySaleLine {
  invoice_id: string;
  invoice_number: string;
  date: string;
  arrival_id: string;
  qty: number;
  /** Taxable value of the line (after the line discount; GST is the agent's own liability, not the principal's). */
  amount: number;
}

const SALE_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

type AgencySource = Pick<InvoiceRecord, 'id' | 'invoice_number' | 'issue_date' | 'doc_type' | 'status' | 'items' | 'goods_returned'> & Partial<InvoiceRecord>;

/**
 * Agency lines of issued sales documents (drafts and cancelled documents never count). Each line is valued at its
 * taxable value as the invoice engine computes it (QA8 T1): after the line and the document-level discount, net of
 * GST on tax-inclusive prices, in rupees for a foreign-currency document.
 */
export function agencySales(invoices: readonly AgencySource[]): AgencySaleLine[] {
  const out: AgencySaleLine[] = [];
  for (const inv of invoices) {
    if (!inv || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const type = inv.doc_type ?? 'INVOICE';
    const sign = SALE_DOCS.has(type) ? 1 : type === 'CREDIT_NOTE' && inv.goods_returned !== false ? -1 : 0;
    if (!sign || !(inv.items ?? []).some((l) => l?.arrival_id)) continue;
    const priced = (inv.items ?? []).filter((l) => l && !isExcludedLine(l));
    const calc = inrTotals(calculateInvoice(calcInputFromRecord({ ...inv, items: priced })), inv);
    priced.forEach((l, i) => {
      if (!l.arrival_id) return;
      const qty = num(l.quantity);
      const amount = calc.lines[i]?.taxable ?? 0;
      out.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, date: String(inv.issue_date).slice(0, 10), arrival_id: l.arrival_id, qty: roundQty(sign * qty), amount: round2(sign * amount) });
    });
  }
  return out;
}

export interface LotBalance {
  arrival: Arrival;
  sold: number;
  amount: number;
  balance: number;
}

/** Each lot: quantity sold on agency lines (up to `asOf`), its value and the balance still held. */
export function lotBalances(arrivals: readonly Arrival[], sales: readonly AgencySaleLine[], asOf?: string): LotBalance[] {
  return arrivals.map((a) => {
    const mine = sales.filter((s) => s.arrival_id === a.id && (!asOf || s.date <= asOf));
    const sold = roundQty(mine.reduce((t, s) => t + s.qty, 0));
    return { arrival: a, sold, amount: round2(mine.reduce((t, s) => t + s.amount, 0)), balance: roundQty(num(a.qty) - sold) };
  });
}

/** An agency line selling more than its lot holds (beyond what other documents already sold). '' when fine. */
export function lotShortage(arrival: Arrival | undefined, otherSales: readonly AgencySaleLine[], qty: number): string {
  if (!arrival) return 'The lot no longer exists.';
  if (arrival.status === 'cancelled') return `Lot ${arrival.lot_no} (${arrival.number}) is cancelled.`;
  const sold = otherSales.filter((s) => s.arrival_id === arrival.id).reduce((t, s) => t + s.qty, 0);
  const left = roundQty(num(arrival.qty) - sold);
  return qty > left + 1e-9 ? `Lot ${arrival.lot_no}: only ${left} ${arrival.unit} left to sell.` : '';
}

export interface ArrivalInput extends Omit<Arrival, 'id' | 'number' | 'godown_id' | 'status' | 'created_at' | 'updated_at' | 'advance_voucher_id'> {
  id?: string;
  godown_id?: string;
}

export function validateArrival(a: ArrivalInput): string {
  if (!ISO.test(a.date ?? '')) return 'Choose the arrival date.';
  if (!a.principal_id || !String(a.principal_name ?? '').trim()) return 'Choose the principal (farmer / trader) from Suppliers.';
  if (!String(a.lot_no ?? '').trim()) return 'Enter the lot number.';
  if (!String(a.item_name ?? '').trim()) return 'Enter the item.';
  if (!String(a.unit ?? '').trim()) return 'Enter the unit the lot is sold in.';
  if (!(num(a.qty) > 0)) return 'Enter the net quantity.';
  if (num(a.packages) < 0 || num(a.advance) < 0) return 'Packages and advance cannot be negative.';
  if (a.principal_kind && !PRINCIPAL_KINDS.includes(a.principal_kind)) return 'Choose what the principal is.';
  return '';
}

/* ── Storage ──────────────────────────────────────────────────── */

/** The consignment godown (kind `consignment`), created on first use. */
export function ensureConsignmentGodown(): string {
  const found = getTable<Godown>(GODOWNS_TABLE).find((g) => g.kind === 'consignment');
  if (found) return found.id;
  return godownsDb.save({ name: CONSIGNMENT_GODOWN_NAME, kind: 'consignment' }).id;
}

const lockOf = (r: Pick<Arrival, 'id' | 'date' | 'number'>) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

/** Create or edit an arrival. The advance voucher is posted once, on create (cancel and re-enter to change it). */
export function saveArrival(input: ArrivalInput): Arrival {
  requireAccess('doc.create');
  const err = validateArrival(input);
  if (err) throw new AgencyError(err);
  const all = getTable<Arrival>(ARRIVALS_TABLE);
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  if (prev?.status === 'cancelled') throw new AgencyError(`Arrival ${prev.number} is cancelled.`);
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  if (prev && round2(num(prev.advance)) !== round2(num(input.advance))) throw new AgencyError('The advance is posted: cancel the arrival and enter it again to change it.');
  const id = prev?.id ?? generateId();
  const number = prev?.number ?? nextSeriesNumberFor(TR_SERIES.arrivals, input.date, all.map((r) => r.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, prev ? 'edit' : 'create');
  const advance = round2(num(input.advance));
  return withTablesRollback([ARRIVALS_TABLE, GODOWNS_TABLE, 'vouchers', 'series_counters'], () => {
    const godown_id = input.godown_id || prev?.godown_id || ensureConsignmentGodown();
    let advance_voucher_id = prev?.advance_voucher_id;
    if (!prev && advance > 0) {
      const v = saveVoucher({
        type: 'PAYMENT',
        date: input.date,
        narration: `Advance to ${input.principal_name.trim()} on arrival ${number} (lot ${input.lot_no.trim()})`,
        lines: [
          { account_id: A.creditors, dr: Math.round(advance * 100), cr: 0, party: input.principal_name.trim() },
          { account_id: input.advance_account_id || A.cash, dr: 0, cr: Math.round(advance * 100) },
        ],
        voucher_class: 'Arrival advance',
      });
      advance_voucher_id = v.id;
    }
    const now = new Date().toISOString();
    const row: Arrival = {
      ...prev,
      ...input,
      id,
      number,
      principal_name: input.principal_name.trim(),
      lot_no: input.lot_no.trim(),
      item_name: input.item_name.trim(),
      unit: input.unit.trim().toUpperCase(),
      packages: Math.max(0, Math.round(num(input.packages))),
      qty: roundQty(num(input.qty)),
      godown_id,
      ...(advance > 0 ? { advance } : { advance: undefined }),
      ...(advance_voucher_id ? { advance_voucher_id } : {}),
      status: 'open',
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    setTable(ARRIVALS_TABLE, prev ? all.map((r) => (r.id === id ? row : r)) : [...all, row]);
    recordSeries(number);
    return row;
  });
}

/** Cancel an arrival (its number stays used). Refused while any issued agency line sells it; the advance voucher goes. */
export function cancelArrival(id: string, reason: string, invoices: Parameters<typeof agencySales>[0]): Arrival {
  requireAccess('doc.create');
  if (!reason.trim()) throw new AgencyError('Give the reason for cancelling.');
  const all = getTable<Arrival>(ARRIVALS_TABLE);
  const r = all.find((x) => x.id === id);
  if (!r) throw new AgencyError('Arrival not found.');
  if (r.status === 'cancelled') return r;
  assertUnlocked(lockOf(r), 'cancel');
  if (agencySales(invoices).some((s) => s.arrival_id === id)) throw new AgencyError(`Lot ${r.lot_no} has agency sales: cancel those documents first.`);
  return withTablesRollback([ARRIVALS_TABLE, 'vouchers'], () => {
    if (r.advance_voucher_id) deleteVoucher(r.advance_voucher_id);
    const next: Arrival = { ...r, status: 'cancelled', cancel_reason: reason.trim(), advance_voucher_id: undefined, updated_at: new Date().toISOString() };
    setTable(ARRIVALS_TABLE, all.map((x) => (x.id === id ? next : x)));
    return next;
  });
}
