/**
 * TDS we deduct from suppliers (payables side, Tally parity): rate and threshold checks for a bill,
 * the deduction register (bills, payments and manual rows), TDS / TCS challans (ITNS 281) linked to
 * deductions, Sec 201(1A) interest estimates and the deposit / return calendar.
 *
 * Model
 *  - "Deduct on bill" (Tally's default, `tds_on: 'BILL'`): the bill carries `tds_*` fields; what the
 *    supplier is owed drops by the TDS (`supplierPayable`) and the ledger credits the section's TDS
 *    payable account. Tax is deductible and deducted on the bill date.
 *  - "Deduct on payment" (`tds_on: 'PAYMENT'`): each `purchase_payments` row may carry `tds_amount`;
 *    the bill is settled by cash + TDS. Tax became deductible on the bill date (earlier of credit and
 *    payment), so a later deduction attracts 1% / month interest.
 *  - Manual deductions (`tds_deductions`): register-only rows for TDS booked outside bills (e.g. a
 *    journal for rent); they are not posted to the ledger.
 *  - Challans (`tds_challans`): BSR code, challan serial, date, tax / interest / fee and the keys of
 *    the deductions they deposit. The ledger posts them as payments (Dr TDS / TCS payable, Dr interest
 *    & fees, Cr bank).
 *
 * Pure above the "Storage" divider (node:test). Working papers — verify with your CA / TRACES.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { assertUnlocked } from './period-lock';
import { readPurchase, isVoidStatus } from './purchase-normalize';
import { generateId, getTable, setTable } from './storage';
import { ruleAt } from './tax-rules';
import {
  TDS_206AB_RULES,
  TDS_NO_PAN_RULES,
  payableSection,
  sectionRate,
  tdsDueDays,
  tdsInterestRates,
  tdsThreshold,
  type DeducteeType,
} from './tds-rules';
import { isValidPan } from './validators';

export type TdsQuarter = 1 | 2 | 3 | 4;

/* ── Periods ──────────────────────────────────────────────────── */

/** Indian FY start year and quarter of a `YYYY-MM-DD` day (read as a calendar day). */
export function fyQuarterOf(day: string): { fy: number; quarter: TdsQuarter } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(day ?? '');
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  return { fy: mo >= 4 ? y : y - 1, quarter: (mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3) as TdsQuarter };
}

export function quarterSpan(fy: number, q: TdsQuarter): { from: string; to: string } {
  if (q === 1) return { from: `${fy}-04-01`, to: `${fy}-06-30` };
  if (q === 2) return { from: `${fy}-07-01`, to: `${fy}-09-30` };
  if (q === 3) return { from: `${fy}-10-01`, to: `${fy}-12-31` };
  return { from: `${fy + 1}-01-01`, to: `${fy + 1}-03-31` };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Months or part of a month from `from` to `to` (calendar months, both ends counted); 0 when `to <= from`. */
export function monthsOrPart(from: string, to: string): number {
  if (!from || !to || to <= from) return 0;
  return (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7)) + 1;
}

/** Last day to deposit tax deducted / collected on `day`: 7th of next month; TDS of March by 30 April. */
export function depositDueDate(day: string, kind: 'TDS' | 'TCS' = 'TDS'): string {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7);
  const rules = tdsDueDays(day);
  if (kind === 'TDS' && m === 3) return `${y}-${rules.marchTdsDue}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(rules.depositDay)}`;
}

/** Quarterly return due date: 26Q / 27Q (TDS) or 27EQ (TCS). */
export function returnDueDate(fy: number, q: TdsQuarter, kind: 'TDS' | 'TCS' = 'TDS'): string {
  const r = tdsDueDays(quarterSpan(fy, q).from);
  const md = (kind === 'TDS' ? r.tdsReturn : r.tcsReturn)[q - 1];
  // Q1–Q3 are due in the same calendar year as the quarter; Q3 (Jan) and Q4 (May / Jul) in fy + 1.
  return `${q === 1 || q === 2 ? fy : fy + 1}-${md}`;
}

