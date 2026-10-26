/**
 * R4-C2 bell notices for the export desk, plus the R4-C1 LUT notices: realisation due within 60 days, overdue
 * (Rule 96A note — verify with your CA), shipping bill missing. Loaded lazily by the notification bell
 * (`ensureTradeAlerts`) only once an export invoice or an LUT row exists; recomputed when the tables change.
 */
import type { AppNotification } from '../notifications';
import { registerNotificationProvider } from '../notifications';
import type { ExportIrm, ExportWriteOff, LutRow } from '../../types/trade-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { tlT } from '../../i18n/areas/trade-trust-r4-links';
import { localDayOf } from '../dates';
import { peekTable } from '../storage';
import { tableStamp } from '../table-memo';
import { buildRegister, DUE_SOON_DAYS, IRMS_TABLE, WRITEOFFS_TABLE, type RealisationRow } from './export-register';
import { LUT_TABLE } from './lut-register';
import { lutNotices } from './lut-alerts';

const list = (rows: readonly RealisationRow[]) => rows.slice(0, 3).map((r) => `${r.number} (${r.dueDate})`).join(', ') + (rows.length > 3 ? ' …' : '');

/** Pure: notices for a register drawn as at `today`. */
export function realisationNotices(rows: readonly RealisationRow[], at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const open = rows.filter((r) => r.outstandingFcy > 0.005);
  const overdue = open.filter((r) => r.status === 'overdue');
  const soon = open.filter((r) => r.status !== 'overdue' && r.daysLeft <= DUE_SOON_DAYS);
  const noSb = open.filter((r) => r.sbMissing);
  const href = '/gst-reports?tab=export-desk';
  const id = (k: string, rs: readonly RealisationRow[]) => `${k}:${rs.map((r) => r.invoiceId).sort().join(',')}`;
  if (overdue.length) out.push({ id: id('exp-overdue', overdue), severity: 'critical', title: tlT('overdueTitle', { n: overdue.length }), detail: tlT('overdueDetail', { list: list(overdue) }), href, cta: tlT('deskCta'), at });
  if (soon.length) out.push({ id: id('exp-due', soon), severity: 'warning', title: tlT('dueTitle', { n: soon.length }), detail: tlT('dueDetail', { list: list(soon) }), href, cta: tlT('deskCta'), at });
  if (noSb.length) out.push({ id: id('exp-nosb', noSb), severity: 'info', title: tlT('sbTitle', { n: noSb.length }), detail: tlT('sbDetail', { list: noSb.slice(0, 3).map((r) => r.number).join(', ') }), href, cta: tlT('deskCta'), at });
  return out;
}

const TABLES = ['invoices', 'transactions', IRMS_TABLE, WRITEOFFS_TABLE, LUT_TABLE];
let unregister: (() => void) | null = null;
let key = '';
let cached: AppNotification[] = [];

export function registerTradeAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const today = localDayOf(ctx.now);
    const k = `${today}|${tableStamp(...TABLES)}`;
    if (k === key) return cached;
    key = k;
    try {
      const at = ctx.now.toISOString();
      const invoices = peekTable<InvoiceRecord>('invoices');
      const rows = buildRegister({ invoices, payments: peekTable<Payment>('transactions'), irms: peekTable<ExportIrm>(IRMS_TABLE), writeoffs: peekTable<ExportWriteOff>(WRITEOFFS_TABLE), today });
      cached = [...lutNotices(peekTable<LutRow>(LUT_TABLE), invoices, today, at), ...realisationNotices(rows, at)];
    } catch {
      cached = [];
    }
    return cached;
  });
}
