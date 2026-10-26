/**
 * R5-C4 FC-4 working paper for a FY (FCRA annual return; certified by a chartered accountant): receipts & payments
 * of the FCRA bank accounts, income & expenditure of the FCRA funds, a balance-sheet extract (FCRA bank balances,
 * fixed assets bought from FC, fund balances), purpose-wise utilisation and interest on FC. Ties to the ledger: the
 * FCRA bank movements are the ledger's own lines. Due date date-keyed (`FC4_DUE_RULES`). Verify with your CA.
 */
import type { BankAccount } from '../bank-accounts';
import type { Ledger } from '../ledger/postings';
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { FC4_DUE_RULES, afterFy, fyFrom, ruleAt } from '../r5c-rules';
import { fcraLedgers } from './fcra-checks';
import { fundStatement, type FundStatement } from './fund-statement';
import type { Fund } from './funds';

export interface Fc4 {
  fy: number;
  dueBy: string;
  bankOpening: number;
  bankReceipts: number;
  bankPayments: number;
  bankClosing: number;
  funds: FundStatement[];
  income: number;
  expenditure: number;
  assets: number;
  interest: number;
  purposes: { purpose: string; amount: number }[];
}

export function buildFc4(ledger: Ledger, funds: readonly Fund[], banks: readonly BankAccount[], fy: number): Fc4 {
  const period = { start: fyFrom(fy), end: `${fy + 1}-03-31` };
  const { all } = fcraLedgers(banks);
  let open = 0;
  let rec = 0;
  let pay = 0;
  for (const v of ledger.vouchers) {
    if (v.date > period.end) continue;
    for (const l of v.lines) {
      if (!all.has(l.account)) continue;
      if (v.date < period.start) open += l.dr - l.cr;
      else {
        rec += l.dr;
        pay += l.cr;
      }
    }
  }
  const sts = funds.filter((f) => f.fund.nature === 'fcra').map((f) => fundStatement(ledger, f, period));
  const purposes = new Map<string, number>();
  let assets = 0;
  for (const s of sts) {
    const p = s.fund.fund.purpose || s.fund.name;
    purposes.set(p, round2((purposes.get(p) ?? 0) + s.utilisationTotal));
    assets += s.utilisation.filter((u) => u.account.group === 'FIXED_ASSETS').reduce((a, u) => a + u.amount, 0);
  }
  const p = (n: number) => round2(n / 100);
  return {
    fy, dueBy: afterFy(fy, ruleAt(FC4_DUE_RULES, period.end)),
    bankOpening: p(open), bankReceipts: p(rec), bankPayments: p(pay), bankClosing: p(open + rec - pay), funds: sts,
    income: round2(sts.reduce((a, s) => a + s.receiptsTotal, 0)), expenditure: round2(sts.reduce((a, s) => a + s.utilisationTotal, 0) - assets),
    assets: round2(assets), interest: round2(sts.reduce((a, s) => a + s.interest, 0)),
    purposes: [...purposes].map(([purpose, amount]) => ({ purpose, amount })),
  };
}

export function fc4Csv(f: Fc4, labels: Record<'rp' | 'open' | 'rec' | 'pay' | 'close' | 'ie' | 'inc' | 'exp' | 'bs' | 'assets' | 'interest' | 'purpose' | 'cert', string>): string {
  const rows: unknown[][] = [
    [`FC-4 FY ${f.fy}-${String(f.fy + 1).slice(2)}`, f.dueBy], [], [labels.rp], [labels.open, f.bankOpening], [labels.rec, f.bankReceipts], [labels.pay, f.bankPayments], [labels.close, f.bankClosing],
    [], [labels.ie], [labels.inc, f.income], [labels.interest, f.interest], [labels.exp, f.expenditure],
    [], [labels.bs], [labels.assets, f.assets], ...f.funds.map((s) => [s.fund.name, s.closing]),
    [], [labels.purpose], ...f.purposes.map((p) => [p.purpose, p.amount]), [], [labels.cert],
  ];
  return toCsv(rows);
}
