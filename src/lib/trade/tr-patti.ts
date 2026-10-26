/**
 * TR-C1 bikri patti: the settlement a commission agent gives a principal for the lots sold on their behalf.
 *
 *   gross       = Σ agency lines of the chosen lots not yet on a live patti (taxable value, `tr-arrivals.ts`)
 *   deductions  = aadat % · market fee · hamali / tulai per bag · freight … (rates are the user's — §8 Q6)
 *   net payable = gross − deductions − advances paid on those lots
 *
 * Posting (one `saveVoucher` journal, class "Bikri patti"): Dr "Agency sales transferred" (a Sales-group contra
 * ledger) gross; Cr Sundry creditors (principal) gross − deductions; Cr "Commission (aadat) income" the aadat; Cr each
 * other deduction's ledger (Other income unless a ledger is named). The advance already sits on the principal's
 * ledger (arrival payment voucher), so the principal's balance after posting is the net payable. P&L then shows only
 * the commission and recoveries for settled lots (§8 Q7, TR22). When the aadat is taxable (goods other than
 * agricultural produce, TR9) it is billed on a separate tax invoice and left out of the journal.
 * Guards: `books.edit`, period lock, PAT series counter, audit; cancelling deletes the journal and keeps the number.
 */
import './tr-registry';
import type { Arrival, PattiDeduction, PattiSale, SalePatti } from '../../types/trade-r8';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { AgencyError, type AgencySaleLine } from './tr-arrivals';
import { TR_SERIES, TR_TABLES } from './tr-shared';

export const PATTIS_TABLE = TR_TABLES.pattis;
export const AGENCY_TRANSFER_LEDGER = 'Agency sales transferred to principals';
export const AADAT_LEDGER = 'Commission (aadat) income';

export const loadPattis = (): readonly SalePatti[] => peekTable<SalePatti>(PATTIS_TABLE).filter((r) => r && typeof r.id === 'string');

/** What the user enters for one deduction (the amount follows from the basis unless typed). */
export type DeductionInput = Omit<PattiDeduction, 'amount'> & { amount?: number };

/* ── Pure ─────────────────────────────────────────────────────── */

/** Agency lines already settled on a live (draft or posted) patti. */
export function settledKeys(pattis: readonly SalePatti[], exceptId?: string): Set<string> {
  const out = new Set<string>();
  for (const p of pattis) if (p.status !== 'cancelled' && p.id !== exceptId) for (const s of p.sales) out.add(`${s.invoice_id}|${s.arrival_id}`);
  return out;
}

/** One deduction's amount: % of gross, per bag of the lots, per unit sold, or a fixed ₹. */
export function deductionAmount(d: Pick<DeductionInput, 'basis' | 'rate' | 'amount'>, base: { gross: number; packages: number; qty: number }): number {
  if (d.amount !== undefined && Number.isFinite(d.amount)) return round2(Math.max(num(d.amount), 0));
  const r = Math.max(num(d.rate), 0);
  if (d.basis === 'percent') return round2((base.gross * r) / 100);
  if (d.basis === 'per_package') return round2(base.packages * r);
  if (d.basis === 'per_qty') return round2(base.qty * r);
  return round2(r);
}

/** Bags of the lots that were sold, pro rata to the quantity sold (whole bags of a fully sold lot). */
function packagesSold(arrivals: readonly Arrival[], sales: readonly PattiSale[]): number {
  let n = 0;
  for (const a of arrivals) {
    const q = sales.filter((s) => s.arrival_id === a.id).reduce((t, s) => t + s.qty, 0);
    if (num(a.qty) > 0) n += (num(a.packages) * Math.min(q, num(a.qty))) / num(a.qty);
  }
  return Math.round(n * 1000) / 1000;
}

/**
 * The patti for `principalId` and the chosen lots: their agency lines not yet on a live patti, the deductions and the
 * net. Pure; `existing` = the pattis already made (so a sale is never settled twice).
 */
