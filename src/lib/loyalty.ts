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
 *  - R4-B2 (additive, both optional): dated tier sets (`tiers`: Silver / Gold … on rolling 12-month spend, the
 *    multiplier applies to the base points, rounded down) and `expiry_months` (FIFO lots; oldest points are used
 *    first and lapse N months after they were earned). Maths in `retail/loyalty-tiers.ts`. With neither set,
 *    every balance is exactly the single-rate result.
 */
import type { InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, setJson, setTable } from './storage';
import { requireAccess } from './access';
import { localDayOf, shiftDay } from './dates';
import {
  appendTierSet, cleanTierSets, expiringBetween, multiplyPoints, nextExpiry, nextTier, rollingSpend, runLots, tierFor, tiersOn,
  type LedgerEvent, type Lot, type LoyaltyTier, type SpendEntry, type TierSet,
} from './retail/loyalty-tiers';

export type { LoyaltyTier, TierSet } from './retail/loyalty-tiers';

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
  /** R4-B2: dated tier sets (appended, never overwritten). Absent = no tiers. */
  tiers?: TierSet[];
  /** R4-B2: points lapse this many months after they are earned (FIFO). Absent = never. */
  expiry_months?: number;
}

export const DEFAULT_PROGRAM: LoyaltyProgram = { enabled: false, rules: [{ from: '2000-01-01', points_per_100: 1, point_value: 1 }], min_redeem: 0 };

