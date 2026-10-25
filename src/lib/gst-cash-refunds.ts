/**
 * Electronic cash ledger depth (7R, 7.121): PMT-09 transfers between heads and GST refunds (RFD-01) with claim
 * tracking. Builds on WP-6 (`gst-setoff.ts`: PMT-06 challans and set-off journals).
 *
 *  - Cash ledger by major × minor head (`cashLedgerDetail`): paid PMT-06 challans in, set-offs out (tax → tax,
 *    interest → interest, late fee → fee), PMT-09 transfers moved between heads, refund claims of EXCESS cash
 *    debited when filed (the portal debits the ledger on filing RFD-01) and their rejected part re-credited
 *    (PMT-03). The books carry one ledger (2360) for all heads, so a PMT-09 posts nothing.
 *  - PMT-09 (`gst_pmt09`, Rule 87(14)): an amount moved from one major / minor head to another, never more than
 *    the source head holds on that day.
 *  - Refund claims (`gst_refunds`): category (excess cash, export / SEZ supply under LUT — accumulated ITC,
 *    export of services with IGST, inverted duty structure, other), period, relevant date, ARN, amounts claimed
 *    by head, status trail RFD-01 → RFD-02 (acknowledged) → RFD-03 (deficiency) → RFD-04 (provisional) →
 *    RFD-06 (sanctioned / rejected) → RFD-05 (paid). Time limit and interest from `REFUND_TIME_RULES`
 *    (gst-penalties.ts, date-keyed). Marking a claim paid with a bank ledger posts a RECEIPT voucher (class
 *    "GST refund (RFD)"): Dr Bank | Cr GST electronic cash ledger (2360) for cash refunds, Cr Input IGST / CGST /
 *    SGST / cess for ITC refunds.
 *  - Working paper for a refund of accumulated ITC on zero-rated supplies under LUT (Rule 89(4)):
 *    refund = turnover of zero-rated supply × net ITC ÷ adjusted total turnover (`rule894Refund`).
 *
 * Everything is a WORKING PAPER — the portal's ledgers, RFD forms and orders are what count; verify with your CA.
 * Pure above the "Storage" divider; dates are bare local days.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { refundTimeRules } from './gst-penalties';
import { GST_HEADS, GST_HEAD_LABELS, INPUT_ACCOUNT, MINOR_HEADS, isPaid, zeroHeads, type GstChallan, type GstHead, type GstSetOffRecord, type Heads, type MinorHead } from './gst-setoff';
import type { Gstr1Report, Gstr3bReport } from './gst-reports';
import { num, round2 } from './invoice-calc';
import { A, chartOf, loadUserAccounts } from './ledger/accounts';
import { deleteVoucher, loadVouchers, rupeesToPaise, saveVoucher, type ManualVoucherLine } from './ledger/vouchers';
import { assertUnlocked } from './period-lock';
import { generateId, getTable, setTable } from './storage';

export const PMT09_TABLE = 'gst_pmt09';
export const REFUNDS_TABLE = 'gst_refunds';
export const REFUND_VOUCHER_CLASS = 'GST refund (RFD)';
export const CASH_REFUND_DISCLAIMER = 'Working paper — PMT-09 transfers and refund claims as recorded here. The GST portal’s electronic cash / credit ledgers, RFD forms and refund orders are what count; verify with your CA.';

export type LedgerDetail = Record<GstHead, Record<MinorHead, number>>;

const emptyDetail = (): LedgerDetail => ({
  igst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  cgst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  sgst: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
  cess: { tax: 0, interest: 0, penalty: 0, fee: 0, others: 0 },
});

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const money = (n: number) => `₹${round2(n).toFixed(2)}`;
const isHead = (v: unknown): v is GstHead => typeof v === 'string' && (GST_HEADS as readonly string[]).includes(v);
const isMinor = (v: unknown): v is MinorHead => typeof v === 'string' && (MINOR_HEADS as readonly string[]).includes(v);
const cleanHeads = (v: unknown): Heads => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { igst: round2(Math.max(num(o.igst), 0)), cgst: round2(Math.max(num(o.cgst), 0)), sgst: round2(Math.max(num(o.sgst), 0)), cess: round2(Math.max(num(o.cess), 0)) };
};
export const headsTotal = (h: Partial<Heads> | undefined): number => round2(GST_HEADS.reduce((t, k) => t + num(h?.[k]), 0));

/* ── PMT-09 ───────────────────────────────────────────────────── */

