import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import {
  beatPlan, collectionsBy, distCsv, liveDistContext, outstandingBy, returnsBy, routesDb, salesBy, weekdayOf,
  type DistGroupBy, type DistRow,
} from '../../lib/distribution';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { addDaysInput, formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { distT } from '../../i18n/areas/distribution';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

type Measure = 'sales' | 'outstanding' | 'collections' | 'returns';

/** 8.81 reports: sales / outstanding / collections / returns by salesman, beat or area, and the beat plan. */
export default function DistReports({ view }: { view: 'reports' | 'plan' }) {
  useT();
  const [by, setBy] = useState<DistGroupBy>('salesman');
  const [measure, setMeasure] = useState<Measure>('sales');
  const [from, setFrom] = useState(() => addDaysInput(-30));
  const [to, setTo] = useState(todayInput());
  const [day, setDay] = useState(todayInput());
  const data = useMemo(() => ({
    ctx: liveDistContext(), invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), routes: routesDb.all(),
  }), []);
  const period = { from, to };
  const rows: DistRow[] = useMemo(() => {
    if (measure === 'sales') return salesBy(data.invoices, data.ctx, by, { from, to });
    if (measure === 'returns') return returnsBy(data.invoices, data.ctx, by, { from, to });
    if (measure === 'collections') return collectionsBy(data.payments, data.invoices, data.ctx, by, { from, to });
    return outstandingBy(data.invoices, data.ctx, by);
  }, [data, by, measure, from, to]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const plan = useMemo(() => beatPlan(weekdayOf(day), data.ctx, data.invoices, data.routes), [data, day]);
  const week = useMemo(() => [1, 2, 3, 4, 5, 6, 0].map((d) => ({ d, beats: beatPlan(d, data.ctx, data.invoices, data.routes) })), [data]);
  const groupLabel = distT(by === 'salesman' ? 'salesman' : by === 'beat' ? 'beat' : 'area');

  if (view === 'plan') {
    return (
      <div className={own.stack} data-beat-plan>
        <p className={own.muted}>{distT('planIntro')}</p>
        <label className={controls.field}><span className={controls.label}>{distT('day')}</span>
          <input type="date" className={controls.input} value={day} onChange={(e) => setDay(e.target.value)} /></label>
        {plan.length === 0 && <p className={own.muted}>{distT('noBeatsDay')}</p>}
        {plan.map((p) => (
          <div key={p.beat.id} className={own.day} data-plan-beat={p.beat.name}>
            <h4>{p.beat.name}{p.route ? ` · ${p.route}` : ''}{p.area ? ` · ${p.area}` : ''}{p.agent ? ` · ${p.agent}` : ''} — {formatCurrency(p.outstanding)}</h4>
            <ul>{p.parties.map((c) => <li key={c.id ?? c.name}>{c.name}{c.phone ? ` · ${c.phone}` : ''} — {formatCurrency(c.outstanding)}</li>)}</ul>
          </div>
        ))}
        <h4>{distT('weekPlan')}</h4>
        <div className={own.grid}>
          {week.map((w) => (
            <div key={w.d} className={own.day}>
              <h4>{distT(`d${w.d as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}</h4>
              <ul>{w.beats.length ? w.beats.map((b) => <li key={b.beat.id}>{b.beat.name} ({b.parties.length}){b.agent ? ` · ${b.agent}` : ''}</li>) : <li>—</li>}</ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={own.stack} data-dist-reports>
      <div className={own.row}>
        <label className={controls.field}><span className={controls.label}>{distT('report')}</span>
          <select className={controls.select} value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} data-dist-measure>
            <option value="sales">{distT('mSales')}</option>
            <option value="outstanding">{distT('mOutstanding')}</option>
            <option value="collections">{distT('mCollections')}</option>
            <option value="returns">{distT('mReturns')}</option>
          </select></label>
        <label className={controls.field}><span className={controls.label}>{distT('groupBy')}</span>
          <select className={controls.select} value={by} onChange={(e) => setBy(e.target.value as DistGroupBy)} data-dist-by>
            <option value="salesman">{distT('salesman')}</option>
            <option value="beat">{distT('beat')}</option>
            <option value="area">{distT('area')}</option>
          </select></label>
        {measure !== 'outstanding' && (
          <>
            <label className={controls.field}><span className={controls.label}>{distT('from')}</span><input type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{distT('to')}</span><input type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`${measure}-by-${by}.csv`, distCsv(`${distT(measure === 'sales' ? 'mSales' : measure === 'returns' ? 'mReturns' : measure === 'collections' ? 'mCollections' : 'mOutstanding')} — ${groupLabel}${measure !== 'outstanding' ? ` ${period.from} – ${period.to}` : ''}`, rows, groupLabel, distT('notAssigned')), 'text/csv')}>
          <Download size={14} aria-hidden="true" /> CSV
        </button>
      </div>
      <div className={own.tableWrap}>
        <table className={own.table}>
          <thead><tr><th>{groupLabel}</th><th className={own.num}>{distT('documents')}</th><th className={own.num}>{distT('parties')}</th><th className={own.num}>{distT('amount')}</th>{(measure === 'sales' || measure === 'returns') && <th className={own.num}>{distT('taxable')}</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key || '-'} data-dist-row={r.label || '-'}>
                <td>{r.label || distT('notAssigned')}</td><td className={own.num}>{r.docs}</td><td className={own.num}>{r.parties}</td><td className={own.num}>{formatCurrency(r.amount)}</td>
                {(measure === 'sales' || measure === 'returns') && <td className={own.num}>{formatCurrency(r.taxable)}</td>}
              </tr>
            ))}
            <tr className={own.group}><td>{distT('total')}</td><td /><td /><td className={own.num}>{formatCurrency(total)}</td>{(measure === 'sales' || measure === 'returns') && <td />}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
