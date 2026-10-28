/**
 * Notification-bell notices for the Phase 7 packages (integration pass): documents pending the
 * owner's approval (WP-9), AMC visit / renewal reminders (WP-9) and a GST set-off not yet posted for
 * the last 3B period (WP-6). Loaded on demand by the bell, only once one of those features is in use
 * (cheap check `ensureBusinessAlerts` in NotificationBell.tsx), so the notifications chunk that loads after first paint does not grow.
 *
 * `businessNotices` is pure (tested); `registerBusinessAlerts` reads storage on each bell refresh.
 * Set-off notices are working-paper reminders — verify with your CA.
 */

import type { InvoiceRecord } from '../types/invoice';
import { can } from './access';
import { readApprovalPolicy } from './approval-gate';
import { AMC_TABLE, amcReminders, type AmcContract } from './amc';
import { returnsForMonth, type FilerFrequency } from './compliance';
import { localDayOf } from './dates';
import { localDb } from './localDb';
import { registerNotificationProvider, type AppNotification } from './notifications';
import { getTable, KEYS } from './storage';
import { wireT } from '../i18n/areas/wiring';
import { o7T } from '../i18n/areas/gst-tds-7o';
import { ita25Words } from '../i18n/areas/ita2025';
import { formText, periodStart } from './ita2025';
import { loadTcsDue, loadTdsDue, usesTcs, usesTds, type DueItem } from './tds-payables';

/** 7O (7.96): remind this many days before a TDS deposit / 26Q due date (and keep reminding while overdue). */
export const TDS_LEAD_DAYS = 5;

export const SETOFF_TABLE = 'gst_setoffs';
export const GST_CHALLAN_TABLE = 'gst_challans';
/** Remind this many days before the 3B due date, and keep reminding for this many days after it. */
export const SETOFF_LEAD_DAYS = 5;
export const SETOFF_GRACE_DAYS = 30;

export interface BusinessAlertInput {
  today: string;
  at: string;
  /** Owner (may approve) and approvals switched on. */
  approver: boolean;
  invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number' | 'approval' | 'total'>[];
  amc: readonly AmcContract[];
  /** Set-off reminders: for a regular GST-registered filer (or one who has used the set-off screen). */
  setoff?: { gstin: string; frequency: FilerFrequency; stateCode?: string; postedKeys: ReadonlySet<string> };
  /** 7O (7.96): TDS deposit / return due items (`dueCalendar`) of the current and previous FY. */
  tdsDue?: readonly DueItem[];
  /** 7R (7.120): TCS (27EQ) deposit / return due items from the TCS charged on invoices. */
  tcsDue?: readonly DueItem[];
}

