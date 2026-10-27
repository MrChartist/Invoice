/** AG-D5 rows in the compliance calendar (fpo pack only, lazy): the members' statutory reminders for the last closed FY. */
import { useT } from '../../i18n';
import { agdT } from '../../i18n/areas/agri-r12d';
import { localDb } from '../../lib/localDb';
import { membersCalendar } from '../../lib/agri/ag-coop-papers';
import { fyOf } from '../../lib/agri/ag-patronage';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { Tbl } from './agd-kit';
import surface from '../../styles/surface.module.css';

export default function MembersCalendar({ today }: { today: string }) {
  useT();
  const kind = (localDb.settings.get() as { agri_kind?: string }).agri_kind === 'coop' ? 'coop' : 'producer';
  const rows = membersCalendar(kind, fyOf(today) - 1, readAgriSettings().calendar);
  return (
    <section className={surface.card} data-agd-calendar>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{agdT('calendar')} — {agdT(kind)}</span></div>
      <div className={surface.cardBody}>
        <Tbl head={[agdT('what'), agdT('dueOn'), '']} flag={rows.map((r) => r.due < today)} rows={rows.map((r) => [r.label, r.due, r.due < today ? agdT('pastDue') : ''])} />
      </div>
    </section>
  );
}
