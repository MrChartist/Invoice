/**
 * Gift vouchers (R4-B1) — the small, mostly pure core the POS, the payment dialog and the ledger need: voucher codes,
 * the derived balance / status of a voucher, the redemption checks, the promotional-voucher discount and the two
 * writes a counter sale makes (stamp `gift_voucher_id` on a receipt row, note a promo use). Selling, cancelling,
 * breakage and the register live in `gift-vouchers.ts` (lazy, with the ledger).
 *
 * Statutory position (working paper — verify with your CA): per Circular 243/37/2024-GST transactions in vouchers are
 * neither a supply of goods nor of services, so selling a voucher raises no invoice and no GST; GST is charged on the
 * underlying supply when the voucher is redeemed, on the full value of that supply (a voucher is consideration, not a
 * discount). A free promotional voucher is a discount at redemption instead (Sec 15(3)(a)), because no money was
 * received for it.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { GiftVoucher, GiftVoucherSettings, GiftVoucherStatus, GiftVoucherPromoUse } from '../../types/stores-r4';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { DB_PREFIX, getJson, getTable, peekTable, setTable } from '../storage';
import { getIndianFY } from '../invoice-number';

export const GV_TABLE = 'gift_vouchers';
export const GV_SETTINGS_KEY = `${DB_PREFIX}gift_voucher_settings`;
export const GV_PREFIX = 'GV';
/** Payment method / POS tender name (stored in English, like every method). */
export const GV_METHOD = 'Gift voucher';
/** User ledgers created on first use (looked up by name). */
export const GV_LIABILITY_ACCOUNT = 'Gift vouchers outstanding';
export const GV_BREAKAGE_ACCOUNT = 'Unredeemed voucher income';
export const GV_CA_NOTE = 'Gift vouchers: no invoice and no GST on the sale (Circular 243/37/2024-GST); GST on the goods / services at redemption; breakage is not a supply. Working paper: verify with your CA.';

export const DEFAULT_GV_SETTINGS: GiftVoucherSettings = { validity_months: 12, allow_partial: true, prefix: GV_PREFIX };

