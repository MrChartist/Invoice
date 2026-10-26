/**
 * TDS / TCS return working papers (Tally parity): Form 26Q (TDS on payments to residents other than
 * salary), Form 27EQ (TCS collected on sales, from the invoices' 206C fields) and Form 16A data per
 * deductee per quarter, with challan details — as CSV / XLSX rows and tab-separated text in the
 * column order of the NSDL Return Preparation Utility (RPU).
 *
 * UNVERIFIED: the column order and section / collection codes follow the RPU as we understand it
 * and have not been validated against the current RPU or the FVU. Import through the RPU and
 * validate with the FVU; verify with your CA. Form 27Q (non-residents) is a separate paper (tds-27q.ts): payees
 * flagged non-resident are left out of 26Q and listed as warnings.
 *
 * Pure (node:test).
 */

import type { InvoiceRecord } from '../types/invoice';
import { isSale, partyOfInvoice } from './books';
import { toCsv } from './csv';
import { num, round2 } from './invoice-calc';
import { inrValue } from './fx';
import { isoDay } from './dates';
import {
  challanByKey,
  challanTotal,
  deducteeCode,
  deducteeTypeFromPan,
  fyQuarterOf,
  payeeKeyOf,
  quarterSpan,
  type TdsChallan,
  type TdsDeductionRow,
  type TdsQuarter,
} from './tds-payables';
import { TCS_27EQ_CODES, type DeducteeType } from './tds-rules';
import { actRef, formText, quarterStart, sectionText } from './ita2025';

export const UNVERIFIED_NOTE = 'UNVERIFIED working paper in NSDL RPU column order — import through the RPU, validate with the FVU and verify with your CA.';

/** dd/mm/yyyy, the RPU date format. */
export function rpuDate(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '';
}

const amt = (n: number) => round2(n).toFixed(2);

/* ── TCS collected (27EQ source) ──────────────────────────────── */

export interface TcsRow {
  key: string;
  invoiceId: string;
  docNumber: string;
  collectee: string;
  payeeKey: string;
  pan: string;
  deducteeType: DeducteeType;
  code: string;
  label: string;
  /** Amount received / debited (₹), TCS excluded. */
  base: number;
  rate: number;
  amount: number;
  /** TCS is reported on the invoice date (the app charges it on the invoice). */
  creditedOn: string;
  deductedOn: string;
  fy: number;
  quarter: TdsQuarter;
}

/** TCS on live sales invoices (credit notes are not netted — adjust in the RPU). */
export function tcsCollections(invoices: readonly InvoiceRecord[]): TcsRow[] {
  const out: TcsRow[] = [];
  for (const inv of invoices) {
    if (!isSale(inv) || !(num(inv.tcs_amount) > 0)) continue;
    const date = isoDay(inv.issue_date);
    const fq = fyQuarterOf(date);
    if (!fq) continue;
    const label = String(inv.tcs_label ?? '');
    const code = TCS_27EQ_CODES.find((c) => c.match.test(label))?.code ?? '6CR';
    const tcs = round2(inrValue(num(inv.tcs_amount), inv));
    const pan = String(inv.client?.pan ?? '').trim().toUpperCase();
    const collectee = partyOfInvoice(inv);
    out.push({
      key: `tcs:${inv.id}`,
      invoiceId: inv.id,
      docNumber: String(inv.invoice_number ?? ''),
      collectee,
      payeeKey: payeeKeyOf({ pan, name: collectee }),
      pan,
      deducteeType: deducteeTypeFromPan(pan) ?? 'OTHER',
      code,
      label: label || code,
      base: round2(inrValue(num(inv.total), inv) - tcs),
      rate: num(inv.tcs_rate),
      amount: tcs,
      creditedOn: date,
      deductedOn: date,
      ...fq,
    });
  }
  return out.sort((a, b) => a.deductedOn.localeCompare(b.deductedOn) || a.key.localeCompare(b.key));
}

/* ── Quarterly return ─────────────────────────────────────────── */

