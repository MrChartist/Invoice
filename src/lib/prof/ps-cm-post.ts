/**
 * R14 PS-B3 client money — the store and the postings (one all-or-nothing write, `withTablesRollback`):
 *   receipt    Dr client-money bank      | Cr Client money held
 *   payment    Dr Client money held      | Cr client-money bank   (stamp, court fee … paid for the client: not a firm expense)
 *   refund     Dr Client money held      | Cr client-money bank
 *   to fees    Dr Client money held      | Cr client-money bank, and a normal receipt (`transactions`) into the office
 *              bank against the issued invoice (the money becomes the firm's; cash readers see it then) — refused without
 *              an issued invoice, above its balance, or without the client's authority (the owner may override with a
 *              reason, audited)
 *   transfer   between two clients' balances (no journal: one ledger "Client money held")
 *   interest   Dr client-money bank      | Cr Client money held (to the client) or Interest received (to the firm)
 * No client's or matter's balance may go negative. Deletes go through `removeClientMoney` (recycle bin; its journals and
 * office receipt go with it). Working paper — verify with your CA (PS10, PS27, PS32).
 */
import './ps-registry';
import { requireAccess, can } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { audit } from '../audit';
import { num, round2 } from '../invoice-calc';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, saveVoucher, type ManualVoucherInput, type ManualVoucherLine } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { bankAccountsDb, DEFAULT_BANK_ID, isClientMoneyAccount } from '../bank-accounts';
import { localDb } from '../localDb';
import { isRevenueDoc } from '../stats';
import { receivableBalance } from '../rcm';
import { CLIENT_MONEY_TABLE, CMV_SERIES, negativeBalance, validateCm, type ClientMoneyVoucher, type CmInput } from './ps-client-money';

export const CM_CLASS = 'Client money';
const HELD = { name: 'Client money held', group: 'OTHER_CL', code: 2470 } as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The "Client money held" liability ledger (created on first use; one ledger, the client sub-ledger is this table). */
export function heldLedgerId(): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(HELD.name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let code: number = HELD.code;
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name: HELD.name, group: HELD.group }).id;
}

export const cmDb = {
  all: (): ClientMoneyVoucher[] => getTable<ClientMoneyVoucher>(CLIENT_MONEY_TABLE).filter((r) => r && typeof r.id === 'string'),
};

const p100 = (rupees: number) => Math.round(round2(rupees) * 100);
const dr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: p100(amount), cr: 0 });
const cr = (account_id: string, amount: number): ManualVoucherLine => ({ account_id, dr: 0, cr: p100(amount) });

/** Journal lines of a voucher (pure; ledger ids passed in). Transfers post nothing. */
export function cmLines(v: Pick<ClientMoneyVoucher, 'kind' | 'amount' | 'interest_to'>, l: { bank: string; held: string; interest: string }): ManualVoucherLine[] {
  const a = round2(num(v.amount));
  switch (v.kind) {
    case 'receipt': return [dr(l.bank, a), cr(l.held, a)];
    case 'interest': return [dr(l.bank, a), cr(v.interest_to === 'firm' ? l.interest : l.held, a)];
    case 'transfer': return [];
    default: return [dr(l.held, a), cr(l.bank, a)];
  }
}

export interface RecordOptions {
  /** Owner only: post a to-fees transfer without the client's authority, with this reason (audited). */
  override_reason?: string;
}

