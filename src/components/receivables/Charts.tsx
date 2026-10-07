import type { ReactNode } from 'react';
import { AGING_BUCKETS, compactMoney, niceMax, type AgingBucketLabel, type MonthRow } from '../../lib/receivables';
import { formatMoney } from '../../lib/utils';
import styles from './Charts.module.css';

const TONE = [styles.b0, styles.b1, styles.b2, styles.b3, styles.b4];

/** Coloured pill showing a bill's age; colour follows the aging bucket. */
export function AgeChip({ bucket, children }: { bucket: AgingBucketLabel; children: ReactNode }) {
  return <span className={`${styles.chip} ${TONE[AGING_BUCKETS.indexOf(bucket)]}`}>{children}</span>;
}

/** One stacked horizontal bar of the five aging buckets, with a labelled legend. */
export function AgingStack({
  buckets,
  currency,
}: {
  buckets: Record<AgingBucketLabel, number>;
  currency: string;
}) {
  const total = AGING_BUCKETS.reduce((s, b) => s + buckets[b], 0);
  return (
    <div>
      <div
        className={styles.stack}
        role="img"
        aria-label={`Outstanding by age. ${AGING_BUCKETS.map((b) => `${b}: ${formatMoney(buckets[b], currency)}`).join('; ')}`}
      >
        {AGING_BUCKETS.map((b, i) =>
          buckets[b] > 0 ? (
            <div key={b} className={`${styles.seg} ${TONE[i]}`} style={{ flexGrow: buckets[b] }} title={`${b}: ${formatMoney(buckets[b], currency)}`} />
          ) : null,
        )}
      </div>
      <ul className={styles.legend}>
        {AGING_BUCKETS.map((b, i) => (
          <li key={b} className={`${styles.legendItem} ${TONE[i]}`}>
            <span className={styles.legendLabel}><span className={styles.dot} />{b}</span>
            <span className={styles.legendValue}>{formatMoney(buckets[b], currency)}</span>
            <span className={styles.legendPct}>{total > 0 ? `${Math.round((buckets[b] / total) * 100)}% of bills` : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ShareBar({ percent }: { percent: number }) {
  return (
    <div className={styles.share} aria-hidden="true">
      <div className={styles.shareFill} style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }} />
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Grouped bars: billed vs received per month, efficiency % above each group. Plain SVG. */
export function CollectionsChart({ rows, currency }: { rows: MonthRow[]; currency: string }) {
  const W = 720, H = 280;
  const pad = { l: 52, r: 12, t: 22, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.billed - r.credited, r.received))));
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const group = iw / Math.max(rows.length, 1);
  const bw = Math.min(group * 0.34, 22);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div>
      <div className={styles.keys}>
        <span className={styles.key}><span className={styles.keyBilled} />Billed (net of credit notes)</span>
        <span className={styles.key}><span className={styles.keyReceived} />Received</span>
      </div>
      <div className={styles.chartScroll}>
        <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly billed versus received. Full figures are in the table below.">
          {ticks.map((t) => (
            <g key={t}>
              <line className={styles.grid} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text className={styles.axisText} x={pad.l - 8} y={y(t) + 4} textAnchor="end">{compactMoney(t, currency)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const cx = pad.l + group * i + group / 2;
            const billed = Math.max(r.billed - r.credited, 0);
            const [yy, mm] = r.month.split('-');
            return (
              <g key={r.month} className={styles.bar}>
                <title>{`${MONTHS[Number(mm) - 1]} ${yy}: billed ${formatMoney(billed, currency)}, received ${formatMoney(r.received, currency)}${r.efficiency !== null ? ` (${r.efficiency}%)` : ''}`}</title>
                <rect className={styles.barBilled} x={cx - bw - 1} width={bw} y={y(billed)} height={Math.max(ih - (y(billed) - pad.t), 0)} rx={2} />
                <rect className={styles.barReceived} x={cx + 1} width={bw} y={y(r.received)} height={Math.max(ih - (y(r.received) - pad.t), 0)} rx={2} />
                {r.efficiency !== null && (
                  <text className={styles.effText} x={cx} y={Math.min(y(billed), y(r.received)) - 5} textAnchor="middle">{Math.round(r.efficiency)}%</text>
                )}
                <text className={styles.axisText} x={cx} y={H - 10} textAnchor="middle">{MONTHS[Number(mm) - 1]}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
