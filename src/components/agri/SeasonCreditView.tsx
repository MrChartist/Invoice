/** AG-D4 credit till harvest: seasons and their due dates, put a bill on season credit, open season bills with days past due (interest via Receivables → Interest). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { requireAccess } from '../../lib/access';
import { DEFAULT_SEASONS, seasonCredit, withSeason } from '../../lib/agri/ag-season-credit';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { F, Sel, Tbl } from './agd-kit';
import { btn, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function SeasonCreditView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const seasons = s.seasons?.length ? s.seasons : [...DEFAULT_SEASONS];
  const invoices = useMemo(() => { void tick; return localDb.invoices.getAll(); }, [tick]);
  const [n, setN] = useState({ name: '', due: '' });
  const [b, setB] = useState({ bill: '', season: seasons[0]?.name ?? '' });
  const open = invoices.filter((i) => ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY'].includes(i.doc_type) && i.status !== 'Cancelled' && (i.balance_due ?? 0) > 0 && !i.ag?.inputs?.season_due);
  const rows = seasonCredit(invoices, day);
  return (
    <>
      <Tbl head={[agdT('season'), agdT('dueOn'), '']} rows={seasons.map((x, i) => [x.name, x.due,
        <button key="d" type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { saveAgriSettings({ seasons: seasons.filter((_, j) => j !== i) }); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>])} />
      <div style={wrap}>
        <F label={agdT('season')} w={140}><input className={controls.input} value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></F>
        <F label={agdT('dueOn')} w={140}><input className={controls.input} value={n.due} onChange={(e) => setN({ ...n, due: e.target.value })} placeholder="11-15" /></F>
        <button type="button" className={btn} onClick={() => run(() => {
          if (!n.name.trim() || !/^(\d{4}-)?\d{2}-\d{2}$/.test(n.due.trim())) throw new Error(agdT('seasonNeed'));
          saveAgriSettings({ seasons: [...seasons.filter((x) => x.name !== n.name.trim()), { name: n.name.trim(), due: n.due.trim() }] });
          setN({ name: '', due: '' });
          return agdT('saved');
        })}>{agdT('add')}</button>
      </div>
      <h3>{agdT('onSeason')}</h3>
      <div style={wrap}>
        <F label={agdT('bill')}><Sel value={b.bill} onChange={(v) => setB({ ...b, bill: v })} opts={open.map((i) => [i.id, `${i.invoice_number} · ${i.client?.name ?? ''} · ${fmt(i.balance_due ?? 0)}`])} blank="—" /></F>
        <F label={agdT('season')}><Sel value={b.season} onChange={(v) => setB({ ...b, season: v })} opts={seasons.map((x) => [x.name, x.name])} /></F>
        <button type="button" className={btn} disabled={!b.bill} onClick={() => run(() => {
          requireAccess('doc.edit');
          const inv = localDb.invoices.getById(b.bill);
          if (!inv) throw new Error(agdT('none'));
          const next = withSeason(inv, seasons, b.season);
          localDb.invoices.save(next);
          return agdT('dueAt', { date: next.due_date });
        })} data-agd-season-bill>{agdT('setSeason')}</button>
      </div>
      <Tbl head={[agdT('bill'), agdT('party'), agdT('season'), agdT('dueOn'), agdT('due'), agdT('daysPast')]} flag={rows.map((r) => r.overdueDays > 0)} rows={rows.map((r) => [r.invoice.invoice_number, r.invoice.client?.name ?? '', r.season, r.due, fmt(r.balance), r.overdueDays || ''])} />
      <p className={controls.hint}>{agdT('creditNote')} <Link to="/receivables?tab=interest">{agdT('interestLink')}</Link></p>
    </>
  );
}
