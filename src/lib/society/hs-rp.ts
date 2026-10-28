/**
 * R18-D2 Receipts and Payments account (pure over posting lines; family `f-society`): for the period, the opening and
 * closing balances of the cash and bank ledgers (`isCash` — the caller leaves clearing accounts out), and every other
 * ledger of a voucher that moved cash, as a receipt (credit) or a payment (debit) — contra entries between cash and
 * bank net to nothing. Paise in, paise out; closing = opening + receipts − payments. Working papers — verify with your CA.
 */
import type { Ledger } from '../ledger/postings';

export interface RpLine { account: string; amount: number }
export interface ReceiptsPayments { opening: number; receipts: RpLine[]; payments: RpLine[]; closing: number }

export function receiptsPayments(ledger: Pick<Ledger, 'vouchers' | 'byId'>, period: { start: string; end: string }, isCash: (id: string) => boolean): ReceiptsPayments {
  let opening = 0, closing = 0;
  const rec = new Map<string, number>(), pay = new Map<string, number>();
  for (const v of ledger.vouchers) {
    if (v.date > period.end) continue;
    const cash = v.lines.filter((l) => isCash(l.account)).reduce((t, l) => t + l.dr - l.cr, 0);
    closing += cash;
    if (v.date < period.start) { opening += cash; continue; }
    if (!cash) continue;
    for (const l of v.lines) if (!isCash(l.account)) {
      const name = ledger.byId.get(l.account)?.name ?? l.account;
      if (l.cr) rec.set(name, (rec.get(name) ?? 0) + l.cr);
      if (l.dr) pay.set(name, (pay.get(name) ?? 0) + l.dr);
    }
  }
  const list = (m: Map<string, number>) => [...m].map(([account, amount]) => ({ account, amount })).sort((a, b) => b.amount - a.amount);
  return { opening, receipts: list(rec), payments: list(pay), closing };
}
