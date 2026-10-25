/**
 * Bell notices for 8C (loaded lazily by NotificationBell, only once bills with due dates, recurring
 * bills, draft bills, inbox documents or payment requests exist): supplier bills due this week,
 * recurring bills about to be drafted, draft bills waiting to be posted, unprocessed documents, and —
 * for the owner — bills / payments waiting for approval. Loading the provider also drafts any due
 * recurring bills once per session (drafts only, never posted).
 *
 * `captureNotices` is pure (tested).
 */

import type { AppNotification } from './notifications';
import { registerNotificationProvider } from './notifications';
import { can } from './access';
import { billsDueSoon, recurringBillsAll, runDueBillSchedules, type DueSoon } from './recurring-bills';
import { draftsDb } from './purchase-drafts';
import { inboxDb } from './doc-inbox';
import { pendingPaymentRequests } from './purchase-approvals';
import { purchasesDb } from './purchases';
import { businessContext } from './purchases-context';
import { readPurchaseApprovalPolicy } from './purchase-approval-gate';
import { formatCurrency, todayInput } from './utils';
import { capT } from '../i18n/areas/capture';

export interface CaptureAlertInput {
  today: string;
  at: string;
  due: DueSoon;
  drafts: number;
  inbox: number;
  /** Owner with purchase approvals on: counts waiting for them. */
  approver: boolean;
  pendingBills: number;
  pendingPayments: number;
}

export function captureNotices(i: CaptureAlertInput): AppNotification[] {
  const out: AppNotification[] = [];
  if (i.due.bills.length) {
    const overdue = i.due.bills.filter((b) => b.due < i.today).length;
    const total = i.due.bills.reduce((t, b) => t + b.balance, 0);
    out.push({
      id: `bills-due:${i.today}:${i.due.bills.map((b) => b.id).join('|')}`,
      severity: overdue ? 'warning' : 'info',
      title: capT('nDueTitle', { n: i.due.bills.length }),
      detail: capT('nDueDetail', { amount: formatCurrency(total), overdue }),
      href: '/expenses',
      cta: capT('nDueCta'),
      at: i.at,
    });
  }
  if (i.due.upcoming.length) {
    out.push({
      id: `recurring-bills:${i.due.upcoming.map((u) => `${u.id}@${u.date}`).join('|')}`,
      severity: 'info',
      title: capT('nRecurTitle', { n: i.due.upcoming.length }),
      detail: i.due.upcoming.slice(0, 3).map((u) => `${u.name} (${u.date})`).join(', '),
      href: '/expenses?tab=inbox',
      cta: capT('nOpenInbox'),
      at: i.at,
    });
  }
  if (i.drafts || i.inbox) {
    out.push({
      id: `capture-inbox:${i.drafts}:${i.inbox}`,
      severity: 'info',
      title: capT('nInboxTitle', { drafts: i.drafts, docs: i.inbox }),
      detail: capT('nInboxDetail'),
      href: '/expenses?tab=inbox',
      cta: capT('nOpenInbox'),
      at: i.at,
    });
  }
  if (i.approver && i.pendingBills + i.pendingPayments > 0) {
    out.push({
      id: `purchase-approvals:${i.pendingBills}:${i.pendingPayments}`,
      severity: 'warning',
      title: capT('nApproveTitle', { bills: i.pendingBills, payments: i.pendingPayments }),
      detail: capT('nApproveDetail'),
      href: '/expenses?tab=inbox',
      cta: capT('nApproveCta'),
      at: i.at,
    });
  }
  return out;
}

let ran = false;

export function registerCaptureAlerts(): void {
  const today = todayInput();
  if (!ran) {
    ran = true;
    try {
      runDueBillSchedules(today, businessContext().stateCode);
    } catch {
      /* a viewer / locked session: drafted next time someone who may write opens the app */
    }
  }
  registerNotificationProvider((ctx) => {
    const day = todayInput();
    const drafts = draftsDb.all();
    const policy = readPurchaseApprovalPolicy();
    return captureNotices({
      today: day,
      at: ctx.now.toISOString(),
      due: billsDueSoon(purchasesDb.all(), recurringBillsAll(), day, businessContext().stateCode),
      drafts: drafts.filter((d) => d.draft.approval?.state !== 'pending').length,
      inbox: inboxDb.open().filter((r) => !r.draft_id).length,
      approver: (policy.bills || policy.payments) && can('doc.approve'),
      pendingBills: drafts.filter((d) => d.draft.approval?.state === 'pending').length,
      pendingPayments: pendingPaymentRequests().length,
    });
  });
}