export interface Pmt09Transfer {
  id: string;
  /** Day the PMT-09 was filed (local). */
  date: string;
  gstin?: string;
  /** Acknowledgement / reference of the PMT-09 on the portal (optional). */
  arn?: string;
  from: { head: GstHead; minor: MinorHead };
  to: { head: GstHead; minor: MinorHead };
  amount: number;
  notes?: string;
  created_at?: string;
}

export type Pmt09Input = Omit<Pmt09Transfer, 'id' | 'created_at'>;

/* ── Refund claims ────────────────────────────────────────────── */

export type RefundCategory = 'EXCESS_CASH' | 'EXPORT_LUT_ITC' | 'SEZ_LUT_ITC' | 'EXPORT_SERVICES_IGST' | 'INVERTED_DUTY' | 'OTHER';
export const REFUND_CATEGORIES: readonly RefundCategory[] = ['EXCESS_CASH', 'EXPORT_LUT_ITC', 'SEZ_LUT_ITC', 'EXPORT_SERVICES_IGST', 'INVERTED_DUTY', 'OTHER'];
/** Refunds of input tax credit (debited from the electronic CREDIT ledger, credited back to the input heads when paid). */
export const ITC_REFUND_CATEGORIES: ReadonlySet<RefundCategory> = new Set(['EXPORT_LUT_ITC', 'SEZ_LUT_ITC', 'INVERTED_DUTY']);

export type RefundStatus = 'DRAFT' | 'FILED' | 'ACKNOWLEDGED' | 'DEFICIENCY' | 'PROVISIONAL' | 'SANCTIONED' | 'REJECTED' | 'PAID' | 'WITHDRAWN';
export const REFUND_STATUSES: readonly RefundStatus[] = ['DRAFT', 'FILED', 'ACKNOWLEDGED', 'DEFICIENCY', 'PROVISIONAL', 'SANCTIONED', 'REJECTED', 'PAID', 'WITHDRAWN'];
/** Portal form behind each status (for the trail). */
export const REFUND_STATUS_FORM: Record<RefundStatus, string> = {
  DRAFT: '—', FILED: 'RFD-01', ACKNOWLEDGED: 'RFD-02', DEFICIENCY: 'RFD-03', PROVISIONAL: 'RFD-04', SANCTIONED: 'RFD-06', REJECTED: 'RFD-06', PAID: 'RFD-05', WITHDRAWN: 'RFD-01W',
};

export interface RefundEvent {
  date: string;
  status: RefundStatus;
  note?: string;
}

