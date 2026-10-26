/**
 * Forex bank ledgers (7U, roadmap 7.23): EEFC / foreign-currency bank accounts. A bank account with a
 * `currency` (USD, EUR…) keeps its ledger in rupees like every other bank ledger (`bank-ledgers.ts`),
 * and this module keeps the foreign-currency (FCY) side next to it:
 *
 *  - FCY balance = `fcy_opening` + receipts of invoices in the account's currency received into it
 *    (`Payment.amount` is in the invoice currency) + the entries in table `fx_bank_moves`;
 *  - rupee (book) balance = the account's ledger balance (receipts at their realised rate, 6.19);
 *  - carrying rate = rupee balance ÷ FCY balance (weighted average).
 *
 * Entries (each posts one manual Journal through `saveVoucher`: period lock, audit, roles):
 *  - `in`  — FCY credited to the account from elsewhere (typed rate): Dr forex bank | Cr counter ledger;
 *  - `out` — FCY leaves the account (conversion to an INR account, a payment): the counter ledger gets
 *    the rupees actually received / settled, the bank is relieved at its carrying value and the
 *    difference is the REALISED exchange gain / loss (4930 Foreign exchange gain / loss);
 *  - `revalue` — period-end restatement of the FCY balance at a typed closing rate (AS 11 / Ind AS 21:
 *    monetary items at the closing rate): the UNREALISED difference, Dr / Cr the bank vs 4930.
 *
 * No live rates: every rate is typed. Working papers — verify the rates and the treatment with your CA.
 * Pure above the "Storage" divider.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { DEFAULT_BANK_ID, bankAccountsDb, type BankAccount } from './bank-accounts';
import { bankLedgerId } from './bank-ledgers';
import { receiptInr } from './fx-gain';
import { docCurrency } from './fx';
import { isoDay } from './dates';
import { A } from './ledger/accounts';
import { closingBalances } from './ledger/reports';
import { deleteVoucher, saveVoucher, type ManualVoucherLine } from './ledger/vouchers';
import { loadLedger } from './ledger/index';
import { withTablesRollback } from './table-txn';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { audit } from './audit';
import { movedNoCash } from './advance-tax'; // no-cash.ts (QA6-1 F4)

export const FX_BANK_MOVES_TABLE = 'fx_bank_moves';

export type FxMoveKind = 'in' | 'out' | 'revalue';

export interface FxBankMove {
  id: string;
  bank_account_id: string;
  /** YYYY-MM-DD. */
  date: string;
  kind: FxMoveKind;
  /** Foreign-currency amount moved (positive; 0 for a revaluation). */
  fcy: number;
  /** Rate typed (₹ per unit): `in` = rate credited, `out` = rate realised, `revalue` = closing rate. */
  rate: number;
  /** Rupees: `in` = posted to the bank; `out` = received / settled on the counter ledger; `revalue` = the difference (signed). */
  inr: number;
  /** `out` only: rupees taken off the bank at its carrying rate. */
  carrying?: number;
  /** Exchange difference (signed, + = gain): realised for `out`, unrealised for `revalue`. */
  diff?: number;
  /** Counter ledger id (`in` / `out`), e.g. another bank, Sundry debtors, Bank charges. */
  counter_account?: string;
  counter_party?: string;
  voucher_id: string;
  voucher_number: string;
  narration?: string;
  created_at: string;
}

export interface FxMovementRow {
  date: string;
  kind: 'opening' | 'receipt' | FxMoveKind;
  /** Signed FCY (+ in, − out). */
  fcy: number;
  /** Signed rupees on the bank ledger (+ Dr, − Cr). */
  inr: number;
  ref: string;
}

export interface ForexData {
  transactions: readonly Payment[];
  invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number' | 'currency' | 'exchange_rate'>[];
  moves: readonly FxBankMove[];
}

const money = (n: number) => round2(num(n)).toFixed(2);

/** Foreign-currency accounts of the master. */
export const forexAccounts = (accounts: readonly BankAccount[]): BankAccount[] => accounts.filter((a) => a.id !== DEFAULT_BANK_ID && !!a.currency);

/**
 * FCY movements of one account in date order (opening first). Movements dated before the account's
 * `opening_as_of` are left out (the opening already contains them).
 */
