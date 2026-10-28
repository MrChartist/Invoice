/**
 * Gateway voucher entry, ROADMAP 7.19: Tally bill-wise references (Agst Ref / New Ref / Advance /
 * On Account), single-entry mode for Contra / Payment / Receipt, and the voucher class list.
 *
 *   Receipt with a Sundry Debtors party line (credit)  → `saveReceiptVoucher` (bill-allocation.ts): the
 *     voucher and its receipt rows in ONE step (all or nothing). Agst Ref settles invoices / opening
 *     bills; the rest is one On Account row (labelled New Ref <name> / Advance when chosen).
 *   Payment with a Sundry Creditors party line (debit) → a supplier payment through `billwise.ts`
 *     (`recordSupplierPayment`: Agst Ref `purchase_payments` rows, remainder a `vendor_payments`
 *     New Ref / Advance / On Account row), all or nothing. Posted by the ledger from those rows, so
 *     it is NOT also a manual PV voucher (no double count). Shape: exactly one supplier line (Dr) and
 *     one Cash / bank-ledger line (Cr).
 *
 * Pure above "Writes". Working papers — verify with your CA.
 */
import { A, type Account } from '../ledger/accounts';
import { bankAccountIdOfLedger, isCashOrBankLedger } from '../bank-ledgers';
import { round2 } from '../invoice-calc';
import type { ManualVoucherType } from '../ledger/vouchers';
import type { EntryLine, EntrySide } from './voucher-entry';
import { rupeesToPaise } from '../ledger/vouchers';
import type { OpenRef, ReceiptAllocation, VoucherReceiptsInput } from '../bill-allocation';
import type { SupplierPaymentInput } from '../billwise';
import type { VendorPayment } from '../../types/purchases';

/* ── Single-entry mode ─────────────────────────────────────────── */

export const SINGLE_ENTRY_TYPES: readonly ManualVoucherType[] = ['CONTRA', 'PAYMENT', 'RECEIPT'];

/** Side of the particulars in single-entry mode (the Account takes the other side). */
export function particularsSide(type: ManualVoucherType): EntrySide {
  return type === 'RECEIPT' ? 'cr' : 'dr';
}

export interface SingleEntry {
  /** The cash / bank ledger at the top ("Account"). */
  accountId: string;
  /** Particulars: every other line, all on `particularsSide(type)`. */
  rows: EntryLine[];
}

/** Double-entry lines for a single-entry screen: one Account line for the total, then the particulars. */
export function singleToLines(type: ManualVoucherType, entry: SingleEntry, accountKey: number): EntryLine[] {
  const side = particularsSide(type);
  const rows = entry.rows.filter((r) => r.account_id || r.amount.trim()).map((r) => ({ ...r, side }));
  const total = rows.reduce((s, r) => s + rupeesToPaise(r.amount), 0);
  const account: EntryLine = { key: accountKey, side: side === 'dr' ? 'cr' : 'dr', account_id: entry.accountId, amount: total ? (total / 100).toFixed(2) : '' };
  return entry.accountId ? [account, ...rows] : rows;
}

/**
 * The single-entry view of double-entry lines, or null when it cannot be shown that way: exactly one
 * cash / bank line on the Account side, every other line on the particulars side.
 */
export function linesToSingle(type: ManualVoucherType, lines: readonly EntryLine[], byId: ReadonlyMap<string, Account>): SingleEntry | null {
  if (!SINGLE_ENTRY_TYPES.includes(type)) return null;
  const side = particularsSide(type);
  const filled = lines.filter((l) => l.account_id || l.amount.trim());
  const accountSide = filled.filter((l) => l.side !== side);
  if (accountSide.length > 1) return null;
  const acc = accountSide[0];
  if (acc && !isCashOrBankLedger(byId.get(acc.account_id))) return null;
  return { accountId: acc?.account_id ?? '', rows: filled.filter((l) => l.side === side) };
}

/* ── Voucher classes ───────────────────────────────────────────── */

