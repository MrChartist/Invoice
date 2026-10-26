/**
 * R4-C1 bell notices for the LUT register (pure): "No LUT for FY27-28 yet" from 15 March, and exports in the
 * current FY while no LUT of that FY is on record. Registered by `export-alerts.ts` (lazy bell gate).
 */
import type { AppNotification } from '../notifications';
import type { InvoiceRecord } from '../../types/invoice';
import type { LutRow } from '../../types/trade-r4';
import { tlT } from '../../i18n/areas/trade-trust-r4-links';
import { isLutSupply } from './exporter';
import { fyOf } from './lut-register';

export function lutNotices(register: readonly LutRow[], invoices: readonly Partial<InvoiceRecord>[], today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  const has = (fy: string) => register.some((r) => r?.fy === fy);
  const year = Number(today.slice(0, 4));
  // From 15 March: the coming FY's LUT should be filed before its first export.
  if (today.slice(5) >= '03-15' && today.slice(5) <= '03-31') {
    const next = fyOf(`${year}-04-01`);
    if (!has(next)) out.push({ id: `lut-next:${next}`, severity: 'info', title: tlT('lutNextTitle', { fy: next }), detail: tlT('lutNextDetail', { fy: next }), href: '/settings?tab=business#export', cta: tlT('lutCta'), at });
  }
  const current = fyOf(today);
  if (!has(current)) {
    const n = invoices.filter((i) => i && isLutSupply(i) && i.status !== 'Draft' && i.status !== 'Cancelled' && fyOf(i.issue_date) === current).length;
    if (n) out.push({ id: `lut-now:${current}`, severity: 'warning', title: tlT('lutNowTitle', { fy: current }), detail: tlT('lutNowDetail', { n }), href: '/settings?tab=business#export', cta: tlT('lutCta'), at });
  }
  return out;
}
