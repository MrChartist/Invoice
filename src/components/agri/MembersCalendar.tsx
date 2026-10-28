/** AG-D5 card on GST → Compliance (fpo pack only, lazy): the members' statutory reminders for the last closed FY (typed dates from Members → Papers win). */
import { useT } from '../../i18n';
import { agdT } from '../../i18n/areas/agri-r12d';
import { localDb } from '../../lib/localDb';
import { membersCalendar } from '../../lib/agri/ag-coop-papers';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { Tbl } from './agd-kit';
import surface from '../../styles/surface.module.css';

export default function MembersCalendar({ today }: { today: string }) {
  useT();
  const kind = localDb.settings.get().agri_kind === 'coop' ? 'coop' : 'producer';
  const rows = membersCalendar(kind, +today.slice(0, 4) - (+today.slice(5, 7) >= 4 ? 1 : 2), readAgriSettings().calendar);
  return (
    <section className={surface.card} data-agd-calendar>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{agdT('calendar')} — {agdT(kind)}</span></div>
      <div className={surface.cardBody}>
        <Tbl head={['what', 'dueOn', '']} flag={rows.map((r) => r.due < today)} rows={rows.map((r) => [r.label, r.due, r.due < today ? agdT('pastDue') : ''])} />
      </div>
    </section>
  );
}
