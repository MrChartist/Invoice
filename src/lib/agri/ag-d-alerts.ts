/**
 * AG-D bell notices, loaded lazily by the notification bell only with the `agri_inputs`, `coldstore` or `fpo` pack on
 * (the provider re-checks the packs on every run; turning them off silences it, nothing is deleted):
 *  - dealer licences expiring within 60 days (45 days or less: "due soon") or expired (AG-D4, pack `agri_inputs`);
 *  - lien release: loans against lots past their due date with anything due — the lien still holds the lots
 *    (AG-D3, pack `coldstore` or `fpo`);
 *  - the members' statutory dates (AGM, annual return, audit …) of the last closed and the current FY due within 30
 *    days or past due in the last 30 (AG-D5, pack `fpo`; typed dates from Members → Papers win).
 * Read only.
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { localDb } from '../localDb';
import { isPackOn, type PackId } from '../industry-packs';
import { peekTable } from '../storage';
import { agdT } from '../../i18n/areas/agri-r12d';
import { agriLicenceNotices } from './ag-licences';
import { LOANS_TABLE, loadLoans, loanState, overdueLoans } from './ag-loans';
import { membersCalendar } from './ag-coop-papers';
import { readAgriSettings } from './ag-settings';

const shift = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);

/** Pure enough to test: the notices for `today`. */
export function agdNotices(today: string, at: string, packs: { inputs: boolean; loans: boolean; loansTab?: string; members?: 'producer' | 'coop' }): AppNotification[] {
  const out: AppNotification[] = [];
  const s = readAgriSettings();
  if (packs.inputs) {
    for (const n of agriLicenceNotices(s.licences, today)) {
      const l = n.licence;
      out.push({ id: `agd:lic:${l.kind}:${l.number}:${l.valid_to}:${n.expired ? 'x' : n.soon ? 's' : 'd'}`, severity: n.expired ? 'critical' : 'warning', title: `${agdT(`lk.${l.kind}`)} ${l.number}: ${agdT(n.expired ? 'expired' : n.soon ? 'dueSoon' : 'due60')} (${l.valid_to})`, detail: agdT('licenceNote'), href: '/inventory?tab=inputs&view=licences', cta: agdT('v.licences'), at });
    }
  }
  if (packs.loans && peekTable(LOANS_TABLE).length) {
    const late = overdueLoans(loadLoans(), today);
    if (late.length) out.push({ id: `agd:loans:${today}:${late.length}`, severity: 'warning', title: agdT('lienDue', { n: late.map((l) => l.number).join(', ') }), detail: `₹${late.reduce((t, l) => t + loanState(l, today).total, 0).toFixed(2)}: ${agdT('dueDate')}`, href: `/inventory?tab=${packs.loansTab ?? 'cold'}&view=loans`, cta: agdT('v.loans'), at });
  }
  if (packs.members) {
    const from = shift(today, -30), to = shift(today, 30);
    const fy = +today.slice(0, 4) - (+today.slice(5, 7) >= 4 ? 0 : 1);
    for (const c of [...membersCalendar(packs.members, fy - 1, s.calendar), ...membersCalendar(packs.members, fy, s.calendar)]) {
      if (c.due < from || c.due > to) continue;
      out.push({ id: `agd:cal:${c.key}:${c.due}`, severity: c.due < today ? 'critical' : 'info', title: `${c.label}: ${c.due}${c.due < today ? `: ${agdT('pastDue')}` : ''}`, detail: agdT('calendarNote'), href: '/inventory?tab=members&view=papers', cta: agdT('v.papers'), at });
    }
  }
  return out;
}

registerNotificationProvider((ctx) => {
  const s = localDb.settings.get();
  const on = (p: PackId) => isPackOn(s, p);
  const packs = { inputs: on('agri_inputs'), loans: on('coldstore') || on('fpo'), loansTab: on('coldstore') ? 'cold' : 'members', members: on('fpo') ? (s.agri_kind === 'coop' ? 'coop' as const : 'producer' as const) : undefined };
  return packs.inputs || packs.loans ? agdNotices(localDayOf(ctx.now), ctx.now.toISOString(), packs) : [];
});