/** TDS due items worth a bell notice: deposits / returns overdue, or due within `TDS_LEAD_DAYS` (certificates skipped). */
export function tdsDueReminders(items: readonly DueItem[], today: string): DueItem[] {
  const soon = addDays(today, TDS_LEAD_DAYS);
  return items.filter((d) => d.what !== 'certificate' && (d.status === 'overdue' || (d.status === 'upcoming' && d.due <= soon)));
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

/** The 3B period that closed most recently before `today` (monthly, or the quarter for QRMP). */
export function lastThreeBPeriod(today: string, frequency: FilerFrequency, stateCode?: string): { key: string; label: string; due: string } | null {
  if (frequency === 'composition') return null;
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - 1;
  // Walk back to the last month that closes a 3B period (every month; QRMP: quarter ends).
  for (let i = 0; i < 3; i++) {
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    const r = returnsForMonth(y, m, frequency, stateCode).find((x) => x.form === 'GSTR3B');
    if (r) return { key: r.periodKey, label: r.label, due: r.due };
    m -= 1;
  }
  return null;
}

export function businessNotices(input: BusinessAlertInput): AppNotification[] {
  const out: AppNotification[] = [];
  if (input.approver) {
    const pending = input.invoices.filter((i) => i.approval?.state === 'pending');
    if (pending.length) {
      const list = pending.slice(0, 3).map((i) => i.invoice_number || i.id).join(', ') + (pending.length > 3 ? ` +${pending.length - 3}` : '');
      out.push({
        id: `approvals:${pending.map((i) => i.id).sort().join('|')}`,
        severity: 'warning',
        title: wireT('nApprovals', { n: pending.length }),
        detail: wireT('nApprovalsDetail', { list }),
        href: '/transactions?filter=approval',
        cta: wireT('nApprovalsCta'),
        at: input.at,
      });
    }
  }
  for (const r of amcReminders(input.amc, input.today)) {
    out.push({
      id: r.id,
      severity: r.overdue ? 'warning' : 'info',
      title: wireT('nAmcTitle', { text: r.text }),
      detail: r.text,
      href: '/',
      cta: wireT('nAmcCta'),
      at: input.at,
    });
  }
  const so = input.setoff;
  if (so && so.gstin) {
    const p = lastThreeBPeriod(input.today, so.frequency, so.stateCode);
    if (p && !so.postedKeys.has(p.key) && input.today >= addDays(p.due, -SETOFF_LEAD_DAYS) && input.today <= addDays(p.due, SETOFF_GRACE_DAYS)) {
      out.push({
        id: `setoff:${so.gstin}:${p.key}`,
        severity: input.today > p.due ? 'critical' : 'warning',
        title: wireT('nSetoffTitle', { period: p.label }),
        detail: wireT('nSetoffDetail', { date: p.due }),
        href: '/gst-reports?tab=setoff',
        cta: wireT('nSetoffCta'),
        at: input.at,
      });
    }
  }
  for (const d of tdsDueReminders([...(input.tdsDue ?? []), ...(input.tcsDue ?? [])], input.today)) {
    const what = d.what === 'deposit' ? o7T('nTdsDeposit', { kind: d.kind, period: d.period }) : o7T('nTdsReturn', { form: formText(d.form ?? (d.kind === 'TDS' ? '26Q' : '27EQ'), periodStart(d.period), { ...ita25Words(), form: '{n}' }), period: d.period });
    out.push({
      id: `tdsdue:${d.id}:${d.status}`,
      severity: d.status === 'overdue' ? 'critical' : 'warning',
      title: d.status === 'overdue' ? o7T('nTdsOverdue', { what }) : o7T('nTdsSoon', { what }),
      detail: o7T('nTdsDetail', { date: d.due, amount: d.amount.toFixed(2) }),
      href: '/tds?tab=overview',
      cta: o7T('nTdsCta'),
      at: input.at,
    });
  }
  return out;
}

let unregister: (() => void) | null = null;

export function registerBusinessAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const gstin = ctx.profile?.companyGstin?.trim().toUpperCase() ?? '';
    // Every regular (non-composition) GST filer gets the reminder, even before the set-off screen was
    // first used; a composition dealer only once it has set-off / challan records (cheap checks first).
    const regular = !!gstin && ctx.profile?.gst_scheme !== 'composition' && ctx.gstFrequency !== 'composition';
    const usesSetoff = regular || getTable(SETOFF_TABLE).length > 0 || getTable(GST_CHALLAN_TABLE).length > 0;
    const postedKeys = new Set(
      getTable<{ period_key?: string; gstin?: string }>(SETOFF_TABLE)
        .filter((r) => !r.gstin || r.gstin === gstin)
        .map((r) => String(r.period_key ?? '')),
    );
    return businessNotices({
      today,
      at: ctx.now.toISOString(),
      approver: readApprovalPolicy().enabled && can('doc.approve'),
      invoices: ctx.invoices ?? getTable<InvoiceRecord>(KEYS.invoices),
      amc: getTable<AmcContract>(AMC_TABLE),
      ...(usesTds() ? { tdsDue: loadTdsDue(today) } : {}),
      ...(usesTcs() ? { tcsDue: loadTcsDue(today) } : {}),
      ...(usesSetoff && gstin
        ? {
            setoff: {
              gstin,
              frequency: ctx.gstFrequency ?? (ctx.profile?.gst_scheme === 'composition' ? 'composition' : localDb.settings.get().gst_filing_frequency ?? 'monthly'),
              stateCode: ctx.profile?.stateCode || gstin.slice(0, 2),
              postedKeys,
            },
          }
        : {}),
    });
  });
}
