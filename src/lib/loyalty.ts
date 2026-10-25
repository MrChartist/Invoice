/**
 * Loyalty points (WP-9, P2 — the Vyapar / Marg "loyalty" feature).
 *
 *  - Program: `mrchartist_inv_loyalty_program` — points per ₹100 of taxable sales and the rupee
 *    value of a point, as **date-keyed rules** (a new rate applies from its date; old bills keep
 *    the rate of their date), plus the minimum points to redeem.
 *  - Accrual is DERIVED, never stored: every live sales bill of a saved customer (not the walk-in
 *    row) earns floor(taxable × rate / 100); a credit note takes back points the same way; a
 *    cancelled bill earns nothing and gives its redeemed points back. Editing / cancelling a bill
 *    therefore always keeps the ledger right.
 *  - Redemption: `loyalty_redeem {points, value}` on the bill; the value is added to the bill's
 *    invoice-level AMOUNT discount (a pre-tax discount at the time of supply, Sec 15(3)(a) CGST
 *    Act — so GST is on the reduced value; verify with your CA). `applyRedemption` /
 *    `removeRedemption` work on any record (POS cart or editor draft).
 *  - Manual corrections: table `loyalty_adjustments` (`master.edit`).
 */
import type { InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, setJson, setTable } from './storage';
import { requireAccess } from './access';
import { localDayOf } from './dates';

export const LOYALTY_PROGRAM_KEY = `${DB_PREFIX}loyalty_program`;
export const LOYALTY_ADJUSTMENTS_TABLE = 'loyalty_adjustments';
const WALK_IN = 'walk-in customer';

export interface LoyaltyRule {
  /** Effective from (YYYY-MM-DD). */
  from: string;
  points_per_100: number;
  /** Rupees per point when redeemed. */
  point_value: number;
}

export interface LoyaltyProgram {
  enabled: boolean;
  rules: LoyaltyRule[];
  min_redeem: number;
}

export const DEFAULT_PROGRAM: LoyaltyProgram = { enabled: false, rules: [{ from: '2000-01-01', points_per_100: 1, point_value: 1 }], min_redeem: 0 };

