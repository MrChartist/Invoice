/**
 * Form 27Q working paper (7R, 7.120) — TDS on payments to NON-RESIDENTS (Sec 195 and other sections where the
 * payee is a non-resident). Built from the TDS register (`tdsDeductions`: rows of vendors flagged
 * `non_resident`) and the vendor's non-resident details (country, foreign TIN, Tax Residency Certificate, Form
 * 10F, no-PE declaration, DTAA rate / article — `Vendor.nr_*`).
 *
 * For every deduction the paper works out the rate that should have applied:
 *  - Act rate: `nrActRate` (tds-rules.ts, date-keyed, with health & education cess) for the nature of the payment
 *    (royalty / FTS / interest / other — from the section code: `195-R` / `195-F` / `195-I` / `195-O`);
 *  - DTAA rate: the vendor's typed treaty rate, ONLY when a TRC valid on the credit date and Form 10F are on file
 *    (Sec 90(4) / 90(5)); the lower of the two applies (Sec 90(2)); no cess on a treaty rate;
 *  - no PAN: Sec 206AA — at least 20%, unless the Rule 37BC details (country, foreign TIN, TRC) are on file
 *    (Sec 206AA(7)).
 * and flags SHORT deduction (rate applied below the required one) and non-resident rows booked under a resident
 * section. PENDING 40 (7.131) adds: surcharge on the Act rate by the payee's FY aggregate (`nrSurchargePct`,
 * unverified rows), Sec 195A grossing-up when the payer bears the tax (`Vendor.nr_tax_borne`: the amount credited
 * is the net, the income is net × 100 ÷ (100 − rate)), and the Form 15CA part / 15CB need per remittance (Rule
 * 37BB, `form15caPlan`). Sec 194LB / 194LC / 194LD concessional rates and the FVU text file are NOT modelled.
 *
 * UNVERIFIED: column order, section code '195', deductee codes, the "rate as per IT Act / DTAA" flag (A / B) and
 * remittance nature codes follow the NSDL RPU as we understand it — import through the RPU, validate with the FVU
 * and verify every rate with your CA. Pure (node:test).
 */

import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { toCsv } from './csv';
import { challanByKey, challanTotal, deducteeCode, type TdsChallan, type TdsDeductionRow, type TdsQuarter } from './tds-payables';
import { rpuDate } from './tds-returns';
import { FORM15CA_RULES, nrActRate, nrNatureOf, nrSurchargePct, payableSection, rpuCode2025, type NrNature } from './tds-rules';
import { ruleAt } from './tax-rules';
import { isValidPan } from './validators';
import { actRef, formText, quarterStart, sectionText } from './ita2025';

/** Section code of a 27Q row: the 2025-Act code from 1 Apr 2026 (23b), else the 1961 RPU code. */
const rpu27Q = (r: TdsDeductionRow): string => rpuCode2025(r.code, r.creditedOn) || payableSection(r.code)?.rpu || r.section;

export const FORM27Q_NOTE = 'UNVERIFIED Form 27Q working paper (non-residents) in NSDL RPU column order as understood — import through the RPU, validate with the FVU and verify every rate, the DTAA claim and Form 15CA / 15CB with your CA.';

/** Sec 206AA floor for a payee without PAN (no Rule 37BC details). */
export const NR_NO_PAN_RATE = 20;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const amt = (n: number) => round2(n).toFixed(2);

export interface NrPayee {
  country: string;
  tin: string;
  trcNo: string;
  trcTo: string;
  form10f: boolean;
  noPe: boolean;
  dtaaRate: number | null;
  dtaaArticle: string;
  /** PENDING 40: the payer bears the tax (Sec 195A grossing-up). */
  taxBorne: boolean;
}

export function nrPayeeOf(vendor: unknown): NrPayee {
  const v = (vendor ?? {}) as Record<string, unknown>;
  const rate = v.nr_dtaa_rate;
  return {
    country: str(v.nr_country),
    tin: str(v.nr_tin),
    trcNo: str(v.nr_trc_no),
    trcTo: isoDay(v.nr_trc_to),
    form10f: v.nr_form10f === true,
    noPe: v.nr_no_pe === true,
    dtaaRate: rate === undefined || rate === null || rate === '' || !Number.isFinite(Number(rate)) ? null : Number(rate),
    dtaaArticle: str(v.nr_dtaa_article),
    taxBorne: v.nr_tax_borne === true,
  };
}

