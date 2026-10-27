/** PS-A4 WIP: unbilled time and costs aged by bucket, by matter / client / partner; write off (and reverse) selected rows. */
import { useMemo, useState } from 'react';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { currentCover, currentLiveInvoiceIds, readTimePrefs, timeDb, unbilledExpenses, unbilledTime } from '../../lib/timesheets';
import { reverseWriteOff, wipRows, writeOffWip, type WipGroup } from '../../lib/prof/ps-wip';
import { loadEngagements } from '../../lib/prof/ps-engagements';
import { engagementUse } from '../../lib/prof/ps-prebill';
import { wipRules } from '../../lib/prof/ps-settings';
import { loadStaff } from '../../lib/services/sv-staff';
import { downloadText, toCsv } from '../../lib/download';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

export default function WipView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const [by, setBy] = useState<WipGroup>('matter');
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const { reasons, buckets } = wipRules();
  /* eslint-disable react-hooks/exhaustive-deps */
  const data = useMemo(() => {
    const prefs = readTimePrefs();
    const live = currentLiveInvoiceIds();
    const all = timeDb.all();
    const engs = loadEngagements();
    const invoices = localDb.invoices.getAll();
    const rows = wipRows(unbilledTime(all, live, currentCover(prefs, all), prefs), unbilledExpenses(purchasesDb.all(), live), { prefs, today: todayInput(), buckets, by, centres: loadCostCentres(), engagements: engs, capUsed: (id) => engagementUse(id, invoices, live).used });
    return { rows, written: all.filter((e) => e.ps?.wo) };
  }, [by, tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const staff = useMemo(() => new Map(loadStaff().map((s) => [s.id, s.name])), []);
  const label = (l: string) => (by === 'partner' ? staff.get(l) ?? psT('none') : l);
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const picked = data.rows.filter((r) => sel.has(r.key));
  const head = [psT(by === 'partner' ? 'partner' : by === 'client' ? 'client' : 'matter'), psT('hours'), psT('standard'), pwT('costs'), ...buckets.map((b) => pwT('days', { n: b })), pwT('older'), pwT('oldest'), psT('model'), pwT('capLeft')];
  const rows = data.rows.map((r) => [label(r.label), r.hours, r.time, r.costs, ...r.aged, r.oldest, r.model ? psT(`m.${r.model}`) : '', r.capLeft ?? '']);
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <Field label={pwT('by')}><select className={controls.select} value={by} onChange={(e) => { setBy(e.target.value as WipGroup); setSel(new Set()); }}>{(['matter', 'client', 'partner'] as const).map((k) => <option key={k} value={k}>{pwT(`by.${k}`)}</option>)}</select></Field>
          <Field label={psT('reason')}><input className={controls.input} list="ps-wo-reasons" value={reason} onChange={(e) => setReason(e.target.value)} data-wo-reason /><datalist id="ps-wo-reasons">{reasons.map((r) => <option key={r} value={r} />)}</datalist></Field>
        </div>
        <div className={controls.row}>
          <button type="button" className={controls.btnOutline} disabled={!picked.length} onClick={() => run(() => writeOffWip(picked.flatMap((r) => r.ids), picked.flatMap((r) => r.costIds), reason, todayInput()), psT('saved')) !== undefined && (setSel(new Set()), setTick((x) => x + 1))} data-wo>{pwT('writeOff')}</button>
          {can('settings.manage') && data.written.length > 0 && <button type="button" className={controls.btnGhost} onClick={() => run(() => reverseWriteOff(data.written.map((e) => e.id)), psT('saved')) !== undefined && setTick((x) => x + 1)}>{pwT('reverse')} ({data.written.length})</button>}
          <button type="button" className={controls.btnGhost} onClick={() => downloadText('wip.csv', toCsv([head, ...rows]), 'text/csv')}>{psT('csv')}</button>
        </div>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-wip>
            <thead><tr><th />{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.key} data-wip-row={r.label}>
                  <td><input type="checkbox" aria-label={r.label} checked={sel.has(r.key)} onChange={() => toggle(r.key)} /></td>
                  {rows[i].map((c, j) => <td key={j} className={typeof c === 'number' ? surface.numeric : undefined}>{typeof c === 'number' && j !== 1 ? formatCurrency(c) : c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
