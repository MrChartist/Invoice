/**
 * Deposit slip / pay-in slip (WP-5, gap P1-14): the cheques in hand and the cash notes counted by
 * denomination, printed for the bank counter, numbered `PIS/FY<yy-yy>/<seq>` (Indian FY of the slip
 * date) and kept in table `deposit_slips` for a reprint. Saving a slip marks its cheques deposited
 * (through `transitionCheque`, so the cheque register, reminders and audit behave as usual) into the
 * chosen bank account. The cash on a slip posts a Contra voucher automatically (7U): Dr the slip's
 * bank ledger | Cr Cash on the slip date (`cash_voucher_id`; untick "Post the cash as a Contra" to
 * leave it out, e.g. when the deposit was already entered by hand).
 *
 * The slip prints the full account number: the bank needs it. Lists elsewhere mask it.
 * Pure above the "Storage" divider.
 */

import type { Cheque } from '../types/cheques';
import { amountInWords } from './amount-in-words';
import { DEFAULT_BANK_ID, type BankAccount } from './bank-accounts';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { isPostDated, validUntil } from './cheque-reminders';
import { cashTotal, denominationRows, normalizeCounts, type DenominationCounts, type DenominationRow } from './denominations';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { CHEQUES_TABLE, loadCheques, transitionCheque } from './cheques';
import { audit } from './audit';
import { bankLedgerId } from './bank-ledgers';
import { A } from './ledger/accounts';
import { deleteVoucher, saveVoucher, type ManualVoucher } from './ledger/vouchers';

export { DENOMINATIONS, cashTotal, denominationRows, normalizeCounts, type DenominationCounts, type DenominationRow } from './denominations';

/** Received cheques that can go on a slip today: in hand, dated today or earlier, still valid (3 months). */
export function depositableCheques(cheques: readonly Cheque[], today: string): Cheque[] {
  return cheques
    .filter((c) => c.direction === 'received' && c.status === 'received' && !isPostDated(c, today) && validUntil(c.cheque_date) >= today)
    .sort((a, b) => a.cheque_date.localeCompare(b.cheque_date) || a.number.localeCompare(b.number));
}

export interface DepositSlip {
  id: string;
  /** `PIS/FY<yy-yy>/<seq>`. */
  number: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Our bank account; missing = the main account. */
  bank_account_id?: string;
  cheque_ids: string[];
  cash: DenominationCounts;
  cheque_total: number;
  cash_total: number;
  total: number;
  /** Depositor name printed on the slip. */
  depositor?: string;
  /** 7U: the Contra voucher (Dr bank | Cr Cash) posted for the slip's cash. */
  cash_voucher_id?: string;
  cash_voucher_number?: string;
  created_at: string;
}

export interface SlipChequeRow {
  number: string;
  bank: string;
  branch: string;
  date: string;
  party: string;
  amount: number;
}

export interface DepositSlipView {
  number: string;
  date: string;
  accountName: string;
  /** Full number: the bank needs it on the slip. */
  accountNo: string;
  ifsc: string;
  branch: string;
  depositor: string;
  cheques: SlipChequeRow[];
  chequeTotal: number;
  cash: DenominationRow[];
  cashTotal: number;
  total: number;
  words: string;
}

/** Problems with a slip about to be saved (empty = fine). */
export function validateDepositSlip(input: { date: string; cheques: readonly Cheque[]; cash: DenominationCounts }, today: string): string[] {
  const errors: string[] = [];
  const day = isoDay(input.date);
  if (!day) errors.push('Choose the deposit date.');
  else if (day > today) errors.push('The deposit date cannot be in the future.');
  if (!input.cheques.length && !(cashTotal(input.cash) > 0)) errors.push('Pick at least one cheque or count some cash.');
  for (const c of input.cheques) {
    if (c.direction !== 'received' || c.status !== 'received') errors.push(`Cheque ${c.number} is not in hand.`);
    else if (day && c.cheque_date > day) errors.push(`Cheque ${c.number} is dated ${c.cheque_date}: it cannot be deposited before then.`);
  }
  return [...new Set(errors)];
}

/** Next pay-in slip number: above every existing number and the series high-water mark (never reused). */
export function nextSlipNumber(existing: readonly Pick<DepositSlip, 'number'>[], date: string): string {
  return nextSeriesNumberFor('PIS', date, existing.map((s) => s.number));
}