export function fxMovements(account: BankAccount, data: ForexData): FxMovementRow[] {
  const cur = (account.currency ?? '').toUpperCase();
  const from = account.opening_as_of ?? '';
  const rows: FxMovementRow[] = [];
  const byId = new Map(data.invoices.map((i) => [i.id, i]));
  for (const t of data.transactions) {
    if (!t || t.bank_account_id !== account.id || movedNoCash(t)) continue; // QA6-1 F4: no money moved (`no-cash.ts`)
    const inv = byId.get(t.invoice_id);
    if (!inv || docCurrency(inv) !== cur) continue;
    const date = isoDay(t.date);
    if (!date || (from && date < from)) continue;
    rows.push({ date, kind: 'receipt', fcy: round2(num(t.amount)), inr: receiptInr(t, inv as InvoiceRecord), ref: inv.invoice_number });
  }
  for (const m of data.moves) {
    if (!m || m.bank_account_id !== account.id) continue;
    if (from && m.date < from) continue;
    const fcy = m.kind === 'in' ? num(m.fcy) : m.kind === 'out' ? -num(m.fcy) : 0;
    const inr = m.kind === 'in' ? num(m.inr) : m.kind === 'out' ? -num(m.carrying) : num(m.diff);
    rows.push({ date: m.date, kind: m.kind, fcy: round2(fcy), inr: round2(inr), ref: m.voucher_number });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'revalue' ? 1 : 0) - (b.kind === 'revalue' ? 1 : 0));
  if (account.fcy_opening !== undefined || account.opening !== undefined) {
    rows.unshift({ date: from, kind: 'opening', fcy: round2(num(account.fcy_opening)), inr: round2(num(account.opening)), ref: '' });
  }
  return rows;
}

/** FCY balance at the end of `date`. */
export function fcyBalanceAt(account: BankAccount, data: ForexData, date: string): number {
  return round2(fxMovements(account, data).filter((r) => r.kind === 'opening' || r.date <= date).reduce((s, r) => s + r.fcy, 0));
}

/** Rupees per unit at which the balance is carried (null when there is no FCY balance). */
export function carryingRate(fcyBalance: number, inrBalance: number): number | null {
  return num(fcyBalance) > 0.004 ? num(inrBalance) / num(fcyBalance) : null;
}

export interface OutflowPlan {
  carrying: number;
  diff: number;
  errors: string[];
}

/** FCY leaving the account: carrying value taken off the bank and the realised difference. */
export function planOutflow(input: { fcy: number; inrReceived: number; fcyBalance: number; inrBalance: number }): OutflowPlan {
  const fcy = round2(num(input.fcy));
  const errors: string[] = [];
  if (!(fcy > 0)) errors.push('Enter the foreign-currency amount.');
  if (!(num(input.inrReceived) > 0)) errors.push('Enter the rupee value received / settled.');
  if (fcy > round2(num(input.fcyBalance)) + 0.004) errors.push(`Only ${money(input.fcyBalance)} is in the account on that date.`);
  const rate = carryingRate(input.fcyBalance, input.inrBalance);
  const carrying = errors.length || rate === null ? 0 : Math.abs(fcy - num(input.fcyBalance)) < 0.005 ? round2(num(input.inrBalance)) : round2(fcy * rate);
  return { carrying, diff: errors.length ? 0 : round2(num(input.inrReceived) - carrying), errors };
}

export interface RevaluationPlan {
  fcy: number;
  book: number;
  restated: number;
  /** + = unrealised gain (Dr bank), − = loss. */
  diff: number;
}

/** Restate the FCY balance at a typed closing rate. */
export function planRevaluation(input: { fcyBalance: number; inrBalance: number; rate: number }): RevaluationPlan {
  const fcy = round2(num(input.fcyBalance));
  const restated = round2(fcy * num(input.rate));
  const book = round2(num(input.inrBalance));
  return { fcy, book, restated, diff: round2(restated - book) };
}

const paise = (rupees: number) => Math.round(Math.abs(num(rupees)) * 100);

/** Journal lines of an entry (integer paise, balanced). */
export function moveVoucherLines(move: Pick<FxBankMove, 'kind' | 'inr' | 'carrying' | 'diff' | 'counter_account' | 'counter_party'>, bankLedger: string): ManualVoucherLine[] {
  const lines: ManualVoucherLine[] = [];
  const add = (account_id: string, rupees: number, side: 'dr' | 'cr', party?: string) => {
    const p = paise(rupees);
    if (p > 0) lines.push({ account_id, dr: side === 'dr' ? p : 0, cr: side === 'cr' ? p : 0, ...(party ? { party } : {}) });
  };
  const counter = move.counter_account || A.otherCa;
  if (move.kind === 'in') {
    add(bankLedger, move.inr, 'dr');
    add(counter, move.inr, 'cr', move.counter_party);
  } else if (move.kind === 'out') {
    add(counter, move.inr, 'dr', move.counter_party);
    add(bankLedger, num(move.carrying), 'cr');
    const d = num(move.diff);
    if (d > 0) add(A.fxGain, d, 'cr');
    else if (d < 0) add(A.fxGain, d, 'dr');
  } else {
    const d = num(move.diff);
    add(bankLedger, d, d >= 0 ? 'dr' : 'cr');
    add(A.fxGain, d, d >= 0 ? 'cr' : 'dr');
  }
  return lines;
}

