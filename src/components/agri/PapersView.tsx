/** AG-D5 working papers: co-operative deduction by head (80P(2) → Sec 149 by date), producer company 80PA, and the members' statutory calendar. */
import { useMemo, useState } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadMembers } from '../../lib/agri/ag-members';
import { fyOf, patronage } from '../../lib/agri/ag-patronage';
import { COOP_HEAD_LABEL, coopPaper, membersCalendar, producerPaper } from '../../lib/agri/ag-coop-papers';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { F, Form, Hint, Tbl } from './agd-kit';
import { fmt, wrap, type Done } from './agd-ui';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';

export default function PapersView({ onDone }: { onDone: Done }) {
  void onDone;
  const s = readAgriSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [d, setD] = useState<Record<string, any>>({ fy: fyOf(todayInput()), kind: localDb.settings.get().agri_kind === 'coop' ? 'coop' : 'producer' });
  const [heads, setHeads] = useState<Record<string, number>>({});
  const pct = useMemo(() => patronage(d.fy, { members: loadMembers(), cycles: getTable('farmer_cycles'), purchases: getTable('purchases'), invoices: localDb.invoices.getAll(), farmerIds: new Set(getTable<{ id: string; ag?: unknown }>('vendors').filter((v) => v.ag).map((v) => v.id)) }).memberPct, [d.fy]);
  const coop = coopPaper(d.fy, heads, pct);
  const prod = producerPaper(d.fy, d.profit, d.turnover);
  const rows = membersCalendar(d.kind, d.fy, s.calendar);
  return (
    <>
      <Form v={d} set={setD} f={[['fy', 'fy', 'n', 120], ['kind', 'entity', [['producer', agdT('producer')], ['coop', agdT('coop')]]], d.kind === 'producer' && ['profit', 'eligibleProfit', 'n', 160], d.kind === 'producer' && ['turnover', 'turnover', 'n', 160]]} />
      {d.kind === 'coop' ? (
        <section data-agd-paper="coop">
          <h3>{agdT('coopTitle', { section: coop.section, act: coop.act })}</h3>
          <div style={wrap}>{Object.keys(COOP_HEAD_LABEL).map((h) => <F key={h} label={COOP_HEAD_LABEL[h]} w={200}><NumberInput className={controls.input} value={heads[h] ?? 0} onChange={(v) => setHeads({ ...heads, [h]: v })} /></F>)}</div>
          <Tbl head={['head', 'profit', 'membersPct', 'membersPart']} rows={coop.rows.map((r) => [r.label, fmt(r.profit), `${r.membersPct}%`, fmt(r.membersPart)])} />
        </section>
      ) : (
        <p data-agd-80pa><strong>{agdT('paTitle', { ay: prod.ay })} — {agdT('deduction')}: ₹{fmt(prod.deduction)}</strong> — {prod.note}</p>
      )}
      <h3>{agdT('calendar')}</h3>
      <Tbl head={['what', 'dueOn']} rows={rows.map((c) => [c.label, c.due])} />
      <Hint k="calendarNote" />
    </>
  );
}