/** The printable slip (pure). `cheques` are the slip's cheques in print order. */
export function depositSlipView(slip: Pick<DepositSlip, 'number' | 'date' | 'cash' | 'depositor'>, cheques: readonly Cheque[], account: BankAccount | undefined): DepositSlipView {
  const rows = cheques.map((c) => ({ number: c.number, bank: c.bank, branch: c.branch ?? '', date: c.cheque_date, party: c.party_name, amount: round2(num(c.amount)) }));
  const chequeTotal = round2(rows.reduce((s, r) => s + r.amount, 0));
  const cash = denominationRows(slip.cash);
  const ct = cashTotal(slip.cash);
  const total = round2(chequeTotal + ct);
  return {
    number: slip.number,
    date: slip.date,
    accountName: account?.name ?? 'Main bank account',
    accountNo: account?.account_no ?? account?.number ?? '',
    ifsc: account?.ifsc ?? '',
    branch: account?.branch ?? '',
    depositor: slip.depositor ?? '',
    cheques: rows,
    chequeTotal,
    cash,
    cashTotal: ct,
    total,
    words: total > 0 ? amountInWords(total, 'INR') : '',
  };
}

/* ── Storage ──────────────────────────────────────────────────── */

export const DEPOSIT_SLIPS_TABLE = 'deposit_slips';

export class DepositSlipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DepositSlipError';
  }
}

export function loadDepositSlips(): DepositSlip[] {
  return getTable<DepositSlip>(DEPOSIT_SLIPS_TABLE).filter((s) => s && typeof s.id === 'string');
}

/**
 * Save a slip and mark its cheques deposited into the account on the slip date. If a cheque cannot
 * be moved (e.g. a period lock), the cheques already moved stay deposited and the error is thrown
 * before the slip is stored, so nothing claims a deposit that did not happen.
 */
export function saveDepositSlip(input: { date: string; bank_account_id?: string; cheque_ids: string[]; cash: DenominationCounts; depositor?: string; post_cash_contra?: boolean }, today: string): DepositSlip {
  requireAccess('books.edit');
  const all = loadCheques();
  const picked = input.cheque_ids.map((id) => all.find((c) => c.id === id)).filter((c): c is Cheque => !!c);
  const cash = normalizeCounts(input.cash);
  const errors = validateDepositSlip({ date: input.date, cheques: picked, cash }, today);
  if (errors.length) throw new DepositSlipError(errors[0]);
  const slips = getTable<DepositSlip>(DEPOSIT_SLIPS_TABLE);
  const id = generateId();
  const bankId = input.bank_account_id && input.bank_account_id !== DEFAULT_BANK_ID ? input.bank_account_id : undefined;
  const number = nextSlipNumber(slips, input.date);
  const ct = cashTotal(cash);
  // 7U: the cash goes in as a Contra (Dr bank | Cr Cash) on the slip date — posted first, so a
  // period lock refuses the slip before any cheque moves; removed again if a cheque cannot move.
  let contra: ManualVoucher | undefined;
  if (ct > 0 && input.post_cash_contra !== false) {
    const paise = Math.round(ct * 100);
    contra = saveVoucher({
      type: 'CONTRA',
      date: input.date,
      narration: `Cash deposited in the bank — pay-in slip ${number}`,
      lines: [{ account_id: bankLedgerId(bankId), dr: paise, cr: 0 }, { account_id: A.cash, dr: 0, cr: paise }],
    });
  }
  // Tag the cheques with the account and slip first (in hand: no payment recorded yet), then deposit them.
  const ids = new Set(picked.map((c) => c.id));
  try {
    setTable(CHEQUES_TABLE, all.map((c) => (ids.has(c.id) ? { ...c, bank_account_id: bankId, deposit_slip_id: id } : c)));
    for (const c of picked) transitionCheque(c.id, 'deposited', { date: input.date, today });
  } catch (err) {
    if (contra) {
      try {
        deleteVoucher(contra.id);
      } catch {
        /* the original error is what the caller needs */
      }
    }
    throw err;
  }
  const chequeTotal = round2(picked.reduce((s, c) => s + num(c.amount), 0));
  const slip: DepositSlip = {
    id,
    number,
    date: input.date,
    ...(bankId ? { bank_account_id: bankId } : {}),
    cheque_ids: picked.map((c) => c.id),
    cash,
    cheque_total: chequeTotal,
    cash_total: ct,
    total: round2(chequeTotal + ct),
    ...(input.depositor?.trim() ? { depositor: input.depositor.trim() } : {}),
    ...(contra ? { cash_voucher_id: contra.id, cash_voucher_number: contra.number } : {}),
    created_at: new Date().toISOString(),
  };
  setTable(DEPOSIT_SLIPS_TABLE, [...slips, slip]);
  recordSeries(slip.number);
  try {
    audit.record({ entity: 'cheque', entity_id: slip.id, action: 'create', doc_number: slip.number, summary: `Deposit slip ${slip.number} dated ${slip.date}: ${picked.length} cheque(s) ₹${chequeTotal.toFixed(2)} + cash ₹${ct.toFixed(2)}${contra ? ` (Contra ${contra.number})` : ''}` });
  } catch {
    /* logging never breaks a save */
  }
  return slip;
}
