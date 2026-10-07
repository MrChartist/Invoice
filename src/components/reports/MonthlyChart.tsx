import type { MonthRow } from '../../lib/sales-reports';
import { compactInr } from '../../lib/stats';
import { formatMoney } from '../../lib/utils';
import styles from './reports.module.css';

const W = 720;
const H = 260;
const PAD = { top: 14, right: 12, bottom: 30, left: 52 };

/** Pure-SVG grouped bars: this period beside the same month a year earlier. */
export function MonthlyChart({ rows, metric }: { rows: MonthRow[]; metric: 'taxable' | 'total' }) {
  if (rows.length === 0) return null;
  const cur = (r: MonthRow) => (metric === 'taxable' ? r.taxable : r.total);
  const prev = (r: MonthRow) => (metric === 'taxable' ? r.prevTaxable : r.prevTotal);

  const values = rows.flatMap((r) => [cur(r), prev(r), 0]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((max - v) / span) * innerH;
  const zero = y(0);
  const slot = innerW / rows.length;
  const barW = Math.min(slot * 0.34, 26);
  const ticks = [...new Set([max, max - span / 2, min].map((t) => Math.round(t)))];

  const summary = `Monthly sales ${metric === 'taxable' ? 'excluding GST' : 'including GST'}, this period against last year. ${rows
    .map((r) => `${r.label}: ${formatMoney(cur(r))} against ${formatMoney(prev(r))}`)
    .join('. ')}`;

  return (
    <div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swatchCur}`} />This period</span>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swatchPrev}`} />Same month last year</span>
      </div>
      <div className={styles.chartWrap}>
        <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={styles.gridLine} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className={styles.axisText} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{compactInr(t)}</text>
            </g>
          ))}
          <line className={styles.axis} x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />
          {rows.map((r, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const bar = (v: number, x: number, cls: string) => (
              <rect className={cls} x={x} y={Math.min(y(v), zero)} width={barW} height={Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1)} rx={3} />
            );
            return (
              <g key={r.month}>
                {bar(prev(r), cx - barW - 1, styles.barPrev)}
                {bar(cur(r), cx + 1, styles.barCur)}
                <text className={styles.axisText} x={cx} y={H - 10} textAnchor="middle">{r.label.split(' ')[0]}</text>
                <title>{`${r.label}: ${formatMoney(cur(r))} (last year ${formatMoney(prev(r))})`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
