import { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { computeStock } from '../../lib/inventory';
import { computeTracking } from '../../lib/stock-tracking';
import { getIndianFY } from '../../lib/invoice-number';
import {
  AGE_BUCKETS, ageBucketBounds, batchAgeing, groupWiseSummary, monthVouchers, monthlyMovement, movementAnalysis,
  negativeStockReport, parseAgeSlabs, stockAgeing,
} from '../../lib/stock-reports';
import { stockGroupsDb } from '../../lib/stock-groups';
import { mfgT } from '../../i18n/areas/manufacturing';
import { ItemFilterBar } from './ItemFilterBar';
import { useItemFilterIds } from './useItemFilterIds';
import { NO_FILTER, applyItemFilter } from '../../lib/stock-filters';
import { money, qtyText, type MfgContext } from './context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

type Report = 'summary' | 'groups' | 'movement' | 'ageing' | 'negative';

/** Translated bucket labels for the slabs ("0–30 days", …, "Over 180 days"). */
const ageLabels = (buckets: readonly number[]) =>
  ageBucketBounds(buckets).map((b) => (b.to === null ? mfgT('ageOver', { n: b.from - 1 }) : mfgT('ageRange', { from: b.from, to: b.to })));

/** Stock Summary drill-down, Movement Analysis, Stock Ageing, Negative stock exceptions. */
export function StockReportsTab({ ctx }: { ctx: MfgContext }) {
  const [report, setReport] = useState<Report>('summary');
  const positions = useMemo(() => computeStock(ctx.inputs).filter((p) => p.item.track_stock), [ctx.inputs]);
  // 7S (7.66): Movement and Ageing narrow to a stock group / category.
  const [filter, setFilter] = useState(NO_FILTER);
  const ids = useItemFilterIds(filter, ctx.items);
  const narrowed = useMemo(() => applyItemFilter(positions, ids, (p) => p.item.id), [positions, ids]);
  const today = todayInput();
  const reports: [Report, string][] = [['summary', mfgT('rSummary')], ['groups', mfgT('rGroups')], ['movement', mfgT('rMovement')], ['ageing', mfgT('rAgeing')], ['negative', mfgT('rNegative')]];
  return (
    <>
      <div className={cn(controls.segment, styles.tabs)} role="tablist" aria-label={mfgT('tabReports')}>
        {reports.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={report === k} className={report === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setReport(k)}>{label}</button>
        ))}
      </div>
      {report === 'summary' && <SummaryDrill positions={positions} today={today} />}
      {report === 'groups' && <GroupSummary positions={positions} today={today} />}
      {(report === 'movement' || report === 'ageing') && <ItemFilterBar value={filter} onChange={setFilter} idPrefix={`sr-${report}`} />}
      {report === 'movement' && <Movement positions={narrowed} today={today} />}
      {report === 'ageing' && <Ageing positions={narrowed} today={today} ctx={ctx} ids={ids} />}
      {report === 'negative' && <Negative positions={positions} />}
    </>
  );
}

type Positions = ReturnType<typeof computeStock>;

