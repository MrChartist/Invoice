import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { StockPosition } from '../../lib/inventory';
import { abcAnalysis, abcSummary, movingAnalysis, type MoveClass } from '../../lib/stock-analysis';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { skT } from '../../i18n/areas/stock-depth';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

const CLS: Record<MoveClass, 'clsFast' | 'clsSlow' | 'clsNon'> = { fast: 'clsFast', slow: 'clsSlow', non: 'clsNon' };

/** 8.83: fast / slow / non-moving and ABC analysis for a period (from the stock ledger). */
export default function StockAnalysisTab({ positions, from, to }: { positions: StockPosition[]; from: string; to: string }) {
  useT();
  const [view, setView] = useState<'moving' | 'abc'>('moving');
  const [fast, setFast] = useState(6);
  const [a, setA] = useState(70);
  const [b, setB] = useState(90);
  const [only, setOnly] = useState<'' | MoveClass>('');
  const period = useMemo(() => ({ from, to }), [from, to]);
  const moving = useMemo(() => movingAnalysis(positions, period, fast), [positions, period, fast]);
  const abc = useMemo(() => abcAnalysis(positions, period, a, Math.max(b, a)), [positions, period, a, b]);
  const summary = abcSummary(abc);
  const shown = only ? moving.filter((r) => r.cls === only) : moving;

  const csv = () => {
    if (view === 'moving') {
      downloadText(`movement-class-${from}-${to}.csv`, toCsv([
        [skT('csvMoving', { from, to })],
        [skT('item'), skT('class'), skT('outQty'), skT('outValue'), skT('closingQty'), skT('closingValue'), skT('turnover'), skT('daysCover'), skT('lastOut')],
        ...moving.map((r) => [r.name, skT(CLS[r.cls]), r.outQty, r.outValue, r.closingQty, r.closingValue, r.turnover, r.daysCover ?? '', r.lastOut]),
      ]), 'text/csv');
    } else {
      downloadText(`abc-${from}-${to}.csv`, toCsv([
        [skT('csvAbc', { from, to })],
        [skT('item'), skT('class'), skT('outValue'), skT('share'), skT('cumulative')],
        ...abc.map((r) => [r.name, r.cls, r.outValue, r.share, r.cumulative]),
      ]), 'text/csv');
    }
  };

  return (
    <div className={own.stack} data-stock-analysis>
      <div className={own.row}>
        <div className={controls.segment} role="tablist" aria-label={skT('analysis')}>
          <button type="button" role="tab" aria-selected={view === 'moving'} className={view === 'moving' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('moving')}>{skT('moving')}</button>
          <button type="button" role="tab" aria-selected={view === 'abc'} className={view === 'abc' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('abc')}>{skT('abc')}</button>
        </div>
        {view === 'moving' ? (
          <>
            <label className={controls.field}><span className={controls.label}>{skT('fastTurns')}</span>
              <input type="number" min={1} className={controls.input} value={fast} onChange={(e) => setFast(Math.max(Number(e.target.value) || 1, 1))} /></label>
            <label className={controls.field}><span className={controls.label}>{skT('show')}</span>
              <select className={controls.select} value={only} onChange={(e) => setOnly(e.target.value as '' | MoveClass)}>
                <option value="">{skT('all')}</option>
                <option value="fast">{skT('clsFast')}</option>
                <option value="slow">{skT('clsSlow')}</option>
                <option value="non">{skT('clsNon')}</option>
              </select></label>
          </>
        ) : (
          <>
            <label className={controls.field}><span className={controls.label}>{skT('cutA')}</span>
              <input type="number" min={1} max={99} className={controls.input} value={a} onChange={(e) => setA(Math.min(Math.max(Number(e.target.value) || 70, 1), 99))} /></label>
            <label className={controls.field}><span className={controls.label}>{skT('cutB')}</span>
              <input type="number" min={2} max={100} className={controls.input} value={b} onChange={(e) => setB(Math.min(Math.max(Number(e.target.value) || 90, 2), 100))} /></label>
          </>
        )}
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={csv}><Download size={14} aria-hidden="true" /> CSV</button>
      </div>
      <p className={own.muted}>{view === 'moving' ? skT('movingIntro') : skT('abcIntro')}</p>
      {view === 'abc' && (
        <p className={own.muted} data-abc-summary>
          {(['A', 'B', 'C'] as const).map((c) => skT('abcLine', { cls: c, n: summary[c].items, value: formatCurrency(summary[c].value) })).join(' · ')}
        </p>
      )}
      <div className={own.tableWrap}>
        {view === 'moving' ? (
          <table className={own.table}>
            <thead><tr><th>{skT('item')}</th><th>{skT('class')}</th><th className={own.num}>{skT('outQty')}</th><th className={own.num}>{skT('outValue')}</th><th className={own.num}>{skT('closingQty')}</th><th className={own.num}>{skT('turnover')}</th><th className={own.num}>{skT('daysCover')}</th><th>{skT('lastOut')}</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.itemId} data-move-class={r.cls}>
                  <td>{r.name}</td><td><span className={own.chip}>{skT(CLS[r.cls])}</span></td>
                  <td className={own.num}>{r.outQty} {r.unit}</td><td className={own.num}>{formatCurrency(r.outValue)}</td>
                  <td className={own.num}>{r.closingQty}</td><td className={own.num}>{r.turnover >= 999 ? '∞' : r.turnover}</td>
                  <td className={own.num}>{r.daysCover ?? '—'}</td><td>{r.lastOut || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className={own.table}>
            <thead><tr><th>{skT('item')}</th><th>{skT('class')}</th><th className={own.num}>{skT('outValue')}</th><th className={own.num}>{skT('share')}</th><th className={own.num}>{skT('cumulative')}</th></tr></thead>
            <tbody>
              {abc.map((r) => (
                <tr key={r.itemId} data-abc={r.cls}>
                  <td>{r.name}</td><td><span className={own.chip}>{r.cls}</span></td><td className={own.num}>{formatCurrency(r.outValue)}</td>
                  <td className={own.num}>{r.share}%</td><td className={own.num}>{r.cumulative}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