/** Classes already used on vouchers (for the datalist), most used first. */
export function knownClasses(vouchers: readonly { voucher_class?: string }[]): string[] {
  const count = new Map<string, number>();
  for (const v of vouchers) {
    const c = (v.voucher_class ?? '').trim();
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/* ── Bill-wise references ──────────────────────────────────────── */

export type RefKind = 'agst' | 'new' | 'advance' | 'onacc';

export interface BillRefRow {
  key: number;
  kind: RefKind;
  /** Agst Ref: invoice / opening bill id (receivable) or purchase id (payable). */
  bill_id?: string;
  /** New Ref: the reference name. */
  name?: string;
  /** Rupees as typed. */
  amount: string;
}

export interface OpenBill {
  id: string;
  ref: string;
  date: string;
  due: string;
  /** Rupees still due. */
  outstanding: number;
}

export interface PartyLine {
  key: number;
  party: string;
  side: 'receivable' | 'payable';
  /** Paise on the party line. */
  paise: number;
}

/** The line bill-wise details apply to: a receipt's debtor credit, a payment's creditor debit (first one). */
export function billwiseLine(type: ManualVoucherType, lines: readonly EntryLine[]): PartyLine | null {
  for (const l of lines) {
    if (!l.party) continue;
    if (type === 'RECEIPT' && l.side === 'cr' && l.account_id === A.debtors) return { key: l.key, party: l.party, side: 'receivable', paise: rupeesToPaise(l.amount) };
    if (type === 'PAYMENT' && l.side === 'dr' && l.account_id === A.creditors) return { key: l.key, party: l.party, side: 'payable', paise: rupeesToPaise(l.amount) };
  }
  return null;
}

const amt = (r: BillRefRow) => round2(rupeesToPaise(r.amount) / 100);

/** Oldest-due-first Agst Ref rows for `totalRupees` (Tally "allocate"), remainder On Account. */
export function fifoRefs(bills: readonly OpenBill[], totalRupees: number, nextKey: () => number): BillRefRow[] {
  let left = round2(totalRupees);
  const out: BillRefRow[] = [];
  for (const b of [...bills].sort((x, y) => x.due.localeCompare(y.due) || x.date.localeCompare(y.date))) {
    const a = round2(Math.min(b.outstanding, left));
    if (a <= 0) continue;
    out.push({ key: nextKey(), kind: 'agst', bill_id: b.id, amount: a.toFixed(2) });
    left = round2(left - a);
  }
  if (left > 0.004) out.push({ key: nextKey(), kind: 'onacc', amount: left.toFixed(2) });
  return out;
}

/** Problems with the references (empty = fine). Indexes are 1-based in messages. */
export function validateRefs(refs: readonly BillRefRow[], totalRupees: number, bills: readonly OpenBill[]): string[] {
  const errors: string[] = [];
  const byId = new Map(bills.map((b) => [b.id, b]));
  const perBill = new Map<string, number>();
  let sum = 0;
  refs.forEach((r, i) => {
    const a = amt(r);
    if (!(a > 0)) return;
    sum += a;
    if (r.kind !== 'agst') return;
    const b = r.bill_id ? byId.get(r.bill_id) : undefined;
    if (!b) return void errors.push(`Reference ${i + 1}: choose the bill.`);
    perBill.set(b.id, round2((perBill.get(b.id) ?? 0) + a));
    if ((perBill.get(b.id) ?? 0) > round2(b.outstanding) + 0.004) errors.push(`${b.ref}: only ${b.outstanding.toFixed(2)} is due.`);
  });
  if (round2(sum) > round2(totalRupees) + 0.004) errors.push('The references add up to more than the party line.');
  return errors;
}

/** Receivable side → the input `saveReceiptVoucher` takes (Agst Ref allocations; the rest one row). */
export function receiptRefsInput(refs: readonly BillRefRow[], party: string, totalRupees: number, bills: readonly OpenBill[], method: string): VoucherReceiptsInput {
  const byId = new Map(bills.map((b) => [b.id, b]));
  const allocations: ReceiptAllocation[] = refs
    .filter((r) => r.kind === 'agst' && r.bill_id && amt(r) > 0)
    .map((r) => ({ bill_id: r.bill_id!, ref: byId.get(r.bill_id!)?.ref ?? '', amount: amt(r) }));
  return { party, total: round2(totalRupees), allocations, method, ...(remainderNote(refs) ? { remainder_note: remainderNote(refs) } : {}) };
}

/** Label of the non-bill remainder ("New ref P-17" / "Advance" / "On account"). */
export function remainderNote(refs: readonly BillRefRow[]): string | undefined {
  const r = refs.find((x) => x.kind !== 'agst' && amt(x) > 0);
  if (!r || r.kind === 'onacc') return undefined;
  return r.kind === 'advance' ? 'Advance' : `New ref ${(r.name ?? '').trim()}`.trim();
}

/** Remainder kind for a supplier payment (first non-bill reference wins; default On Account). */
export function remainderKind(refs: readonly BillRefRow[]): { kind: VendorPayment['kind']; refName?: string } {
  const r = refs.find((x) => x.kind !== 'agst' && amt(x) > 0);
  if (r?.kind === 'new') return { kind: 'NEW_REF', ...(r.name?.trim() ? { refName: r.name.trim() } : {}) };
  if (r?.kind === 'advance') return { kind: 'ADVANCE' };
  return { kind: 'ON_ACCOUNT' };
}

/**
 * Payable side: the voucher as a supplier payment, or an error message when its shape does not fit
 * (exactly a creditor Dr line and one Cash / bank-ledger Cr line).
 */
export function supplierPaymentFrom(
  lines: readonly EntryLine[],
  refs: readonly BillRefRow[],
  ctx: { date: string; reference?: string; vendors: readonly { id: string; name: string }[] },
): SupplierPaymentInput | string {
  const filled = lines.filter((l) => l.account_id || l.amount.trim());
  const party = filled.filter((l) => l.side === 'dr' && l.account_id === A.creditors && l.party);
  const money = filled.filter((l) => l.side === 'cr');
  if (filled.length !== 2 || party.length !== 1 || money.length !== 1) return 'shape';
  const from = money[0].account_id;
  const bankId = from === A.cash ? null : bankAccountIdOfLedger(from);
  if (from !== A.cash && !bankId) return 'shape';
  const total = round2(rupeesToPaise(party[0].amount) / 100);
  const name = party[0].party!.trim();
  const vendor = ctx.vendors.find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
  const rem = remainderKind(refs);
  return {
    ...(vendor ? { vendorId: vendor.id } : {}),
    vendorName: vendor?.name ?? name,
    date: ctx.date,
    amount: total,
    method: from === A.cash ? 'Cash' : 'Bank Transfer',
    ...(ctx.reference?.trim() ? { reference: ctx.reference.trim() } : {}),
    ...(bankId ? { bankAccountId: bankId } : {}),
    allocations: refs.filter((r) => r.kind === 'agst' && r.bill_id && amt(r) > 0).map((r) => ({ purchaseId: r.bill_id!, amount: amt(r) })),
    remainderKind: rem.kind,
    ...(rem.refName ? { refName: rem.refName } : {}),
  };
}

/** Receivable open refs (bill-allocation.ts) in the common shape. */
export const fromOpenRefs = (refs: readonly OpenRef[]): OpenBill[] => refs.map((r) => ({ id: r.id, ref: r.ref, date: r.date, due: r.due, outstanding: r.outstanding }));