/** Other postings on a forex account that carry no FCY figure (supplier payments, INR receipts…): counted for a warning. */
export function inrOnlyPostings(accountId: string, t: { transactions?: readonly Payment[]; invoices?: ForexData['invoices']; currency?: string; purchasePayments?: readonly { bank_account_id?: string }[]; vendorPayments?: readonly { bank_account_id?: string }[] }): number {
  const cur = (t.currency ?? '').toUpperCase();
  const byId = new Map((t.invoices ?? []).map((i) => [i.id, i]));
  let n = 0;
  for (const p of t.transactions ?? []) {
    if (p?.bank_account_id !== accountId || movedNoCash(p)) continue;
    const inv = byId.get(p.invoice_id);
    if (!inv || docCurrency(inv) !== cur) n++;
  }
  for (const r of [...(t.purchasePayments ?? []), ...(t.vendorPayments ?? [])]) if (r?.bank_account_id === accountId) n++;
  return n;
}

/* ── Storage ──────────────────────────────────────────────────── */

export class ForexBankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForexBankError';
  }
}

export const loadFxMoves = (): FxBankMove[] => getTable<FxBankMove>(FX_BANK_MOVES_TABLE).filter((m) => m && typeof m.id === 'string');

export function liveForexData(): ForexData {
  return { transactions: getTable<Payment>('transactions'), invoices: getTable<InvoiceRecord>('invoices'), moves: loadFxMoves() };
}

/** Rupee balance of the account's ledger at the end of `date` (the books' figure). */
export function ledgerInrBalance(accountId: string, date: string): number {
  const bal = closingBalances(loadLedger(), date).get(bankLedgerId(accountId)) ?? 0;
  return round2(bal / 100);
}

/** Make an account a foreign-currency account (or back to INR with currency ''). */
export function setAccountCurrency(accountId: string, currency: string, fcyOpening?: number): BankAccount {
  requireAccess('books.edit');
  if (accountId === DEFAULT_BANK_ID) throw new ForexBankError('The main bank account stays in rupees: add a separate account for the EEFC / foreign-currency balance.');
  const acc = bankAccountsDb.all().find((a) => a.id === accountId);
  if (!acc) throw new ForexBankError('Bank account not found.');
  const cur = currency.trim().toUpperCase();
  if (cur && (!/^[A-Z]{3}$/.test(cur) || cur === 'INR')) throw new ForexBankError('Use a three-letter currency code such as USD.');
  if (!cur && loadFxMoves().some((m) => m.bank_account_id === accountId)) throw new ForexBankError('This account has forex entries: delete them first.');
  const next: BankAccount = { ...acc };
  if (cur) next.currency = cur;
  else delete next.currency;
  if (cur && fcyOpening !== undefined && Number.isFinite(fcyOpening)) next.fcy_opening = round2(fcyOpening);
  if (!cur) delete next.fcy_opening;
  return bankAccountsDb.save(next);
}

export interface FxMoveInput {
  bank_account_id: string;
  date: string;
  kind: FxMoveKind;
  /** FCY amount (in / out). */
  fcy?: number;
  /** ₹ per unit. */
  rate: number;
  /** `out`: rupees received / settled (default fcy × rate). */
  inr?: number;
  counter_account?: string;
  counter_party?: string;
  narration?: string;
}