export interface ReturnPaper {
  /** Stored form key (return marks keep it); `formLabel` is the name for the period (Form 140 from Apr 2026). */
  form: '26Q' | '27EQ';
  formLabel: string;
  /** Code → statutory reference for the period, when it differs from the code (2025-Act periods). */
  refs: [string, string][];
  fy: number;
  quarter: TdsQuarter;
  /** Header row first. */
  challanRows: (string | number)[][];
  deducteeRows: (string | number)[][];
  totals: { deducted: number; deposited: number; challans: number };
  warnings: string[];
}

const CHALLAN_HEAD = ['Sr. No.', 'Section code', 'TDS / TCS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Interest (₹)', 'Fee (₹)', 'Others (₹)', 'Total (₹)', 'Cheque / DD no.', 'BSR code', 'Date of deposit', 'Challan serial no.', 'Minor head', 'Book entry'];

const DEDUCTEE_HEAD_26Q = ['Sr. No.', 'Challan Sr. No.', 'Section code', 'Deductee code', 'PAN of deductee', 'Name of deductee', 'Date of payment / credit', 'Amount paid / credited (₹)', 'TDS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Total tax deducted (₹)', 'Total tax deposited (₹)', 'Date of deduction', 'Rate (%)', 'Reason for non / lower / higher deduction', 'Certificate no. (Sec 197)'];

const COLLECTEE_HEAD_27EQ = ['Sr. No.', 'Challan Sr. No.', 'Collection code', 'Collectee code', 'PAN of collectee', 'Name of collectee', 'Total value of purchase (₹)', 'Amount received / debited (₹)', 'Date of receipt / debit', 'TCS (₹)', 'Surcharge (₹)', 'Education cess (₹)', 'Total tax collected (₹)', 'Total tax deposited (₹)', 'Date of collection', 'Rate (%)', 'Reason for non / lower collection', 'Certificate no.'];

type AnyRow = Pick<TdsDeductionRow, 'key' | 'amount' | 'fy' | 'quarter' | 'pan' | 'deducteeType' | 'base' | 'rate' | 'creditedOn' | 'deductedOn'> & {
  name: string;
  code: string;
  /** Internal section code / TCS label the statutory reference is read from. */
  refCode: string;
  reason: string;
  certNo: string;
  nonResident?: boolean;
};