export interface GstRefundClaim {
  id: string;
  gstin?: string;
  category: RefundCategory;
  /** Tax period(s) the claim is for (local days). */
  period_from: string;
  period_to: string;
  /** Relevant date for the Sec 54(1) two-year limit (e.g. the export / LUT invoice date or the period's end). */
  relevant_date: string;
  /** RFD-01 filing day; absent while DRAFT. */
  filed_on?: string;
  arn?: string;
  claimed: Heads;
  provisional?: Heads;
  sanctioned?: Heads;
  rejected?: Heads;
  status: RefundStatus;
  history: RefundEvent[];
  /** RFD-05: day the money reached the bank, and the bank / cash ledger it posted to. */
  paid_on?: string;
  bank_ledger_id?: string;
  voucher_id?: string;
  voucher_number?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type RefundInput = Pick<GstRefundClaim, 'gstin' | 'category' | 'period_from' | 'period_to' | 'relevant_date' | 'filed_on' | 'arn' | 'claimed' | 'notes'> & { id?: string };

/** The claim debits the electronic CASH ledger (excess balance) — on filing, until withdrawn. */
const debitsCash = (r: Pick<GstRefundClaim, 'category' | 'status'>) => r.category === 'EXCESS_CASH' && r.status !== 'DRAFT' && r.status !== 'WITHDRAWN';

/**
 * Electronic cash ledger by major × minor head on `asOf` (inclusive; all dates when absent), for `gstin` (rows
 * without a GSTIN count for every GSTIN). Never adjusts the books.
 */
export function cashLedgerDetail(
  challans: readonly GstChallan[],
  setoffs: readonly GstSetOffRecord[],
  transfers: readonly Pmt09Transfer[] = [],
  refunds: readonly GstRefundClaim[] = [],
  asOf?: string,
  gstin = '',
): LedgerDetail {
  const d = emptyDetail();
  const mine = (g?: string) => !gstin || !g || g === gstin;
  const upTo = (day?: string) => !!day && (!asOf || day <= asOf);
  for (const c of challans) {
    if (!isPaid(c) || !upTo(c.deposited_on) || !mine(c.gstin)) continue;
    for (const h of GST_HEADS) for (const m of MINOR_HEADS) d[h][m] = round2(d[h][m] + num(c.amounts?.[h]?.[m]));
  }
  for (const r of setoffs) {
    if (!upTo(r.date) || !mine(r.gstin)) continue;
    for (const h of GST_HEADS) {
      d[h].tax = round2(d[h].tax - num(r.cash_tax?.[h]));
      d[h].interest = round2(d[h].interest - num(r.interest?.[h]));
      d[h].fee = round2(d[h].fee - num(r.late_fee?.[h]));
    }
  }
  for (const t of transfers) {
    if (!upTo(t.date) || !mine(t.gstin)) continue;
    d[t.from.head][t.from.minor] = round2(d[t.from.head][t.from.minor] - t.amount);
    d[t.to.head][t.to.minor] = round2(d[t.to.head][t.to.minor] + t.amount);
  }
  for (const r of refunds) {
    if (!debitsCash(r) || !upTo(r.filed_on) || !mine(r.gstin)) continue;
    for (const h of GST_HEADS) {
      d[h].tax = round2(d[h].tax - num(r.claimed[h]));
      // PMT-03: the rejected part comes back to the ledger (dated the latest trail entry).
      const back = num(r.rejected?.[h]);
      const when = r.history.length ? r.history[r.history.length - 1].date : r.filed_on;
      if (back > 0 && upTo(when)) d[h].tax = round2(d[h].tax + back);
    }
  }
  return d;
}

export function detailByHead(d: LedgerDetail): Heads {
  const out = zeroHeads();
  for (const h of GST_HEADS) out[h] = round2(MINOR_HEADS.reduce((t, m) => t + d[h][m], 0));
  return out;
}

export function validatePmt09(t: Pmt09Input, balance: LedgerDetail): string {
  if (!isoDay(t.date)) return 'Choose the PMT-09 date.';
  if (!isHead(t.from?.head) || !isMinor(t.from?.minor) || !isHead(t.to?.head) || !isMinor(t.to?.minor)) return 'Choose the heads to transfer from and to.';
  if (t.from.head === t.to.head && t.from.minor === t.to.minor) return 'The source and destination heads are the same.';
  const amount = round2(num(t.amount));
  if (!(amount > 0)) return 'Enter the amount to transfer.';
  const avail = round2(balance[t.from.head][t.from.minor]);
  if (amount > avail + 0.004) return `${GST_HEAD_LABELS[t.from.head]} (${t.from.minor}) holds only ${money(Math.max(avail, 0))} on ${t.date}.`;
  return '';
}

/** Days from `from` to `to` (local, inclusive of neither end's time zone issues). */
function daysBetweenDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function addYears(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  // 29 Feb + n years → 28 Feb when the target year has none.
  const last = new Date(y + n, m, 0).getDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Sec 54(1): last day to file, and whether `filedOn` (or today) is past it. */
export function refundDeadline(relevantDate: string, filedOn?: string, today?: string): { lastDay: string; late: boolean } {
  const rel = isoDay(relevantDate);
  if (!rel) return { lastDay: '', late: false };
  const lastDay = addYears(rel, refundTimeRules(rel).limitYears);
  // Sec 54(1): "before the expiry of two years" — the day before the anniversary is the last day.
  const [y, m, d] = lastDay.split('-').map(Number);
  const t = new Date(y, m - 1, d - 1);
  const last = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const on = isoDay(filedOn) || isoDay(today);
  return { lastDay: last, late: !!on && on > last };
}

/**
 * Sec 54(7) / Sec 56 estimate: days the refund is past the sanction window (from filing) and simple interest on the
 * sanctioned amount for those days (paid or as of `today`). Estimate only.
 */
export function refundDelayInterest(r: Pick<GstRefundClaim, 'filed_on' | 'paid_on' | 'sanctioned' | 'claimed' | 'relevant_date'>, today: string): { daysLate: number; interest: number } {
  const filed = isoDay(r.filed_on);
  if (!filed) return { daysLate: 0, interest: 0 };
  const rules = refundTimeRules(r.relevant_date || filed);
  const end = isoDay(r.paid_on) || isoDay(today);
  const late = Math.max(daysBetweenDays(filed, end) - rules.sanctionDays, 0);
  const base = headsTotal(r.sanctioned ?? r.claimed);
  return { daysLate: late, interest: round2((base * rules.delayInterestPct * late) / 36500) };
}

export function validateRefund(r: RefundInput, cash?: Heads): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!REFUND_CATEGORIES.includes(r.category)) errors.push('Choose the refund category.');
  const from = isoDay(r.period_from);
  const to = isoDay(r.period_to);
  if (!from || !to) errors.push('Enter the period the refund is for.');
  else if (to < from) errors.push('The period ends before it starts.');
  if (!isoDay(r.relevant_date)) errors.push('Enter the relevant date (Sec 54(1)).');
  if (r.filed_on && !isoDay(r.filed_on)) errors.push('Enter a valid filing date.');
  const claimed = cleanHeads(r.claimed);
  if (!(headsTotal(claimed) > 0)) errors.push('Enter the amount claimed under at least one head.');
  if (r.arn && !/^[A-Z0-9]{10,20}$/i.test(s(r.arn))) warnings.push('The ARN looks unusual (letters / digits, 10–20 characters expected).');
  if (r.category === 'EXCESS_CASH' && cash) {
    for (const h of GST_HEADS) if (claimed[h] > Math.max(cash[h], 0) + 0.004) warnings.push(`${GST_HEAD_LABELS[h]}: claimed ${money(claimed[h])} is more than the cash ledger holds (${money(Math.max(cash[h], 0))}).`);
  }
  if (isoDay(r.relevant_date)) {
    const dl = refundDeadline(r.relevant_date, r.filed_on);
    if (dl.late) warnings.push(`Filed after the Sec 54(1) time limit (last day ${dl.lastDay}).`);
  }
  return { errors, warnings };
}

