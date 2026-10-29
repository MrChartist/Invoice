/**
 * Cash-flow forecast (roadmap 6.18, Xero style) — an ESTIMATE of cash + bank over the next
 * 30 / 90 / 180 days, in weekly buckets.
 *
 *   opening   = today's cash + bank from Books (cash book incl. opening balances)
 *   inflows   = open receivables at their expected date: due date shifted by the client's usual
 *               collection lag (amount-weighted average of past receipts' days after due; no
 *               history → the due date). Anything expected before today lands today.
 *             + received cheques not yet cleared, at their cheque date (6.26) — a cheque linked to
 *               an invoice replaces that much of the invoice's expected receipt
 *             + recurring schedules (6.x): each future occurrence's total less TDS, due
 *               `due_in_days` later, shifted by the client's lag
 *   outflows  = unpaid purchase bills at their due date (MSME suppliers: the MSMED Act limit when
 *               earlier — 15 days without an agreed date, 45 at most; `msme.ts`); a bill without a
 *               due date is treated as due on its bill date
 *             + issued cheques not yet cleared, at their cheque date
 *             + optionally, average monthly direct expenses (last 3 full months) spread per week
 *
 * PENDING 39: receivables are net of live credit notes (linked ones off their bill, unlinked ones off the party's
 * first expected receipts), and `commitments` add GST / TDS deposits, loan EMIs and salaries (`gstTdsCommitments`,
 * `loanCommitments`, `payrollCommitments`).
 *
 * Foreign documents are converted at their invoice rate; one without a rate is left out (counted).
 * Pure: no storage. Not a statement — it is only as good as the due dates in your data.
 */

import type { Cheque } from '../types/cheques';
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import type { Vendor } from '../types/purchases';
import { accountBalanceAt, buildVouchers, type BooksData } from './books';
import { toCsv } from './csv';
import { isoDay, shiftDay } from './dates';
import { fxRate } from './fx';
import { mulRound2, num, round2 } from './invoice-calc';
import { isMse, paymentLimit } from './msme';
import { isVoidStatus, pickStr, readPurchase, supplierPayableOf } from './purchase-normalize';
import { previewOccurrences, scheduleStatus, templateTotals, type RecurringSchedule } from './recurring';
import { receivableBalance } from './rcm';
import { openInstalments } from './payment-schedule';
import { movedNoCash } from './advance-tax'; // no-cash.ts (QA6-1 F4)
import { bankAccountsDb, isClientMoneyAccount } from './bank-accounts'; // R14 PS-B3
import { isLiveCreditNote, linkedCredits, type CreditLinkRow } from './amount-due';
import { receivableTotal } from './rcm';
import { isNonGstFinancialNote } from './financial-note';
import type { BusinessLoan } from './loans'; // type only: loans.ts stays in the Loans route chunk

/** Open receivable `inr` split over a document's unpaid instalments (one part on `due_date` without a schedule). */
function scheduledParts(inv: InvoiceRecord, inr: number): { due: string; label: string; amount: number }[] {
  const open = openInstalments(inv);
  const sum = open.reduce((s, o) => s + o.open, 0);
  if (!open.length || sum <= 0) return [{ due: '', label: '', amount: inr }];
  let left = inr;
  return open.map((o, i) => {
    const amount = i === open.length - 1 ? round2(left) : round2((inr * o.open) / sum);
    left = round2(left - amount);
    return { due: o.instalment.due_date, label: o.instalment.label ?? '', amount };
  });
}

export const HORIZONS = [30, 90, 180] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Lags are clamped so one freak payment cannot throw the whole forecast. */
export const LAG_MIN = -30;
export const LAG_MAX = 120;

export type ForecastKind = 'receivable' | 'recurring' | 'cheque_in' | 'payable' | 'cheque_out' | 'expenses' | 'tax' | 'loan' | 'salary';

export interface ForecastItem {
  date: string;
  kind: ForecastKind;
  direction: 'in' | 'out';
  party: string;
  ref: string;
  amount: number;
  /** How the date was worked out, e.g. "due 12 Oct + 9 days usual delay". */
  basis: string;
  /** Expected date fell before today (past due by the client's own pattern) and was moved to today. */
  overdue?: boolean;
  link?: string;
}