/** Form 16A (TDS) / 27D (TCS) — `certDays` after the return due date. */
export function certificateDueDate(fy: number, q: TdsQuarter, kind: 'TDS' | 'TCS' = 'TDS'): string {
  const due = returnDueDate(fy, q, kind);
  const days = tdsDueDays(due).certDays;
  const d = new Date(Date.UTC(+due.slice(0, 4), +due.slice(5, 7) - 1, +due.slice(8, 10) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* ── Payee ────────────────────────────────────────────────────── */

/** Deductee category from the PAN's 4th character (C company, P individual, H HUF, F firm / LLP). */
export function deducteeTypeFromPan(pan: string | undefined): DeducteeType | undefined {
  const p = (pan ?? '').trim().toUpperCase();
  if (!isValidPan(p)) return undefined;
  const c = p[3];
  return c === 'C' ? 'COMPANY' : c === 'P' ? 'INDIVIDUAL' : c === 'H' ? 'HUF' : c === 'F' ? 'FIRM' : 'OTHER';
}

/** 26Q / 27EQ deductee code: 01 company, 02 anyone else. */
export function deducteeCode(t: DeducteeType | undefined): '01' | '02' {
  return t === 'COMPANY' ? '01' : '02';
}

export interface Payee {
  pan?: string;
  deducteeType?: DeducteeType;
  nonFiler?: boolean;
  lowerRate?: number;
  lowerCert?: string;
}

/* ── Rate ─────────────────────────────────────────────────────── */

export interface TdsRate {
  /** Rate to apply (%). */
  rate: number;
  /** Rate in the Act for the section and payee category (%). */
  actRate: number;
  /** 26Q reason code: '' normal, 'A' Sec 197 certificate, 'C' higher rate (206AA / 206AB). */
  reason: '' | 'A' | 'C';
  notes: string[];
  deducteeType: DeducteeType;
  panValid: boolean;
}

/** Rate for a section on `date` for a payee. Null when the section was not in force that day. */
export function tdsRateFor(code: string, date: string, payee: Payee = {}): TdsRate | null {
  const panValid = isValidPan(payee.pan);
  const deducteeType = payee.deducteeType ?? deducteeTypeFromPan(payee.pan) ?? 'OTHER';
  const act = sectionRate(code, date, deducteeType);
  if (act === null) return null;
  const notes: string[] = [];
  let rate = act;
  let reason: TdsRate['reason'] = '';
  const sec = payableSection(code)?.section ?? code;
  if (!panValid) {
    const r = ruleAt(TDS_NO_PAN_RULES, date);
    const floor = r.overrides[sec] ?? r.rate;
    if (floor > rate) {
      rate = floor;
      reason = 'C';
    }
    notes.push(`No valid PAN: Sec 206AA rate ${rate}%.`);
  } else if (payee.lowerCert && typeof payee.lowerRate === 'number' && payee.lowerRate >= 0) {
    rate = payee.lowerRate;
    reason = 'A';
    notes.push(`Sec 197 certificate ${payee.lowerCert}: ${rate}%.`);
  }
  const ab = ruleAt(TDS_206AB_RULES, date);
  if (payee.nonFiler && reason !== 'A') {
    if (ab.active) {
      const abRate = Math.max(act * ab.multiplier, ab.floor);
      if (abRate > rate) {
        rate = abRate;
        reason = 'C';
      }
      notes.push(`Non-filer (Sec 206AB): ${abRate}%.`);
    } else {
      notes.push('Sec 206AB is not in force on this date — normal rate.');
    }
  }
  return { rate, actRate: act, reason, notes, deducteeType, panValid };
}

/* ── Threshold ────────────────────────────────────────────────── */

export interface PriorCredit {
  id?: string;
  date: string;
  /** Amount credited / paid (₹), GST excluded. */
  base: number;
  /** TDS already deducted on it (₹). */
  tds: number;
  /** Section code, '' when the bill carried none (assumed the same nature for the same payee). */
  code: string;
}

export interface ThresholdResult {
  applies: boolean;
  /** Amount TDS is computed on (this credit + earlier untaxed credits once the aggregate is crossed). */
  taxableBase: number;
  /** Earlier untaxed credits of the FY brought in when the aggregate is crossed. */
  catchUp: number;
  aggregateBefore: number;
  aggregateAfter: number;
  /** '' or 'Y' (threshold not crossed — 26Q reason for no deduction). */
  reason: '' | 'Y';
  message: string;
}

/**
 * Single and aggregate (same payee, same Indian FY, same section family) threshold check for a new
 * credit of `base` on `date`. 194Q: only the part above ₹50 lakh is taxed.
 */
export function thresholdCheck(code: string, date: string, base: number, prior: readonly PriorCredit[], excludeId?: string): ThresholdResult {
  const family = payableSection(code)?.family ?? code;
  const th = tdsThreshold(family, date);
  const amt = round2(Math.max(num(base), 0));
  const fq = fyQuarterOf(date);
  const same = prior.filter((p) => {
    if (excludeId && p.id === excludeId) return false;
    const q = fyQuarterOf(p.date);
    if (!q || !fq || q.fy !== fq.fy || p.date > date) return false;
    return !p.code || (payableSection(p.code)?.family ?? p.code) === family;
  });
  const aggregateBefore = round2(same.reduce((s, p) => s + Math.max(num(p.base), 0), 0));
  const aggregateAfter = round2(aggregateBefore + amt);
  const none = (message: string): ThresholdResult => ({ applies: false, taxableBase: 0, catchUp: 0, aggregateBefore, aggregateAfter, reason: 'Y', message });
  if (!th) return { applies: amt > 0, taxableBase: amt, catchUp: 0, aggregateBefore, aggregateAfter, reason: '', message: 'No threshold for this section.' };
  if (th.exceedOnly && th.aggregate) {
    if (aggregateAfter <= th.aggregate) return none(`FY purchases from this seller ₹${aggregateAfter.toFixed(2)} are within ₹${th.aggregate}.`);
    const taxable = round2(aggregateAfter - Math.max(aggregateBefore, th.aggregate));
    return { applies: true, taxableBase: taxable, catchUp: 0, aggregateBefore, aggregateAfter, reason: '', message: `TDS on the ₹${taxable.toFixed(2)} above ₹${th.aggregate} (FY total ₹${aggregateAfter.toFixed(2)}).` };
  }
  const singleHit = !!th.single && amt > th.single;
  const aggHit = !!th.aggregate && aggregateAfter > th.aggregate;
  if (!singleHit && !aggHit) {
    const parts = [th.single ? `single ₹${th.single}${th.perMonth ? ' a month' : ''}` : '', th.aggregate ? `FY aggregate ₹${th.aggregate} (now ₹${aggregateAfter.toFixed(2)})` : ''].filter(Boolean);
    return none(`Below the threshold: ${parts.join(', ')}.`);
  }
  const catchUp = aggHit ? round2(same.filter((p) => !(num(p.tds) > 0)).reduce((s, p) => s + Math.max(num(p.base), 0), 0)) : 0;
  return {
    applies: true,
    taxableBase: round2(amt + catchUp),
    catchUp,
    aggregateBefore,
    aggregateAfter,
    reason: '',
    message: aggHit
      ? `FY aggregate ₹${aggregateAfter.toFixed(2)} crosses ₹${th.aggregate}${catchUp ? `: TDS also on earlier untaxed credits of ₹${catchUp.toFixed(2)}` : ''}.`
      : `Single credit above ₹${th.single}${th.perMonth ? ' a month' : ''}.`,
  };
}

/** TDS is rounded to the nearest rupee (Sec 288B). */
export function roundTds(x: number): number {
  return Math.round(Math.max(num(x), 0));
}

export interface TdsSuggestion {
  applies: boolean;
  code: string;
  rate: number;
  base: number;
  amount: number;
  reason: '' | 'A' | 'C' | 'Y';
  deducteeType: DeducteeType;
  notes: string[];
  threshold: ThresholdResult;
}

/** Everything the bill form shows: rate after 206AA / 206AB / 197, threshold, base and amount. */
export function suggestTds(code: string, date: string, base: number, payee: Payee, prior: readonly PriorCredit[], excludeId?: string): TdsSuggestion | null {
  const r = tdsRateFor(code, date, payee);
  if (!r) return null;
  const t = thresholdCheck(code, date, base, prior, excludeId);
  const amount = t.applies ? roundTds((t.taxableBase * r.rate) / 100) : 0;
  return {
    applies: t.applies,
    code,
    rate: r.rate,
    base: t.applies ? t.taxableBase : round2(Math.max(num(base), 0)),
    amount,
    reason: t.applies ? r.reason : 'Y',
    deducteeType: r.deducteeType,
    notes: [t.message, ...r.notes],
    threshold: t,
  };
}

/** What the bill form's TDS block holds. `section` '' = no TDS. Undefined rate / base / amount follow the suggestion. */
export interface BillTdsInput {
  section: string;
  on: 'BILL' | 'PAYMENT';
  pan: string;
  nonFiler?: boolean;
  lowerCert?: string;
  lowerRate?: number;
  rate?: number;
  base?: number;
  amount?: number;
}

export type BillTdsFields = Pick<PurchaseRecordTds, 'tds_section' | 'tds_rate' | 'tds_base' | 'tds_amount' | 'tds_on' | 'tds_pan' | 'tds_deductee_type' | 'tds_reason' | 'tds_cert_no'>;

interface PurchaseRecordTds {
  tds_section?: string;
  tds_rate?: number;
  tds_base?: number;
  tds_amount?: number;
  tds_on?: 'BILL' | 'PAYMENT';
  tds_pan?: string;
  tds_deductee_type?: DeducteeType;
  tds_reason?: string;
  tds_cert_no?: string;
}

const NO_TDS: BillTdsFields = { tds_section: undefined, tds_rate: undefined, tds_base: undefined, tds_amount: undefined, tds_on: undefined, tds_pan: undefined, tds_deductee_type: undefined, tds_reason: undefined, tds_cert_no: undefined };

/**
 * The bill form's TDS block → the suggestion shown and the fields saved on the bill (all undefined
 * when TDS is off, so an edit clears them). The user may override rate, base or amount.
 */
export function resolveBillTds(v: BillTdsInput, ctx: { date: string; taxable: number; prior: readonly PriorCredit[]; excludeId?: string }): { suggestion: TdsSuggestion | null; fields: BillTdsFields } {
  if (!v.section) return { suggestion: null, fields: NO_TDS };
  const pan = v.pan.trim().toUpperCase();
  const suggestion = suggestTds(v.section, ctx.date, ctx.taxable, { pan, nonFiler: v.nonFiler, lowerCert: v.lowerCert, lowerRate: v.lowerRate }, ctx.prior, ctx.excludeId);
  if (!suggestion) return { suggestion: null, fields: NO_TDS };
  const rate = v.rate ?? suggestion.rate;
  const base = v.base ?? suggestion.base;
  const amount = v.amount ?? (v.rate !== undefined || v.base !== undefined ? roundTds((base * rate) / 100) : suggestion.amount);
  if (!(amount > 0)) return { suggestion, fields: NO_TDS };
  return {
    suggestion,
    fields: {
      tds_section: v.section,
      tds_rate: rate,
      tds_base: round2(base),
      tds_amount: round2(amount),
      tds_on: v.on,
      tds_pan: pan || undefined,
      tds_deductee_type: suggestion.deducteeType,
      tds_reason: (v.rate === undefined && suggestion.reason !== 'Y' ? suggestion.reason : '') || undefined,
      tds_cert_no: v.lowerCert?.trim() || undefined,
    },
  };
}

/** Grouping key of a payee: PAN when valid, else vendor id, else the lower-cased name. */
export function payeeKeyOf(r: { pan?: unknown; vendorId?: unknown; name?: unknown }): string {
  const pan = String(r.pan ?? '').trim().toUpperCase();
  if (isValidPan(pan)) return `pan:${pan}`;
  const id = String(r.vendorId ?? '').trim();
  if (id) return `id:${id}`;
  return `name:${String(r.name ?? '').trim().toLowerCase()}`;
}

/** Earlier credits to the same supplier, read from the purchases table (any section, any bill). */
export function priorCreditsFor(purchases: readonly unknown[], vendor: { id?: string; name?: string; pan?: string }): PriorCredit[] {
  const out: PriorCredit[] = [];
  const name = (vendor.name ?? '').trim().toLowerCase();
  for (const raw of purchases) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status)) continue;
    const r = raw as Record<string, unknown>;
    const sameId = !!vendor.id && r.vendor_id === vendor.id;
    const samePan = isValidPan(vendor.pan) && String(r.tds_pan ?? '').toUpperCase() === String(vendor.pan).toUpperCase();
    const sameName = !vendor.id && !!name && c.partyName.toLowerCase() === name;
    if (!sameId && !samePan && !sameName) continue;
    out.push({ id: c.id, date: c.date, base: num(r.tds_base, c.taxable), tds: c.tdsAmount, code: c.tdsSection });
  }
  return out;
}