function buildPaper(form: '26Q' | '27EQ', rows: readonly AnyRow[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): ReturnPaper {
  const warnings: string[] = [];
  const list = rows.filter((r) => r.fy === fy && r.quarter === quarter);
  const byKey = challanByKey(challans);
  // Challans that deposit at least one deduction of the quarter, in date order.
  const used = [...new Set(list.map((r) => byKey.get(r.key)).filter((c): c is TdsChallan => !!c))].sort((a, b) => a.date.localeCompare(b.date) || a.challan_no.localeCompare(b.challan_no));
  const srOf = new Map(used.map((c, i) => [c.id, i + 1]));
  const challanRows: (string | number)[][] = [CHALLAN_HEAD];
  used.forEach((c, i) => {
    const codes = [...new Set(list.filter((r) => byKey.get(r.key)?.id === c.id).map((r) => r.code))];
    challanRows.push([i + 1, codes.length === 1 ? codes[0] : '', amt(c.amount), '0.00', '0.00', amt(num(c.interest)), amt(num(c.fee)), amt(num(c.others)), amt(challanTotal(c)), '', c.bsr_code, rpuDate(c.date), c.challan_no, c.minor_head ?? '200', 'N']);
  });
  const deducteeRows: (string | number)[][] = [form === '26Q' ? DEDUCTEE_HEAD_26Q : COLLECTEE_HEAD_27EQ];
  let deposited = 0;
  list.forEach((r, i) => {
    const ch = byKey.get(r.key);
    if (ch) deposited += r.amount;
    else warnings.push(`${r.name}: ₹${amt(r.amount)} deducted on ${r.deductedOn} is not linked to a challan.`);
    if (!r.pan) warnings.push(`${r.name}: PAN missing — the RPU needs "PANNOTAVBL" and the 20% rate (206AA).`);
    const sr = ch ? srOf.get(ch.id) ?? '' : '';
    const pan = r.pan || 'PANNOTAVBL';
    const dep = ch ? amt(r.amount) : '0.00';
    if (form === '26Q') {
      deducteeRows.push([i + 1, sr, r.code, deducteeCode(r.deducteeType), pan, r.name, rpuDate(r.creditedOn), amt(r.base), amt(r.amount), '0.00', '0.00', amt(r.amount), dep, rpuDate(r.deductedOn), r.rate, r.reason, r.certNo]);
    } else {
      deducteeRows.push([i + 1, sr, r.code, deducteeCode(r.deducteeType), pan, r.name, amt(r.base + r.amount), amt(r.base), rpuDate(r.creditedOn), amt(r.amount), '0.00', '0.00', amt(r.amount), dep, rpuDate(r.deductedOn), r.rate, r.reason, r.certNo]);
    }
  });
  const deducted = round2(list.reduce((t, r) => t + r.amount, 0));
  // Income-tax Act 2025 (from 1 Apr 2026): the paper's form and the section references follow the period.
  const start = quarterStart(fy, quarter);
  const refs = new Map<string, string>();
  for (const r of list) {
    const ref = actRef(r.refCode, r.creditedOn);
    if (ref.act === 2025) refs.set(r.code, sectionText(r.refCode, r.creditedOn));
  }
  if (refs.size) warnings.push(`Income-tax Act 2025 period: the section codes above are the 1961-Act RPU codes the app knows; ${formText(form, start)} uses the 2025-Act section codes of the current RPU — map each code (see "Section references") and verify with your CA.`);
  for (const c of used) {
    const linked = round2(list.filter((r) => byKey.get(r.key)?.id === c.id).reduce((t, r) => t + r.amount, 0));
    if (Math.abs(linked - c.amount) > 0.5) warnings.push(`Challan ${c.bsr_code}/${c.challan_no}: tax ₹${amt(c.amount)} vs ₹${amt(linked)} linked to this quarter (the rest may belong to another quarter).`);
  }
  return { form, formLabel: formText(form, start), refs: [...refs], fy, quarter, challanRows, deducteeRows, totals: { deducted, deposited: round2(deposited), challans: used.length }, warnings };
}

/** Form 26Q for a quarter: residents only (non-resident payees are flagged for Form 27Q). */
export function form26Q(rows: readonly TdsDeductionRow[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): ReturnPaper {
  const resident = rows.filter((r) => !r.nonResident);
  const paper = buildPaper(
    '26Q',
    resident.map((r) => ({ ...r, name: r.payee, code: r.rpu || r.section, refCode: r.code })),
    challans.filter((c) => c.kind !== 'TCS'),
    fy,
    quarter,
  );
  for (const r of rows) if (r.nonResident && r.fy === fy && r.quarter === quarter) paper.warnings.push(`${r.payee} is non-resident: report in ${formText('27Q', quarterStart(fy, quarter))} (TDS and TCS page, Form 27Q tab).`);
  return paper;
}

/** Form 27EQ for a quarter from the TCS on invoices. */
export function form27EQ(rows: readonly TcsRow[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): ReturnPaper {
  return buildPaper(
    '27EQ',
    rows.map((r) => ({ ...r, name: r.collectee, reason: '', certNo: '', refCode: TCS_27EQ_CODES.find((c) => c.code === r.code)?.label ?? r.label })),
    challans.filter((c) => c.kind === 'TCS'),
    fy,
    quarter,
  );
}

/** CSV of a return paper: a note line, the challan block, a blank line, the deductee block. */
export function paperCsv(p: ReturnPaper): string {
  return toCsv([[UNVERIFIED_NOTE], [p.formLabel, `FY ${p.fy}-${String(p.fy + 1).slice(2)}`, `Q${p.quarter}`], [], ['Challan details'], ...p.challanRows, [], [p.form === '26Q' ? 'Deductee details' : 'Collectee details'], ...p.deducteeRows, ...refBlock(p)]);
}

/** "Section references" block (2025-Act periods only): code in the paper → its 2025-Act reference. */
function refBlock(p: ReturnPaper): (string | number)[][] {
  return p.refs.length ? [[], ['Section references (Income-tax Act 2025)'], ['Code', 'Reference'], ...p.refs] : [];
}

/** Tab-separated text in RPU column order (paste block by block into the RPU grid). */
export function paperText(p: ReturnPaper): string {
  const tsv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  const refs = p.refs.length ? ['# Section references (Income-tax Act 2025)', tsv([['Code', 'Reference'], ...p.refs]), ''] : [];
  return [`# ${UNVERIFIED_NOTE}`, `# ${p.formLabel} · FY ${p.fy}-${String(p.fy + 1).slice(2)} · Q${p.quarter}`, '# Challan details', tsv(p.challanRows), '', `# ${p.form === '26Q' ? 'Deductee' : 'Collectee'} details`, tsv(p.deducteeRows), '', ...refs].join('\n');
}

/** Sheets for `writeXlsx` (src/lib/xlsx.ts, loaded on demand by the page). */
export function paperSheets(p: ReturnPaper): { name: string; rows: (string | number)[][] }[] {
  return [
    { name: 'Challans', rows: p.challanRows },
    { name: p.form === '26Q' ? 'Deductees' : 'Collectees', rows: p.deducteeRows },
    { name: 'Notes', rows: [['Note'], [UNVERIFIED_NOTE], [p.formLabel], ...p.warnings.map((w) => [w])] },
    ...(p.refs.length ? [{ name: 'Section references', rows: [['Code', 'Reference (Income-tax Act 2025)'], ...p.refs] }] : []),
  ];
}

/* ── Form 16A data ────────────────────────────────────────────── */

export interface Form16AData {
  payeeKey: string;
  payee: string;
  pan: string;
  fy: number;
  quarter: TdsQuarter;
  period: { from: string; to: string };
  rows: { code: string; date: string; paid: number; tds: number; deposited: boolean }[];
  totalPaid: number;
  totalTds: number;
  challans: { bsr: string; date: string; challanNo: string; amount: number }[];
}

/** What a Form 16A for each deductee would show (the certificate itself must come from TRACES). */
export function form16AData(rows: readonly TdsDeductionRow[], challans: readonly TdsChallan[], fy: number, quarter: TdsQuarter): Form16AData[] {
  const byKey = challanByKey(challans);
  const groups = new Map<string, Form16AData>();
  for (const r of rows) {
    if (r.fy !== fy || r.quarter !== quarter || r.nonResident) continue;
    const g = groups.get(r.payeeKey) ?? { payeeKey: r.payeeKey, payee: r.payee, pan: r.pan, fy, quarter, period: quarterSpan(fy, quarter), rows: [], totalPaid: 0, totalTds: 0, challans: [] };
    const ch = byKey.get(r.key);
    g.rows.push({ code: r.section, date: r.creditedOn, paid: r.base, tds: r.amount, deposited: !!ch });
    g.totalPaid = round2(g.totalPaid + r.base);
    g.totalTds = round2(g.totalTds + r.amount);
    if (ch && !g.challans.some((c) => c.bsr === ch.bsr_code && c.challanNo === ch.challan_no && c.date === ch.date)) {
      g.challans.push({ bsr: ch.bsr_code, date: ch.date, challanNo: ch.challan_no, amount: ch.amount });
    }
    groups.set(r.payeeKey, g);
  }
  return [...groups.values()].sort((a, b) => a.payee.localeCompare(b.payee));
}

export function form16ACsv(list: readonly Form16AData[]): string {
  const first = list[0];
  const title = first ? `${formText('16A', quarterStart(first.fy, first.quarter))} data` : 'Form 16A data';
  const rows: (string | number)[][] = [[UNVERIFIED_NOTE], [title], ['Deductee', 'PAN', 'Quarter', 'Section', 'Date of payment / credit', 'Amount paid (₹)', 'TDS (₹)', 'Deposited', 'Challans (BSR / date / serial)']];
  for (const g of list) {
    const ch = g.challans.map((c) => `${c.bsr} / ${rpuDate(c.date)} / ${c.challanNo}`).join('; ');
    for (const r of g.rows) rows.push([g.payee, g.pan || 'PANNOTAVBL', `Q${g.quarter} FY${g.fy}-${String(g.fy + 1).slice(2)}`, sectionText(r.code, r.date), rpuDate(r.date), amt(r.paid), amt(r.tds), r.deposited ? 'Yes' : 'No', ch]);
  }
  return toCsv(rows);
}