/** Receipt voucher lines (paise) for a paid claim: Dr bank | Cr 2360 (cash refunds) or Cr input heads (ITC refunds). */
export function refundVoucherLines(r: Pick<GstRefundClaim, 'category' | 'sanctioned' | 'claimed' | 'bank_ledger_id'>): ManualVoucherLine[] {
  const amounts = r.sanctioned && headsTotal(r.sanctioned) > 0 ? r.sanctioned : r.claimed;
  const itc = ITC_REFUND_CATEGORIES.has(r.category);
  const cr: ManualVoucherLine[] = [];
  let total = 0;
  for (const h of GST_HEADS) {
    const p = rupeesToPaise(num(amounts[h]));
    if (p <= 0) continue;
    total += p;
    cr.push({ account_id: itc ? INPUT_ACCOUNT[h] : A.gstCash, dr: 0, cr: p });
  }
  // One credit line per account (cash refunds all go to 2360).
  const merged = new Map<string, number>();
  for (const l of cr) merged.set(l.account_id, (merged.get(l.account_id) ?? 0) + l.cr);
  return [{ account_id: s(r.bank_ledger_id) || A.bank, dr: total, cr: 0 }, ...[...merged].map(([account_id, p]) => ({ account_id, dr: 0, cr: p }))];
}

