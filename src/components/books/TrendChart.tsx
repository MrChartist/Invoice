import type { TrendPoint } from '../../lib/books';
import { formatMoney } from '../../lib/utils';
import styles from './books.module.css';

const W = 640;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 30, left: 56 };

function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 10_000_000) return `${sign}${(a / 10_000_000).toFixed(1)}Cr`;
  if (a >= 100_000) return `${sign}${(a / 100_000).toFixed(1)}L`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}k`;
  return `${sign}${Math.round(a)}`;
}

/**
 * Pure-SVG grouped bars (income vs expenses) with a net-profit line.
 * Handles negative months by drawing from a shared zero baseline.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) return null;

  const values = points.flatMap((p) => [p.income, p.expenses, p.profit, 0]);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((max - v) / span) * innerH;
  const zero = y(0);
  const slot = innerW / points.length;
  const barW = Math.min(slot * 0.32, 28);
  const ticks = [max, max - span / 2, min].filter((v, i, a) => a.indexOf(v) === i);

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.left + slot * i + slot / 2).toFixed(1)},${y(p.profit).toFixed(1)}`)
    .join(' ');

  const summary = `Monthly income, expenses and net profit. ${points
    .map((p) => `${p.label}: income ${formatMoney(p.income)}, expenses ${formatMoney(p.expenses)}, profit ${formatMoney(p.profit)}`)
    .join('. ')}`;

  return (
    <div>
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swatchIncome}`} />Income</span>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swatchExpense}`} />Expenses</span>
        <span className={styles.legendItem}><span className={`${styles.swatch} ${styles.swatchProfit}`} />Net profit</span>
      </div>
      <div className={styles.chartWrap}>
        <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={styles.gridLine} x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className={styles.axisText} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {compact(t)}
              </text>
            </g>
          ))}
          <line className={styles.axis} x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero} />
          {points.map((p, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const bar = (v: number, x: number, cls: string) => (
              <rect
                className={cls}
                x={x}
                y={Math.min(y(v), zero)}
                width={barW}
                height={Math.max(Math.abs(y(v) - zero), v === 0 ? 0 : 1)}
                rx={3}
              />
            );
            return (
              <g key={p.month}>
                {bar(p.income, cx - barW - 1, styles.barIncome)}
                {bar(p.expenses, cx + 1, styles.barExpense)}
                <text className={styles.axisText} x={cx} y={H - 10} textAnchor="middle">
                  {p.label}
                </text>
                <title>{`${p.label}: income ${formatMoney(p.income)}, expenses ${formatMoney(p.expenses)}, profit ${formatMoney(p.profit)}`}</title>
              </g>
            );
          })}
          <path className={styles.profitLine} d={line} />
          {points.map((p, i) => (
            <circle
              key={p.month}
              className={styles.profitDot}
              cx={PAD.left + slot * i + slot / 2}
              cy={y(p.profit)}
              r={3.5}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