export function buildPatti(
  input: { date: string; principalId: string; arrivalIds: readonly string[]; deductions: readonly DeductionInput[] },
  ctx: { arrivals: readonly Arrival[]; sales: readonly AgencySaleLine[]; existing: readonly SalePatti[]; exceptId?: string },
): Omit<SalePatti, 'id' | 'number' | 'status' | 'created_at' | 'updated_at'> {
  const lots = ctx.arrivals.filter((a) => input.arrivalIds.includes(a.id) && a.principal_id === input.principalId && a.status !== 'cancelled');
  if (!lots.length) throw new AgencyError('Choose at least one lot of this principal.');
  const done = settledKeys(ctx.existing, ctx.exceptId);
  const ids = new Set(lots.map((a) => a.id));
  // Lines per (document, lot): a document may sell a lot on several lines.
  const byKey = new Map<string, PattiSale>();
  for (const s of ctx.sales) {
    if (!ids.has(s.arrival_id) || s.date > input.date || done.has(`${s.invoice_id}|${s.arrival_id}`)) continue;
    const k = `${s.invoice_id}|${s.arrival_id}`;
    const row = byKey.get(k) ?? { invoice_id: s.invoice_id, invoice_number: s.invoice_number, date: s.date, arrival_id: s.arrival_id, qty: 0, amount: 0 };
    row.qty = Math.round((row.qty + s.qty) * 1000) / 1000;
    row.amount = round2(row.amount + s.amount);
    byKey.set(k, row);
  }
  const sales = [...byKey.values()].filter((s) => s.qty !== 0 || s.amount !== 0).sort((a, b) => a.date.localeCompare(b.date) || a.invoice_number.localeCompare(b.invoice_number));
  if (!sales.length) throw new AgencyError('These lots have no agency sales left to settle up to the patti date.');
  const gross = round2(sales.reduce((t, s) => t + s.amount, 0));
  const base = { gross, packages: packagesSold(lots, sales), qty: sales.reduce((t, s) => t + s.qty, 0) };
  const deductions: PattiDeduction[] = input.deductions
    .filter((d) => String(d.label ?? '').trim() && (num(d.rate) > 0 || num(d.amount) > 0))
    .map((d) => ({ label: d.label.trim(), basis: d.basis, rate: round2(num(d.rate)), amount: deductionAmount(d, base), ...(d.head_id ? { head_id: d.head_id } : {}), ...(d.account_id ? { account_id: d.account_id } : {}), ...(d.aadat ? { aadat: true } : {}) }));
  const total_deductions = round2(deductions.reduce((t, d) => t + d.amount, 0));
  const advance = round2(lots.reduce((t, a) => t + Math.max(num(a.advance), 0), 0));
  return {
    date: input.date,
    principal_id: input.principalId,
    principal_name: lots[0].principal_name,
    arrival_ids: lots.map((a) => a.id),
    sales,
    gross,
    deductions,
    total_deductions,
    advance,
    net_payable: round2(gross - total_deductions - advance),
    commission_gst: lots.every((a) => (a.produce ?? 'agricultural') === 'agricultural') ? 'exempt' : 'taxable',
  };
}

export interface JournalLine {
  account: 'transfer' | 'principal' | 'aadat' | string;
  dr: number;
  cr: number;
}

/** The patti journal in rupees (pure): see the module comment. Balanced by construction. */
export function pattiJournal(p: Pick<SalePatti, 'gross' | 'deductions' | 'commission_gst'>): JournalLine[] {
  const kept = p.deductions.filter((d) => !(d.aadat && p.commission_gst === 'taxable'));
  const lines: JournalLine[] = [{ account: 'transfer', dr: round2(p.gross), cr: 0 }];
  const byAccount = new Map<string, number>();
  for (const d of kept) {
    const acc = d.aadat ? 'aadat' : d.account_id || A.otherIncome;
    byAccount.set(acc, round2((byAccount.get(acc) ?? 0) + d.amount));
  }
  const toPrincipal = round2(p.gross - [...byAccount.values()].reduce((t, v) => t + v, 0));
  if (toPrincipal > 0) lines.push({ account: 'principal', dr: 0, cr: toPrincipal });
  else if (toPrincipal < 0) lines.push({ account: 'principal', dr: -toPrincipal, cr: 0 });
  for (const [account, amount] of byAccount) if (amount > 0) lines.push({ account, dr: 0, cr: amount });
  return lines;
}

/** Lots with agency sales not settled on a POSTED patti (their sales still sit in Sales — year-end checklist, TR22). */
export function unsettledLots(arrivals: readonly Arrival[], sales: readonly AgencySaleLine[], pattis: readonly SalePatti[]): Arrival[] {
  const posted = settledKeys(pattis.filter((p) => p.status === 'posted'));
  const open = new Set(sales.filter((s) => !posted.has(`${s.invoice_id}|${s.arrival_id}`)).map((s) => s.arrival_id));
  return arrivals.filter((a) => a.status !== 'cancelled' && open.has(a.id));
}

