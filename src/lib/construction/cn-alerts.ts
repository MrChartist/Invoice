/**
 * CN-B bell notices (added to the works pack's provider in `works/works-alerts.ts`): guarantees expiring within 30 days,
 * a secured advance unrecovered after 90 days, a mobilisation advance not fully recovered at 80% of work, and an amount
 * withheld for more than 90 days. Pure over the tables it is given.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { BankGuarantee, SecuredAdvance, WorksContract } from '../../types/construction-r11';
import type { AppNotification } from '../notifications';
import { shiftDay } from '../dates';
import { num } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { ADVANCE_DEFAULTS, RECOVERY_DEFAULTS } from '../construction-rules';
import { raDueSplit } from '../works/ra-due';
import { contractBills } from './cn-contracts';
import { advanceStatus, type AdvanceLike } from './cn-advances';
import { expiringGuarantees } from './cn-guarantees';
import { securedRecovered } from './cn-secured';

export interface CnAlertData {
  contracts: readonly WorksContract[];
  guarantees: readonly BankGuarantee[];
  secured: readonly SecuredAdvance[];
  advances: readonly AdvanceLike[];
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
}

const rs = (n: number) => `₹${n.toFixed(2)}`;

export function cnFinanceNotices(d: CnAlertData, today: string, at: string): AppNotification[] {
  const r = ruleAt(RECOVERY_DEFAULTS, today);
  const a = ruleAt(ADVANCE_DEFAULTS, today);
  const out: AppNotification[] = [];
  const note = (id: string, warn: boolean, title: string, detail: string, view: string): void => {
    out.push({ id: `cn:${id}`, severity: warn ? 'warning' : 'info', title, detail, href: `/time?tab=works&view=${view}`, cta: 'Open', at });
  };
  for (const b of expiringGuarantees(d.guarantees, today, r.bg_alert_days)) note(`bg:${b.id}:${b.expires_on}`, b.expires_on < today, `Bank guarantee ${b.bg_no} (${rs(b.amount)}) ${b.expires_on < today ? 'expired' : 'expires'} ${b.expires_on}`, `${b.bank}: extend it or ask the client to release it.`, 'guarantees');
  for (const s of d.secured) {
    const left = num(s.amount) - securedRecovered(s.id, d.invoices);
    if (s.status === 'open' && left > 0.5 && s.date <= shiftDay(today, -a.secured_alert_days)) note(`sa:${s.id}`, false, `Secured advance of ${s.date} still unrecovered: ${rs(left)}`, 'Recover it on the next RA bill as the material is used.', 'advances');
  }
  for (const c of d.contracts) {
    if (c.status === 'closed') continue;
    const bills = contractBills(c, d.invoices);
    for (const x of advanceStatus(c, bills, d.advances, today)) {
      if (x.balance > 0.5 && x.workPct >= num(x.term.recover_by_pct ?? 80)) note(`mob:${c.id}:${x.term.advance_id}`, true, `${c.name_of_work}: advance balance ${rs(x.balance)} at ${x.workPct}% of work`, 'The contract recovers it fully by this stage: recover it on the next RA bill.', 'advances');
    }
    for (const b of bills) {
      if (b.issue_date > shiftDay(today, -r.withheld_alert_days)) continue;
      const mine = d.payments.filter((p) => p.invoice_id === b.id);
      const owed = num(b.ra_net_payable ?? b.total) + (b.ra_deductions ?? []).filter((x) => x.kind !== 'it_tds').reduce((s, x) => s + x.amount, 0) - mine.reduce((s, p) => s + num(p.amount), 0);
      for (const h of raDueSplit(b, mine, owed).held.filter((h) => h.kind === 'withheld')) note(`wh:${b.id}`, false, `${rs(h.amount)} withheld on ${b.invoice_number} since ${b.issue_date}`, 'Follow up the release and record it in Works → Retention.', 'retention');
    }
  }
  return out;
}