export function readProgram(): LoyaltyProgram {
  const raw = getJson<Partial<LoyaltyProgram> | null>(LOYALTY_PROGRAM_KEY, null);
  if (!raw) return DEFAULT_PROGRAM;
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.from) && num(r.points_per_100) >= 0 && num(r.point_value) >= 0)
    .map((r) => ({ from: r.from, points_per_100: num(r.points_per_100), point_value: num(r.point_value) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const tiers = cleanTierSets(raw.tiers);
  const months = Math.floor(num(raw.expiry_months));
  return {
    enabled: raw.enabled === true, rules: rules.length ? rules : DEFAULT_PROGRAM.rules, min_redeem: Math.max(num(raw.min_redeem), 0),
    ...(tiers.length ? { tiers } : {}),
    ...(months > 0 ? { expiry_months: months } : {}),
  };
}

/** Save the program. A changed rate (R4-B2: or tier list) is APPENDED from `effectiveFrom` (old bills keep theirs). */
export function saveProgram(
  next: { enabled: boolean; points_per_100: number; point_value: number; min_redeem: number; tiers?: LoyaltyTier[]; expiry_months?: number },
  effectiveFrom: string,
): LoyaltyProgram {
  requireAccess('settings.manage');
  const cur = readProgram();
  const latest = ruleOn(cur, effectiveFrom);
  let rules = cur.rules;
  if (latest.points_per_100 !== num(next.points_per_100) || latest.point_value !== num(next.point_value)) {
    rules = [...cur.rules.filter((r) => r.from !== effectiveFrom), { from: effectiveFrom, points_per_100: Math.max(num(next.points_per_100), 0), point_value: Math.max(num(next.point_value), 0) }]
      .sort((a, b) => a.from.localeCompare(b.from));
  }
  let tierSets = cur.tiers;
  if (next.tiers !== undefined) {
    const wanted = appendTierSet([], effectiveFrom, next.tiers)[0].tiers;
    if (JSON.stringify(tiersOn(cur.tiers, effectiveFrom)) !== JSON.stringify(wanted)) tierSets = appendTierSet(cur.tiers, effectiveFrom, wanted);
  }
  const months = next.expiry_months !== undefined ? Math.floor(num(next.expiry_months)) : cur.expiry_months ?? 0;
  const program: LoyaltyProgram = {
    enabled: !!next.enabled, rules, min_redeem: Math.max(num(next.min_redeem), 0),
    ...(tierSets?.length ? { tiers: tierSets } : {}),
    ...(months > 0 ? { expiry_months: months } : {}),
  };
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

const inrTaxable = (inv: InvoiceRecord) => num(inv.taxable_value) * (((inv.currency || 'INR').toUpperCase() !== 'INR' ? num(inv.exchange_rate) : 1) || 0);

/** Points a document earns (negative for a credit note). Redemption is separate. R4-B2: × the tier `multiplier`. */
export function pointsEarned(inv: InvoiceRecord, program: LoyaltyProgram, multiplier = 1): number {
  if (!program.enabled || inv.status === 'Draft' || inv.status === 'Cancelled' || !eligibleParty(inv.client?.name)) return 0;
  const rule = ruleOn(program, inv.issue_date);
  const pts = multiplyPoints(Math.floor((inrTaxable(inv) * rule.points_per_100) / 100 + 1e-9), multiplier);
  if (SALES.has(inv.doc_type)) return pts;
  if (inv.doc_type === 'CREDIT_NOTE') return -pts;
  return 0;
}

/** R4-B2: a customer's live taxable spend entries (sales +, credit notes −), for the rolling 12-month tier. */
export function spendEntries(docs: readonly InvoiceRecord[]): SpendEntry[] {
  const out: SpendEntry[] = [];
  for (const inv of docs) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled' || !eligibleParty(inv.client?.name)) continue;
    if (SALES.has(inv.doc_type)) out.push({ date: inv.issue_date, amount: inrTaxable(inv) });
    else if (inv.doc_type === 'CREDIT_NOTE') out.push({ date: inv.issue_date, amount: -inrTaxable(inv) });
  }
  return out;
}

/** R4-B2: the customer's tier on `day` (spend in the 365 days before it) and that spend. */
export function tierOn(program: LoyaltyProgram, spend: readonly SpendEntry[], day: string): { tier?: LoyaltyTier; spend: number } {
  const s = rollingSpend(spend, day);
  return { tier: tierFor(tiersOn(program.tiers, day), s), spend: s };
}

export interface LoyaltyEntry {
  date: string;
  ref: string;
  doc_id?: string;
  earned: number;
  redeemed: number;
  balance: number;
  note?: string;
  /** R4-B2: points that lapsed (an "Expired" row). */
  expired?: number;
  /** R4-B2: earn rows — the day these points expire. */
  expires_on?: string;
  /** R4-B2: the tier the bill earned at. */
  tier?: string;
  kind?: 'earn' | 'redeem' | 'expired';
}

/** Ledger rows and the open earn lots of one customer (by name) up to `asOf` (default today). */
export function pointsLots(
  name: string, invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, asOf: string = localDayOf(new Date()),
): { rows: LoyaltyEntry[]; lots: Lot[] } {
  const key = partyKey(name);
  const mine = invoices.filter((inv) => partyKey(inv.client?.name) === key);
  const spend = program.tiers?.length ? spendEntries(mine) : [];
  const events: (LedgerEvent & { tier?: string })[] = [];
  for (const inv of mine) {
    const tier = program.tiers?.length ? tierOn(program, spend, inv.issue_date).tier : undefined;
    const earned = pointsEarned(inv, program, tier?.multiplier ?? 1);
    const redeemed = inv.status !== 'Draft' && inv.status !== 'Cancelled' ? Math.max(Math.trunc(num(inv.loyalty_redeem?.points)), 0) : 0;
    if (earned || redeemed) events.push({ date: inv.issue_date, ref: inv.invoice_number, doc_id: inv.id, earned, redeemed, ...(tier ? { tier: tier.name } : {}) });
  }
  for (const a of adjustments) if (a.party === key) events.push({ date: a.date, ref: 'Adjustment', earned: a.points, redeemed: 0, note: a.note });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const { rows, lots } = runLots(events, program.expiry_months, asOf);
  let bal = 0;
  return {
    rows: rows.map((r) => {
      bal += r.earned - r.redeemed - r.expired;
      const { expired, ...rest } = r;
      return { ...rest, balance: bal, ...(expired ? { expired } : {}) } as LoyaltyEntry;
    }),
    lots,
  };
}

/** The points ledger of one customer (by name), oldest first, with a running balance (with expiry: "Expired" rows). */
export function pointsLedger(name: string, invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, asOf?: string): LoyaltyEntry[] {
  return pointsLots(name, invoices, adjustments, program, asOf).rows;
}

export function pointsBalance(name: string, invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, excludeDocId?: string, asOf?: string): number {
  const list = excludeDocId ? invoices.filter((i) => i.id !== excludeDocId) : invoices;
  const l = pointsLedger(name, list, adjustments, program, asOf);
  return l.length ? l[l.length - 1].balance : 0;
}

export interface LoyaltyLiability {
  /** Customers with points. */
  customers: number;
  points: number;
  /** Points × today's point value (₹). */
  value: number;
  /** Points lapsing in the rest of this calendar month, and their value. */
  expiringPoints: number;
  expiringValue: number;
  rows: { name: string; points: number; value: number; expiring: number; tier?: string }[];
}

/** R4-B2: outstanding points × point value, and what lapses this month — a working figure for the CA's provision. */
export function loyaltyLiability(invoices: readonly InvoiceRecord[], adjustments: readonly LoyaltyAdjustment[], program: LoyaltyProgram, today: string): LoyaltyLiability {
  const byParty = new Map<string, InvoiceRecord[]>();
  const names = new Map<string, string>();
  for (const i of invoices) {
    if (!eligibleParty(i.client?.name)) continue;
    const k = partyKey(i.client.name);
    names.set(k, i.client.name.trim());
    byParty.set(k, [...(byParty.get(k) ?? []), i]);
  }
  for (const a of adjustments) names.set(a.party, a.name);
  const value = ruleOn(program, today).point_value;
  const [y, m] = today.split('-').map(Number);
  const monthEnd = `${today.slice(0, 8)}${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  const rows: LoyaltyLiability['rows'] = [];
  for (const [key, name] of names) {
    const mine = byParty.get(key) ?? [];
    const { rows: l, lots } = pointsLots(name, mine, adjustments, program, today);
    const points = l.length ? l[l.length - 1].balance : 0;
    if (points <= 0) continue;
    const expiring = program.expiry_months ? expiringBetween(lots, shiftDay(today, 1), monthEnd) : 0;
    const tier = program.tiers?.length ? tierOn(program, spendEntries(mine), today).tier?.name : undefined;
    rows.push({ name, points, value: round2(points * value), expiring, ...(tier ? { tier } : {}) });
  }
  rows.sort((a, b) => b.points - a.points);
  const points = rows.reduce((s, r) => s + r.points, 0);
  const expiringPoints = rows.reduce((s, r) => s + r.expiring, 0);
  return { customers: rows.length, points, value: round2(points * value), expiringPoints, expiringValue: round2(expiringPoints * value), rows };
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

export interface LoyaltyInfo {
  enabled: boolean;
  balance: number;
  pointValue: number;
  minRedeem: number;
  /** R4-B2: the customer's tier today, the next tier and the spend still needed for it. */
  tier?: string;
  next?: { name: string; need: number };
  /** R4-B2: the next points to lapse. */
  expiring?: { date: string; points: number };
}

/** Balance and programme state for a customer (what the redeem box shows). */
export function loyaltyInfo(name: string): LoyaltyInfo {
  const program = readProgram();
  const today = localDayOf(new Date());
  const base = { enabled: program.enabled && eligibleParty(name), pointValue: ruleOn(program, today).point_value, minRedeem: program.min_redeem };
  if (!program.enabled) return { ...base, balance: 0 };
  // Read-only view: shown as the customer name is typed, so no re-parse of the invoice table per keystroke.
  const key = partyKey(name);
  const mine = peekTable<InvoiceRecord>('invoices').filter((i) => partyKey(i.client?.name) === key);
  const { rows, lots } = pointsLots(name, mine, adjustmentsDb.all(), program, today);
  const out: LoyaltyInfo = { ...base, balance: rows.length ? rows[rows.length - 1].balance : 0 };
  if (program.tiers?.length) {
    const { tier, spend } = tierOn(program, spendEntries(mine), today);
    if (tier) out.tier = tier.name;
    const n = nextTier(tiersOn(program.tiers, today), spend);
    if (n) out.next = { name: n.tier.name, need: n.need };
  }
  if (program.expiry_months) {
    const e = nextExpiry(lots, today);
    if (e) out.expiring = e;
  }
  return out;
}
