/**
 * MF-D card on GST → Compliance (`shopfloor` pack only, lazy): MSME Form-1 due dates (companies), export-obligation dates
 * of open AA / EPCG within 90 / 30 days or overdue, and incentive claims pending more than 180 days. Reminders only.
 */
import { useT } from '../../i18n';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { purchasesDb } from '../../lib/purchases';
import { stockDb } from '../../lib/inventory';
import { form1Dues, isCompany } from '../../lib/mfg/mf-msme-form1';
import { authorisationsDb, eoStatus, exportsAgainst, importsAgainst } from '../../lib/mfg/mf-authorisations';
import { claimFigures, incentiveClaimsDb, pendingClaims } from '../../lib/mfg/mf-incentives';
import { Tbl } from './mfd-ui';
import surface from '../../styles/surface.module.css';

export default function MfgCalendar({ today }: { today: string }) {
  useT();
  const p = localDb.settings.activeProfile();
  const entity = [...getTable<{ id: string; entity_type?: string }>('notes_to_accounts')].sort((a, b) => b.id.localeCompare(a.id)).find((n) => n.entity_type)?.entity_type;
  const rows: string[][] = isCompany(entity, p?.companyName) ? form1Dues(today).map((d) => [d.label, d.date]) : [];
  const auths = authorisationsDb.all().filter((a) => a.status === 'open');
  if (auths.length) {
    const inv = localDb.invoices.getAll();
    const bills = purchasesDb.all();
    const ids = new Map(stockDb.items().map((i) => [i.name.trim().toLowerCase(), i.id]));
    const idOf = (n: string) => ids.get(n.trim().toLowerCase());
    for (const a of auths) {
      const s = eoStatus(a, exportsAgainst(inv, a.id, idOf), importsAgainst(bills, a.id, idOf), today);
      if (s.bell) rows.push([`${a.kind === 'aa' ? 'AA' : 'EPCG'} ${a.number} — ${sdT('eoDue')}`, a.eo_extended_to || a.eo_due]);
    }
  }
  for (const c of pendingClaims(incentiveClaimsDb.all(), today)) rows.push([`${c.name} — ${sdT('pending')} ${claimFigures(c, today).pending}`, c.claimed_on || c.period_to]);
  if (!rows.length) return null;
  return (
    <section className={surface.card} data-mfd-calendar>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{sdT('view.msme')} · {sdT('view.authorisations')} · {sdT('view.incentives')}</span></div>
      <div className={surface.cardBody}><Tbl empty="" head={['', sdT('date')]} rows={rows} /></div>
    </section>
  );
}