/* ── Rule 89(4) working paper ─────────────────────────────────── */

export interface Rule894Input {
  /** Turnover of zero-rated supply of goods and services made without payment of tax under LUT (₹). */
  zeroRatedTurnover: number;
  /** Adjusted total turnover (₹): turnover in the State excluding exempt supplies other than zero-rated. */
  adjustedTotalTurnover: number;
  /** Net ITC of inputs and input services in the period, by head (capital goods excluded). */
  netItc: Heads;
  /** Credit ledger balance at the end of the period / on filing (caps the claim per head), optional. */
  creditBalance?: Heads;
}

export interface Rule894Result {
  ratio: number;
  /** Maximum refund before the ledger cap (₹). */
  formula: number;
  /** Per head: formula share by net ITC, capped by the credit balance when given. */
  byHead: Heads;
  total: number;
  notes: string[];
}

/** Refund of accumulated ITC on zero-rated supplies under LUT: zero-rated turnover × net ITC ÷ adjusted total turnover. */
export function rule894Refund(i: Rule894Input): Rule894Result {
  const zr = Math.max(num(i.zeroRatedTurnover), 0);
  const att = Math.max(num(i.adjustedTotalTurnover), 0);
  const net = cleanHeads(i.netItc);
  const notes: string[] = [];
  if (!(att > 0)) return { ratio: 0, formula: 0, byHead: zeroHeads(), total: 0, notes: ['Adjusted total turnover is nil — no refund can be worked out.'] };
  const ratio = Math.min(zr / att, 1);
  if (zr > att) notes.push('Zero-rated turnover exceeds the adjusted total turnover — check both figures.');
  const byHead = zeroHeads();
  for (const h of GST_HEADS) byHead[h] = round2(net[h] * ratio);
  const formula = headsTotal(byHead);
  if (i.creditBalance) {
    const cap = cleanHeads(i.creditBalance);
    for (const h of GST_HEADS) {
      if (byHead[h] > cap[h]) {
        notes.push(`${GST_HEAD_LABELS[h]} capped at the credit ledger balance ${money(cap[h])}.`);
        byHead[h] = cap[h];
      }
    }
  }
  notes.push('Rule 89(4): the value of zero-rated supply of goods is limited to 1.5 times the value of like goods supplied domestically (from 23 Mar 2020, as understood) and net ITC excludes capital goods — adjust the inputs if they apply. Verify with your CA.');
  return { ratio: round2(ratio * 10000) / 10000, formula, byHead, total: headsTotal(byHead), notes };
}

/**
 * Inputs for `rule894Refund` from one GST report build covering the claim period: zero-rated supplies under LUT
 * (EXP without payment + SEZ without payment, net of their notes), adjusted total turnover (3B 3.1(a) + 3.1(b)
 * taxable value) and net ITC (3B 4C). Capital goods are not separated by the 3B (adjust by hand).
 */
