/**
 * Writes for bank rules / memory (8.45): apply a batch of categorisations to statement lines.
 *
 * Every write goes through the existing data-layer writers — `purchasesDb.save` + `paymentsDb.record`
 * (expense), `saveVoucher` (payment / receipt / contra voucher), `localDb.payments.record` (receipt
 * against invoices) — so roles (`requireAccess`), the period lock, the approval gate and the audit log
 * all apply. A batch is all or nothing: everything is checked first, then written inside
 * `withTablesRollback`; any refusal restores every table and nothing is matched. One audit row
 * summarises the batch.
 */

import type { BankLine, BankStatement } from './bank-recon';
import { bankDb, ignoreLine, inferMode, matchLine, methodForMode, noteLine, openBalance, referenceFor } from './bank-recon';
import type { RuleAction, SuggestionSource } from './bank-rules';
import { actionFits } from './bank-rules';
import { requireAccess, can } from './access';
import { audit } from './audit';
import { PAYMENTS_TABLE, PURCHASES_TABLE, computePurchaseTotals, expenseLine, paymentsDb, purchasesDb } from './purchases';
import { businessContext } from './purchases-context';
import { billApprovalRequired, readPurchaseApprovalPolicy } from './purchase-approval-gate';
import { VOUCHERS_TABLE, loadVouchers, rupeesToPaise, saveVoucher, type ManualVoucherLine } from './ledger/vouchers';
import { chartOf, loadUserAccounts } from './ledger/accounts';
import { bankLedgerId, isCashOrBankLedger } from './bank-ledgers';
import { localDb } from './localDb';
import { vendorsDb } from './vendors';
import { withTablesRollback } from './table-txn';
import { round2 } from './invoice-calc';

export interface ApplyItem {
  line: BankLine;
  action: RuleAction;
  source: SuggestionSource | 'manual';
  ruleId?: string;
  label?: string;
}

export class BankRuleApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankRuleApplyError';
  }
}

const amountOf = (l: Pick<BankLine, 'debit' | 'credit'>) => (l.credit > 0 ? l.credit : l.debit);

function accountOfLine(statements: readonly BankStatement[], lineId: string): string | undefined {
  return statements.find((st) => st.lines.some((l) => l.id === lineId))?.bank_account_id;
}

function expenseFor(item: ApplyItem) {
  const { line, action } = item;
  const rate = Math.max(Number(action.gst_rate) || 0, 0);
  const business = businessContext();
  const bl = expenseLine(action.category || 'Other', line.debit, rate, true);
  const totals = computePurchaseTotals([bl], { placeOfSupply: business.stateCode, businessState: business.stateCode, gstApplies: rate > 0 });
  return { bl, totals, business, rate };
}

/** Check one item without writing; returns the problem or ''. */
export function applyProblem(item: ApplyItem, statements: readonly BankStatement[]): string {
  const { line, action } = item;
  const d = line.date;
  if (line.matched_to || line.ignored) return `${d}: this line is already reconciled.`;
  if (!actionFits(action, line)) return `${d}: ${action.kind === 'expense' ? 'only a debit can be an expense' : 'only a credit can be received against invoices'}.`;
  if (action.kind === 'expense') {
    if (!action.category) return `${d}: choose the expense head.`;
    const { totals } = expenseFor(item);
    if (Math.abs(totals.total - line.debit) > 0.01) return `${d}: at ${action.gst_rate}% GST the expense comes to ${totals.total.toFixed(2)}, not ${line.debit.toFixed(2)}.`;
    if (billApprovalRequired({ total: totals.total }, undefined, readPurchaseApprovalPolicy(), can('doc.approve'))) return `${d}: an expense of ${totals.total.toFixed(2)} needs the owner's approval, record it from the expense form.`;
  }
  if (action.kind === 'voucher' || action.kind === 'contra') {
    const chart = chartOf(loadUserAccounts());
    const acc = chart.find((a) => a.id === action.ledger_id);
    if (!acc) return `${d}: the rule's ledger no longer exists.`;
    if (action.kind === 'contra') {
      if (!isCashOrBankLedger(acc)) return `${d}: a contra needs a cash or bank ledger.`;
      if (acc.id === bankLedgerId(accountOfLine(statements, line.id))) return `${d}: a contra needs the OTHER cash / bank ledger.`;
    }
  }
  if (action.kind === 'receipt') {
    const open = openInvoicesOf(action.client_id ?? '');
    const owing = round2(open.reduce((t, i) => t + openBalance(i), 0));
    if (line.credit > owing + 0.01) return `${d}: the credit of ${line.credit.toFixed(2)} is more than the customer's open invoices (${owing.toFixed(2)}).`;
  }
  return '';
}

function openInvoicesOf(clientId: string) {
  return localDb.invoices
    .getAll()
    .filter((i) => i.client?.id === clientId && openBalance(i) > 0)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date));
}

