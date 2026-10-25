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
 * section. Surcharge, Sec 194LB / 194LC / 194LD concessional rates, grossing-up (Sec 195A) and Form 15CA / 15CB
 * are NOT modelled.
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
import { nrActRate, nrNatureOf, payableSection, type NrNature } from './tds-rules';
import { isValidPan } from './validators';

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
  };
}

/** TRC on file and (when a last valid day is entered) still valid on `date`. */
export function trcValidOn(p: Pick<NrPayee, 'trcNo' | 'trcTo'>, date: string): boolean {
  return !!p.trcNo && (!p.trcTo || date <= p.trcTo);
}

export interface NrRateCheck {
  nature: NrNature;
  /** Act rate with cess (%). */
  actRate: number;
  /** DTAA rate typed on the vendor (null = none). */
  dtaaRate: number | null;
  /** Rate that should apply (%), and on what basis. */
  required: number;
  basis: 'DTAA' | 'ACT' | 'NO_PAN';
  /** DTAA rate typed but not usable (TRC / Form 10F missing or TRC expired). */
  dtaaBlocked: boolean;
  notes: string[];
}

/** Rate that should have applied to a non-resident credit of `date` under section `code`. */
export function nrRateCheck(code: string, date: string, pan: string, deducteeType: TdsDeductionRow['deducteeType'], payee: NrPayee): NrRateCheck {
  const nature = nrNatureOf(code);
  const act = nrActRate(nature, date, deducteeType);
  const notes: string[] = [];
  let required = act.rate;
  let basis: NrRateCheck['basis'] = 'ACT';
  let dtaaBlocked = false;
  if (payee.dtaaRate !== null) {
    const trc = trcValidOn(payee, date);
    if (trc && payee.form10f) {
      if (payee.dtaaRate < act.rate) {
        required = payee.dtaaRate;
        basis = 'DTAA';
        notes.push(`DTAA rate ${payee.dtaaRate}%${payee.dtaaArticle ? ` (${payee.dtaaArticle})` : ''} is lower than the Act rate ${act.rate}% — applied (TRC and Form 10F on file).`);
      } else notes.push(`Act rate ${act.rate}% is not higher than the DTAA rate ${payee.dtaaRate}% — Act rate applies (Sec 90(2)).`);
    } else {
      dtaaBlocked = true;
      notes.push(`DTAA rate ${payee.dtaaRate}% cannot be applied: ${!payee.trcNo ? 'no Tax Residency Certificate' : !trc ? `TRC expired on ${payee.trcTo}` : 'Form 10F not on file'} (Sec 90(4) / 90(5)) — Act rate ${act.rate}% (incl. ${act.cessPct}% cess).`);
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
  return { nature, actRate: act.rate, dtaaRate: payee.dtaaRate, required: round2(required), basis, dtaaBlocked, notes };
}

export interface Nr27qRow {
  row: TdsDeductionRow;
  payee: NrPayee;
  check: NrRateCheck;
  /** Tax that should have been deducted at `check.required` (rupee-rounded) and the shortfall (₹, ≥ 0). */
  requiredTds: number;
  shortBy: number;
}

/** Non-resident rows of the register with the vendor's NR details and the rate check, oldest first. */
export function nr27qRows(rows: readonly TdsDeductionRow[], vendors: readonly unknown[]): Nr27qRow[] {
  const byId = new Map<string, unknown>();
  for (const v of vendors) if (v && typeof v === 'object') byId.set(str((v as Record<string, unknown>).id), v);
  const out: Nr27qRow[] = [];
  for (const r of rows) {
    if (!r.nonResident) continue;
    const payee = nrPayeeOf(r.vendorId ? byId.get(r.vendorId) : undefined);
    const check = nrRateCheck(r.code, r.creditedOn, r.pan, r.deducteeType, payee);
    const requiredTds = r.base > 0 ? Math.round((r.base * check.required) / 100) : r.amount;
    out.push({ row: r, payee, check, requiredTds, shortBy: Math.max(round2(requiredTds - r.amount), 0) });
  }
  return out;
}

const NATURE_CODE: Record<NrNature, string> = { ROYALTY: '49', FTS: '21', INTEREST: '27', OTHER: '99' };
const NATURE_LABEL: Record<NrNature, string> = { ROYALTY: 'Royalty', FTS: 'Fees for technical services', INTEREST: 'Interest', OTHER: 'Other remittance' };

export interface Form27QPaper {
  form: '27Q';
  fy: number;
  quarter: TdsQuarter;
  challanRows: (string | number)[][];
  deducteeRows: (string | number)[][];
  totals: { deducted: number; deposited: number; challans: number; shortBy: number };
  warnings: string[];
}

const CHALLAN_HEAD = ['Sr. No.', 'Section code', 'TDS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Interest (₹)', 'Fee (₹)', 'Others (₹)', 'Total (₹)', 'Cheque / DD no.', 'BSR code', 'Date of deposit', 'Challan serial no.', 'Minor head', 'Book entry'];
const DEDUCTEE_HEAD = ['Sr. No.', 'Challan Sr. No.', 'Section code', 'Deductee code', 'PAN of deductee', 'Name of deductee', 'Date of payment / credit', 'Amount paid / credited (₹)', 'TDS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Total tax deducted (₹)', 'Total tax deposited (₹)', 'Date of deduction', 'Rate (%)', 'Reason for non / lower / higher deduction', 'Certificate no. (Sec 197)', 'Rate as per IT Act (A) / DTAA (B)', 'Nature of remittance', 'Form 15CA acknowledgement', 'Country of residence', 'Tax identification no.', 'TRC on file', 'Form 10F', 'Required rate (%)', 'Short deduction (₹)'];

/** Form 27Q for a quarter (non-resident rows only; TDS challans, never TCS). */
export function form27Q(rows: readonly TdsDeductionRow[], vendors: readonly unknown[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): Form27QPaper {
  const list = nr27qRows(rows.filter((r) => r.fy === fy && r.quarter === quarter), vendors);
  const warnings: string[] = [];
  const byKey = challanByKey(challans.filter((c) => c.kind !== 'TCS'));
  const used = [...new Set(list.map((x) => byKey.get(x.row.key)).filter((c): c is TdsChallan => !!c))].sort((a, b) => a.date.localeCompare(b.date) || a.challan_no.localeCompare(b.challan_no));
  const srOf = new Map(used.map((c, i) => [c.id, i + 1]));
  const challanRows: (string | number)[][] = [CHALLAN_HEAD];
  used.forEach((c, i) => {
    const codes = [...new Set(list.filter((x) => byKey.get(x.row.key)?.id === c.id).map((x) => payableSection(x.row.code)?.rpu || x.row.section))];
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
    for (const n of x.check.notes) if (/cannot be applied|Booked under/.test(n)) warnings.push(`${r.payee}: ${n}`);
    // Act rate includes cess: split the TDS into tax + cess for the RPU columns; a DTAA rate carries no cess.
    const cessPct = x.check.basis === 'DTAA' ? 0 : nrActRate(x.check.nature, r.creditedOn, r.deducteeType).cessPct;
    const tax = cessPct ? round2((r.amount * 100) / (100 + cessPct)) : r.amount;
    const cess = round2(r.amount - tax);
    deducteeRows.push([
      i + 1, ch ? srOf.get(ch.id) ?? '' : '', payableSection(r.code)?.rpu || r.section, deducteeCode(r.deducteeType), r.pan || 'PANNOTAVBL', r.payee,
      rpuDate(r.creditedOn), amt(r.base), amt(tax), '0.00', amt(cess), amt(r.amount), ch ? amt(r.amount) : '0.00', rpuDate(r.deductedOn), r.rate, r.reason, r.certNo,
      x.check.basis === 'DTAA' ? 'B' : 'A', `${NATURE_CODE[x.check.nature]} ${NATURE_LABEL[x.check.nature]}`, '', x.payee.country, x.payee.tin,
      x.payee.trcNo ? `${x.payee.trcNo}${x.payee.trcTo ? ` (to ${rpuDate(x.payee.trcTo)})` : ''}` : 'No', x.payee.form10f ? 'Yes' : 'No', x.check.required, amt(x.shortBy),
    ]);
  });
  const deducted = round2(list.reduce((t, x) => t + x.row.amount, 0));
  return { form: '27Q', fy, quarter, challanRows, deducteeRows, totals: { deducted, deposited: round2(deposited), challans: used.length, shortBy: round2(shortBy) }, warnings: [...new Set(warnings)] };
}

export function form27QCsv(p: Form27QPaper): string {
  return toCsv([[FORM27Q_NOTE], ['Form 27Q', `FY ${p.fy}-${String(p.fy + 1).slice(2)}`, `Q${p.quarter}`], [], ['Challan details'], ...p.challanRows, [], ['Deductee details (non-residents)'], ...p.deducteeRows, [], ['Warnings'], ...p.warnings.map((w) => [w])]);
}

export function form27QSheets(p: Form27QPaper): { name: string; rows: (string | number)[][] }[] {
  return [
    { name: 'Challans', rows: p.challanRows },
    { name: 'Deductees', rows: p.deducteeRows },
    { name: 'Notes', rows: [['Note'], [FORM27Q_NOTE], ...p.warnings.map((w) => [w])] },
  ];
}