/** TRC on file and (when a last valid day is entered) still valid on `date`. */
export function trcValidOn(p: Pick<NrPayee, 'trcNo' | 'trcTo'>, date: string): boolean {
  return !!p.trcNo && (!p.trcTo || date <= p.trcTo);
}

export interface NrRateCheck {
  nature: NrNature;
  /** Act rate with surcharge and cess (%). */
  actRate: number;
  /** PENDING 40: surcharge % in the required rate (0 below the first slab, or when a DTAA / 206AA rate applies). */
  surchargePct: number;
  /** DTAA rate typed on the vendor (null = none). */
  dtaaRate: number | null;
  /** Rate that should apply (%), and on what basis. */
  required: number;
  basis: 'DTAA' | 'ACT' | 'NO_PAN';
  /** DTAA rate typed but not usable (TRC / Form 10F missing or TRC expired). */
  dtaaBlocked: boolean;
  notes: string[];
}

/**
 * Rate that should have applied to a non-resident credit of `date` under section `code`. `aggregate` = the payee's
 * income paid or likely to be paid in the FY and subject to deduction (₹) — picks the surcharge slab.
 */
export function nrRateCheck(code: string, date: string, pan: string, deducteeType: TdsDeductionRow['deducteeType'], payee: NrPayee, aggregate = 0): NrRateCheck {
  const nature = nrNatureOf(code);
  const act = nrActRate(nature, date, deducteeType);
  const sc = nrSurchargePct(deducteeType, aggregate, date);
  const actRate = round2((act.base * (100 + sc) * (100 + act.cessPct)) / 10000);
  const notes: string[] = [];
  if (sc) notes.push(`Surcharge ${sc}% on the Act rate: the payee's income subject to deduction this FY is ₹${amt(aggregate)} (First Schedule Part II as understood — verify).`);
  let required = actRate;
  let basis: NrRateCheck['basis'] = 'ACT';
  let dtaaBlocked = false;
  if (payee.dtaaRate !== null) {
    const trc = trcValidOn(payee, date);
    if (trc && payee.form10f) {
      if (payee.dtaaRate < actRate) {
        required = payee.dtaaRate;
        basis = 'DTAA';
        notes.push(`DTAA rate ${payee.dtaaRate}%${payee.dtaaArticle ? ` (${payee.dtaaArticle})` : ''} is lower than the Act rate ${actRate}% — applied (TRC and Form 10F on file).`);
      } else notes.push(`Act rate ${actRate}% is not higher than the DTAA rate ${payee.dtaaRate}% — Act rate applies (Sec 90(2)).`);
    } else {
      dtaaBlocked = true;
      notes.push(`DTAA rate ${payee.dtaaRate}% cannot be applied: ${!payee.trcNo ? 'no Tax Residency Certificate' : !trc ? `TRC expired on ${payee.trcTo}` : 'Form 10F not on file'} (Sec 90(4) / 90(5)) — Act rate ${actRate}% (incl. ${act.cessPct}% cess${sc ? `, ${sc}% surcharge` : ''}).`);
    }
  }
  if (!isValidPan(pan)) {
    const rule37bc = !!payee.country && !!payee.tin && !!payee.trcNo;
    if (rule37bc) notes.push('No PAN: Rule 37BC details (country, foreign TIN, TRC) are on file, so Sec 206AA does not apply (Sec 206AA(7)) — verify.');
    else if (required < NR_NO_PAN_RATE) {
      required = NR_NO_PAN_RATE;
      basis = 'NO_PAN';
      notes.push(`No PAN and no Rule 37BC details: Sec 206AA rate ${NR_NO_PAN_RATE}%.`);
    }
  }
  if (!code.startsWith('195')) notes.push(`Booked under ${payableSection(code)?.label ?? code}: payments to a non-resident are normally deducted under Sec 195 — check the section.`);
  return { nature, actRate, surchargePct: basis === 'ACT' ? sc : 0, dtaaRate: payee.dtaaRate, required: round2(required), basis, dtaaBlocked, notes };
}

/**
 * Sec 195A: when the payer bears the tax, the income is the net amount grossed up so that, after deducting tax
 * at `ratePct`, the net is left: net × 100 ÷ (100 − rate), rupee-rounded.
 */
export function grossUp195A(net: number, ratePct: number): number {
  return ratePct > 0 && ratePct < 100 ? Math.round((net * 100) / (100 - ratePct)) : round2(net);
}