/** Record an entry: compute it against the live balances, post its Journal and store it (all or nothing). */
export function recordFxMove(input: FxMoveInput): FxBankMove {
  requireAccess('books.edit');
  const acc = bankAccountsDb.all().find((a) => a.id === input.bank_account_id);
  if (!acc?.currency) throw new ForexBankError('Pick a foreign-currency bank account.');
  const date = isoDay(input.date);
  if (!date) throw new ForexBankError('Choose the date.');
  const rate = num(input.rate);
  if (!(rate > 0)) throw new ForexBankError('Enter the rate (₹ per unit) — no live rates are fetched.');
  const data = liveForexData();
  const fcyBal = fcyBalanceAt(acc, data, date);
  const inrBal = ledgerInrBalance(acc.id, date);
  const ledger = bankLedgerId(acc.id);
  const cur = acc.currency;
  let move: Omit<FxBankMove, 'id' | 'voucher_id' | 'voucher_number' | 'created_at'>;
  let narration: string;
  if (input.kind === 'in') {
    const fcy = round2(num(input.fcy));
    if (!(fcy > 0)) throw new ForexBankError('Enter the foreign-currency amount.');
    if (!input.counter_account) throw new ForexBankError('Choose the ledger the money came from.');
    const inr = round2(fcy * rate);
    move = { bank_account_id: acc.id, date, kind: 'in', fcy, rate, inr, counter_account: input.counter_account, ...(input.counter_party ? { counter_party: input.counter_party } : {}) };
    narration = `${cur} ${money(fcy)} credited to ${acc.name} @ ₹${rate} = ₹${money(inr)}`;
  } else if (input.kind === 'out') {
    const fcy = round2(num(input.fcy));
    if (!input.counter_account) throw new ForexBankError('Choose the ledger the money went to.');
    const received = input.inr !== undefined && num(input.inr) > 0 ? round2(num(input.inr)) : round2(fcy * rate);
    const plan = planOutflow({ fcy, inrReceived: received, fcyBalance: fcyBal, inrBalance: inrBal });
    if (plan.errors.length) throw new ForexBankError(plan.errors[0]);
    move = { bank_account_id: acc.id, date, kind: 'out', fcy, rate, inr: received, carrying: plan.carrying, diff: plan.diff, counter_account: input.counter_account, ...(input.counter_party ? { counter_party: input.counter_party } : {}) };
    narration = `${cur} ${money(fcy)} out of ${acc.name} @ ₹${rate}: ₹${money(received)} against carrying value ₹${money(plan.carrying)} — realised exchange ${plan.diff >= 0 ? 'gain' : 'loss'} ₹${money(Math.abs(plan.diff))} (verify with your CA)`;
  } else {
    const plan = planRevaluation({ fcyBalance: fcyBal, inrBalance: inrBal, rate });
    if (Math.abs(plan.diff) < 0.005) throw new ForexBankError('Nothing to revalue: the book balance already equals the balance at that rate.');
    move = { bank_account_id: acc.id, date, kind: 'revalue', fcy: 0, rate, inr: plan.diff, diff: plan.diff };
    narration = `Revaluation of ${acc.name}: ${cur} ${money(plan.fcy)} @ ₹${rate} closing rate = ₹${money(plan.restated)} against book ₹${money(plan.book)} — unrealised exchange ${plan.diff >= 0 ? 'gain' : 'loss'} (AS 11; verify with your CA)`;
  }
  const lines = moveVoucherLines(move, ledger);
  return withTablesRollback([FX_BANK_MOVES_TABLE, 'vouchers'], () => {
    const v = saveVoucher({ type: 'JOURNAL', date, narration: input.narration?.trim() ? `${input.narration.trim()} | ${narration}` : narration, lines, voucher_class: 'Forex bank' });
    const row: FxBankMove = { ...move, id: generateId(), voucher_id: v.id, voucher_number: v.number, ...(input.narration?.trim() ? { narration: input.narration.trim() } : {}), created_at: new Date().toISOString() };
    setTable(FX_BANK_MOVES_TABLE, [...loadFxMoves(), row]);
    return row;
  });
}

/** Delete an entry and its Journal (period lock applies through `deleteVoucher`). */
export function deleteFxMove(id: string): void {
  requireAccess('books.edit');
  const row = loadFxMoves().find((m) => m.id === id);
  if (!row) return;
  withTablesRollback([FX_BANK_MOVES_TABLE, 'vouchers'], () => {
    deleteVoucher(row.voucher_id);
    setTable(FX_BANK_MOVES_TABLE, loadFxMoves().filter((m) => m.id !== id));
  });
  try {
    audit.record({ entity: 'voucher', entity_id: id, action: 'delete', doc_number: row.voucher_number, summary: `Deleted forex bank ${row.kind} entry ${row.voucher_number} of ${row.date}` });
  } catch {
    /* logging never breaks a delete */
  }
}

export interface ForexSummary {
  account: BankAccount;
  fcy: number;
  inr: number;
  rate: number | null;
  realised: number;
  unrealised: number;
  inrOnly: number;
  rows: FxMovementRow[];
}

/** Statement of one account for a period (live). */
export function forexSummary(account: BankAccount, period: { from: string; to: string }): ForexSummary {
  const data = liveForexData();
  const rows = fxMovements(account, data);
  const fcy = fcyBalanceAt(account, data, period.to);
  const inr = ledgerInrBalance(account.id, period.to);
  const inPeriod = data.moves.filter((m) => m.bank_account_id === account.id && m.date >= period.from && m.date <= period.to);
  return {
    account,
    fcy,
    inr,
    rate: carryingRate(fcy, inr),
    realised: round2(inPeriod.filter((m) => m.kind === 'out').reduce((s, m) => s + num(m.diff), 0)),
    unrealised: round2(inPeriod.filter((m) => m.kind === 'revalue').reduce((s, m) => s + num(m.diff), 0)),
    inrOnly: inrOnlyPostings(account.id, { ...data, currency: account.currency, purchasePayments: getTable('purchase_payments'), vendorPayments: getTable('vendor_payments') }),
    rows: rows.filter((r) => r.kind === 'opening' || (r.date >= period.from && r.date <= period.to)),
  };
}
