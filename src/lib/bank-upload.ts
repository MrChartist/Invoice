/**
 * Bulk e-payment upload files (WP-5, gap P1-14): one file with many NEFT / RTGS / IMPS / within-bank
 * transfers to suppliers, for the bank's corporate net-banking "bulk upload". File generation only —
 * nothing is sent anywhere, and no payment is recorded until you record it after the bank confirms.
 *
 * Presets: a generic NEFT / RTGS CSV with a header row, and HDFC / ICICI / SBI corporate-banking
 * ("CMS") style layouts. Bank layouts differ by product and change over time — the presets are
 * starting points: CHECK THE FORMAT WITH YOUR BANK before uploading (every screen and the docs say so).
 *
 * Pure.
 */

import { toCsv } from './csv';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';

export type UploadMode = 'NEFT' | 'RTGS' | 'IMPS' | 'IFT';
export type UploadPreset = 'generic' | 'hdfc' | 'icici' | 'sbi';

export const UPLOAD_PRESETS: readonly UploadPreset[] = ['generic', 'hdfc', 'icici', 'sbi'];

/** RTGS minimum (RBI): ₹2,00,000. */
export const RTGS_MIN = 200000;

export interface UploadRow {
  beneficiary: string;
  accountNo: string;
  ifsc: string;
  amount: number;
  mode: UploadMode;
  /** Our reference (bill numbers / voucher no.), max 30 characters in most layouts. */
  reference: string;
  email?: string;
  bankName?: string;
  /** Vendor id the row was built from (not written to the file). */
  vendorId?: string;
}

export interface UploadInput {
  preset: UploadPreset;
  /** Value / payment date, YYYY-MM-DD. */
  date: string;
  /** Our account to debit (full number — the bank needs it). */
  debitAccountNo: string;
  rows: readonly UploadRow[];
}

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function cleanAccountNo(v: string | undefined): string {
  return String(v ?? '').replace(/[\s-]+/g, '').toUpperCase();
}

/** Problems with one row (empty = fine). */
export function validateUploadRow(r: UploadRow): string[] {
  const errors: string[] = [];
  if (!r.beneficiary.trim()) errors.push('beneficiary name missing');
  const acc = cleanAccountNo(r.accountNo);
  if (!acc) errors.push('account number missing');
  else if (!/^[A-Z0-9]{6,20}$/.test(acc)) errors.push('account number looks wrong');
  const ifsc = r.ifsc.trim().toUpperCase();
  if (!ifsc) errors.push('IFSC missing');
  else if (!IFSC_RE.test(ifsc)) errors.push('IFSC should be 11 characters like HDFC0001234');
  const amt = round2(num(r.amount));
  if (!(amt > 0)) errors.push('amount must be above zero');
  if (r.mode === 'RTGS' && amt < RTGS_MIN) errors.push('RTGS needs ₹2,00,000 or more — use NEFT');
  return errors;
}

/** Problems with the whole file, each prefixed with the row number (empty = fine). */
export function validateUpload(input: UploadInput): string[] {
  const errors: string[] = [];
  if (!isoDay(input.date)) errors.push('Choose the payment date.');
  if (input.preset !== 'generic' && !cleanAccountNo(input.debitAccountNo)) errors.push('Enter the full account number of the account to debit (bank accounts master).');
  if (!input.rows.length) errors.push('Add at least one payment.');
  input.rows.forEach((r, i) => {
    for (const e of validateUploadRow(r)) errors.push(`Row ${i + 1} (${r.beneficiary || '—'}): ${e}.`);
  });
  return errors;
}

/** NEFT up to ₹2 lakh, RTGS from ₹2 lakh — the usual default. */
export const suggestMode = (amount: number): UploadMode => (round2(num(amount)) >= RTGS_MIN ? 'RTGS' : 'NEFT');

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const amt = (n: number) => round2(num(n)).toFixed(2);
const ref = (s: string, max = 30) => s.replace(/[^A-Za-z0-9 /-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const nameOf = (s: string, max = 35) => s.replace(/[^A-Za-z0-9 .&-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function hdfcType(mode: UploadMode): string {
  return mode === 'RTGS' ? 'R' : mode === 'IMPS' ? 'M' : mode === 'IFT' ? 'I' : 'N';
}

/** The upload file text (CSV). Throws on validation errors — call `validateUpload` first to show them. */
export function buildUploadFile(input: UploadInput): { text: string; filename: string; total: number; count: number } {
  const errors = validateUpload(input);
  if (errors.length) throw new Error(errors[0]);
  const date = dmy(input.date);
  const debit = cleanAccountNo(input.debitAccountNo);
  const rows = input.rows.map((r) => ({ ...r, accountNo: cleanAccountNo(r.accountNo), ifsc: r.ifsc.trim().toUpperCase() }));
  let table: unknown[][];
  switch (input.preset) {
    case 'hdfc':
      // HDFC ENet-style bulk layout (no header row).
      table = rows.map((r, i) => [
        hdfcType(r.mode), `V${String(i + 1).padStart(4, '0')}`, r.accountNo, amt(r.amount), nameOf(r.beneficiary),
        '', '', '', '', '', '', '', '', ref(r.reference, 20), ref(r.reference, 20), ref(r.reference), '', '', '', '', '', '',
        '', date, '', r.ifsc, r.bankName ?? '', '', r.email ?? '',
      ]);
      break;
    case 'icici':
      table = [
        ['PYMT_MODE', 'DEBIT_ACC_NO', 'BNF_NAME', 'BENE_ACC_NO', 'BENE_IFSC', 'AMOUNT', 'DEBIT_NARR', 'CREDIT_NARR', 'EMAIL_ID', 'PYMT_DATE', 'REF_NO'],
        ...rows.map((r, i) => [r.mode === 'IFT' ? 'FT' : r.mode, debit, nameOf(r.beneficiary), r.accountNo, r.ifsc, amt(r.amount), ref(r.reference), ref(r.reference), r.email ?? '', date, `${input.date.replace(/-/g, '')}${String(i + 1).padStart(3, '0')}`]),
      ];
      break;
    case 'sbi':
      table = [
        ['Debit Account No', 'Beneficiary Name', 'Beneficiary Account No', 'IFSC', 'Amount', 'Payment Mode', 'Value Date', 'Narration', 'Email'],
        ...rows.map((r) => [debit, nameOf(r.beneficiary), r.accountNo, r.ifsc, amt(r.amount), r.mode === 'IFT' ? 'DCR' : r.mode, date, ref(r.reference), r.email ?? '']),
      ];
      break;
    default:
      table = [
        ['Payment Type', 'Debit Account No', 'Beneficiary Name', 'Beneficiary Account No', 'IFSC', 'Amount', 'Payment Date', 'Reference', 'Beneficiary Bank', 'Beneficiary Email'],
        ...rows.map((r) => [r.mode, debit, r.beneficiary.trim(), r.accountNo, r.ifsc, amt(r.amount), date, ref(r.reference), r.bankName ?? '', r.email ?? '']),
      ];
  }
  const total = round2(rows.reduce((s, r) => s + num(r.amount), 0));
  return { text: `${toCsv(table)}\r\n`, filename: `epayments-${input.preset}-${input.date}.csv`, total, count: rows.length };
}
