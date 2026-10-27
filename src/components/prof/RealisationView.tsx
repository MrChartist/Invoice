/** PS-A4 Realisation: worked, billed, collected and the three ratios by timekeeper / partner / client / matter / work type. */
import { useMemo, useState } from 'react';
import type { TimeEntry } from '../../types/time';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { currentLiveInvoiceIds, readTimePrefs, timeDb } from '../../lib/timesheets';
import { loadWorkTypes } from '../../lib/rate-cards';
import { realisation, type RealDim } from '../../lib/prof/ps-realisation';
import { loadStaff } from '../../lib/services/sv-staff';
import { downloadText, toCsv } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { pct } from './ps-run';
import { usePeriod } from './use-period';

const DIMS: RealDim[] = ['staff', 'partner', 'client', 'matter', 'work_type'];

export default function RealisationView() {
  const { from, to, inputs } = usePeriod();
  const [by, setBy] = useState<RealDim>('client');
  const res = useMemo(() => {
    const prefs = readTimePrefs();
    const all = timeDb.all();
    const byId = new Map<string, TimeEntry>(all.map((e) => [e.id, e]));
    const live = currentLiveInvoiceIds();
    const invoices = localDb.invoices.getAll();
    const inv = invoices.filter((i) => live.has(i.id) && i.doc_type === 'INVOICE');
    const totals = new Map(invoices.map((i) => [i.id, i.total]));
    const credit = new Map<string, number>();
    for (const l of getTable<{ from_id: string; to_id: string; relation: string }>('doc_links')) if (l.relation === 'credit_note' && live.has(l.to_id)) credit.set(l.from_id, (credit.get(l.from_id) ?? 0) + (totals.get(l.to_id) ?? 0));
    return realisation({ from, to, by, prefs, invoices: inv, entryById: (id) => byId.get(id), dated: all.filter((e) => e.date >= from && e.date <= to), writtenOff: all.filter((e) => e.ps?.wo), centres: loadCostCentres(), credited: (id) => credit.get(id) ?? 0 });
  }, [from, to, by]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of loadStaff()) m.set(s.id, s.name);
    for (const c of localDb.clients.getAll()) if (c.id) m.set(c.id, c.name);
    for (const c of loadCostCentres()) m.set(c.id, c.ps?.code ? `${c.ps.code} — ${c.name}` : c.name);
    for (const w of loadWorkTypes()) m.set(w.id, w.name);
    return m;
  }, []);
  const head = [pwT(`by.${by}`), pwT('worked'), psT('standard'), psT('billed'), psT('collected'), pwT('billing'), pwT('collection'), pwT('overall')];
  const rows = [...res.rows, { ...res.total, key: psT('total') }].map((r) => [names.get(r.key) ?? (r.key || psT('none')), r.worked, r.standard, r.billed, r.collected, pct(r.billing), pct(r.collection), pct(r.overall)]);
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          {inputs}
          <Field label={pwT('by')}><select className={controls.select} value={by} onChange={(e) => setBy(e.target.value as RealDim)}>{DIMS.map((d) => <option key={d} value={d}>{pwT(`by.${d}`)}</option>)}</select></Field>
        </div>
        <button type="button" className={controls.btnGhost} onClick={() => downloadText('realisation.csv', toCsv([head, ...rows]), 'text/csv')}>{psT('csv')}</button>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-realisation>
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} data-real-row={r[0]}>{r.map((c, j) => <td key={j} className={j ? surface.numeric : undefined}>{typeof c === 'number' ? formatCurrency(c) : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className={controls.hint}>{pwT('defs')}</p>
      </div>
    </div>
  );
}
