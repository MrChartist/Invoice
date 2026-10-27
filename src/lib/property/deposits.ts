/**
 * R5-C6 security deposits register. A deposit we HOLD (`received`) is a liability ("Security deposits received",
 * other current liabilities, created by name); one we PAID is the asset "Security deposits" (3200). Movements post
 * through `saveVoucher` (period lock, roles, audit):
 *  - receive / pay: receipt / payment voucher;
 *  - adjust against an existing invoice: a journal (Dr deposits received | Cr debtors) whose bill-wise receipt row
 *    settles that invoice — no money moves; against new damages, or a forfeit: a TAX document is raised for the
 *    applied amount first ("applied as consideration — GST payable on the applied part", proviso to Sec 2(31)), then
 *    settled the same way;
 *  - refund: payment voucher (received) / receipt voucher (paid).
 * A refundable deposit is not income until applied. Working paper — verify with your CA (§7 Q12).
 */
import type { InvoiceRecord, Payment, SenderProfile } from '../../types/invoice';
import type { DepositMoveKind, DepositMovement, SecurityDeposit } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { A } from '../ledger/accounts';
import { saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { saveReceiptVoucher } from '../bill-allocation';
import { bankLedgerId } from '../bank-ledgers';
import { buildBatchDrafts, issueBatch } from '../batch-invoices';
import type { RecurringTemplate } from '../recurring';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { amountDue, linkedCredits, type CreditLinkRow } from '../amount-due';
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { receiptHtml } from '../receipts';
import { amountInWords } from '../amount-in-words';
import { DEPOSITS_RECEIVED_ACCOUNT, DEPOSITS_TABLE, R5cError, day, ensureAccount, money, paise, str } from '../institutions/r5c';

export const ADJUST_METHOD = 'Security deposit adjustment';
export const ensureDepositsReceivedAccount = () => ensureAccount(DEPOSITS_RECEIVED_ACCOUNT, 'OTHER_CL', 2810);

export const loadDeposits = (): SecurityDeposit[] => peekTable<SecurityDeposit>(DEPOSITS_TABLE).filter((d) => d && d.id && Array.isArray(d.movements)) as SecurityDeposit[];

const OUT: readonly DepositMoveKind[] = ['adjust', 'forfeit', 'refund'];

/** Balance still held / receivable: money in (receive / pay) less adjusted, forfeited and refunded. */
export function depositBalance(d: Pick<SecurityDeposit, 'movements'>): number {
  return round2(d.movements.reduce((s, m) => s + (OUT.includes(m.kind) ? -m.amount : m.amount), 0));
}

const moneyLedger = (mode: string, bank?: string) => (mode === 'cash' ? A.cash : bankLedgerId(bank));

function lock(d: SecurityDeposit, date: string) {
  assertUnlocked({ id: d.id, issue_date: date, invoice_number: '' }, 'create');
}

function write(d: SecurityDeposit, mv: DepositMovement): SecurityDeposit {
  const movements = [...d.movements, mv];
  const row: SecurityDeposit = { ...d, movements, status: depositBalance({ movements }) <= 0.004 ? 'closed' : 'open' };
  const all = getTable<SecurityDeposit>(DEPOSITS_TABLE);
  setTable(DEPOSITS_TABLE, all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
  return row;
}

export interface DepositInput {
  direction: 'received' | 'paid';
  party_id: string;
  party_name: string;
  amount: number;
  date: string;
  mode: string;
  bank_account_id?: string;
  lease_id?: string;
  interest_pct?: number;
}

/** Record a new deposit and the money that came in / went out. All or nothing. */
export function recordDeposit(i: DepositInput): SecurityDeposit {
  requireAccess('books.edit');
  const amount = money(i.amount);
  const date = day(i.date);
  if (!(amount > 0) || !date) throw new R5cError('amount');
  if (!str(i.party_name)) throw new R5cError('party');
  const d: SecurityDeposit = {
    id: generateId(), direction: i.direction === 'paid' ? 'paid' : 'received', party_id: str(i.party_id), party_name: str(i.party_name), amount, date, mode: str(i.mode) || 'bank',
    ...(i.bank_account_id ? { bank_account_id: i.bank_account_id } : {}), ...(i.lease_id ? { lease_id: i.lease_id } : {}),
    ...(money(i.interest_pct) > 0 ? { interest: { pct: money(i.interest_pct) } } : {}), movements: [], status: 'open', created_at: new Date().toISOString(),
  };
  lock(d, date);
  return withTablesRollback([DEPOSITS_TABLE, 'vouchers', 'accounts'], () => {
    const p = paise(amount);
    const cash = moneyLedger(d.mode, d.bank_account_id);
    const held = d.direction === 'received' ? ensureDepositsReceivedAccount() : A.deposits;
    const lines: ManualVoucherLine[] = d.direction === 'received' ? [{ account_id: cash, dr: p, cr: 0 }, { account_id: held, dr: 0, cr: p }] : [{ account_id: held, dr: p, cr: 0 }, { account_id: cash, dr: 0, cr: p }];
    const v = saveVoucher({ type: d.direction === 'received' ? 'RECEIPT' : 'PAYMENT', date, narration: `Security deposit ${d.direction === 'received' ? 'received from' : 'paid to'} ${d.party_name}`, lines, voucher_class: 'Security deposit' });
    return write(d, { id: generateId(), kind: d.direction === 'received' ? 'receive' : 'pay', date, amount, voucher_id: v.id });
  });
}

function partyOf(inv: InvoiceRecord) {
  return inv.client?.company || inv.client?.name || '';
}

/** Settle `amount` of an open invoice out of a deposit we hold (journal + bill-wise receipt row). */
function settleFromDeposit(d: SecurityDeposit, inv: InvoiceRecord, amount: number, date: string, kind: DepositMoveKind, note: string): SecurityDeposit {
  const p = paise(amount);
  const party = partyOf(inv);
  const v = saveReceiptVoucher(
    { type: 'JOURNAL', date, narration: `${note} — ${d.party_name}, against ${inv.invoice_number}`, lines: [{ account_id: ensureDepositsReceivedAccount(), dr: p, cr: 0 }, { account_id: A.debtors, dr: 0, cr: p, party }], voucher_class: 'Security deposit' },
    undefined,
    { party, total: amount, allocations: [{ bill_id: inv.id, ref: inv.invoice_number, amount }], method: ADJUST_METHOD },
  );
  // The receipt rows moved no money: mark them so cash / bank readers skip them (like gift-voucher rows).
  setTable('transactions', getTable<Payment & { voucher_id?: string }>('transactions').map((r) => (r.voucher_id === v.id ? { ...r, deposit_adjustment_id: d.id } : r)));
  return write(d, { id: generateId(), kind, date, amount, doc_id: inv.id, voucher_id: v.id, note });
}

function guard(id: string, amount: number, date: string): SecurityDeposit {
  requireAccess('books.edit');
  const d = loadDeposits().find((x) => x.id === id);
  if (!d) throw new R5cError('deposit');
  if (!(money(amount) > 0) || !day(date)) throw new R5cError('amount');
  if (money(amount) > depositBalance(d) + 0.004) throw new R5cError('balance');
  lock(d, date);
  return d;
}

/**
 * QA6 F3: what is still due on `inv` — net of its live credit notes (`amount-due.ts`), never the gross balance, so a
 * deposit never settles more than the party owes. Read-only peeks (no clone of the tables).
 */
export function dueForDeposit(inv: InvoiceRecord, links: readonly CreditLinkRow[] = peekTable<CreditLinkRow>('doc_links'), invoices: readonly InvoiceRecord[] = peekTable<InvoiceRecord>('invoices')): number {
  const mine = links.filter((l) => l.from_id === inv.id);
  return amountDue(inv, mine.length ? linkedCredits(mine, invoices).get(inv.id) : 0);
}

/** A party's issued invoices that still have something due (net of credit notes), for the "adjust" pick list. */
export function depositOpenInvoices(partyId: string): { inv: InvoiceRecord; due: number }[] {
  if (!partyId) return [];
  const invoices = peekTable<InvoiceRecord>('invoices');
  const credits = linkedCredits(peekTable<CreditLinkRow>('doc_links'), invoices);
  const out: { inv: InvoiceRecord; due: number }[] = [];
  for (const inv of invoices) {
    if (inv?.client?.id !== partyId || inv.doc_type === 'CREDIT_NOTE' || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    const due = amountDue(inv, credits.get(inv.id));
    if (due > 0) out.push({ inv, due });
  }
  return out;
}

/** Adjust a deposit we hold against an invoice that already exists (receipt only; no new tax document). */
export function adjustAgainstInvoice(id: string, invoiceId: string, amount: number, date: string): SecurityDeposit {
  const d = guard(id, amount, date);
  if (d.direction !== 'received') throw new R5cError('direction');
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new R5cError('invoice');
  if (money(amount) > dueForDeposit(inv) + 0.004) throw new R5cError('balance');
  return withTablesRollback([DEPOSITS_TABLE, 'vouchers', 'accounts', 'transactions', 'invoices'], () => settleFromDeposit(d, inv, money(amount), day(date), 'adjust', 'Deposit adjusted'));
}

export interface ChargeContext {
  sender: SenderProfile | null;
  templateId: string;
  /** GST rate of the charge (damages / forfeit), default 18 — verify with your CA. */
  rate?: number;
  sac?: string;
}

/**
 * Apply a deposit we hold to a NEW charge — damages (`adjust`) or a forfeit (`forfeit`): a tax invoice for the
 * applied amount (tax-inclusive: the deposit pays the whole of it) is issued, then settled from the deposit.
 */
export function applyToCharge(id: string, kind: 'adjust' | 'forfeit', amount: number, date: string, what: string, ctx: ChargeContext): { deposit: SecurityDeposit; invoice: InvoiceRecord } {
  const d = guard(id, amount, date);
  if (d.direction !== 'received') throw new R5cError('direction');
  const client = (d.party_id && localDb.clients.getById(d.party_id)) || { name: d.party_name, email: '', address: '', city: '', zip: '' };
  const rate = ctx.rate ?? 18;
  const gross = money(amount);
  const tpl = {
    doc_type: 'TAX_INVOICE', currency: 'INR', template_id: ctx.templateId, client, sender: ctx.sender,
    items: [{ id: 'l1', name: str(what) || (kind === 'forfeit' ? 'Security deposit forfeited' : 'Damages recovered from deposit'), type: 'Service', ...(ctx.sac ? { hsn: ctx.sac } : {}), quantity: 1, rate: gross, tax_rate: rate, amount: gross }],
    gst_mode: 'CGST_SGST', place_of_supply: '', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: false, price_includes_tax: true, notes: 'Applied from the security deposit as consideration — GST payable on the applied part.', terms: '',
  } as RecurringTemplate;
  return withTablesRollback([DEPOSITS_TABLE, 'vouchers', 'accounts', 'transactions', 'invoices', 'batch_runs', 'clients', 'items_catalog'], () => {
    const drafts = buildBatchDrafts(tpl, [{ key: `dep:${d.id}`, client }], { date: day(date), dueDays: 0, sender: ctx.sender });
    const inv = issueBatch(drafts, { sourceId: `deposit:${d.id}`, sourceKind: 'invoice', date: day(date), mode: 'issue', force: true }).invoices[0];
    const pay = Math.min(gross, dueForDeposit(inv));
    const deposit = settleFromDeposit(d, inv, pay, day(date), kind, kind === 'forfeit' ? 'Deposit forfeited' : 'Deposit applied to damages');
    return { deposit, invoice: localDb.invoices.getById(inv.id) ?? inv };
  });
}

/** Refund (all or part of) a deposit: payment voucher when we held it, receipt voucher when we had paid it. */
export function refundDeposit(id: string, amount: number, date: string, mode = 'bank', bankAccountId?: string): SecurityDeposit {
  const d = guard(id, amount, date);
  return withTablesRollback([DEPOSITS_TABLE, 'vouchers', 'accounts'], () => {
    const p = paise(money(amount));
    const cash = moneyLedger(mode, bankAccountId ?? d.bank_account_id);
    const held = d.direction === 'received' ? ensureDepositsReceivedAccount() : A.deposits;
    const lines: ManualVoucherLine[] = d.direction === 'received' ? [{ account_id: held, dr: p, cr: 0 }, { account_id: cash, dr: 0, cr: p }] : [{ account_id: cash, dr: p, cr: 0 }, { account_id: held, dr: 0, cr: p }];
    const v = saveVoucher({ type: d.direction === 'received' ? 'PAYMENT' : 'RECEIPT', date: day(date), narration: `Security deposit refund — ${d.party_name}`, lines, voucher_class: 'Security deposit' });
    return write(d, { id: generateId(), kind: 'refund', date: day(date), amount: money(amount), voucher_id: v.id });
  });
}

/** Party-wise schedule of deposits outstanding on `asOf` (notes to accounts). */
export function depositScheduleCsv(rows: readonly SecurityDeposit[], asOf: string, head: readonly string[]): string {
  const live = rows.map((d) => ({ d, mv: d.movements.filter((m) => m.date <= asOf) })).filter((x) => x.mv.length);
  return toCsv([[...head], ...live.map(({ d, mv }) => {
    const sumOf = (k: DepositMoveKind[]) => round2(mv.filter((m) => k.includes(m.kind)).reduce((s, m) => s + m.amount, 0));
    return [d.party_name, d.direction, d.date, sumOf(['receive', 'pay']), sumOf(['adjust', 'forfeit']), sumOf(['refund']), depositBalance({ movements: mv })];
  })]);
}

/** A refund receipt page (the app's script-free receipt, `receipts.ts`). */
export function refundReceiptHtml(d: SecurityDeposit, m: DepositMovement, business: string): string {
  const left = depositBalance({ movements: d.movements.slice(0, d.movements.indexOf(m) + 1) });
  return receiptHtml({
    title: 'Security deposit refund', number: m.id.slice(0, 8).toUpperCase(), date: m.date, from: d.party_name, fromGstin: '', business, businessGstin: '', businessAddress: '',
    amount: m.amount, currency: 'INR', amountWords: amountInWords(m.amount, 'INR'), method: d.mode, reference: '', against: '', invoiceTotal: d.amount, balanceAfter: left,
    rows: [['Deposit of', `₹${d.amount.toFixed(2)} (${d.date})`], ['Refunded', `₹${m.amount.toFixed(2)}`], ['Balance held', `₹${left.toFixed(2)}`]],
  });
}