export interface ForecastBucket {
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  net: number;
  opening: number;
  closing: number;
}

export interface Forecast {
  today: string;
  horizon: number;
  end: string;
  opening: number;
  items: ForecastItem[];
  buckets: ForecastBucket[];
  totals: { inflow: number; outflow: number; closing: number };
  lowest: { balance: number; week: string };
  firstNegative: string | null;
  /** Client → average days paid after due (only clients with history). */
  lags: { party: string; days: number; receipts: number }[];
  excludedForeign: number;
  averageMonthlyExpenses: number;
}

export interface ForecastInput {
  today: string;
  horizon: number;
  opening: number;
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  purchases: readonly unknown[];
  vendors?: readonly Vendor[];
  recurring?: readonly RecurringSchedule[];
  cheques?: readonly Cheque[];
  clients?: readonly Client[];
  includeExpenses?: boolean;
  /** Leave out invoices more than this many days past due (undefined = keep all). */
  skipOverdueAfter?: number;
  /** PENDING 39: `doc_links` — live credit notes reduce the receivables they settle. */
  links?: readonly CreditLinkRow[];
  /** PENDING 39: GST / TDS deposits, loan EMIs, salaries (outflows built by the `*Commitments` helpers). */
  commitments?: readonly ForecastItem[];
}

const RECEIVABLE_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const DAY = 86400000;
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysFrom = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/** Party key: client id when the snapshot has one, else the name. */
export function clientKey(c: Pick<Client, 'id' | 'name'> | null | undefined): string {
  return c?.id ? `id:${c.id}` : `n:${norm(c?.name)}`;
}
const partyName = (c: Pick<Client, 'name' | 'company'> | null | undefined) => String(c?.company || c?.name || '').trim() || 'Customer';

/* ── Collection lag ─────────────────────────────────────────── */

/**
 * Amount-weighted average days between due date and receipt, per client. Only receipts against
 * documents with a due date count; the result is rounded and clamped to [LAG_MIN, LAG_MAX].
 */
export function collectionLags(invoices: readonly InvoiceRecord[], payments: readonly Payment[]): Map<string, { days: number; receipts: number; party: string }> {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const acc = new Map<string, { w: number; sum: number; n: number; party: string }>();
  const banks = bankAccountsDb.all();
  for (const p of payments) {
    if (isClientMoneyAccount(p.bank_account_id, banks)) continue; // R14 PS-B3: clients' money, not the firm's
    const inv = byId.get(p.invoice_id);
    const due = isoDay(inv?.due_date);
    const paid = isoDay(p.date);
    // A row that moved no money (advance adjustment, write-off, gift voucher, deposit, RA deduction — `no-cash.ts`) is
    // not a collection: it says nothing about how late the client pays.
    if (!inv || !due || !paid || movedNoCash(p)) continue;
    const amt = Math.abs(num(p.amount)) * (fxRate(inv) ?? 1);
    if (!(amt > 0)) continue;
    const k = clientKey(inv.client);
    const a = acc.get(k) ?? { w: 0, sum: 0, n: 0, party: partyName(inv.client) };
    a.w += amt;
    a.sum += amt * daysFrom(due, paid);
    a.n++;
    acc.set(k, a);
  }
  const out = new Map<string, { days: number; receipts: number; party: string }>();
  for (const [k, a] of acc) {
    const days = Math.max(LAG_MIN, Math.min(LAG_MAX, Math.round(a.sum / a.w)));
    out.set(k, { days, receipts: a.n, party: a.party });
  }
  return out;
}

/* ── Buckets ────────────────────────────────────────────────── */

/** Weekly buckets from `today` covering `horizon` days (the last one may be shorter). */
export function weeklyBuckets(today: string, horizon: number): { start: string; end: string }[] {
  const end = shiftDay(today, horizon - 1);
  const out: { start: string; end: string }[] = [];
  for (let start = today; start <= end; start = shiftDay(start, 7)) {
    const e = shiftDay(start, 6);
    out.push({ start, end: e < end ? e : end });
  }
  return out;
}

