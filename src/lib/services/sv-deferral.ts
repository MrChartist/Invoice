/**
 * SV-C1.7 package income kept deferred (`service_settings.defer_package_income`, default off; PENDING #20). The sale bill
 * still credits Sales in full (taxed at sale, SV14); with the switch on, ONE journal a month ("Package income
 * recognised", dated the month end) moves the month's movement through "Package income received in advance":
 *   deferred    the price of session packages sold in the month (sale bill dated in the month, on or after
 *               `defer_package_from`, the day the switch went on — packages sold before it are never touched);
 *   recognised  sessions redeemed in the month (live bills' `sv.redeem` lines + redeeming check-ins) × price ÷ sessions,
 *               + the unused value of packages that expired in the month (the `forfeited` report) or were cancelled /
 *               upgraded in it (SV15: no GST event).
 * Net > 0: Dr Sales | Cr Package income received in advance; net < 0 the other way. A month is posted once (a
 * journal of the class naming the month); delete the journal to post it again. Working paper — verify with your CA (SV44).
 */
import './sv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { CheckinDay, Membership } from '../../types/services-r10';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { getTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { loadVouchers, saveVoucher, type ManualVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { forfeited, loadCheckins, loadMemberships, sessionsUsed } from './sv-members';
import { readServiceSettings } from './sv-settings';

export const PACKAGE_CLASS = 'Package income recognised';
const DEFERRED = { name: 'Package income received in advance', group: 'OTHER_CL', code: 2420 } as const;

const live = (i: InvoiceRecord) => i.status !== 'Draft' && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE';
const inMonth = (d: string | undefined, month: string) => (d ?? '').slice(0, 7) === month;

/** Last day of `YYYY-MM`. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export interface DeferralMonth {
  month: string;
  deferred: number;
  redeemed: number;
  forfeited: number;
  closed: number;
  recognised: number;
  /** deferred − recognised (> 0: income moved to the liability). */
  net: number;
}

/** Pure: the month's figures. `from` = the day deferral was switched on; `today` = the forfeiture cut-off. */
export function packageDeferral(all: readonly Membership[], invoices: readonly InvoiceRecord[], checkins: readonly CheckinDay[], month: string, from: string, today: string): DeferralMonth {
  const byId = new Map(invoices.filter((i) => i && live(i)).map((i) => [i.id, i]));
  const saleDate = (m: Membership) => byId.get(m.invoice_ids?.[0] ?? '')?.issue_date ?? '';
  const pkgs = all.filter((m) => num(m.plan.sessions) > 0 && m.plan.kind !== 'wallet' && saleDate(m) && saleDate(m) >= from);
  const ids = new Set(pkgs.map((m) => m.id));
  const per = new Map(pkgs.map((m) => [m.id, num(m.plan.price) / num(m.plan.sessions)]));
  let deferred = 0, redeemed = 0, closed = 0;
  for (const m of pkgs) if (inMonth(saleDate(m), month)) deferred += num(m.plan.price);
  for (const i of byId.values()) {
    if (!inMonth(i.issue_date, month)) continue;
    for (const l of i.items ?? []) {
      const id = l?.sv?.redeem?.membership_id;
      if (id && ids.has(id)) redeemed += Math.max(1, num(l.quantity)) * per.get(id)!;
    }
  }
  for (const d of checkins) if (inMonth(d?.date, month)) for (const e of d.entries ?? []) if (e.redeem && e.membership_id && ids.has(e.membership_id)) redeemed += per.get(e.membership_id)!;
  const lost = forfeited(pkgs, invoices, checkins, today).filter((x) => x.month === month).reduce((s, x) => s + x.value, 0);
  for (const m of pkgs) {
    if (m.closed !== 'cancelled' && m.closed !== 'upgraded') continue;
    const ev = [...(m.history ?? [])].reverse().find((h) => h.kind === (m.closed === 'cancelled' ? 'cancel' : 'upgrade'));
    if (!ev || !inMonth(ev.date, month)) continue;
    closed += Math.max(0, num(m.plan.sessions) - sessionsUsed(m, invoices, checkins)) * per.get(m.id)!;
  }
  const recognised = round2(redeemed + lost + closed);
  return { month, deferred: round2(deferred), redeemed: round2(redeemed), forfeited: round2(lost), closed: round2(closed), recognised, net: round2(deferred - recognised) };
}

/** Journal lines (paise) for a month's net. */
export function deferralLines(net: number, l: { sales: string; deferred: string }): ManualVoucherLine[] {
  const p = Math.round(Math.abs(round2(net)) * 100);
  return net > 0 ? [{ account_id: l.sales, dr: p, cr: 0 }, { account_id: l.deferred, dr: 0, cr: p }] : [{ account_id: l.deferred, dr: p, cr: 0 }, { account_id: l.sales, dr: 0, cr: p }];
}

const tag = (month: string) => `[${month}]`;

/** The month's posted journal, if any. */
export const postedDeferral = (month: string, vouchers: readonly ManualVoucher[] = loadVouchers()): ManualVoucher | undefined =>
  vouchers.find((v) => v.voucher_class === PACKAGE_CLASS && (v.narration ?? '').includes(tag(month)));

function ensureDeferredLedger(): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.trim().toLowerCase() === DEFERRED.name.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let code: number = DEFERRED.code;
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name: DEFERRED.name, group: DEFERRED.group }).id;
}

/** Figures for a month from the stored tables (null while the switch is off). */
export function deferralFor(month: string, today: string): DeferralMonth | null {
  const s = readServiceSettings();
  if (!s.defer_package_income) return null;
  return packageDeferral(loadMemberships(), getTable<InvoiceRecord>('invoices'), loadCheckins(), month, s.defer_package_from ?? '', today);
}

/** Post the month's journal (once, after the month has ended). */
export function postPackageDeferral(month: string, today: string): ManualVoucher {
  requireAccess('books.edit');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Pick a month.');
  const r = deferralFor(month, today);
  if (!r) throw new Error('Package income is not kept deferred (switch it on first).');
  if (monthEnd(month) >= today) throw new Error('Post a month once it has ended.');
  const done = postedDeferral(month);
  if (done) throw new Error(`${month} is already posted (${done.number}). Delete that journal to post it again.`);
  if (!r.net) throw new Error('Nothing to post for this month.');
  return withTablesRollback(['vouchers', 'accounts'], () => saveVoucher({
    type: 'JOURNAL', date: monthEnd(month), voucher_class: PACKAGE_CLASS,
    narration: `Package income ${tag(month)}: sold ₹${r.deferred} deferred, ₹${r.recognised} recognised (sessions ₹${r.redeemed}, expired ₹${r.forfeited}, cancelled / upgraded ₹${r.closed}) — verify with your CA (SV44)`,
    lines: deferralLines(r.net, { sales: A.sales, deferred: ensureDeferredLedger() }),
  }));
}