/* ── Register ─────────────────────────────────────────────────── */

export interface ManualTdsDeduction {
  id: string;
  vendor_id?: string;
  vendor_name: string;
  pan?: string;
  deductee_type?: DeducteeType;
  section: string;
  /** Day the amount was credited / paid (tax became deductible). */
  date: string;
  /** Day the tax was deducted (defaults to `date`). */
  deducted_on?: string;
  base: number;
  rate: number;
  amount: number;
  reason?: string;
  cert_no?: string;
  notes?: string;
  created_at?: string;
}

export interface TdsDeductionRow {
  /** `bill:<purchase id>`, `pay:<payment id>`, `man:<manual id>` — what challans link to. */
  key: string;
  source: 'bill' | 'payment' | 'manual';
  purchaseId?: string;
  paymentId?: string;
  manualId?: string;
  payee: string;
  payeeKey: string;
  vendorId?: string;
  pan: string;
  deducteeType: DeducteeType;
  code: string;
  section: string;
  rpu: string;
  billNumber: string;
  base: number;
  rate: number;
  amount: number;
  /** Tax became deductible (credit or payment, whichever first). */
  creditedOn: string;
  deductedOn: string;
  reason: string;
  certNo: string;
  nonResident: boolean;
  fy: number;
  quarter: TdsQuarter;
}

