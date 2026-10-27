/** AG-D5 working papers: co-operative deduction by head (80P(2) → Sec 149 by date), producer company 80PA, and the members' statutory calendar. */
import { useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { fyOf } from '../../lib/agri/ag-patronage';
import { coopSection, membersCalendar, producerPaper } from '../../lib/agri/ag-coop-papers';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { Form, Hint, Tbl } from './agd-kit';
import { fmt, type Done } from './agd-ui';

export default function PapersView({ onDone }: { onDone: Done }) {
  void onDone;
  const s = readAgriSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, setD] = useState<Record<string, any>>({ fy: fyOf(todayInput()), kind: localDb.settings.get().agri_kind === 'coop' ? 'coop' : 'producer' });
  const prod = producerPaper(d.fy, d.profit, d.turnover);
  const rows = membersCalendar(d.kind, d.fy, s.calendar);
  return (
    <>
      <Form v={d} set={setD} f={[['fy', 'fy', 'n', 120], ['kind', 'entity', [['producer', agdT('producer')], ['coop', agdT('coop')]]], d.kind === 'producer' && ['profit', 'eligibleProfit', 'n', 160], d.kind === 'producer' && ['turnover', 'turnover', 'n', 160]]} />
      {d.kind === 'coop' ? <h3 data-agd-paper="coop">{agdT('coopTitle', { section: coopSection(d.fy).section, act: coopSection(d.fy).act })}</h3>
        : <p data-agd-80pa><strong>{agdT('paTitle', { ay: prod.ay })} — {agdT('deduction')}: ₹{fmt(prod.deduction)}</strong> — {prod.note}</p>}
      <h3>{agdT('calendar')}</h3>
      <Tbl head={['what', 'dueOn']} rows={rows.map((c) => [c.label, c.due])} />
      <Hint k="calendarNote" />
    </>
  );
}
