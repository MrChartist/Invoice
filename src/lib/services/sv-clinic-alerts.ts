/**
 * SV-B bell notices, loaded lazily by the notification bell only with the clinic pack listed (explicit packs): a clinic
 * registration (CEA / state) expiring within 60 days or expired; admissions open more than 7 days; deposits short of
 * the running charges by more than `clinic_settings.deposit_alert` (0 = off). The provider re-checks the pack each run.
 */
import type { SenderProfile } from '../../types/invoice';
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import { defineArea } from '../../i18n/area';
import { dayDiff, readClinicSettings } from './sv-patients';
import { depositsOpen, ipdNotices, loadAdmissions } from './sv-ipd';

const aT = defineArea(
  { reg: 'Clinic registration {r} expires in {n} days', regGone: 'Clinic registration {r} has expired', long: 'Admission {no} ({name}) open for over 7 days', dep: 'Admission {no}: charges exceed deposits by ₹{gap}', open: 'Open' } as const,
  { reg: 'क्लिनिक रजिस्ट्रेशन {r} {n} दिन में समाप्त', regGone: 'क्लिनिक रजिस्ट्रेशन {r} समाप्त हो गया', long: 'भर्ती {no} ({name}) 7 दिन से ज़्यादा खुली', dep: 'भर्ती {no}: शुल्क जमा से ₹{gap} अधिक', open: 'खोलें' },
);

/** Days to the registration's validity end when within 60 days (negative = expired), else null. */
export function regExpiry(sender: Pick<SenderProfile, 'sv_regs'> | null | undefined, today: string): number | null {
  const to = sender?.sv_regs?.cea_valid;
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const n = dayDiff(today, to);
  return n <= 60 ? n : null;
}

let on = false;
export function registerClinicAlerts(): void {
  if (on) return;
  on = true;
  registerNotificationProvider((ctx) => {
    if (!isPackOn(localDb.settings.get(), 'clinic')) return [];
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    const out: AppNotification[] = [];
    const n = regExpiry(ctx.profile, today);
    const r = ctx.profile?.sv_regs?.cea ?? '';
    if (n !== null) out.push({ id: `sv:reg:${ctx.profile?.sv_regs?.cea_valid}`, severity: n < 0 ? 'critical' : 'warning', title: n < 0 ? aT('regGone', { r }) : aT('reg', { r, n }), detail: '', href: '/settings', cta: aT('open'), at });
    const s = readClinicSettings();
    for (const x of ipdNotices(loadAdmissions(), today, s.deposit_alert ?? 0, (a) => depositsOpen(a))) {
      out.push({ id: `sv:ipd:${x.kind}:${x.a.id}`, severity: 'warning', title: x.kind === 'long' ? aT('long', { no: x.a.number, name: x.a.patient_name }) : aT('dep', { no: x.a.number, gap: x.gap ?? 0 }), detail: '', href: '/time?tab=clinic&view=ipd', cta: aT('open'), at });
    }
    return out;
  });
}

registerClinicAlerts();