export interface Nr27qRow {
  row: TdsDeductionRow;
  payee: NrPayee;
  check: NrRateCheck;
  /** Tax that should have been deducted at `check.required` (rupee-rounded) and the shortfall (₹, ≥ 0). */
  requiredTds: number;
  shortBy: number;
  /** PENDING 40: Sec 195A — the income after grossing up the net amount credited (only when the payer bears the tax). */
  grossedUp?: number;
}

const payeeKey = (r: TdsDeductionRow) => r.vendorId || r.pan || r.payee;
/** "Sec 195A", or its 2025-Act label from 1 Apr 2026 (ita2025.ts). */
const sec195A = (date: string) => (actRef('195A', date).act === 2025 ? sectionText('195A', date) : 'Sec 195A');

/** Income subject to deduction per payee (₹), summed over the non-resident `rows`. */
export function nrAggregates(rows: readonly TdsDeductionRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (r.nonResident) m.set(payeeKey(r), round2((m.get(payeeKey(r)) ?? 0) + Math.max(r.base, 0)));
  return m;
}

/**
 * Non-resident rows of the register with the vendor's NR details and the rate check, oldest first. `fyRows` (the
 * whole FY of the register; default `rows`) gives each payee's aggregate for the surcharge slab.
 */
export function nr27qRows(rows: readonly TdsDeductionRow[], vendors: readonly unknown[], fyRows: readonly TdsDeductionRow[] = rows): Nr27qRow[] {
  const byId = new Map<string, unknown>();
  for (const v of vendors) if (v && typeof v === 'object') byId.set(str((v as Record<string, unknown>).id), v);
  const agg = nrAggregates(fyRows);
  const out: Nr27qRow[] = [];
  for (const r of rows) {
    if (!r.nonResident) continue;
    const payee = nrPayeeOf(r.vendorId ? byId.get(r.vendorId) : undefined);
    const total = agg.get(payeeKey(r)) ?? r.base;
    let check = nrRateCheck(r.code, r.creditedOn, r.pan, r.deducteeType, payee, total);
    let grossedUp: number | undefined;
    if (payee.taxBorne && r.base > 0) {
      // The grossed-up income may cross a surcharge slab: check again on the grossed aggregate.
      check = nrRateCheck(r.code, r.creditedOn, r.pan, r.deducteeType, payee, round2((total * grossUp195A(r.base, check.required)) / r.base));
      grossedUp = grossUp195A(r.base, check.required);
      check.notes.push(`${sec195A(r.creditedOn)}: tax borne by the payer — ₹${amt(r.base)} credited is grossed up to ₹${amt(grossedUp)} at ${check.required}%.`);
    }
    const income = grossedUp ?? r.base;
    const requiredTds = income > 0 ? Math.round((income * check.required) / 100) : r.amount;
    out.push({ row: r, payee, check, requiredTds, shortBy: Math.max(round2(requiredTds - r.amount), 0), ...(grossedUp !== undefined ? { grossedUp } : {}) });
  }
  return out;
}

/* ── Form 15CA / 15CB (Rule 37BB) ─────────────────────────────── */

export type Form15caPart = 'A' | 'B' | 'C' | 'D';

export interface Form15caRow {
  row: TdsDeductionRow;
  part: Form15caPart;
  /** Accountant's certificate (Form 15CB) needed before the remittance. */
  needs15cb: boolean;
  /** Payee's remittances of the FY so far, this one included (₹). */
  aggregate: number;
  why: string;
}

/**
 * Which part of Form 15CA each remittance to a non-resident falls in (Rule 37BB as substituted from 1 Apr 2016, as
 * understood): D — not chargeable to tax (the rate that applies is nil); B — a Sec 197 certificate or Sec 195(2) /
 * 195(3) order is on file; A — chargeable and the payee's remittances in the FY, this one included, do not exceed
 * `FORM15CA_RULES` (₹5 lakh); C — above that, after a Form 15CB from a chartered accountant. Remittances in the
 * Rule 37BB(3) specified list need no form — not modelled. `list` = one FY's rows. Working paper.
 */