/** Record one client-money voucher with its journal (and, for to-fees, the office-bank receipt). */
export function recordClientMoney(input: CmInput, opts: RecordOptions = {}): ClientMoneyVoucher {
  requireAccess('books.edit');
  const err = validateCm(input);
  if (err) throw new Error(err);
  const banks = bankAccountsDb.all();
  if (!isClientMoneyAccount(input.bank_account_id, banks)) throw new Error('Pick a bank account marked "client money" (Reconcile → bank accounts).');
  const amount = round2(num(input.amount));
  let override = '';
  if (input.kind === 'to_fees') {
    const inv = localDb.invoices.getById(input.invoice_id ?? '');
    if (!inv || !isRevenueDoc(inv) || inv.status === 'Draft') throw new Error('Pick an issued invoice: money moves to fees only against a bill.');
    if (inv.client?.id && inv.client.id !== input.client_id) throw new Error('This invoice is for another client.');
    if (amount > round2(receivableBalance(inv)) + 0.005) throw new Error(`More than the invoice balance (₹${round2(receivableBalance(inv))}).`);
    const office = input.office_bank_id || DEFAULT_BANK_ID;
    if (isClientMoneyAccount(office, banks)) throw new Error('Fees go into an office account, not a client-money account.');
    if (!input.authority?.date || !input.authority.ref?.trim()) {
      override = (opts.override_reason ?? '').trim();
      if (!override) throw new Error('Record the client\'s authority to apply the money to fees (date, how, reference) — or the owner may override with a reason.');
      if (!can('settings.manage')) throw new Error('Only the owner may move client money to fees without the client\'s authority.');
    }
  }
  const rows = cmDb.all();
  const number = nextSeriesNumberFor(CMV_SERIES, input.date, rows.map((r) => r.number));
  assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
  const row: ClientMoneyVoucher = {
    ...input,
    id: generateId(),
    number,
    amount,
    ref: (input.ref ?? '').trim(),
    narration: (input.narration ?? '').trim(),
    ...(input.kind === 'to_fees' ? { office_bank_id: input.office_bank_id || DEFAULT_BANK_ID } : {}),
    ...(override ? { override_reason: override } : {}),
    voucher_ids: [],
    created_at: new Date().toISOString(),
  };
  const neg = negativeBalance([...rows, row]);
  if (neg) throw new Error(`This would take a client's balance below zero on ${neg.date} (₹${neg.balance}). Client money is never overdrawn.`);
  return withTablesRollback([CLIENT_MONEY_TABLE, 'vouchers', 'accounts', 'transactions', 'invoices', 'series_counters'], () => {
    const lines = cmLines(row, { bank: bankLedgerId(row.bank_account_id), held: row.kind === 'interest' && row.interest_to === 'firm' ? '' : heldLedgerId(), interest: A.interestIncome });
    if (lines.length) {
      const type: ManualVoucherInput['type'] = row.kind === 'receipt' || row.kind === 'interest' ? 'RECEIPT' : 'PAYMENT';
      const v = saveVoucher({ type, date: row.date, voucher_class: CM_CLASS, narration: `${number} — client money ${row.kind.replace('_', ' ')}${row.narration ? `: ${row.narration}` : ''}`, lines });
      row.voucher_ids = [v.id];
    }
    if (row.kind === 'to_fees') {
      const pay = localDb.payments.record({ invoiceId: row.invoice_id!, amount, method: 'Bank Transfer', reference: number, note: 'Applied from client money', date: row.date, bankAccountId: row.office_bank_id });
      row.payment_id = pay.id;
    }
    setTable(CLIENT_MONEY_TABLE, [...rows, row]);
    recordSeries(number);
    if (override) audit.record({ entity: 'payment', entity_id: row.id, action: 'create', doc_number: number, summary: `Client money ${number}: ₹${amount} moved to fees without the client's recorded authority — owner override: ${override}` });
    return row;
  });
}

/** Delete a voucher (recycle bin): its journal and office receipt go with it; refused if a balance would go negative. */
export function removeClientMoney(id: string): void {
  requireAccess('books.edit');
  const rows = cmDb.all();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  assertUnlocked({ issue_date: row.date, invoice_number: row.number }, 'delete');
  const rest = rows.filter((r) => r.id !== id);
  const neg = negativeBalance(rest);
  if (neg) throw new Error(`Later entries use this money (a balance would go below zero on ${neg.date}). Delete those first.`);
  withTablesRollback([CLIENT_MONEY_TABLE, 'vouchers', 'transactions', 'invoices', 'series_counters'], () => {
    setTable(CLIENT_MONEY_TABLE, rest);
    for (const v of row.voucher_ids ?? []) deleteVoucher(v);
    if (row.payment_id) localDb.payments.remove(row.payment_id);
    recordSeries(row.number); // the number stays used
  });
}