export interface RegisterInput {
  purchases: readonly unknown[];
  payments: readonly unknown[];
  manual?: readonly ManualTdsDeduction[];
  vendors?: readonly unknown[];
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Every TDS deduction we made, oldest first. */
export function tdsDeductions(input: RegisterInput): TdsDeductionRow[] {
  const out: TdsDeductionRow[] = [];
  const vendors = new Map<string, Record<string, unknown>>();
  for (const v of input.vendors ?? []) if (v && typeof v === 'object') vendors.set(s((v as Record<string, unknown>).id), v as Record<string, unknown>);
  const bills = new Map<string, Record<string, unknown>>();
  const push = (row: Omit<TdsDeductionRow, 'fy' | 'quarter' | 'section' | 'rpu' | 'payeeKey'>) => {
    const fq = fyQuarterOf(row.deductedOn);
    if (!fq || !(row.amount > 0)) return;
    const sec = payableSection(row.code);
    out.push({ ...row, section: sec?.section ?? row.code, rpu: sec?.rpu ?? '', payeeKey: payeeKeyOf({ pan: row.pan, vendorId: row.vendorId, name: row.payee }), ...fq });
  };
  for (const raw of input.purchases) {
    const c = readPurchase(raw, input.vendors ?? []);
    if (!c || isVoidStatus(c.status)) continue;
    const r = raw as Record<string, unknown>;
    bills.set(c.id, r);
    if (!(c.tdsAmount > 0) || s(r.tds_on).toUpperCase() === 'PAYMENT') continue;
    const vendor = vendors.get(s(r.vendor_id));
    const pan = (s(r.tds_pan) || s(vendor?.pan)).toUpperCase();
    push({
      key: `bill:${c.id}`,
      source: 'bill',
      purchaseId: c.id,
      payee: c.partyName,
      vendorId: s(r.vendor_id) || undefined,
      pan,
      deducteeType: (s(r.tds_deductee_type) as DeducteeType) || deducteeTypeFromPan(pan) || 'OTHER',
      code: c.tdsSection,
      billNumber: c.number,
      base: round2(num(r.tds_base, c.taxable)),
      rate: num(r.tds_rate),
      amount: c.tdsAmount,
      creditedOn: c.date,
      deductedOn: c.date,
      reason: s(r.tds_reason),
      certNo: s(r.tds_cert_no),
      nonResident: vendor?.non_resident === true,
    });
  }
  for (const raw of input.payments) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const tds = round2(Math.max(num(p.tds_amount), 0));
    const date = isoDay(p.date);
    if (!(tds > 0) || !date) continue;
    const bill = bills.get(s(p.purchase_id));
    const c = bill ? readPurchase(bill) : null;
    const vendor = vendors.get(s(bill?.vendor_id));
    const pan = (s(bill?.tds_pan) || s(vendor?.pan)).toUpperCase();
    const rate = num(bill?.tds_rate);
    const billTds = num(bill?.tds_amount);
    const billBase = num(bill?.tds_base, c?.taxable ?? 0);
    push({
      key: `pay:${s(p.id)}`,
      source: 'payment',
      purchaseId: c?.id,
      paymentId: s(p.id),
      payee: c?.partyName ?? 'Unknown vendor',
      vendorId: s(bill?.vendor_id) || undefined,
      pan,
      deducteeType: (s(bill?.tds_deductee_type) as DeducteeType) || deducteeTypeFromPan(pan) || 'OTHER',
      code: c?.tdsSection ?? '',
      billNumber: c?.number ?? '',
      base: billTds > 0 && billBase > 0 ? round2((billBase * tds) / billTds) : rate > 0 ? round2((tds * 100) / rate) : 0,
      rate,
      amount: tds,
      // Deductible at the earlier of credit (the bill) and payment.
      creditedOn: c && c.date < date ? c.date : date,
      deductedOn: date,
      reason: s(bill?.tds_reason),
      certNo: s(bill?.tds_cert_no),
      nonResident: vendor?.non_resident === true,
    });
  }
  for (const m of input.manual ?? []) {
    const date = isoDay(m.date);
    if (!date) continue;
    const pan = s(m.pan).toUpperCase();
    push({
      key: `man:${m.id}`,
      source: 'manual',
      manualId: m.id,
      payee: s(m.vendor_name) || 'Unknown payee',
      vendorId: s(m.vendor_id) || undefined,
      pan,
      deducteeType: m.deductee_type ?? deducteeTypeFromPan(pan) ?? 'OTHER',
      code: s(m.section),
      billNumber: '',
      base: round2(num(m.base)),
      rate: num(m.rate),
      amount: round2(num(m.amount)),
      creditedOn: date,
      deductedOn: isoDay(m.deducted_on) || date,
      reason: s(m.reason),
      certNo: s(m.cert_no),
      nonResident: false,
    });
  }
  return out.sort((a, b) => a.deductedOn.localeCompare(b.deductedOn) || a.key.localeCompare(b.key));
}

