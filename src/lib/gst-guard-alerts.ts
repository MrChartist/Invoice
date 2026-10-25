/**
 * 8D bell notices (lazy, loaded by NotificationBell only once e-invoicing data / an AATO exists or the books reach
 * back far enough for the time bar to matter):
 *  - documents still without an IRN on day 20 and day 27 of the 30-day IRP window (and once it has closed);
 *  - unfiled returns that become time-barred within 90 days (Sec 37(5) / 39(11) / 44(2) / 52(13)).
 * `gstGuardNotices` is pure (tested); `registerGstGuardAlerts` reads storage on each bell refresh. Verify with your CA.
 */

import type { InvoiceRecord } from '../types/invoice';
import { COMPLIANCE_TABLE, FORM_LABELS, type FiledReturn, type FilerFrequency } from './compliance';
import { aatoFor, irnWindowList, timeBarList, type IrnPending, type TimeBarRow } from './gst-guards';
import { localDb } from './localDb';
import { registerNotificationProvider, type AppNotification } from './notifications';
import { getTable, KEYS } from './storage';
import { todayIso } from './tax-rules';
import { formatDate } from './utils';
import { ggT } from '../i18n/areas/gst-guards';

/** Time-bar notices start this many days before the bar. */
export const TIME_BAR_LEAD_DAYS = 90;

export interface GuardAlertInput {
  at: string;
  pending: readonly IrnPending[];
  timeBars: readonly TimeBarRow[];
}

const nums = (list: readonly IrnPending[]) => list.slice(0, 3).map((p) => `${p.invoice.invoice_number || '—'} (${formatDate(p.window.deadline)})`).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');

export function gstGuardNotices(i: GuardAlertInput): AppNotification[] {
  const out: AppNotification[] = [];
  const irn = (stage: 'day20' | 'day27' | 'closed', severity: AppNotification['severity'], title: string) => {
    const list = i.pending.filter((p) => p.window.stage === stage);
    if (!list.length) return;
    out.push({
      id: `irp-${stage}:${list.map((p) => p.invoice.id).join('|')}`,
      severity,
      title,
      detail: `${nums(list)}. ${ggT('nIrpDetail')}`,
      href: '/gst-reports?tab=guards',
      cta: ggT('nOpenGuards'),
      at: i.at,
    });
  };
  const n20 = i.pending.filter((p) => p.window.stage === 'day20').length;
  const n27 = i.pending.filter((p) => p.window.stage === 'day27').length;
  const nC = i.pending.filter((p) => p.window.stage === 'closed').length;
  irn('closed', 'critical', ggT('nIrpClosed', { n: nC }));
  irn('day27', 'critical', ggT('nIrp27', { n: n27 }));
  irn('day20', 'warning', ggT('nIrp20', { n: n20 }));
  const soon = i.timeBars.filter((t) => !t.bar.barred && t.bar.daysLeft <= TIME_BAR_LEAD_DAYS);
  if (soon.length) {
    out.push({
      id: `time-bar:${soon.map((t) => t.r.id).join('|')}`,
      severity: soon.some((t) => t.bar.daysLeft <= 30) ? 'critical' : 'warning',
      title: ggT('nBarTitle', { n: soon.length }),
      detail: `${soon.slice(0, 2).map((t) => ggT('nBarLine', { form: FORM_LABELS[t.r.form], period: t.r.label, date: formatDate(t.bar.barredOn) })).join('; ')}${soon.length > 2 ? ` +${soon.length - 2}` : ''}. ${ggT('nBarDetail')}`,
      href: '/gst-reports?tab=compliance',
      cta: ggT('nOpenCompliance'),
      at: i.at,
    });
  }
  return out;
}

let registered = false;

export function registerGstGuardAlerts(): void {
  if (registered) return;
  registered = true;
  registerNotificationProvider((ctx) => {
    const today = todayIso(ctx.now);
    const settings = localDb.settings.get();
    const profile = ctx.profile;
    const invoices = ctx.invoices.length ? ctx.invoices : getTable<InvoiceRecord>(KEYS.invoices);
    const irnIds = new Set(getTable<{ invoice_id: string; irn?: string }>('einvoice_meta').filter((m) => m?.irn).map((m) => m.invoice_id));
    const pending = irnWindowList(invoices, irnIds, (inv) => aatoFor(inv, settings.profiles, profile), today, 7);
    let timeBars: TimeBarRow[] = [];
    const gstin = profile?.companyGstin?.trim().toUpperCase();
    if (gstin) {
      let since = '';
      for (const inv of invoices) {
        const d = String(inv?.issue_date ?? '').slice(0, 10);
        if (inv && inv.status !== 'Draft' && inv.status !== 'Cancelled' && d && (!since || d < since)) since = d;
      }
      const frequency: FilerFrequency = ctx.gstFrequency ?? (profile?.gst_scheme === 'composition' ? 'composition' : 'monthly');
      if (since) timeBars = timeBarList({ frequency, stateCode: profile?.stateCode || gstin.slice(0, 2), today, since }, ctx.gstFiled ?? getTable<FiledReturn>(COMPLIANCE_TABLE), gstin, TIME_BAR_LEAD_DAYS);
    }
    return gstGuardNotices({ at: ctx.now.toISOString(), pending, timeBars });
  });
}
