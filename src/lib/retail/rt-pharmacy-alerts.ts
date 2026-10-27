/**
 * RT-B bell notices, registered by the notification bell only with the pharmacy pack on (through the desk chunk):
 *  - drug licences expiring within 60 days, or expired (RT-B2);
 *  - "Refills due today: n" (active refills due today or overdue, RT-B1).
 * Read only: the due list is derived (`advanceRefill`), nothing is written from the bell.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { getTable } from '../storage';
import { rtbT } from '../../i18n/areas/retail-r9b';
import type { InvoiceRecord } from '../../types/invoice';
import { readRxSettings } from './rt-pharmacy-rx';
import { licenceNotices } from './rt-pharmacy-registers';
import { REFILLS_TABLE, advanceRefill, dueRefills, loadRefills } from './rt-refills';

const HREF = '/inventory?tab=pharmacy&view=';

/** Pure: the notices for `today` from licences and refill rows (already advanced). */
export function pharmacyNotices(licences: ReturnType<typeof readRxSettings>['licences'], refills: Parameters<typeof dueRefills>[0], today: string, at: string): AppNotification[] {
  const out: AppNotification[] = [];
  for (const n of licenceNotices(licences, today)) {
    const l = n.licence;
    out.push({
      id: `rtb:lic:${l.form}:${l.number}:${l.valid_to}:${n.expired ? 'x' : 'd'}`, severity: n.expired ? 'critical' : 'warning',
      title: rtbT(n.expired ? 'a.licExpired' : 'a.licDue', { form: l.form, number: l.number, date: l.valid_to ?? '' }),
      detail: rtbT('a.licNote'), href: `${HREF}registers`, cta: rtbT('open'), at,
    });
  }
  const due = dueRefills(refills, today, 0);
  if (due.length) out.push({ id: `rtb:refill:${today}:${due.length}`, severity: 'info', title: rtbT('a.refills', { n: due.length }), detail: due.slice(0, 3).map((d) => d.refill.name).join(', '), href: `${HREF}refills`, cta: rtbT('open'), at });
  return out;
}

export function registerPharmacyAlerts(): void {
  registerNotificationProvider((ctx) => {
    const invoices = ctx.invoices as InvoiceRecord[];
    const refills = getTable(REFILLS_TABLE).length ? loadRefills().map((r) => (r.active ? advanceRefill(r, invoices) : r)) : [];
    return pharmacyNotices(readRxSettings().licences, refills, localDayOf(ctx.now), ctx.now.toISOString());
  });
}