/* ── Challans ─────────────────────────────────────────────────── */

export interface TdsChallan {
  id: string;
  kind: 'TDS' | 'TCS';
  /** Date of deposit (tender date on the challan), YYYY-MM-DD. */
  date: string;
  /** 7-digit BSR code of the bank branch. */
  bsr_code: string;
  /** 5-digit challan serial number. */
  challan_no: string;
  /** Tax deposited (₹). */
  amount: number;
  interest?: number;
  /** Late filing fee u/s 234E. */
  fee?: number;
  others?: number;
  /** 200 = TDS/TCS payable by taxpayer, 400 = regular assessment. */
  minor_head?: '200' | '400';
  method?: string;
  bank_account_id?: string;
  /** Deduction keys (`bill:…`, `pay:…`, `man:…`, `tcs:…`) this challan deposits. */
  deduction_keys: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export function challanTotal(c: Pick<TdsChallan, 'amount' | 'interest' | 'fee' | 'others'>): number {
  return round2(num(c.amount) + num(c.interest) + num(c.fee) + num(c.others));
}

/** Problems with a challan (empty = it may be saved). `rows` resolve the linked keys. */
export function validateChallan(c: Omit<TdsChallan, 'id'> & { id?: string }, rows: readonly { key: string; amount: number }[], others: readonly TdsChallan[] = []): string[] {
  const errors: string[] = [];
  if (!/^\d{7}$/.test(s(c.bsr_code))) errors.push('BSR code is 7 digits.');
  if (!/^\d{5}$/.test(s(c.challan_no))) errors.push('Challan serial number is 5 digits.');
  if (!isoDay(c.date) || isoDay(c.date) !== c.date) errors.push('Choose the date of deposit.');
  if (!(num(c.amount) > 0)) errors.push('Enter the tax deposited.');
  if ([c.interest, c.fee, c.others].some((x) => num(x) < 0)) errors.push('Interest, fee and others cannot be negative.');
  const dup = others.find((o) => o.id !== c.id && o.bsr_code === s(c.bsr_code) && o.challan_no === s(c.challan_no) && o.date === c.date);
  if (dup) errors.push('A challan with this BSR code, date and serial number is already recorded.');
  const byKey = new Map(rows.map((r) => [r.key, r.amount]));
  const linked = round2((c.deduction_keys ?? []).reduce((t, k) => t + (byKey.get(k) ?? 0), 0));
  if (linked > num(c.amount) + 0.5) errors.push(`The linked deductions (₹${linked.toFixed(2)}) exceed the tax deposited.`);
  const taken = new Set(others.filter((o) => o.id !== c.id).flatMap((o) => o.deduction_keys ?? []));
  if ((c.deduction_keys ?? []).some((k) => taken.has(k))) errors.push('A linked deduction is already deposited with another challan.');
  return errors;
}

/** Deduction key → the challan that deposits it. */
export function challanByKey(challans: readonly TdsChallan[]): Map<string, TdsChallan> {
  const m = new Map<string, TdsChallan>();
  for (const c of challans) for (const k of c.deduction_keys ?? []) if (!m.has(k)) m.set(k, c);
  return m;
}

/**
 * Pick undeposited deductions for a new challan: oldest first, deducted on or before the challan
 * date (optionally only in `month` = 'YYYY-MM'), while they fit in `amount`.
 */
export function autoLink(rows: readonly { key: string; amount: number; deductedOn: string }[], challans: readonly TdsChallan[], amount: number, date: string, month?: string): string[] {
  const taken = challanByKey(challans);
  let left = round2(num(amount));
  const out: string[] = [];
  for (const r of [...rows].sort((a, b) => a.deductedOn.localeCompare(b.deductedOn))) {
    if (taken.has(r.key) || r.deductedOn > date || (month && r.deductedOn.slice(0, 7) !== month)) continue;
    if (r.amount <= left + 0.004) {
      out.push(r.key);
      left = round2(left - r.amount);
    }
  }
  return out;
}

/* ── Interest ─────────────────────────────────────────────────── */

export interface InterestEstimate {
  due: string;
  depositedOn: string;
  monthsLateDeduction: number;
  lateDeduction: number;
  monthsLatePayment: number;
  latePayment: number;
  total: number;
  /** Not deposited yet and past the due date: still growing until paid. */
  accruing: boolean;
}

/**
 * Sec 201(1A) (TDS) / 206C(7) (TCS) interest estimate for one deduction: late deduction from the day
 * it was deductible to the day deducted; late payment — when deposited after the due date — from the
 * day deducted to the day deposited (or `today` while unpaid). Month or part of a month = calendar
 * months, both ends counted (the TRACES convention). Rounded to the paisa; an estimate only.
 */
export function interestFor(row: { creditedOn: string; deductedOn: string; amount: number }, depositedOn: string | undefined, today: string, kind: 'TDS' | 'TCS' = 'TDS'): InterestEstimate {
  const due = depositDueDate(row.deductedOn, kind);
  const r = tdsInterestRates(row.deductedOn);
  const dedRate = kind === 'TDS' ? r.lateDeduction : r.tcsLateCollection;
  const payRate = kind === 'TDS' ? r.latePayment : r.tcsLatePayment;
  const monthsLateDeduction = monthsOrPart(row.creditedOn, row.deductedOn);
  const end = depositedOn || today;
  const monthsLatePayment = end > due ? monthsOrPart(row.deductedOn, end) : 0;
  const lateDeduction = round2((row.amount * dedRate * monthsLateDeduction) / 100);
  const latePayment = round2((row.amount * payRate * monthsLatePayment) / 100);
  return {
    due,
    depositedOn: depositedOn ?? '',
    monthsLateDeduction,
    lateDeduction,
    monthsLatePayment,
    latePayment,
    total: round2(lateDeduction + latePayment),
    accruing: !depositedOn && today > due,
  };
}

/* ── Returns filed marks ──────────────────────────────────────── */

export type TdsForm = '26Q' | '27Q' | '27EQ';

export interface TdsReturnMark {
  /** `${form}:${fy}-Q${quarter}` */
  id: string;
  form: TdsForm;
  fy: number;
  quarter: TdsQuarter;
  filed_on: string;
  /** Provisional receipt / token number. */
  token?: string;
  marked_at?: string;
}

export const returnMarkId = (form: TdsForm, fy: number, q: TdsQuarter) => `${form}:${fy}-Q${q}`;

/* ── Dashboard ────────────────────────────────────────────────── */

export interface QuarterSummary {
  fy: number;
  quarter: TdsQuarter;
  kind: 'TDS' | 'TCS';
  form: TdsForm;
  count: number;
  deducted: number;
  deposited: number;
  undeposited: number;
  interest: number;
  returnDue: string;
  certDue: string;
  filed?: TdsReturnMark;
  status: 'filed' | 'overdue' | 'due' | 'empty';
}

interface RowLike {
  key: string;
  amount: number;
  creditedOn: string;
  deductedOn: string;
  fy: number;
  quarter: TdsQuarter;
}

/** Deducted vs deposited vs filed for each quarter of `fy`. */
export function quarterSummaries(rows: readonly RowLike[], challans: readonly TdsChallan[], marks: readonly TdsReturnMark[], fy: number, today: string, kind: 'TDS' | 'TCS' = 'TDS'): QuarterSummary[] {
  const byKey = challanByKey(challans);
  const form: TdsForm = kind === 'TDS' ? '26Q' : '27EQ';
  return ([1, 2, 3, 4] as TdsQuarter[]).map((quarter) => {
    const list = rows.filter((r) => r.fy === fy && r.quarter === quarter);
    let deposited = 0;
    let interest = 0;
    for (const r of list) {
      const ch = byKey.get(r.key);
      if (ch) deposited += r.amount;
      interest += interestFor(r, ch?.date, today, kind).total;
    }
    const deducted = round2(list.reduce((t, r) => t + r.amount, 0));
    const filed = marks.find((m) => m.id === returnMarkId(form, fy, quarter));
    const returnDue = returnDueDate(fy, quarter, kind);
    const status: QuarterSummary['status'] = filed ? 'filed' : !list.length ? 'empty' : today > returnDue ? 'overdue' : 'due';
    return {
      fy,
      quarter,
      kind,
      form,
      count: list.length,
      deducted,
      deposited: round2(deposited),
      undeposited: round2(deducted - deposited),
      interest: round2(interest),
      returnDue,
      certDue: certificateDueDate(fy, quarter, kind),
      filed,
      status,
    };
  });
}

export interface DueItem {
  id: string;
  kind: 'TDS' | 'TCS';
  what: 'deposit' | 'return' | 'certificate';
  /** 'YYYY-MM' for deposits, 'FY-Qn' for returns / certificates. */
  period: string;
  due: string;
  amount: number;
  status: 'done' | 'late' | 'overdue' | 'upcoming';
}

/** Deposit (per month with deductions) and return / certificate due dates for `fy`, by due date. */
export function dueCalendar(rows: readonly RowLike[], challans: readonly TdsChallan[], marks: readonly TdsReturnMark[], fy: number, today: string, kind: 'TDS' | 'TCS' = 'TDS'): DueItem[] {
  const byKey = challanByKey(challans);
  const out: DueItem[] = [];
  const months = new Map<string, RowLike[]>();
  for (const r of rows) if (r.fy === fy) months.set(r.deductedOn.slice(0, 7), [...(months.get(r.deductedOn.slice(0, 7)) ?? []), r]);
  for (const [month, list] of months) {
    const due = depositDueDate(`${month}-01`, kind);
    const amount = round2(list.reduce((t, r) => t + r.amount, 0));
    const dates = list.map((r) => byKey.get(r.key)?.date ?? '');
    const all = dates.every(Boolean);
    const late = dates.some((d) => d && d > due);
    out.push({ id: `${kind}:dep:${month}`, kind, what: 'deposit', period: month, due, amount, status: all ? (late ? 'late' : 'done') : today > due ? 'overdue' : 'upcoming' });
  }
  const form: TdsForm = kind === 'TDS' ? '26Q' : '27EQ';
  for (const q of [1, 2, 3, 4] as TdsQuarter[]) {
    const list = rows.filter((r) => r.fy === fy && r.quarter === q);
    if (!list.length) continue;
    const mark = marks.find((m) => m.id === returnMarkId(form, fy, q));
    const due = returnDueDate(fy, q, kind);
    const amount = round2(list.reduce((t, r) => t + r.amount, 0));
    out.push({ id: `${kind}:ret:${fy}-Q${q}`, kind, what: 'return', period: `${fy}-Q${q}`, due, amount, status: mark ? (mark.filed_on > due ? 'late' : 'done') : today > due ? 'overdue' : 'upcoming' });
    const cdue = certificateDueDate(fy, q, kind);
    out.push({ id: `${kind}:cert:${fy}-Q${q}`, kind, what: 'certificate', period: `${fy}-Q${q}`, due: cdue, amount, status: today > cdue ? 'done' : 'upcoming' });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
}

/* ════════════════════════════════════════════════════════════════
   Storage (tables `tds_challans`, `tds_deductions`, `tds_returns`)
   ════════════════════════════════════════════════════════════════ */

export const TDS_CHALLANS_TABLE = 'tds_challans';
export const TDS_DEDUCTIONS_TABLE = 'tds_deductions';
export const TDS_RETURNS_TABLE = 'tds_returns';

export class TdsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TdsError';
  }
}