export function rule894Basis(g1: Gstr1Report, g3: Gstr3bReport): Rule894Input {
  let zr = 0;
  for (const e of g1.exp) if (e.expType === 'WOPAY') zr += e.taxable;
  for (const b of g1.b2b) if (b.invTyp === 'SEWOP') zr += b.taxable;
  for (const n of [...g1.cdnr, ...g1.cdnur]) {
    if (n.invTyp === 'SEWOP' || n.unregType === 'EXPWOP') zr += (n.noteType === 'C' ? -1 : 1) * n.taxable;
  }
  const att = round2(g3.outward.taxable.taxable + g3.outward.zeroRated.taxable);
  const net = g3.itc.netSigned ?? g3.itc.net;
  return { zeroRatedTurnover: round2(Math.max(zr, 0)), adjustedTotalTurnover: att, netItc: { igst: Math.max(net.igst, 0), cgst: Math.max(net.cgst, 0), sgst: Math.max(net.sgst, 0), cess: Math.max(net.cess, 0) } };
}

/* ════════════════════════ Storage ════════════════════════ */

export class CashRefundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashRefundError';
  }
}

export function normalizePmt09(rows: readonly unknown[]): Pmt09Transfer[] {
  const out: Pmt09Transfer[] = [];
  for (const raw of rows) {
    const o = (raw ?? {}) as Partial<Pmt09Transfer>;
    if (typeof o.id !== 'string' || !isoDay(o.date) || !isHead(o.from?.head) || !isMinor(o.from?.minor) || !isHead(o.to?.head) || !isMinor(o.to?.minor) || !(num(o.amount) > 0)) continue;
    out.push({ ...(o as Pmt09Transfer), amount: round2(num(o.amount)) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeRefunds(rows: readonly unknown[]): GstRefundClaim[] {
  const out: GstRefundClaim[] = [];
  for (const raw of rows) {
    const o = (raw ?? {}) as Partial<GstRefundClaim>;
    if (typeof o.id !== 'string' || !REFUND_CATEGORIES.includes(o.category as RefundCategory) || !REFUND_STATUSES.includes(o.status as RefundStatus)) continue;
    out.push({
      ...(o as GstRefundClaim),
      claimed: cleanHeads(o.claimed),
      ...(o.sanctioned ? { sanctioned: cleanHeads(o.sanctioned) } : {}),
      ...(o.rejected ? { rejected: cleanHeads(o.rejected) } : {}),
      ...(o.provisional ? { provisional: cleanHeads(o.provisional) } : {}),
      history: Array.isArray(o.history) ? o.history.filter((e) => e && isoDay(e.date) && REFUND_STATUSES.includes(e.status)) : [],
    });
  }
  return out.sort((a, b) => (b.filed_on || b.period_to).localeCompare(a.filed_on || a.period_to));
}

export const loadPmt09 = (): Pmt09Transfer[] => normalizePmt09(getTable<unknown>(PMT09_TABLE));
export const loadRefunds = (): GstRefundClaim[] => normalizeRefunds(getTable<unknown>(REFUNDS_TABLE));

/** Record a PMT-09 transfer: books.edit, period lock on its date, checked against the cash ledger. Audited. */
export function savePmt09(input: Pmt09Input, challans: readonly GstChallan[], setoffs: readonly GstSetOffRecord[]): Pmt09Transfer {
  requireAccess('books.edit');
  const all = loadPmt09();
  const balance = cashLedgerDetail(challans, setoffs, all, loadRefunds(), input.date, s(input.gstin).toUpperCase());
  const problem = validatePmt09(input, balance);
  if (problem) throw new CashRefundError(problem);
  const id = generateId();
  assertUnlocked({ id, issue_date: input.date, invoice_number: s(input.arn) || undefined }, 'create');
  const row: Pmt09Transfer = {
    id,
    date: isoDay(input.date),
    ...(s(input.gstin) ? { gstin: s(input.gstin).toUpperCase() } : {}),
    ...(s(input.arn) ? { arn: s(input.arn).toUpperCase().slice(0, 30) } : {}),
    from: { head: input.from.head, minor: input.from.minor },
    to: { head: input.to.head, minor: input.to.minor },
    amount: round2(num(input.amount)),
    ...(s(input.notes) ? { notes: s(input.notes).slice(0, 300) } : {}),
    created_at: new Date().toISOString(),
  };
  setTable(PMT09_TABLE, [...getTable<unknown>(PMT09_TABLE), row]);
  audit.record({ entity: 'gst', entity_id: id, action: 'create', doc_number: row.arn ?? 'PMT-09', summary: `PMT-09 on ${row.date}: ${money(row.amount)} from ${GST_HEAD_LABELS[row.from.head]} ${row.from.minor} to ${GST_HEAD_LABELS[row.to.head]} ${row.to.minor}` });
  return row;
}

export function deletePmt09(id: string): void {
  const row = loadPmt09().find((t) => t.id === id);
  if (!row) return;
  requireAccess('books.edit');
  assertUnlocked({ id, issue_date: row.date }, 'delete');
  setTable(PMT09_TABLE, getTable<{ id?: string }>(PMT09_TABLE).filter((t) => t?.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.arn ?? 'PMT-09', summary: `Deleted PMT-09 of ${row.date} (${money(row.amount)})` });
}

/** Create / edit a refund claim (DRAFT, or FILED when a filing date is given). Audited; period lock on the filing day. */
export function saveRefund(input: RefundInput, cash?: Heads): GstRefundClaim {
  requireAccess('books.edit');
  const { errors } = validateRefund(input, cash);
  if (errors.length) throw new CashRefundError(errors[0]);
  const all = loadRefunds();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const id = prev?.id ?? generateId();
  const filed = isoDay(input.filed_on);
  if (filed) assertUnlocked({ id, issue_date: filed, invoice_number: s(input.arn) || undefined }, prev ? 'edit' : 'create');
  const now = new Date().toISOString();
  const status: RefundStatus = prev && prev.status !== 'DRAFT' ? prev.status : filed ? 'FILED' : 'DRAFT';
  const row: GstRefundClaim = {
    ...(prev ?? {}),
    id,
    ...(s(input.gstin) ? { gstin: s(input.gstin).toUpperCase() } : {}),
    category: input.category,
    period_from: isoDay(input.period_from),
    period_to: isoDay(input.period_to),
    relevant_date: isoDay(input.relevant_date),
    ...(filed ? { filed_on: filed } : {}),
    ...(s(input.arn) ? { arn: s(input.arn).toUpperCase().slice(0, 30) } : {}),
    claimed: cleanHeads(input.claimed),
    status,
    history: prev?.history?.length ? prev.history : filed ? [{ date: filed, status: 'FILED' }] : [],
    ...(s(input.notes) ? { notes: s(input.notes).slice(0, 500) } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  if (!filed) delete row.filed_on;
  setTable(REFUNDS_TABLE, prev ? getTable<GstRefundClaim>(REFUNDS_TABLE).map((r) => (r?.id === id ? row : r)) : [...getTable<unknown>(REFUNDS_TABLE), row]);
  audit.record({ entity: 'gst', entity_id: id, action: prev ? 'update' : 'create', doc_number: row.arn ?? 'RFD-01', summary: `${prev ? 'Edited' : 'Recorded'} GST refund claim (${row.category}) for ${row.period_from} – ${row.period_to}: ${money(headsTotal(row.claimed))}, ${row.status}` });
  return row;
}

export interface RefundStep {
  status: RefundStatus;
  date: string;
  note?: string;
  provisional?: Partial<Heads>;
  sanctioned?: Partial<Heads>;
  rejected?: Partial<Heads>;
  /** For PAID: the bank / cash ledger the refund reached (posts the receipt voucher). */
  bankLedgerId?: string;
}

/** Move a claim along its trail. PAID with a bank ledger posts (or updates) the receipt voucher. Audited. */
export function advanceRefund(id: string, step: RefundStep): GstRefundClaim {
  requireAccess('books.edit');
  const all = loadRefunds();
  const prev = all.find((r) => r.id === id);
  if (!prev) throw new CashRefundError('Refund claim not found.');
  const date = isoDay(step.date);
  if (!date) throw new CashRefundError('Choose the date of this step.');
  if (!REFUND_STATUSES.includes(step.status) || step.status === 'DRAFT') throw new CashRefundError('Choose the new status.');
  if (prev.filed_on && date < prev.filed_on) throw new CashRefundError('A step cannot be dated before the filing date.');
  assertUnlocked({ id, issue_date: date, invoice_number: prev.arn }, 'edit');
  const next: GstRefundClaim = { ...prev, status: step.status, history: [...prev.history, { date, status: step.status, ...(s(step.note) ? { note: s(step.note).slice(0, 300) } : {}) }], updated_at: new Date().toISOString() };
  if (step.status === 'FILED' && !next.filed_on) next.filed_on = date;
  if (step.provisional) next.provisional = cleanHeads(step.provisional);
  if (step.sanctioned) next.sanctioned = cleanHeads(step.sanctioned);
  if (step.rejected) next.rejected = cleanHeads(step.rejected);
  if (step.status === 'REJECTED' && !step.rejected) next.rejected = { ...next.claimed };
  if (next.sanctioned && headsTotal(next.sanctioned) - headsTotal(next.claimed) > 0.004) throw new CashRefundError('The sanctioned amount is more than the claim.');
  const voucherExists = !!prev.voucher_id && loadVouchers().some((v) => v.id === prev.voucher_id);
  if (step.status === 'PAID') {
    next.paid_on = date;
    if (s(step.bankLedgerId)) next.bank_ledger_id = s(step.bankLedgerId);
    if (next.bank_ledger_id) {
      const lines = refundVoucherLines(next);
      if (lines[0].dr > 0) {
        const v = saveVoucher({
          ...(voucherExists ? { id: prev.voucher_id } : {}),
          type: 'RECEIPT',
          date,
          narration: `GST refund received (${next.category}${next.arn ? `, ARN ${next.arn}` : ''}) for ${next.period_from} – ${next.period_to}`,
          lines,
          voucher_class: REFUND_VOUCHER_CLASS,
        }, chartOf(loadUserAccounts()));
        next.voucher_id = v.id;
        next.voucher_number = v.number;
      }
    }
  } else if (voucherExists && step.status === 'WITHDRAWN') {
    deleteVoucher(prev.voucher_id!);
    delete next.voucher_id;
    delete next.voucher_number;
  }
  setTable(REFUNDS_TABLE, getTable<GstRefundClaim>(REFUNDS_TABLE).map((r) => (r?.id === id ? next : r)));
  audit.record({ entity: 'gst', entity_id: id, action: 'update', doc_number: next.arn ?? 'RFD', summary: `GST refund claim ${next.arn ?? id}: ${prev.status} → ${next.status} on ${date}${next.voucher_number && step.status === 'PAID' ? ` (receipt ${next.voucher_number})` : ''}` });
  return next;
}

export function deleteRefund(id: string): void {
  const row = loadRefunds().find((r) => r.id === id);
  if (!row) return;
  requireAccess('books.edit');
  if (row.filed_on) assertUnlocked({ id, issue_date: row.filed_on, invoice_number: row.arn }, 'delete');
  if (row.voucher_id && loadVouchers().some((v) => v.id === row.voucher_id)) deleteVoucher(row.voucher_id);
  setTable(REFUNDS_TABLE, getTable<{ id?: string }>(REFUNDS_TABLE).filter((r) => r?.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.arn ?? 'RFD', summary: `Deleted GST refund claim (${row.category}) ${row.arn ?? ''} for ${money(headsTotal(row.claimed))}`.replace(/\s+/g, ' ') });
}