/** Plain-text patti (print / WhatsApp). */
export function pattiText(p: SalePatti, company = '', money: (n: number) => string = (n) => `₹${n.toFixed(2)}`): string {
  return [
    `${company ? `${company} — ` : ''}Bikri patti ${p.number} (${p.date})`,
    `Principal: ${p.principal_name}`,
    ...p.sales.map((s) => `${s.invoice_number} ${s.date}: ${s.qty} → ${money(s.amount)}`),
    `Gross sales: ${money(p.gross)}`,
    ...p.deductions.map((d) => `Less ${d.label}: ${money(d.amount)}`),
    ...(p.advance > 0 ? [`Less advance: ${money(p.advance)}`] : []),
    `Net payable: ${money(p.net_payable)}`,
  ].join('\n');
}

/* ── Storage ──────────────────────────────────────────────────── */

function ensureLedger(name: string, group: 'SALES', from: number): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = from;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group }).id;
}

/** Save a draft patti for the chosen lots (numbered PAT/FY…). */
export function savePatti(input: Parameters<typeof buildPatti>[0], ctx: { arrivals: readonly Arrival[]; sales: readonly AgencySaleLine[] }): SalePatti {
  requireAccess('books.edit');
  const all = getTable<SalePatti>(PATTIS_TABLE);
  const built = buildPatti(input, { ...ctx, existing: all });
  const id = generateId();
  const number = nextSeriesNumberFor(TR_SERIES.pattis, input.date, all.map((p) => p.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, 'create');
  const now = new Date().toISOString();
  const row: SalePatti = { ...built, id, number, status: 'draft', created_at: now, updated_at: now };
  setTable(PATTIS_TABLE, [...all, row]);
  recordSeries(number);
  return row;
}

/** Post the patti journal (once). */
export function postPatti(id: string): SalePatti {
  requireAccess('books.edit');
  const all = getTable<SalePatti>(PATTIS_TABLE);
  const p = all.find((x) => x.id === id);
  if (!p) throw new AgencyError('Patti not found.');
  if (p.status !== 'draft') throw new AgencyError(`Patti ${p.number} is ${p.status}.`);
  return withTablesRollback([PATTIS_TABLE, 'vouchers', 'accounts'], () => {
    const ids: Record<string, string> = {
      transfer: ensureLedger(AGENCY_TRANSFER_LEDGER, 'SALES', 4040),
      principal: A.creditors,
      ...(p.deductions.some((d) => d.aadat) ? { aadat: ensureLedger(AADAT_LEDGER, 'SALES', 4050) } : {}),
    };
    const v = saveVoucher({
      type: 'JOURNAL',
      date: p.date,
      narration: `Bikri patti ${p.number} to ${p.principal_name}: gross sales ₹${p.gross.toFixed(2)} less deductions ₹${p.total_deductions.toFixed(2)} (agency sales transferred to the principal) — verify with your CA`,
      lines: pattiJournal(p).map((l) => ({
        account_id: ids[l.account] ?? l.account,
        dr: Math.round(l.dr * 100),
        cr: Math.round(l.cr * 100),
        ...(l.account === 'principal' ? { party: p.principal_name } : {}),
      })),
      voucher_class: 'Bikri patti',
    });
    const next: SalePatti = { ...p, status: 'posted', voucher_id: v.id, voucher_number: v.number, updated_at: new Date().toISOString() };
    setTable(PATTIS_TABLE, all.map((x) => (x.id === id ? next : x)));
    return next;
  });
}

/** Cancel a patti: its journal is deleted (period lock applies), the number stays used, the lots are open again. */
export function cancelPatti(id: string, reason: string): SalePatti {
  requireAccess('books.edit');
  if (!reason.trim()) throw new AgencyError('Give the reason for cancelling.');
  const all = getTable<SalePatti>(PATTIS_TABLE);
  const p = all.find((x) => x.id === id);
  if (!p) throw new AgencyError('Patti not found.');
  if (p.status === 'cancelled') return p;
  assertUnlocked({ id, issue_date: p.date, invoice_number: p.number }, 'cancel');
  return withTablesRollback([PATTIS_TABLE, 'vouchers'], () => {
    if (p.voucher_id) deleteVoucher(p.voucher_id);
    const next: SalePatti = { ...p, status: 'cancelled', cancel_reason: reason.trim(), voucher_id: undefined, updated_at: new Date().toISOString() };
    setTable(PATTIS_TABLE, all.map((x) => (x.id === id ? next : x)));
    return next;
  });
}