export function readGvSettings(): GiftVoucherSettings {
  const raw = getJson<Partial<GiftVoucherSettings> | null>(GV_SETTINGS_KEY, null) ?? {};
  const months = Math.floor(num(raw.validity_months));
  const prefix = String(raw.prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return {
    validity_months: months > 0 && months <= 120 ? months : DEFAULT_GV_SETTINGS.validity_months,
    allow_partial: raw.allow_partial !== false,
    prefix: prefix || GV_PREFIX,
  };
}

/* ── Codes ────────────────────────────────────────────────────── */

/** Characters of the random check: no 0 / O / 1 / I, so a typed code is not misread. */
export const CHECK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CHECK_LENGTH = 4;

/** Luhn (mod 10) check digit of a digit string. */
export function luhnDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** The printed number of the `seq`-th voucher of a FY: FY digits (2627) + 6-digit sequence + Luhn digit. */
export function voucherNumberDigits(date: string, seq: number): string {
  const fy = getIndianFY(date).label.replace(/\D/g, '');
  const body = `${fy}${String(Math.max(0, Math.floor(seq)) % 1_000_000).padStart(6, '0')}`;
  return `${body}${luhnDigit(body)}`;
}

/** `CHECK_LENGTH` random characters from `crypto.getRandomValues` (a test may pass its own byte source). */
export function randomCheck(fill: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => crypto.getRandomValues(b)): string {
  const bytes = new Uint8Array(new ArrayBuffer(CHECK_LENGTH));
  fill(bytes);
  let out = '';
  for (const b of bytes) out += CHECK_ALPHABET[b % CHECK_ALPHABET.length];
  return out;
}

/** Code printed on the slip and in the Code128 barcode: `<number>-<check>`. */
export function makeVoucherCode(date: string, seq: number, fill?: (bytes: Uint8Array) => void): string {
  return `${voucherNumberDigits(date, seq)}-${randomCheck(fill)}`;
}

/** Scanned / typed code → comparable key (capitals, no spaces or dashes). */
export const codeKey = (raw: string | undefined): string => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Shape + Luhn check of a typed code ('' = looks right). Catches most typos before any lookup. */
export function codeShapeIssue(raw: string): string {
  const k = codeKey(raw);
  const m = /^(\d{11})([A-Z0-9]{4})$/.exec(k);
  if (!m) return 'Type the full voucher code (11 digits and 4 letters, as printed on the voucher).';
  const digits = m[1];
  if (luhnDigit(digits.slice(0, 10)) !== Number(digits[10])) return 'This voucher code has a typing mistake (the check digit does not match).';
  return '';
}

export function findVoucherByCode(code: string, vouchers: readonly GiftVoucher[]): GiftVoucher | undefined {
  const k = codeKey(code);
  if (!k) return undefined;
  return vouchers.find((v) => codeKey(v.code) === k);
}

/* ── Dates ────────────────────────────────────────────────────── */

/** `day` plus `months` calendar months, less one day (12 months from 2026-05-10 → 2027-05-09); clamps the month end. */
export function expiryFrom(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = m - 1 + Math.floor(months);
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(ty, tm + 1, 0).getDate();
  const end = new Date(ty, tm, Math.min(d, last));
  end.setDate(end.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${end.getFullYear()}-${p(end.getMonth() + 1)}-${p(end.getDate())}`;
}

/* ── Balance and status (derived) ─────────────────────────────── */

export interface VoucherState {
  /** Paid with on receipts (POS tenders and invoice payments). */
  redeemed: number;
  /** Promotional vouchers: discount given on live bills. */
  promoUsed: number;
  /** Recognised as income after expiry. */
  breakage: number;
  balance: number;
  status: GiftVoucherStatus;
  /** Receipt rows that used it. */
  payments: Payment[];
}

type InvoiceLike = Pick<InvoiceRecord, 'id' | 'status'>;

/**
 * Balance and status of a voucher on `day`: face value − receipts paid with it − promo discounts on live bills −
 * breakage. A removed receipt (or a cancelled bill a promo was used on) gives the value back automatically.
 */
export function voucherState(v: GiftVoucher, payments: readonly Payment[], day: string, invoices?: readonly InvoiceLike[]): VoucherState {
  const mine = payments.filter((p) => p?.gift_voucher_id === v.id);
  const redeemed = round2(mine.reduce((s, p) => s + Math.max(num(p.amount), 0), 0));
  const live = invoices ? new Map(invoices.map((i) => [i.id, i.status])) : null;
  const promoUsed = round2((v.promo_uses ?? []).filter((u) => !live || (live.has(u.invoice_id) && live.get(u.invoice_id) !== 'Cancelled')).reduce((s, u) => s + Math.max(num(u.amount), 0), 0));
  const breakage = v.breakage_voucher_id ? round2(Math.max(num(v.breakage_amount), 0)) : 0;
  const balance = round2(Math.max(num(v.face_value) - redeemed - promoUsed - breakage, 0));
  let status: GiftVoucherStatus = 'active';
  if (v.status === 'cancelled') status = 'cancelled';
  else if (v.breakage_voucher_id) status = 'expired';
  else if (balance <= 0.004 && redeemed + promoUsed > 0) status = 'redeemed';
  else if (v.expires_on && day > v.expires_on) status = 'expired';
  return { redeemed, promoUsed, breakage, balance, status, payments: mine };
}

/** Why `amount` cannot be redeemed from `v` on `day` ('' = it can). */
export function redeemIssue(v: GiftVoucher | undefined, amount: number, day: string, state: VoucherState | undefined, settings: GiftVoucherSettings = DEFAULT_GV_SETTINGS): string {
  if (!v || !state) return 'No gift voucher has this code.';
  if (state.status === 'cancelled') return `Gift voucher ${v.number} was cancelled.`;
  if (v.issued_on && day < v.issued_on) return `Gift voucher ${v.number} is dated ${v.issued_on}, after this bill.`;
  if (v.expires_on && day > v.expires_on) return `Gift voucher ${v.number} expired on ${v.expires_on}.`;
  if (state.balance <= 0.004) return `Gift voucher ${v.number} has no balance left.`;
  const a = round2(num(amount));
  if (!(a > 0)) return 'Enter the amount to take from the voucher.';
  if (a > state.balance + 0.004) return `Gift voucher ${v.number} has only ₹${state.balance.toFixed(2)} left.`;
  if (!settings.allow_partial && Math.abs(a - state.balance) > 0.004) return `Gift voucher ${v.number} must be used for its whole balance (₹${state.balance.toFixed(2)}) in one bill.`;
  return '';
}

/* ── Promotional voucher as a discount ────────────────────────── */

function retotal(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

/**
 * A promotional voucher worth `amount` as a pre-tax AMOUNT discount on the bill (added to any amount discount already
 * there, e.g. loyalty points). Refused with a % discount on the bill, or above what the bill is worth.
 */
export function applyPromoDiscount(rec: InvoiceRecord, amount: number): { record: InvoiceRecord | null; error: string } {
  const a = round2(num(amount));
  if (!(a > 0)) return { record: rec, error: '' };
  if (rec.discount_type === 'PERCENT' && num(rec.discount_rate) > 0) return { record: null, error: 'Remove the % discount first (a promotional voucher is an amount discount).' };
  const t = calculateInvoice(calcInputFromRecord(rec));
  const already = rec.discount_type === 'AMOUNT' ? num(rec.discount_rate) : 0;
  const room = round2(t.subtotal - t.line_discount_total - already);
  if (a > room + 0.004) return { record: null, error: `The voucher (₹${a.toFixed(2)}) is more than the bill.` };
  return { record: retotal({ ...rec, discount_type: 'AMOUNT', discount_rate: round2(already + a) }), error: '' };
}

/**
 * QA6 F12: one promotional voucher per bill (the POS applies and records a single promo discount). With `next`, the
 * voucher about to be applied; without, the vouchers already on the bill.
 */
export function promoVoucherIssue(applied: readonly { promo?: boolean }[], next?: { promo?: boolean }): string {
  const n = applied.filter((a) => a.promo).length + (next?.promo ? 1 : 0);
  return n > 1 ? 'One promotional voucher per bill: remove the other one first.' : '';
}

/* ── Live reads and the counter's writes ──────────────────────── */

export const liveVouchers = (): readonly GiftVoucher[] => peekTable<GiftVoucher>(GV_TABLE);

/** A voucher by code with its state on `day` (read-only views: safe on every keystroke). */
export function lookupVoucher(code: string, day: string): { voucher?: GiftVoucher; state?: VoucherState } {
  const voucher = findVoucherByCode(code, liveVouchers());
  if (!voucher) return {};
  return { voucher, state: voucherState(voucher, peekTable<Payment>('transactions'), day, peekTable<InvoiceRecord>('invoices')) };
}

/** Check a redemption against live data ('' = fine). */
export function liveRedeemIssue(voucherId: string, amount: number, day: string): string {
  const v = liveVouchers().find((x) => x.id === voucherId);
  if (!v) return 'This gift voucher no longer exists.';
  if (v.promo) return `Gift voucher ${v.number} is promotional: it is applied as a discount, not as a payment.`;
  return redeemIssue(v, amount, day, voucherState(v, peekTable<Payment>('transactions'), day, peekTable<InvoiceRecord>('invoices')), readGvSettings());
}

/** Mark a receipt row as paid with a gift voucher (right after `localDb.payments.record`). */
export function stampVoucherPayment(paymentId: string, voucherId: string): void {
  const rows = getTable<Payment>('transactions');
  if (!rows.some((p) => p.id === paymentId)) return;
  setTable('transactions', rows.map((p) => (p.id === paymentId ? { ...p, gift_voucher_id: voucherId } : p)));
}

/** Note a promotional voucher used on a saved bill. */
export function recordPromoUse(voucherId: string, use: GiftVoucherPromoUse): void {
  const rows = getTable<GiftVoucher>(GV_TABLE);
  setTable(GV_TABLE, rows.map((v) => (v.id === voucherId ? { ...v, promo_uses: [...(v.promo_uses ?? []).filter((u) => u.invoice_id !== use.invoice_id), use], updated_at: new Date().toISOString() } : v)));
}

/** The liability ledger's id among the user's accounts (by name), else undefined. */
export function gvLiabilityId(accounts: readonly { id: string; name: string }[]): string | undefined {
  return accounts.find((a) => a.name.trim().toLowerCase() === GV_LIABILITY_ACCOUNT.toLowerCase())?.id;
}