function cleanKeys(keys: unknown): string[] {
  return Array.isArray(keys) ? [...new Set(keys.filter((k): k is string => typeof k === 'string' && !!k))] : [];
}

export function loadChallans(): TdsChallan[] {
  return getTable<TdsChallan>(TDS_CHALLANS_TABLE)
    .filter((c) => c && typeof c.id === 'string' && isoDay(c.date))
    .map((c) => ({ ...c, kind: c.kind === 'TCS' ? 'TCS' : 'TDS', deduction_keys: cleanKeys(c.deduction_keys) }));
}

export function loadManualDeductions(): ManualTdsDeduction[] {
  return getTable<ManualTdsDeduction>(TDS_DEDUCTIONS_TABLE).filter((m) => m && typeof m.id === 'string');
}

export function loadReturnMarks(): TdsReturnMark[] {
  return getTable<TdsReturnMark>(TDS_RETURNS_TABLE).filter((m) => m && typeof m.id === 'string');
}

const money = (n: number) => `₹${round2(n).toFixed(2)}`;

/** Create / update a challan. Period lock on its date; audited. `rows` are the deductions it may link. */
export function saveChallan(input: Omit<TdsChallan, 'id' | 'created_at' | 'updated_at'> & { id?: string }, rows: readonly { key: string; amount: number }[]): TdsChallan {
  requireAccess('books.edit');
  const all = loadChallans();
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  const errors = validateChallan(input, rows, all);
  if (errors.length) throw new TdsError(errors[0]);
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked({ id, issue_date: prev.date, invoice_number: prev.challan_no }, 'edit');
  const lock = assertUnlocked({ id, issue_date: input.date, invoice_number: input.challan_no }, prev ? 'edit' : 'create');
  const now = new Date().toISOString();
  const row: TdsChallan = {
    id,
    kind: input.kind === 'TCS' ? 'TCS' : 'TDS',
    date: input.date,
    bsr_code: s(input.bsr_code),
    challan_no: s(input.challan_no),
    amount: round2(num(input.amount)),
    ...(num(input.interest) > 0 ? { interest: round2(num(input.interest)) } : {}),
    ...(num(input.fee) > 0 ? { fee: round2(num(input.fee)) } : {}),
    ...(num(input.others) > 0 ? { others: round2(num(input.others)) } : {}),
    minor_head: input.minor_head === '400' ? '400' : '200',
    ...(s(input.method) ? { method: s(input.method) } : {}),
    ...(s(input.bank_account_id) ? { bank_account_id: s(input.bank_account_id) } : {}),
    deduction_keys: cleanKeys(input.deduction_keys),
    ...(s(input.notes) ? { notes: s(input.notes) } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(TDS_CHALLANS_TABLE, prev ? all.map((c) => (c.id === id ? row : c)) : [...all, row]);
  audit.record({
    entity: 'tds',
    entity_id: id,
    action: prev ? 'update' : 'create',
    doc_number: `${row.bsr_code}/${row.challan_no}`,
    summary: `${prev ? 'Edited' : 'Recorded'} ${row.kind} challan ${row.bsr_code}/${row.challan_no} dated ${row.date} for ${money(challanTotal(row))} (${row.deduction_keys.length} deduction${row.deduction_keys.length === 1 ? '' : 's'} linked)${lock === 'overridden' ? ' (period lock overridden)' : ''}`,
  });
  return row;
}

export function deleteChallan(id: string): void {
  const all = loadChallans();
  const row = all.find((c) => c.id === id);
  if (!row) return;
  requireAccess('books.edit');
  assertUnlocked({ id, issue_date: row.date, invoice_number: row.challan_no }, 'delete');
  setTable(TDS_CHALLANS_TABLE, all.filter((c) => c.id !== id));
  audit.record({ entity: 'tds', entity_id: id, action: 'delete', doc_number: `${row.bsr_code}/${row.challan_no}`, summary: `Deleted ${row.kind} challan ${row.bsr_code}/${row.challan_no} dated ${row.date} (${money(challanTotal(row))})` });
}

export function saveManualDeduction(input: Omit<ManualTdsDeduction, 'id' | 'created_at'> & { id?: string }): ManualTdsDeduction {
  requireAccess('books.edit');
  const date = isoDay(input.date);
  if (!date) throw new TdsError('Choose the date the amount was credited or paid.');
  if (!s(input.vendor_name)) throw new TdsError('Enter the payee.');
  if (!payableSection(input.section)) throw new TdsError('Choose the TDS section.');
  if (!(num(input.amount) > 0)) throw new TdsError('Enter the TDS amount.');
  const all = loadManualDeductions();
  const prev = input.id ? all.find((m) => m.id === input.id) : undefined;
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked({ id, issue_date: prev.date }, 'edit');
  assertUnlocked({ id, issue_date: date }, prev ? 'edit' : 'create');
  const row: ManualTdsDeduction = {
    id,
    vendor_name: s(input.vendor_name),
    ...(s(input.vendor_id) ? { vendor_id: s(input.vendor_id) } : {}),
    ...(s(input.pan) ? { pan: s(input.pan).toUpperCase() } : {}),
    ...(input.deductee_type ? { deductee_type: input.deductee_type } : {}),
    section: input.section,
    date,
    ...(isoDay(input.deducted_on) ? { deducted_on: isoDay(input.deducted_on) } : {}),
    base: round2(num(input.base)),
    rate: num(input.rate),
    amount: round2(num(input.amount)),
    ...(s(input.reason) ? { reason: s(input.reason) } : {}),
    ...(s(input.cert_no) ? { cert_no: s(input.cert_no) } : {}),
    ...(s(input.notes) ? { notes: s(input.notes) } : {}),
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  setTable(TDS_DEDUCTIONS_TABLE, prev ? all.map((m) => (m.id === id ? row : m)) : [...all, row]);
  audit.record({ entity: 'tds', entity_id: id, action: prev ? 'update' : 'create', doc_number: row.section, summary: `${prev ? 'Edited' : 'Recorded'} manual TDS deduction u/s ${row.section} from ${row.vendor_name} dated ${row.date}: ${money(row.amount)}` });
  return row;
}

export function deleteManualDeduction(id: string): void {
  const all = loadManualDeductions();
  const row = all.find((m) => m.id === id);
  if (!row) return;
  requireAccess('books.edit');
  assertUnlocked({ id, issue_date: row.date }, 'delete');
  setTable(TDS_DEDUCTIONS_TABLE, all.filter((m) => m.id !== id));
  audit.record({ entity: 'tds', entity_id: id, action: 'delete', doc_number: row.section, summary: `Deleted manual TDS deduction u/s ${row.section} from ${row.vendor_name} (${money(row.amount)})` });
}

/** Mark a quarterly return filed (or clear the mark with `filedOn` null). Audited. */
export function setReturnFiled(form: TdsForm, fy: number, quarter: TdsQuarter, filedOn: string | null, token = ''): TdsReturnMark[] {
  requireAccess('books.edit');
  const id = returnMarkId(form, fy, quarter);
  const rest = loadReturnMarks().filter((m) => m.id !== id);
  const day = filedOn ? isoDay(filedOn) : '';
  const rows = day ? [...rest, { id, form, fy, quarter, filed_on: day, ...(token.trim() ? { token: token.trim() } : {}), marked_at: new Date().toISOString() }] : rest;
  setTable(TDS_RETURNS_TABLE, rows);
  audit.record({ entity: 'tds', entity_id: id, action: 'update', doc_number: id, summary: day ? `Form ${form} for Q${quarter} FY${fy}-${String(fy + 1).slice(2)} marked filed on ${day}` : `Form ${form} for Q${quarter} FY${fy}-${String(fy + 1).slice(2)} filed mark cleared` });
  return rows;
}