export function form15caPlan(list: readonly Nr27qRow[]): Form15caRow[] {
  const sorted = [...list].sort((a, b) => a.row.creditedOn.localeCompare(b.row.creditedOn));
  const running = new Map<string, number>();
  const out: Form15caRow[] = [];
  for (const x of sorted) {
    const limit = ruleAt(FORM15CA_RULES, x.row.creditedOn).partALimit;
    const k = payeeKey(x.row);
    const aggregate = round2((running.get(k) ?? 0) + (x.grossedUp ?? x.row.base));
    running.set(k, aggregate);
    let part: Form15caPart;
    let why: string;
    if (x.check.required <= 0) [part, why] = ['D', 'Not chargeable to tax at the rate that applies.'];
    else if (x.row.certNo) [part, why] = ['B', `Certificate / order ${x.row.certNo} (Sec 197 / 195(2) / 195(3)) on file.`];
    else if (aggregate <= limit) [part, why] = ['A', `FY remittances ₹${amt(aggregate)} do not exceed ₹${amt(limit)}.`];
    else [part, why] = ['C', `FY remittances ₹${amt(aggregate)} exceed ₹${amt(limit)}: Form 15CB first.`];
    out.push({ row: x.row, part, needs15cb: part === 'C', aggregate, why });
  }
  return out;
}

const NATURE_CODE: Record<NrNature, string> = { ROYALTY: '49', FTS: '21', INTEREST: '27', OTHER: '99' };
const NATURE_LABEL: Record<NrNature, string> = { ROYALTY: 'Royalty', FTS: 'Fees for technical services', INTEREST: 'Interest', OTHER: 'Other remittance' };

export interface Form27QPaper {
  form: '27Q';
  /** Name for the period: "Form 27Q", or "Form 144 [old 27Q]" from Apr 2026 (Income-tax Act 2025). */
  formLabel: string;
  fy: number;
  quarter: TdsQuarter;
  challanRows: (string | number)[][];
  deducteeRows: (string | number)[][];
  totals: { deducted: number; deposited: number; challans: number; shortBy: number };
  warnings: string[];
}

const CHALLAN_HEAD = ['Sr. No.', 'Section code', 'TDS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Interest (₹)', 'Fee (₹)', 'Others (₹)', 'Total (₹)', 'Cheque / DD no.', 'BSR code', 'Date of deposit', 'Challan serial no.', 'Minor head', 'Book entry'];
const DEDUCTEE_HEAD = ['Sr. No.', 'Challan Sr. No.', 'Section code', 'Deductee code', 'PAN of deductee', 'Name of deductee', 'Date of payment / credit', 'Amount paid / credited (₹)', 'TDS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Total tax deducted (₹)', 'Total tax deposited (₹)', 'Date of deduction', 'Rate (%)', 'Reason for non / lower / higher deduction', 'Certificate no. (Sec 197)', 'Rate as per IT Act (A) / DTAA (B)', 'Nature of remittance', 'Form 15CA acknowledgement', 'Country of residence', 'Tax identification no.', 'TRC on file', 'Form 10F', 'Required rate (%)', 'Short deduction (₹)', 'Form 15CA part (Rule 37BB)'];

