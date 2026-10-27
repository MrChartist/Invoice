/**
 * AG-D bell notices, loaded lazily by the notification bell only with the `agri_inputs`, `coldstore` or `fpo` pack on
 * (the provider re-checks the packs on every run; turning them off silences it, nothing is deleted):
 *  - dealer licences expiring within 60 days (45 days or less: "due soon") or expired (AG-D4);
 *  - loans against stored produce past their due date with anything due (AG-D3).
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
import { readAgriSettings } from './ag-settings';

/** Pure enough to test: the notices for `today`. */
export function agdNotices(today: string, at: string, packs: { inputs: boolean; loans: boolean; loansTab?: string }): AppNotification[] {
  const out: AppNotification[] = [];
  if (packs.inputs) {
    for (const n of agriLicenceNotices(readAgriSettings().licences, today)) {
      const l = n.licence;
      out.push({ id: `agd:lic:${l.kind}:${l.number}:${l.valid_to}:${n.expired ? 'x' : n.soon ? 's' : 'd'}`, severity: n.expired ? 'critical' : 'warning', title: `${agdT(`lk.${l.kind}`)} ${l.number}: ${agdT(n.expired ? 'expired' : n.soon ? 'dueSoon' : 'due60')} (${l.valid_to})`, detail: agdT('licenceNote'), href: '/inventory?tab=inputs&view=licences', cta: agdT('v.licences'), at });
    }
  }
  if (packs.loans && peekTable(LOANS_TABLE).length) {
    const late = overdueLoans(loadLoans(), today);
    if (late.length) out.push({ id: `agd:loans:${today}:${late.length}`, severity: 'warning', title: `${agdT('v.loans')}: ${late.map((l) => l.number).join(', ')}`, detail: `₹${late.reduce((t, l) => t + loanState(l, today).total, 0).toFixed(2)} — ${agdT('dueDate')}`, href: `/inventory?tab=${packs.loansTab ?? 'cold'}&view=loans`, cta: agdT('v.loans'), at });
  }
  return out;
}

registerNotificationProvider((ctx) => {
  const s = localDb.settings.get();
  const on = (p: PackId) => isPackOn(s, p);
  const packs = { inputs: on('agri_inputs'), loans: on('coldstore') || on('fpo'), loansTab: on('coldstore') ? 'cold' : 'members' };
  return packs.inputs || packs.loans ? agdNotices(localDayOf(ctx.now), ctx.now.toISOString(), packs) : [];
});