function fmtDay(d: string): string {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${+d.slice(8, 10)} ${M[+d.slice(5, 7) - 1]}`;
}

/* ── Forecast ───────────────────────────────────────────────── */

export function buildForecast(input: ForecastInput): Forecast {
  const { today } = input;
  const horizon = Math.max(1, Math.round(input.horizon));
  const end = shiftDay(today, horizon - 1);
  const items: ForecastItem[] = [];
  let excludedForeign = 0;
  const lags = collectionLags(input.invoices, input.payments);
  const lagFor = (c: Pick<Client, 'id' | 'name'> | null | undefined) => lags.get(clientKey(c))?.days;
  const clamp = (d: string) => (d < today ? today : d);
  const push = (it: ForecastItem) => {
    if (it.amount > 0.004 && it.date <= end) items.push({ ...it, amount: round2(it.amount) });
  };

  // Pending cheques (not yet cleared / bounced / cancelled).
  const pendingIn = new Map<string, number>(); // invoice id → amount covered by cheques
  const pendingOut = new Map<string, number>(); // bill id → amount covered
  for (const c of input.cheques ?? []) {
    const amount = round2(num(c.amount));
    if (!(amount > 0) || !isoDay(c.cheque_date)) continue;
    if (c.direction === 'received' && (c.status === 'received' || c.status === 'deposited')) {
      if (c.invoice_id) pendingIn.set(c.invoice_id, round2((pendingIn.get(c.invoice_id) ?? 0) + amount));
      push({ date: clamp(c.cheque_date), kind: 'cheque_in', direction: 'in', party: c.party_name, ref: `Cheque ${c.number}`, amount, basis: `cheque dated ${fmtDay(c.cheque_date)}`, link: '/cheques' });
    } else if (c.direction === 'issued' && (c.status === 'issued' || c.status === 'presented')) {
      if (c.purchase_id) pendingOut.set(c.purchase_id, round2((pendingOut.get(c.purchase_id) ?? 0) + amount));
      push({ date: clamp(c.cheque_date), kind: 'cheque_out', direction: 'out', party: c.party_name, ref: `Cheque ${c.number}`, amount, basis: `cheque dated ${fmtDay(c.cheque_date)}`, link: '/cheques' });
    }
  }

  // PENDING 39: live credit notes. Linked ones come off their bill; the rest (in rupees) off the party's receipts.
  const credited = linkedCredits(input.links, input.invoices);
  const linkedNotes = new Set((input.links ?? []).filter((l) => l.relation === 'credit_note').map((l) => l.to_id));
  const unapplied = new Map<string, number>();
  for (const n of input.invoices) {
    if (!isLiveCreditNote(n) || linkedNotes.has(n.id)) continue;
    const rate = fxRate(n);
    if (rate === null) continue;
    const credit = round2(receivableTotal(n) * rate);
    if (credit > 0) unapplied.set(clientKey(n.client), round2((unapplied.get(clientKey(n.client)) ?? 0) + credit));
  }

  // Open receivables.
  for (const inv of input.invoices) {
    if (!RECEIVABLE_DOCS.has(inv.doc_type ?? 'INVOICE') || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const balance = round2((typeof inv.balance_due === 'number' || inv.reverse_charge ? receivableBalance(inv) : num(inv.total) - num(inv.tds_amount) - num(inv.amount_paid)) - (credited.get(inv.id) ?? 0));
    if (balance <= 0.004) continue;
    const rate = fxRate(inv);
    if (rate === null) {
      excludedForeign++;
      continue;
    }
    let inr = rate === 1 ? balance : mulRound2(balance, rate);
    inr = round2(inr - (pendingIn.get(inv.id) ?? 0));
    if (inr <= 0.004) continue;
    // 8.100: a payment schedule expects each unpaid instalment on its own date (in rupees, pro rata).
    const parts = scheduledParts(inv, inr);
    for (const part of parts) {
      const credit = unapplied.get(clientKey(inv.client)) ?? 0;
      const less = Math.min(credit, part.amount);
      if (less > 0) {
        unapplied.set(clientKey(inv.client), round2(credit - less));
        part.amount = round2(part.amount - less);
      }
      const due = part.due || isoDay(inv.due_date) || isoDay(inv.issue_date) || today;
      if (input.skipOverdueAfter !== undefined && daysFrom(due, today) > input.skipOverdueAfter) continue;
      const lag = lagFor(inv.client);
      const expected = lag === undefined ? due : shiftDay(due, lag);
      push({
        date: clamp(expected),
        kind: 'receivable',
        direction: 'in',
        party: partyName(inv.client),
        ref: `${inv.invoice_number || 'Invoice'}${part.label ? ` · ${part.label}` : ''}`,
        amount: part.amount,
        basis: lag === undefined ? `due ${fmtDay(due)} (no payment history)` : `due ${fmtDay(due)} ${lag >= 0 ? '+' : '−'} ${Math.abs(lag)} days usual ${lag >= 0 ? 'delay' : 'early payment'}`,
        overdue: expected < today,
        link: `/invoice/${inv.id}`,
      });
    }
  }

  // Recurring schedules.
  for (const s of input.recurring ?? []) {
    if (scheduleStatus(s) !== 'active' || !s.next_run) continue;
    const t = s.template;
    if ((t.currency || 'INR').toUpperCase() !== 'INR') {
      excludedForeign++;
      continue;
    }
    let calc;
    try {
      calc = templateTotals(t);
    } catch {
      continue;
    }
    const amount = round2(calc.total - num(calc.tds_amount));
    if (!(amount > 0)) continue;
    const lag = lagFor(t.client) ?? 0;
    const consumed = (s.run_count || 0) + (s.skipped_count || 0);
    const due = Math.max(0, Math.round(num(s.due_in_days)));
    for (const occ of previewOccurrences(s, 400, s.next_run, consumed)) {
      const expected = shiftDay(occ, due + lag);
      if (expected > end) break;
      push({
        date: clamp(expected),
        kind: 'recurring',
        direction: 'in',
        party: partyName(t.client),
        ref: s.name || 'Recurring invoice',
        amount,
        basis: `invoice on ${fmtDay(occ)}, due in ${due} days${lag ? ` ${lag > 0 ? '+' : '−'} ${Math.abs(lag)} days usual delay` : ''}`,
        link: '/recurring',
      });
    }
  }

  // Payables.
  const vendors = input.vendors ?? [];
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  for (const raw of input.purchases) {
    const bill = readPurchase(raw, vendors);
    if (!bill || isVoidStatus(bill.status)) continue;
    // Supplier side only: reverse-charge / import GST is paid to the government, not the vendor.
    const open = round2(supplierPayableOf(bill) - bill.paid - (pendingOut.get(bill.id) ?? 0));
    if (open <= 0.004) continue;
    const r = (raw ?? {}) as Record<string, unknown>;
    const dueRaw = isoDay(pickStr(r, ['due_date']));
    const vendor = vendorById.get(pickStr(r, ['vendor_id']));
    let due = dueRaw || bill.date;
    let basis = dueRaw ? `due ${fmtDay(dueRaw)}` : `no due date: bill date ${fmtDay(bill.date)}`;
    if (vendor && isMse(vendor)) {
      const limit = paymentLimit(bill.date, dueRaw || undefined);
      if (limit < due || !dueRaw) {
        due = limit;
        basis = `MSME limit ${fmtDay(limit)} (MSMED Act s.15)`;
      }
    }
    push({
      date: clamp(due),
      kind: 'payable',
      direction: 'out',
      party: bill.partyName || 'Supplier',
      ref: bill.number || (bill.isExpense ? 'Expense' : 'Bill'),
      amount: open,
      basis,
      overdue: due < today,
      link: '/expenses',
    });
  }

  for (const c of input.commitments ?? []) push({ ...c, date: clamp(c.date), overdue: c.overdue || c.date < today });

  // Average monthly expenses (last 3 full months of expense-type bills).
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = `${shiftMonthKey(today.slice(0, 7), -3)}-01`;
  let spent = 0;
  for (const raw of input.purchases) {
    const bill = readPurchase(raw, vendors);
    if (!bill || isVoidStatus(bill.status) || !bill.isExpense) continue;
    if (bill.date >= from && bill.date < monthStart) spent += bill.total;
  }
  const averageMonthlyExpenses = round2(spent / 3);

  // Buckets.
  const ranges = weeklyBuckets(today, horizon);
  if (input.includeExpenses && averageMonthlyExpenses > 0) {
    for (const b of ranges) {
      const days = daysFrom(b.start, b.end) + 1;
      push({ date: b.start, kind: 'expenses', direction: 'out', party: 'Average expenses', ref: '', amount: (averageMonthlyExpenses * 12 * days) / 365, basis: `average of the last 3 months (${averageMonthlyExpenses.toFixed(2)} a month)` });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1) || b.amount - a.amount);

  let running = round2(input.opening);
  let lowest = { balance: running, week: today };
  let firstNegative: string | null = null;
  const buckets: ForecastBucket[] = ranges.map((r) => {
    let inflow = 0;
    let outflow = 0;
    for (const it of items) {
      if (it.date < r.start || it.date > r.end) continue;
      if (it.direction === 'in') inflow += it.amount;
      else outflow += it.amount;
    }
    inflow = round2(inflow);
    outflow = round2(outflow);
    const opening = running;
    running = round2(running + inflow - outflow);
    if (running < lowest.balance) lowest = { balance: running, week: r.start };
    if (running < 0 && firstNegative === null) firstNegative = r.start;
    return { ...r, inflow, outflow, net: round2(inflow - outflow), opening, closing: running };
  });

  const totals = {
    inflow: round2(buckets.reduce((s, b) => s + b.inflow, 0)),
    outflow: round2(buckets.reduce((s, b) => s + b.outflow, 0)),
    closing: running,
  };
  return {
    today,
    horizon,
    end,
    opening: round2(input.opening),
    items,
    buckets,
    totals,
    lowest,
    firstNegative,
    lags: [...lags.values()].map((l) => ({ party: l.party, days: l.days, receipts: l.receipts })).sort((a, b) => b.days - a.days || a.party.localeCompare(b.party)),
    excludedForeign,
    averageMonthlyExpenses,
  };
}

function shiftMonthKey(key: string, months: number): string {
  const y = +key.slice(0, 4);
  const m = +key.slice(5, 7) - 1 + months;
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Today's cash + bank, as the Books cash and bank books show it. */
export function openingCash(books: BooksData, today: string): number {
  const banks = bankAccountsDb.all();
  const vouchers = buildVouchers(books).filter((v) => !isClientMoneyAccount(v.bank_account_id, banks)); // R14 PS-B3
  return round2(accountBalanceAt(vouchers, books.openings, 'cash', today) + accountBalanceAt(vouchers, books.openings, 'bank', today));
}

export const KIND_LABELS: Record<ForecastKind, string> = {
  receivable: 'Invoice',
  recurring: 'Recurring',
  cheque_in: 'Cheque in',
  payable: 'Bill',
  cheque_out: 'Cheque out',
  expenses: 'Expenses',
  tax: 'GST / TDS',
  loan: 'Loan EMI',
  salary: 'Salaries',
};

/* ── Commitments (PENDING 39) ─────────────────────────────────── */

const monthEnd = (ym: string): string => shiftDay(`${shiftMonthKey(ym, 1)}-01`, -1);
const monthName = (ym: string): string => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
/** Months whose deposit day (`day` of the next month) falls between today and `end`. */
function depositMonths(today: string, end: string, day: number): { month: string; due: string }[] {
  const out: { month: string; due: string }[] = [];
  for (let m = shiftMonthKey(today.slice(0, 7), -1); `${m}-01` <= end; m = shiftMonthKey(m, 1)) {
    const due = `${shiftMonthKey(m, 1)}-${String(day).padStart(2, '0')}`;
    if (due >= today && due <= end) out.push({ month: m, due });
  }
  return out;
}

/**
 * GST (20th of the next month): output tax of the month's sales documents (credit notes off, non-GST financial notes
 * left out) less ITC on eligible bills, plus reverse-charge tax (always paid in cash); TDS deducted on bills (7th).
 * From documents — an estimate before the return; a month already paid shows here until it is due. Rupees.
 */
export function gstTdsCommitments(invoices: readonly InvoiceRecord[], purchases: readonly unknown[], vendors: readonly unknown[], today: string, end: string): ForecastItem[] {
  const out: ForecastItem[] = [];
  const bills = purchases.map((raw) => readPurchase(raw, vendors)).filter((b): b is NonNullable<typeof b> => !!b && !isVoidStatus(b.status));
  for (const { month, due } of depositMonths(today, end, 20)) {
    let tax = 0;
    for (const inv of invoices) {
      if (inv.status === 'Draft' || inv.status === 'Cancelled' || String(inv.issue_date).slice(0, 7) !== month || inv.reverse_charge || isNonGstFinancialNote(inv)) continue;
      const sign = inv.doc_type === 'CREDIT_NOTE' ? -1 : RECEIVABLE_DOCS.has(inv.doc_type ?? 'INVOICE') ? 1 : 0;
      const rate = fxRate(inv);
      if (!sign || rate === null) continue;
      tax += sign * (num(inv.tax_amount) + num(inv.cess_amount)) * rate;
    }
    let rcm = 0;
    for (const b of bills) {
      if (b.date.slice(0, 7) !== month) continue;
      if (b.reverseCharge) rcm += b.tax + b.cess;
      else if (b.itcEligible) tax -= b.tax + b.cess - b.itcReversed;
    }
    const gst = round2(Math.max(tax, 0) + rcm);
    if (gst > 0) out.push({ date: due, kind: 'tax', direction: 'out', party: 'GST', ref: `GST ${monthName(month)}`, amount: gst, basis: `output tax less ITC${rcm ? ' + reverse charge' : ''} of ${monthName(month)}, due ${fmtDay(due)} (estimate)` });
  }
  for (const { month, due } of depositMonths(today, end, 7)) {
    const tds = round2(bills.filter((b) => b.date.slice(0, 7) === month).reduce((s, b) => s + b.tdsAmount, 0));
    if (tds > 0) out.push({ date: due, kind: 'tax', direction: 'out', party: 'TDS', ref: `TDS ${monthName(month)}`, amount: tds, basis: `TDS on bills of ${monthName(month)}, due ${fmtDay(due)}` });
  }
  return out;
}

/**
 * The EMI dates and amounts of `loans.ts` `emiSchedule` (reducing balance, last EMI closes the loan, day clamped to the
 * month end). Repeated here so the Books chunk does not share the loans module (a new chunk name in the entry's
 * preload map); `tests/cash-forecast-commitments.test.ts` checks both agree.
 */
export function forecastEmis(l: Pick<BusinessLoan, 'principal' | 'rate' | 'tenure_months' | 'first_emi'> & { payments?: readonly { n?: number; date?: string; principal?: number; reschedule?: 'emi' | 'tenure' }[] }): { n: number; date: string; emi: number }[] {
  const n = Math.floor(num(l.tenure_months));
  const p0 = num(l.principal);
  const r = num(l.rate) / 12 / 100;
  if (!(p0 > 0) || !(n > 0) || !isoDay(l.first_emi)) return [];
  const emiFor = (p: number, k: number): number => {
    const f = Math.pow(1 + r, k);
    return r > 0 ? round2((p * r * f) / (f - 1)) : round2(p / k);
  };
  let emi = emiFor(p0, n);
  const [y, m, d] = l.first_emi.split('-').map(Number);
  const out: { n: number; date: string; emi: number }[] = [];
  let open = round2(p0);
  // QA23 W1: re-scheduling prepayments (PENDING 52) cut the opening of the first EMI dated after them, as in emiSchedule.
  const prepay = (l.payments ?? []).filter((p) => p?.n === 0 && p.reschedule && num(p.principal) > 0).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let next = 0;
  for (let k = 1; k <= n && open > 0; k++) {
    const t = y * 12 + (m - 1) + k - 1;
    const last = new Date(Math.floor(t / 12), (t % 12) + 1, 0).getDate();
    const date = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    let mode: 'emi' | 'tenure' | undefined;
    while (next < prepay.length && String(prepay[next].date) < date) {
      open = round2(Math.max(0, open - num(prepay[next].principal)));
      mode = mode === 'emi' ? 'emi' : prepay[next].reschedule;
      next++;
    }
    if (open <= 0) break;
    if (mode === 'emi') emi = emiFor(open, n - k + 1);
    const interest = round2(open * (r > 0 ? r : 0));
    let principal = round2(emi - interest);
    if (k === n || principal > open) principal = open;
    out.push({ n: k, date, emi: round2(principal + interest) });
    open = round2(open - principal);
  }
  return out;
}

/** Unpaid EMIs of business loans (`business_loans`) up to `end`; an EMI already due is expected today. A closed loan has none (QA23 W1). */
export function loanCommitments(loans: readonly (Pick<BusinessLoan, 'number' | 'lender' | 'principal' | 'rate' | 'tenure_months' | 'first_emi' | 'payments'> & { closed?: boolean })[], end: string): ForecastItem[] {
  const out: ForecastItem[] = [];
  for (const l of loans) {
    if (l.closed) continue;
    const paid = new Set((l.payments ?? []).map((p) => p.n));
    for (const r of forecastEmis(l)) {
      if (r.date > end) break;
      if (!paid.has(r.n)) out.push({ date: r.date, kind: 'loan', direction: 'out', party: l.lender, ref: `${l.number} EMI ${r.n}`, amount: r.emi, basis: `EMI ${r.n} dated ${fmtDay(r.date)}`, link: '/loans' });
    }
  }
  return out;
}

interface RunLike { month?: string; status?: string; date?: string; lines?: readonly { net?: number; pf_ee?: number; epf_er?: number; eps?: number; edli?: number; pf_admin?: number; esi_ee?: number; esi_er?: number; pt?: number; tds?: number }[] }
/**
 * Salaries: the latest FINAL payroll run repeats each later month (net pay on the month's last day) with its PF / ESI /
 * PT / TDS on the 15th of the next month; that run's own deposits too unless a payroll payment for its month exists.
 */
export function payrollCommitments(runs: readonly RunLike[], payments: readonly { kind?: string; period?: string }[], today: string, end: string): ForecastItem[] {
  const last = [...runs].filter((r) => r?.status === 'final' && /^\d{4}-\d{2}$/.test(String(r.month))).sort((a, b) => String(b.month).localeCompare(String(a.month)))[0];
  if (!last) return [];
  const lines = last.lines ?? [];
  const net = round2(lines.reduce((s, l) => s + num(l.net), 0));
  const dues = round2(lines.reduce((s, l) => s + num(l.pf_ee) + num(l.epf_er) + num(l.eps) + num(l.edli) + num(l.pf_admin) + num(l.esi_ee) + num(l.esi_er) + num(l.pt) + num(l.tds), 0));
  const out: ForecastItem[] = [];
  const depositDone = payments.some((p) => p?.period === last.month && p.kind !== 'salary' && p.kind !== 'loan');
  for (let m = last.month!; `${m}-01` <= end; m = shiftMonthKey(m, 1)) {
    const payDay = monthEnd(m);
    const depositDay = `${shiftMonthKey(m, 1)}-15`;
    if (m !== last.month && net > 0 && payDay >= today && payDay <= end) out.push({ date: payDay, kind: 'salary', direction: 'out', party: 'Employees', ref: `Salaries ${monthName(m)}`, amount: net, basis: `net pay of the ${monthName(last.month!)} run, repeated` });
    if (dues > 0 && depositDay >= today && depositDay <= end && !(m === last.month && depositDone)) out.push({ date: depositDay, kind: 'salary', direction: 'out', party: 'PF / ESI / PT / TDS', ref: `Salary dues ${monthName(m)}`, amount: dues, basis: `statutory dues of the ${monthName(last.month!)} run, due ${fmtDay(depositDay)}` });
  }
  return out;
}

export function forecastCsv(f: Forecast): string {
  return toCsv([
    [`Cash-flow forecast ${f.today} to ${f.end}`, 'ESTIMATE: based on due dates, payment history and schedules; not a statement'],
    ['Opening cash + bank', f.opening],
    [],
    ['Week from', 'Week to', 'Opening', 'Money in', 'Money out', 'Net', 'Closing'],
    ...f.buckets.map((b) => [b.start, b.end, b.opening, b.inflow, b.outflow, b.net, b.closing]),
    [],
    ['Expected date', 'Type', 'In / out', 'Party', 'Reference', 'Amount', 'Basis'],
    ...f.items.map((i) => [i.date, KIND_LABELS[i.kind], i.direction === 'in' ? 'In' : 'Out', i.party, i.ref, i.amount, i.basis + (i.overdue ? ' (overdue: assumed today)' : '')]),
  ]);
}
