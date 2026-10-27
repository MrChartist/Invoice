/**
 * R14 PS-B3 three-way reconciliation of client money on a date (pure): (1) the bank's statement balance of the
 * client-money accounts (typed, or from the imported statement), (2) their ledger balance (opening + journals), (3) Σ
 * client balances (`client_money`). Every difference is listed: entries on the bank ledger that are no client-money
 * voucher (unallocated), interest that belongs to the firm still in the account, a to-fees entry whose office receipt is
 * gone, and the unexplained rest (uncleared items — tick them off in the BRS). Working paper — verify with your CA (PS27).
 */
import { num, round2 } from '../invoice-calc';
import { cmBalances, totalHeld, type ClientMoneyVoucher } from './ps-client-money';

export interface RecoDiff {
  kind: 'unallocated' | 'firm_interest' | 'receipt_missing' | 'uncleared';
  amount: number;
  ref: string;
}

export interface RecoResult {
  date: string;
  statement: number | null;
  ledger: number;
  clients: number;
  diffs: RecoDiff[];
  /** All three agree (to the paisa). */
  agreed: boolean;
}

type VoucherLike = { id: string; number?: string; date: string; lines: readonly { account_id: string; dr: number; cr: number }[] };

/**
 * `bankLedgers`: ledger id → opening (₹) and its as-of day, for each client-money account. `vouchers`: manual vouchers
 * (paise). `paymentIds`: live `transactions` ids.
 */
export function threeWay(input: { date: string; statement: number | null; rows: readonly ClientMoneyVoucher[]; vouchers: readonly VoucherLike[]; bankLedgers: ReadonlyMap<string, { opening?: number; as_of?: string }>; paymentIds: ReadonlySet<string> }): RecoResult {
  const { date } = input;
  const own = new Set(input.rows.flatMap((r) => r.voucher_ids ?? []));
  let ledger = 0;
  for (const [, o] of input.bankLedgers) if (num(o.opening) && (!o.as_of || o.as_of <= date)) ledger += num(o.opening);
  const diffs: RecoDiff[] = [];
  for (const v of input.vouchers) {
    if (v.date > date) continue;
    const net = v.lines.filter((l) => input.bankLedgers.has(l.account_id)).reduce((s, l) => s + num(l.dr) - num(l.cr), 0) / 100;
    if (!net) continue;
    ledger += net;
    if (!own.has(v.id)) diffs.push({ kind: 'unallocated', amount: round2(net), ref: v.number ?? v.id });
  }
  ledger = round2(ledger);
  // Openings sit in the account but belong to no client until allocated.
  const openings = round2([...input.bankLedgers.values()].reduce((s, o) => s + (num(o.opening) && (!o.as_of || o.as_of <= date) ? num(o.opening) : 0), 0));
  if (openings) diffs.push({ kind: 'unallocated', amount: openings, ref: 'opening' });
  for (const r of input.rows) {
    if (r.date > date) continue;
    if (r.kind === 'interest' && r.interest_to === 'firm') diffs.push({ kind: 'firm_interest', amount: r.amount, ref: r.number });
    if (r.kind === 'to_fees' && r.payment_id && !input.paymentIds.has(r.payment_id)) diffs.push({ kind: 'receipt_missing', amount: r.amount, ref: r.number });
  }
  const clients = totalHeld(input.rows, date);
  if (input.statement !== null) {
    const gap = round2(input.statement - ledger);
    if (Math.abs(gap) > 0.004) diffs.push({ kind: 'uncleared', amount: gap, ref: 'statement − ledger' });
  }
  const agreed = Math.abs(ledger - clients) < 0.005 && (input.statement === null || Math.abs(input.statement - ledger) < 0.005);
  return { date, statement: input.statement, ledger, clients, diffs, agreed };
}

/** Year-end list of balances by client (and matter), largest first. */
export const balancesByClient = (rows: readonly ClientMoneyVoucher[], date: string) => cmBalances(rows, date).sort((a, b) => b.balance - a.balance);