function SummaryDrill({ positions, today }: { positions: Positions; today: string }) {
  const [itemId, setItemId] = useState('');
  const [month, setMonth] = useState('');
  const thisFy = getIndianFY(today).startYear;
  const [fy, setFy] = useState(thisFy);
  const p = positions.find((x) => x.item.id === itemId);
  const mm = useMemo(() => (p ? monthlyMovement(p, fy) : null), [p, fy]);

  if (p && month) {
    const rows = monthVouchers(p, month);
    return (
      <>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setMonth('')}><ArrowLeft size={14} aria-hidden="true" /> {mfgT('back')}</button>
        <h3 className={styles.section} style={{ margin: '0.75rem 0' }}>{p.item.name} · {month}</h3>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mfgT('date')}</th><th>{mfgT('particulars')}</th><th className={styles.num}>{mfgT('inward')}</th><th className={styles.num}>{mfgT('outward')}</th><th className={styles.num}>{mfgT('rate')}</th><th className={styles.num}>{mfgT('closing')}</th><th className={styles.num}>{mfgT('value')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{formatDate(r.date)}</td><td>{r.particulars}</td>
                  <td className={styles.num}>{r.qtyIn ? qtyText(r.qtyIn) : ''}</td><td className={styles.num}>{r.qtyOut ? qtyText(r.qtyOut) : ''}</td>
                  <td className={styles.num}>{money(r.rate)}</td><td className={styles.num}>{qtyText(r.balance)}</td><td className={styles.num}>{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  if (p && mm) {
    return (
      <>
        <div className={styles.bar}>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setItemId('')}><ArrowLeft size={14} aria-hidden="true" /> {mfgT('back')}</button>
          <label className={styles.muted}>{mfgT('fy')}{' '}
            <select className={controls.select} value={fy} onChange={(e) => setFy(Number(e.target.value))} aria-label={mfgT('fy')}>
              {[thisFy - 2, thisFy - 1, thisFy, thisFy + 1].map((y) => <option key={y} value={y}>FY {String(y).slice(2)}-{String(y + 1).slice(2)}</option>)}
            </select>
          </label>
        </div>
        <h3 className={styles.section} style={{ margin: '0 0 0.75rem' }}>{p.item.name}</h3>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mfgT('month')}</th><th className={styles.num}>{mfgT('inward')}</th><th className={styles.num}>{mfgT('value')}</th><th className={styles.num}>{mfgT('outward')}</th><th className={styles.num}>{mfgT('value')}</th><th className={styles.num}>{mfgT('closing')}</th><th className={styles.num}>{mfgT('value')}</th></tr></thead>
            <tbody>
              <tr><td>{mfgT('opening')}</td><td /><td /><td /><td /><td className={styles.num}>{qtyText(mm.openingQty)}</td><td className={styles.num}>{money(mm.openingValue)}</td></tr>
              {mm.months.map((m) => (
                <tr key={m.month}>
                  <td>{m.vouchers ? <button type="button" className={styles.link} onClick={() => setMonth(m.month)}>{m.label}</button> : m.label}</td>
                  <td className={styles.num}>{m.inQty ? qtyText(m.inQty) : ''}</td><td className={styles.num}>{m.inQty ? money(m.inValue) : ''}</td>
                  <td className={styles.num}>{m.outQty ? qtyText(m.outQty) : ''}</td><td className={styles.num}>{m.outQty ? money(m.outValue) : ''}</td>
                  <td className={styles.num}>{qtyText(m.closingQty)}</td><td className={styles.num}>{money(m.closingValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  const total = positions.reduce((s, x) => s + Math.max(x.value, 0), 0);
  return (
    <>
      <p className={styles.muted}>{mfgT('drillHint')}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{mfgT('item')}</th><th className={styles.num}>{mfgT('closing')}</th><th className={styles.num}>{mfgT('rate')}</th><th className={styles.num}>{mfgT('value')}</th></tr></thead>
          <tbody>
            {positions.map((x) => (
              <tr key={x.item.id}>
                <td><button type="button" className={styles.link} onClick={() => setItemId(x.item.id)}>{x.item.name}</button></td>
                <td className={cn(styles.num, x.qty < 0 && styles.loss)}>{qtyText(x.qty)} {x.item.unit}</td>
                <td className={styles.num}>{money(x.avgCost)}</td><td className={styles.num}>{money(x.value)}</td>
              </tr>
            ))}
            <tr><td><strong>{mfgT('total')}</strong></td><td /><td /><td className={styles.num}><strong>{money(total)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function Movement({ positions, today }: { positions: Positions; today: string }) {
  const [from, setFrom] = useState(`${getIndianFY(today).startYear}-04-01`);
  const [to, setTo] = useState(today);
  const data = useMemo(() => movementAnalysis(positions, from, to), [positions, from, to]);
  return (
    <>
      <div className={styles.bar} style={{ justifyContent: 'flex-start' }}>
        <label className={styles.muted}>{mfgT('from')} <input type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={styles.muted}>{mfgT('to')} <input type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {data.length === 0 && <p className={styles.muted}>{mfgT('noData')}</p>}
      {data.map((d) => (
        <div key={d.position.item.id} style={{ marginBottom: '1rem' }}>
          <h3 className={styles.section} style={{ margin: '0 0 0.5rem' }}>{d.position.item.name}</h3>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{mfgT('party')}</th><th className={styles.num}>{mfgT('inward')}</th><th className={styles.num}>{mfgT('value')}</th><th className={styles.num}>{mfgT('outward')}</th><th className={styles.num}>{mfgT('value')}</th></tr></thead>
              <tbody>
                {[...d.inward, ...d.outward.filter((o) => !d.inward.some((i) => i.party === o.party))].map((m) => (
                  <tr key={m.party}>
                    <td>{m.party}</td>
                    <td className={styles.num}>{m.inQty ? qtyText(m.inQty) : ''}</td><td className={styles.num}>{m.inQty ? money(m.inValue) : ''}</td>
                    <td className={styles.num}>{m.outQty ? qtyText(m.outQty) : ''}</td><td className={styles.num}>{m.outQty ? money(m.outValue) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

/** Group-wise Stock Summary (WP-8): the stock-group tree with opening / inward / outward / closing. */
function GroupSummary({ positions, today }: { positions: Positions; today: string }) {
  const [from, setFrom] = useState(`${getIndianFY(today).startYear}-04-01`);
  const [to, setTo] = useState(today);
  const rows = useMemo(() => groupWiseSummary(positions, stockGroupsDb.all(), from, to), [positions, from, to]);
  const q = (n: number | null, unit: string | null) => (n === null ? '' : `${qtyText(n)}${unit ? ` ${unit}` : ''}`);
  const pad = (d: number) => ({ paddingLeft: `${d * 1.25}rem` });
  return (
    <>
      <div className={styles.bar} style={{ justifyContent: 'flex-start' }}>
        <label className={styles.muted}>{mfgT('from')} <input type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={styles.muted}>{mfgT('to')} <input type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {rows.length === 0 ? <p className={styles.muted}>{mfgT('noData')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mfgT('item')}</th><th className={styles.num}>{mfgT('opening')}</th><th className={styles.num}>{mfgT('inward')}</th><th className={styles.num}>{mfgT('outward')}</th><th className={styles.num}>{mfgT('closing')}</th><th className={styles.num}>{mfgT('value')}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const strong = r.kind === 'group';
                const cell = (v: string) => (strong ? <strong>{v}</strong> : v);
                return (
                  <tr key={`${r.kind}:${r.id}`}>
                    <td style={pad(r.depth)}>{cell(r.kind === 'group' && !r.id ? mfgT('noGroup') : r.name)}</td>
                    <td className={styles.num}>{cell(q(r.openingQty, r.unit))}</td>
                    <td className={styles.num}>{cell(r.inQty ? q(r.inQty, r.unit) : '')}</td>
                    <td className={styles.num}>{cell(r.outQty ? q(r.outQty, r.unit) : '')}</td>
                    <td className={cn(styles.num, (r.closingQty ?? 0) < 0 && styles.loss)}>{cell(q(r.closingQty, r.unit))}</td>
                    <td className={styles.num}>{cell(money(r.closingValue))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Ageing({ positions, today, ctx, ids }: { positions: Positions; today: string; ctx: MfgContext; ids: Set<string> | null }) {
  const [byBatch, setByBatch] = useState(false);
  const [slabText, setSlabText] = useState(AGE_BUCKETS.join(', '));
  const slabs = useMemo(() => parseAgeSlabs(slabText), [slabText]);
  const labels = ageLabels(slabs);
  const rows = useMemo(() => stockAgeing(positions, today, slabs), [positions, today, slabs]);
  const batches = useMemo(() => {
    if (!byBatch) return [];
    const tracking = computeTracking(ctx.inputs);
    return batchAgeing(ids ? new Map([...tracking].filter(([id]) => ids.has(id))) : tracking, today, slabs);
  }, [byBatch, ctx.inputs, today, slabs, ids]);
  const anyBatch = ctx.items.some((i) => i.track_batches);
  return (
    <>
      <div className={styles.bar} style={{ justifyContent: 'flex-start' }}>
        <label className={styles.muted}>{mfgT('ageSlabs')} <input className={controls.input} style={{ width: '12rem' }} value={slabText} onChange={(e) => setSlabText(e.target.value)} onBlur={() => setSlabText(slabs.join(', '))} /></label>
        {anyBatch && <label className={controls.check}><input type="checkbox" checked={byBatch} onChange={(e) => setByBatch(e.target.checked)} /> {mfgT('byBatch')}</label>}
      </div>
      {byBatch ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mfgT('item')}</th><th>{mfgT('batch')}</th><th>{mfgT('oldest')}</th><th>{mfgT('expiry')}</th><th className={styles.num}>{mfgT('quantity')}</th><th className={styles.num}>{mfgT('ageDays')}</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={`${b.itemName}|${b.batch}`}><td>{b.itemName}</td><td>{b.batch}</td><td>{b.firstIn ? formatDate(b.firstIn) : '—'}</td><td>{b.expiry ? formatDate(b.expiry) : '—'}</td><td className={styles.num}>{qtyText(b.qty)} {b.unit}</td><td className={styles.num}>{b.age < 0 ? '—' : b.age}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mfgT('item')}</th>{labels.map((l) => <th key={l} className={styles.num}>{l}</th>)}<th className={styles.num}>{mfgT('total')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.position.item.id}>
                  <td>{r.position.item.name}</td>
                  {r.qty.map((q, i) => <td key={i} className={styles.num}>{q ? <>{qtyText(q)}<div className={styles.muted}>{money(r.value[i])}</div></> : ''}</td>)}
                  <td className={styles.num}>{qtyText(r.position.qty)}<div className={styles.muted}>{money(r.position.value)}</div></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={labels.length + 2} className={styles.muted}>{mfgT('noData')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Negative({ positions }: { positions: Positions }) {
  const rows = useMemo(() => negativeStockReport(positions), [positions]);
  if (rows.length === 0) return <p className={styles.muted}>{mfgT('noNegative')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr><th>{mfgT('item')}</th><th>{mfgT('firstNegative')}</th><th className={styles.num}>{mfgT('lowest')}</th><th className={styles.num}>{mfgT('episodes')}</th><th className={styles.num}>{mfgT('current')}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.position.item.id}>
              <td>{r.position.item.name}</td><td>{formatDate(r.firstDate)} · {r.firstRef}</td>
              <td className={cn(styles.num, styles.loss)}>{qtyText(r.lowest)} ({formatDate(r.lowestDate)})</td>
              <td className={styles.num}>{r.episodes}</td>
              <td className={cn(styles.num, r.current < 0 && styles.loss)}>{qtyText(r.current)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