export function readProgram(): LoyaltyProgram {
  const raw = getJson<Partial<LoyaltyProgram> | null>(LOYALTY_PROGRAM_KEY, null);
  if (!raw) return DEFAULT_PROGRAM;
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && num(r.points_per_100) >= 0 && num(r.point_value) >= 0)
    .map((r) => ({ from: r.from, points_per_100: num(r.points_per_100), point_value: num(r.point_value) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  return { enabled: raw.enabled === true, rules: rules.length ? rules : DEFAULT_PROGRAM.rules, min_redeem: Math.max(num(raw.min_redeem), 0) };
}

/** Save the program. A changed rate is APPENDED from `effectiveFrom` (old bills keep theirs). */
export function saveProgram(next: { enabled: boolean; points_per_100: number; point_value: number; min_redeem: number }, effectiveFrom: string): LoyaltyProgram {
  requireAccess('settings.manage');
  const cur = readProgram();
  const latest = ruleOn(cur, effectiveFrom);
  let rules = cur.rules;
  if (latest.points_per_100 !== num(next.points_per_100) || latest.point_value !== num(next.point_value)) {
    rules = [...cur.rules.filter((r) => r.from !== effectiveFrom), { from: effectiveFrom, points_per_100: Math.max(num(next.points_per_100), 0), point_value: Math.max(num(next.point_value), 0) }]
      .sort((a, b) => a.from.localeCompare(b.from));
  }
  const program: LoyaltyProgram = { enabled: !!next.enabled, rules, min_redeem: Math.max(num(next.min_redeem), 0) };
  setJson(LOYALTY_PROGRAM_KEY, program);
  return program;
}

/** The rule in force on `day`. */
export function ruleOn(program: LoyaltyProgram, day: string): LoyaltyRule {
  let best = program.rules[0] ?? DEFAULT_PROGRAM.rules[0];
  for (const r of program.rules) if (r.from <= day) best = r;
  return best;
}

export interface LoyaltyAdjustment {
  id: string;
  /** Party key (`partyKey`). */
  party: string;
  name: string;
  date: string;
  points: number;
  note: string;
}

export const adjustmentsDb = {
  all: (): LoyaltyAdjustment[] => getTable<LoyaltyAdjustment>(LOYALTY_ADJUSTMENTS_TABLE),
  add(name: string, points: number, date: string, note: string): LoyaltyAdjustment {
    requireAccess('master.edit');
    if (!name.trim() || !Number.isFinite(points) || points === 0) throw new Error('Choose a customer and enter the points to add or take away.');
    const row: LoyaltyAdjustment = { id: generateId(), party: partyKey(name), name: name.trim(), date, points: Math.trunc(points), note: note.trim() };
    setTable(LOYALTY_ADJUSTMENTS_TABLE, [...adjustmentsDb.all(), row]);
    return row;
  },
};

export const partyKey = (name: string | undefined) => (name ?? '').trim().toLowerCase();
const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** Does this saved customer take part (not the walk-in counter row)? */
export function eligibleParty(name: string | undefined): boolean {
  const k = partyKey(name);
  return !!k && k !== WALK_IN;
}

/** Points a document earns (negative for a credit note). Redemption is separate. */
export function pointsEarned(inv: InvoiceRecord, program: LoyaltyProgram): number {
  if (!program.enabled || inv.status === 'Draft' || inv.status === 'Cancelled' || !eligibleParty(inv.client?.name)) return 0;
  const rule = ruleOn(program, inv.issue_date);
  const fx = (inv.currency || 'INR').toUpperCase() !== 'INR' ? num(inv.exchange_rate) : 1;
  const base = num(inv.taxable_value) * (fx || 0);
  const pts = Math.floor((base * rule.points_per_100) / 100 + 1e-9);
  if (SALES.has(inv.doc_type)) return pts;
  if (inv.doc_type === 'CREDIT_NOTE') return -pts;
  return 0;
}

export interface LoyaltyEntry {
  date: string;
  ref: string;
  doc_id?: string;
  earned: number;
  redeemed: number;
  balance: number;
  note?: string;
}

/** The points ledger of one customer (by name), oldest first, with a running balance. */
export function pointsLedger(name: string, invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram): LoyaltyEntry[] {
  const key = partyKey(name);
  const rows: Omit<LoyaltyEntry, 'balance'>[] = [];
  for (const inv of invoices) {
    if (partyKey(inv.client?.name) !== key) continue;
    const earned = pointsEarned(inv, program);
    const redeemed = inv.status !== 'Draft' && inv.status !== 'Cancelled' ? Math.max(Math.trunc(num(inv.loyalty_redeem?.points)), 0) : 0;
    if (earned || redeemed) rows.push({ date: inv.issue_date, ref: inv.invoice_number, doc_id: inv.id, earned, redeemed });
  }
  for (const a of adjustments) if (a.party === key) rows.push({ date: a.date, ref: 'Adjustment', earned: a.points, redeemed: 0, note: a.note });
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  let bal = 0;
  return rows.map((r) => {
    bal += r.earned - r.redeemed;
    return { ...r, balance: bal };
  });
}

export function pointsBalance(name: string, invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, excludeDocId?: string): number {
  const list = excludeDocId ? invoices.filter((i) => i.id !== excludeDocId) : invoices;
  const l = pointsLedger(name, list, adjustments, program);
  return l.length ? l[l.length - 1].balance : 0;
}

/** Top customers by balance (the dashboard tile). */
export function topBalances(invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, limit = 5): { name: string; points: number }[] {
  const names = new Map<string, string>();
  for (const i of invoices) if (eligibleParty(i.client?.name)) names.set(partyKey(i.client.name), i.client.name.trim());
  for (const a of adjustments) names.set(a.party, a.name);
  return [...names.values()]
    .map((name) => ({ name, points: pointsBalance(name, invoices, adjustments, program) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/* ── Redemption on a bill ──────────────────────────────────────── */

function retotal(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

/** Take a previous redemption off a record (its value leaves the AMOUNT discount). */
export function removeRedemption(rec: InvoiceRecord): InvoiceRecord {
  if (!rec.loyalty_redeem) return rec;
  const next: InvoiceRecord = { ...rec };
  if (next.discount_type === 'AMOUNT') next.discount_rate = round2(Math.max(num(next.discount_rate) - num(rec.loyalty_redeem.value), 0));
  delete next.loyalty_redeem;
  return retotal(next);
}

export interface RedeemResult {
  record: InvoiceRecord | null;
  errors: string[];
}

/**
 * Redeem `points` on a bill for a customer with `balance` points available (excluding this bill's
 * own earlier redemption). The value joins the invoice discount; it can never exceed the bill's
 * value after line discounts.
 */
export function applyRedemption(rec: InvoiceRecord, points: number, balance: number, program: LoyaltyProgram): RedeemResult {
  const base = removeRedemption(rec);
  const pts = Math.trunc(num(points));
  if (pts <= 0) return { record: base, errors: [] };
  const errors: string[] = [];
  if (!program.enabled) errors.push('The loyalty programme is switched off.');
  if (!eligibleParty(rec.client?.name)) errors.push('Pick a saved customer to redeem points.');
  if (pts > balance) errors.push(`Only ${balance} points are available.`);
  if (program.min_redeem && pts < program.min_redeem) errors.push(`Redeem at least ${program.min_redeem} points.`);
  if (base.discount_type === 'PERCENT' && num(base.discount_rate) > 0) errors.push('Remove the % discount first (points are redeemed as an amount discount).');
  const rule = ruleOn(program, rec.issue_date);
  const value = round2(pts * rule.point_value);
  const t = calculateInvoice(calcInputFromRecord(base));
  const room = round2(t.subtotal - t.line_discount_total - (base.discount_type === 'AMOUNT' ? num(base.discount_rate) : 0));
  if (value > room + 0.004) errors.push(`${pts} points are worth ₹${value.toFixed(2)}, more than the bill.`);
  if (errors.length) return { record: null, errors };
  const next: InvoiceRecord = {
    ...base,
    discount_type: 'AMOUNT',
    discount_rate: round2((base.discount_type === 'AMOUNT' ? num(base.discount_rate) : 0) + value),
    loyalty_redeem: { points: pts, value },
  };
  return { record: retotal(next), errors: [] };
}

/** `applyRedemption` with the stored programme and the customer's live balance (POS / editor). */
export function redeemOnBill(rec: InvoiceRecord, points: number, invoices: readonly InvoiceRecord[] = getTable<InvoiceRecord>('invoices')): RedeemResult & { balance: number } {
  const program = readProgram();
  const balance = pointsBalance(rec.client?.name ?? '', invoices, adjustmentsDb.all(), program, rec.id || undefined);
  return { ...applyRedemption(rec, points, balance, program), balance };
}

/** Balance and programme state for a customer (what the redeem box shows). */
export function loyaltyInfo(name: string): { enabled: boolean; balance: number; pointValue: number; minRedeem: number } {
  const program = readProgram();
  return {
    enabled: program.enabled && eligibleParty(name),
    // Read-only view: shown as the customer name is typed, so no re-parse of the invoice table per keystroke.
    balance: program.enabled ? pointsBalance(name, peekTable<InvoiceRecord>('invoices'), adjustmentsDb.all(), program) : 0,
    pointValue: ruleOn(program, localDayOf(new Date())).point_value,
    minRedeem: program.min_redeem,
  };
}