/** Write one item; returns the updated statements. Throws (the batch rolls back). */
function applyOne(item: ApplyItem, statements: BankStatement[]): BankStatement[] {
  const { line, action } = item;
  const acct = accountOfLine(statements, line.id);
  const method = methodForMode(action.mode ?? inferMode(line.narration));
  const reference = referenceFor(line) || undefined;
  const tag = item.source === 'rule' ? `bank rule "${item.label ?? ''}"` : item.source === 'memory' ? 'bank memory' : 'bank statement';
  switch (action.kind) {
    case 'ignore':
      return ignoreLine(statements, line.id, true, `Ignored by ${tag}`);
    case 'expense': {
      const { bl, totals, business } = expenseFor(item);
      const vendor = action.vendor_id ? vendorsDb.get(action.vendor_id) : undefined;
      const saved = purchasesDb.save({
        kind: 'EXPENSE',
        vendor_id: vendor?.id,
        vendor_name: vendor?.name ?? (action.vendor_name?.trim() || action.category || 'Bank'),
        vendor_gstin: vendor?.gstin,
        bill_number: '',
        date: line.date,
        place_of_supply: business.stateCode || undefined,
        category: action.category || 'Other',
        lines: [bl],
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        itc_eligible: action.itc !== false && totals.tax > 0,
        total: totals.total,
        amount_paid: 0,
        notes: `From ${tag}`,
        cost_centre_id: action.cost_centre_id || undefined,
        branch_id: action.branch_id || undefined,
      });
      const pay = paymentsDb.record(saved.id, { amount: saved.total, date: line.date, method, reference, bankAccountId: acct });
      return matchLine(statements, line.id, { type: 'purchase_payment', id: pay.id });
    }
    case 'voucher': {
      const paise = rupeesToPaise(amountOf(line));
      const bank = bankLedgerId(acct);
      const party = action.vendor_name?.trim() || undefined;
      const other: ManualVoucherLine = { account_id: action.ledger_id!, dr: 0, cr: 0, ...(party ? { party } : {}), ...(action.cost_centre_id ? { cost_centre_id: action.cost_centre_id } : {}) };
      const out = line.debit > 0;
      const v = saveVoucher({
        type: out ? 'PAYMENT' : 'RECEIPT',
        date: line.date,
        narration: `${line.narration.slice(0, 160)} (${tag})`,
        lines: out ? [{ ...other, dr: paise }, { account_id: bank, dr: 0, cr: paise }] : [{ account_id: bank, dr: paise, cr: 0 }, { ...other, cr: paise }],
        ...(action.branch_id ? { branch_id: action.branch_id } : {}),
      });
      return matchLine(noteLine(statements, line.id, `${v.number} (${tag})`), line.id, { type: 'manual' });
    }
    case 'contra': {
      const paise = rupeesToPaise(amountOf(line));
      const bank = bankLedgerId(acct);
      const counter = action.ledger_id!;
      const out = line.debit > 0;
      const [drAcc, crAcc] = out ? [counter, bank] : [bank, counter];
      // The other account's statement may already have posted this transfer: reuse it, never post twice.
      const twin = loadVouchers().find(
        (v) => v.type === 'CONTRA' && Math.abs(dayNo(v.date) - dayNo(line.date)) <= 3 &&
          v.lines.some((l) => l.account_id === drAcc && l.dr === paise) && v.lines.some((l) => l.account_id === crAcc && l.cr === paise),
      );
      const v = twin ?? saveVoucher({ type: 'CONTRA', date: line.date, narration: `${line.narration.slice(0, 160)} (${tag})`, lines: [{ account_id: drAcc, dr: paise, cr: 0 }, { account_id: crAcc, dr: 0, cr: paise }] });
      return matchLine(noteLine(statements, line.id, `${v.number} (${tag})`), line.id, { type: 'manual' });
    }
    case 'receipt': {
      let left = round2(line.credit);
      const ids: string[] = [];
      for (const inv of openInvoicesOf(action.client_id ?? '')) {
        if (left <= 0.004) break;
        const take = round2(Math.min(left, openBalance(inv)));
        const p = localDb.payments.record({ invoiceId: inv.id, amount: take, method, reference, note: `From ${tag}`, date: line.date, bankAccountId: acct });
        ids.push(p.id);
        left = round2(left - take);
      }
      if (left > 0.01 || !ids.length) throw new BankRuleApplyError(`${line.date}: the credit is more than the customer's open invoices.`);
      return matchLine(statements, line.id, { type: 'payment', id: ids[0], ...(ids.length > 1 ? { ids } : {}) });
    }
    default:
      throw new BankRuleApplyError('Unknown rule action.');
  }
}

const dayNo = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
};

/**
 * Apply a batch (all or nothing). Returns the saved statements. Throws `BankRuleApplyError` naming the
 * first problem before anything is written, or the data layer's own error (lock, role, approval) after
 * rolling everything back.
 */
export function applyBankBatch(items: readonly ApplyItem[]): BankStatement[] {
  requireAccess('books.edit');
  if (!items.length) return bankDb.all();
  const start = bankDb.all();
  const fresh = new Map(start.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  const work = items.map((i) => ({ ...i, line: fresh.get(i.line.id) ?? i.line }));
  if (new Set(work.map((i) => i.line.id)).size !== work.length) throw new BankRuleApplyError('A line is in the batch twice.');
  for (const i of work) {
    const problem = applyProblem(i, start);
    if (problem) throw new BankRuleApplyError(problem);
  }
  const next = withTablesRollback([PURCHASES_TABLE, PAYMENTS_TABLE, VOUCHERS_TABLE, 'bank_statements', 'transactions', 'invoices', 'series_counters'], () => {
    let st = start;
    for (const i of work) st = applyOne(i, st);
    bankDb.saveAll(st);
    return st;
  });
  try {
    const bySource = (s: string) => work.filter((i) => i.source === s).length;
    audit.record({
      entity: 'settings',
      entity_id: 'bank_rules',
      action: 'update',
      summary: `Categorised ${work.length} bank line(s): ${bySource('rule')} by rule, ${bySource('memory')} from memory, ${bySource('manual')} by hand`,
    });
  } catch {
    /* logging never blocks */
  }
  return next;
}
