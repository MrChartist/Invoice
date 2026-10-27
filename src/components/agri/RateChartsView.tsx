/** AG-B1 rate charts: list, a new chart (matrix pasted / loaded from CSV or XLSX, or a formula), heat preview, a test box. */
import { useMemo, useState } from 'react';
import type { MilkKind, MilkRateChart } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { chartRate, deleteChart, loadCharts, matrixCsv, parseMatrix, saveChart } from '../../lib/agri/ag-rate-chart';
import { todayInput } from '../../lib/utils';
import { downloadTextFile } from '../receivables/exportUtils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { clientOpts, milkOpts, sm, useRun, wrap, type Done } from './dairy-kit';
import { F, N, Sel } from './dairy-ui';

type Basis = MilkRateChart['basis'];
const BASES: readonly Basis[] = ['matrix', 'two_axis', 'fat_kg', 'ts_kg', 'flat'];
const SAMPLE = 'fat \\ SNF,8.0,8.5,9.0\n3.0,30,31,32\n3.5,33,34,35\n4.0,36,37,38';

/** "M=1, E=0.5, cow=0.25, 20=0.5" → incentives (shift M / E, milk kind, minimum quantity). */
const parseAddOns = (s: string): NonNullable<MilkRateChart['incentives']> => s.split(/[,;]/).map((t) => t.split('=').map((x) => x.trim())).filter(([k, v]) => k && Number(v))
  .map(([key, v]) => ({ kind: /^[ME]$/i.test(key) ? 'shift' as const : /^\d/.test(key) ? 'quantity' as const : 'category' as const, key: /^[ME]$/i.test(key) ? key.toUpperCase() : key.toLowerCase(), add: Number(v) }));