/** Form 27Q for a quarter (non-resident rows only; TDS challans, never TCS). */
export function form27Q(rows: readonly TdsDeductionRow[], vendors: readonly unknown[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): Form27QPaper {
  const fyRows = rows.filter((r) => r.fy === fy);
  // PENDING 40: the FY's rows give each payee's aggregate (surcharge slab, Form 15CA Part A limit).
  const fyList = nr27qRows(fyRows, vendors);
  const list = fyList.filter((x) => x.row.quarter === quarter);
  const partOf = new Map(form15caPlan(fyList).map((p) => [p.row.key, p]));
  const warnings: string[] = [];
  const byKey = challanByKey(challans.filter((c) => c.kind !== 'TCS'));
  const used = [...new Set(list.map((x) => byKey.get(x.row.key)).filter((c): c is TdsChallan => !!c))].sort((a, b) => a.date.localeCompare(b.date) || a.challan_no.localeCompare(b.challan_no));
  const srOf = new Map(used.map((c, i) => [c.id, i + 1]));
  const challanRows: (string | number)[][] = [CHALLAN_HEAD];
  used.forEach((c, i) => {
    const codes = [...new Set(list.filter((x) => byKey.get(x.row.key)?.id === c.id).map((x) => rpu27Q(x.row)))];
    challanRows.push([i + 1, codes.length === 1 ? codes[0] : '', amt(c.amount), '0.00', '0.00', amt(num(c.interest)), amt(num(c.fee)), amt(num(c.others)), amt(challanTotal(c)), '', c.bsr_code, rpuDate(c.date), c.challan_no, c.minor_head ?? '200', 'N']);
  });
  const deducteeRows: (string | number)[][] = [DEDUCTEE_HEAD];
  let deposited = 0;
  let shortBy = 0;
  list.forEach((x, i) => {
    const r = x.row;
    const ch = byKey.get(r.key);
    if (ch) deposited += r.amount;
    else warnings.push(`${r.payee}: ₹${amt(r.amount)} deducted on ${r.deductedOn} is not linked to a challan.`);
    if (!r.pan && !(x.payee.country && x.payee.tin)) warnings.push(`${r.payee}: no PAN and no Rule 37BC details (country, foreign TIN) — the RPU needs PANNOTAVBL and the 20% rate.`);
    if (!x.payee.country) warnings.push(`${r.payee}: country of residence missing (vendor form → non-resident details).`);
    if (x.shortBy > 0) {
      shortBy += x.shortBy;
      warnings.push(`${r.payee}: short deduction ₹${amt(x.shortBy)} — ${r.rate}% applied, ${x.check.required}% required (${x.check.basis === 'DTAA' ? 'DTAA' : x.check.basis === 'NO_PAN' ? 'Sec 206AA' : 'Act rate with cess'}).`);
    }
    for (const n of x.check.notes) if (/cannot be applied|Booked under|Sec 195A|Surcharge/.test(n)) warnings.push(`${r.payee}: ${n}`);
    // Act rate includes surcharge and cess: split the TDS into tax + surcharge + cess for the RPU columns; a DTAA
    // rate carries neither.
    const cessPct = x.check.basis === 'DTAA' ? 0 : nrActRate(x.check.nature, r.creditedOn, r.deducteeType).cessPct;
    const sc = x.check.surchargePct;
    const tax = cessPct || sc ? round2((r.amount * 10000) / ((100 + sc) * (100 + cessPct))) : r.amount;
    const surcharge = round2((tax * sc) / 100);
    const cess = round2(r.amount - tax - surcharge);
    const plan = partOf.get(r.key);
    deducteeRows.push([
      i + 1, ch ? srOf.get(ch.id) ?? '' : '', rpu27Q(r), deducteeCode(r.deducteeType), r.pan || 'PANNOTAVBL', r.payee,
      rpuDate(r.creditedOn), amt(x.grossedUp ?? r.base), amt(tax), amt(surcharge), amt(cess), amt(r.amount), ch ? amt(r.amount) : '0.00', rpuDate(r.deductedOn), r.rate, r.reason, r.certNo,
      x.check.basis === 'DTAA' ? 'B' : 'A', `${NATURE_CODE[x.check.nature]} ${NATURE_LABEL[x.check.nature]}`, '', x.payee.country, x.payee.tin,
      x.payee.trcNo ? `${x.payee.trcNo}${x.payee.trcTo ? ` (to ${rpuDate(x.payee.trcTo)})` : ''}` : 'No', x.payee.form10f ? 'Yes' : 'No', x.check.required, amt(x.shortBy),
      plan ? `${plan.part}${plan.needs15cb ? ' + 15CB' : ''}` : '',
    ]);
  });
  const deducted = round2(list.reduce((t, x) => t + x.row.amount, 0));
  // Income-tax Act 2025: Sec 195 → Sec 393(2) Table; 23b: section codes of the Protean Form 144 file format v1.2.
  const ref = list.find((x) => actRef(x.row.code, x.row.creditedOn).act === 2025);
  if (ref) warnings.push(`Income-tax Act 2025 period: ${sectionText(ref.row.code, ref.row.creditedOn)}. Section codes are the 2025-Act codes of the Protean Form 144 file format v1.2 (Annexure 2); the nature-of-remittance codes stay as understood — validate with the FVU and verify with your CA.`);
  return { form: '27Q', formLabel: formText('27Q', quarterStart(fy, quarter)), fy, quarter, challanRows, deducteeRows, totals: { deducted, deposited: round2(deposited), challans: used.length, shortBy: round2(shortBy) }, warnings: [...new Set(warnings)] };
}

export function form27QCsv(p: Form27QPaper): string {
  return toCsv([[FORM27Q_NOTE], [p.formLabel, `FY ${p.fy}-${String(p.fy + 1).slice(2)}`, `Q${p.quarter}`], [], ['Challan details'], ...p.challanRows, [], ['Deductee details (non-residents)'], ...p.deducteeRows, [], ['Warnings'], ...p.warnings.map((w) => [w])]);
}

export function form27QSheets(p: Form27QPaper): { name: string; rows: (string | number)[][] }[] {
  return [
    { name: 'Challans', rows: p.challanRows },
    { name: 'Deductees', rows: p.deducteeRows },
    { name: 'Notes', rows: [['Note'], [FORM27Q_NOTE], [p.formLabel], ...p.warnings.map((w) => [w])] },
  ];
}