export default function RateChartsView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const charts = useMemo(() => loadCharts().sort((a, b) => b.effective_from.localeCompare(a.effective_from)), [tick]);
  const [c, setC] = useState({ name: '', milk: 'cow' as MilkKind, basis: 'matrix' as Basis, unit: 'L' as 'L' | 'KG', from: todayInput(), buyer: '', csv: SAMPLE, fat: 0, snf: 0, ts: 0, flat: 0, minFat: 0, minSnf: 0, below: 'reject' as MilkRateChart['below_min'], belowRate: 0, addOns: '' });
  const set = (p: Partial<typeof c>) => setC({ ...c, ...p });
  const [t, setT] = useState({ fat: 4, snf: 8.5, qty: 10 });
  const matrix = useMemo(() => {
    try {
      return c.basis === 'matrix' ? parseMatrix(c.csv) : undefined;
    } catch {
      return undefined;
    }
  }, [c.basis, c.csv]);
  const draft: Omit<MilkRateChart, 'id'> = {
    name: c.name, milk: c.milk, basis: c.basis, unit: c.unit, effective_from: c.from, below_min: c.below, ...(matrix ? { matrix } : {}),
    fat_rate: c.fat, snf_rate: c.snf, ts_rate: c.ts, flat_rate: c.flat, min_fat: c.minFat, min_snf: c.minSnf, below_rate: c.belowRate,
    ...(c.addOns.trim() ? { incentives: parseAddOns(c.addOns) } : {}), ...(c.buyer ? { buyer_id: c.buyer } : {}),
  };
  const test = (() => {
    try {
      const r = chartRate({ ...draft, id: '' }, { ...t, unit: c.unit });
      return r.rejected ? bT('rejected') : `₹${r.rate} × ${t.qty} = ₹${r.amount}`;
    } catch {
      return '';
    }
  })();
  const load = async (f: File) => {
    set({ csv: /\.xlsx$/i.test(f.name) ? await (await import('../../lib/xlsx')).xlsxToCsv(await f.arrayBuffer()) : await f.text() });
  };
  const max = matrix ? Math.max(...matrix.rates.flat(), 1) : 1;
  return (
    <>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="charts">
          <thead><tr><th>{bT('name')}</th><th>{bT('milk')}</th><th>{bT('basis')}</th><th>{bT('from')}</th><th>{bT('to')}</th><th /></tr></thead>
          <tbody>{charts.map((x) => (
            <tr key={x.id}>
              <td>{x.name}{x.buyer_id ? ` · ${bT('buyerChart')}` : ''}</td><td>{bT(`milk.${x.milk}`)}</td><td>{bT(`basis.${x.basis}`)} / {x.unit}</td><td>{x.effective_from}</td><td>{x.effective_to ?? '—'}</td>
              <td>
                {x.matrix && <button type="button" className={sm} onClick={() => downloadTextFile(`${x.name}.csv`, matrixCsv(x.matrix!))}>CSV</button>}
                <button type="button" className={sm} onClick={() => run(() => { deleteChart(x.id); return bT('deleted'); })}>{bT('delete')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3 className={surface.cardHeadIcon}>{bT('newChart')}</h3>
      <p className={surface.sectionNote}>{bT('chartHint')}</p>
      <div className={controls.row} style={wrap}>
        <F l={bT('name')} w={180}><input className={controls.input} value={c.name} onChange={(e) => set({ name: e.target.value })} data-dairy="chart-name" /></F>
        <Sel l={bT('milk')} v={c.milk} set={(milk) => set({ milk })} opts={milkOpts()} />
        <Sel l={bT('basis')} v={c.basis} set={(basis) => set({ basis })} opts={BASES.map((b) => [b, bT(`basis.${b}`)] as const)} w={180} d="chart-basis" />
        <Sel l={bT('unit')} v={c.unit} set={(unit) => set({ unit })} opts={[['L', 'L'], ['KG', 'kg']]} w={80} d="chart-unit" />
        <F l={bT('from')} w={160}><input type="date" className={controls.input} value={c.from} onChange={(e) => set({ from: e.target.value })} data-dairy="chart-from" /></F>
        <Sel l={bT('buyer')} v={c.buyer} set={(buyer) => set({ buyer })} opts={[['', bT('farmersChart')], ...clientOpts()]} w={200} d="chart-buyer" />
      </div>
      {c.basis === 'matrix' ? (
        <>
          <F l={bT('matrix')}><textarea className={controls.textarea} rows={5} value={c.csv} onChange={(e) => set({ csv: e.target.value })} data-dairy="matrix" /></F>
          <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0]).catch((er: Error) => onDone(er.message, true))} />
          {matrix && (
            <table className={surface.table} data-dairy="heat">
              <tbody><tr><th>{bT('fatSnf')}</th>{matrix.snf_steps.map((s) => <th key={s}>{s}</th>)}</tr>
                {matrix.fat_steps.map((f, i) => <tr key={f}><th>{f}</th>{matrix.rates[i].map((r, j) => <td key={j} style={{ background: `color-mix(in srgb, var(--primary) ${Math.round((r / max) * 40)}%, transparent)` }}>{r}</td>)}</tr>)}</tbody>
            </table>
          )}
        </>
      ) : (
        <div className={controls.row} style={wrap}>
          {c.basis === 'flat' ? <N l={bT('flatRate')} v={c.flat} set={(flat) => set({ flat })} /> : c.basis === 'ts_kg' ? <N l={bT('tsRate')} v={c.ts} set={(ts) => set({ ts })} /> : <N l={bT('fatRate')} v={c.fat} set={(fat) => set({ fat })} d="chart-fat" />}
          {c.basis === 'two_axis' && <N l={bT('snfRate')} v={c.snf} set={(snf) => set({ snf })} d="chart-snf" />}
        </div>
      )}
      <div className={controls.row} style={wrap}>
        <N l={bT('minFat')} v={c.minFat} set={(minFat) => set({ minFat })} />
        <N l={bT('minSnf')} v={c.minSnf} set={(minSnf) => set({ minSnf })} />
        <Sel l={bT('belowMin')} v={c.below} set={(below) => set({ below })} opts={(['reject', 'flat', 'deduct'] as const).map((k) => [k, bT(`below.${k}`)] as const)} />
        {c.below !== 'reject' && <N l={bT('belowRate')} v={c.belowRate} set={(belowRate) => set({ belowRate })} />}
        <F l={bT('addOns')} w={200}><input className={controls.input} value={c.addOns} onChange={(e) => set({ addOns: e.target.value })} placeholder="M=1, 20=0.5" /></F>
        <button type="button" className={controls.btnPrimary} data-dairy="chart-save" onClick={() => run(() => bT('chartSaved', { name: saveChart(draft).name }))}>{bT('save')}</button>
      </div>
      <div className={controls.row} style={wrap}>
        <N l={bT('fat')} v={t.fat} set={(fat) => setT({ ...t, fat })} w={80} />
        <N l={bT('snf')} v={t.snf} set={(snf) => setT({ ...t, snf })} w={80} />
        <N l={bT('qty')} v={t.qty} set={(qty) => setT({ ...t, qty })} w={80} />
        <span className={controls.hint} data-dairy="chart-test">{bT('testSample')}: {test}</span>
      </div>
    </>
  );
}
