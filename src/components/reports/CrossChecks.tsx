import { AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import styles from './reports.module.css';
import { useT } from '../../i18n';
import { repT } from '../../i18n/areas/reports';

export interface CrossCheck {
  label: string;
  /** Figure on this page. */
  report: number;
  /** The same figure as the other module computes it. */
  other: number;
  /** Which module that is, e.g. "Dashboard". */
  source: string;
}

/** Shows that every headline number on this page agrees with the Dashboard / Books for the same period. */
export function CrossChecks({ checks }: { checks: CrossCheck[] }) {
  useT();
  const ok = checks.every((c) => Math.abs(c.report - c.other) <= 0.01);
  return (
    <div className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><ShieldCheck size={16} /> {repT('ccTitle')}</span>
        <span className={ok ? styles.pos : styles.neg} style={{ fontSize: '0.75rem', fontWeight: 600 }}>
          {ok ? repT('ccAllAgree') : repT('ccDiff')}
        </span>
      </div>
      <ul className={styles.checkList}>
        <li className={styles.checkHead} aria-hidden="true">
          <span>{repT('ccFigure')}</span>
          <span className={styles.checkNum}>{repT('ccThis')}</span>
          <span className={styles.checkNum}>{repT('ccElsewhere')}</span>
          <span />
        </li>
        {checks.map((c) => {
          const agree = Math.abs(c.report - c.other) <= 0.01;
          return (
            <li key={c.label} className={styles.checkRow}>
              <span>{c.label} <span className={styles.dim} style={{ display: 'inline' }}>{repT('ccVs', { source: c.source })}</span></span>
              <span className={styles.checkNum}>₹{formatMoney(c.report)}</span>
              <span className={styles.checkNum}>₹{formatMoney(c.other)}</span>
              <span className={styles.checkIcon}>
                {agree ? (
                  <CheckCircle2 size={16} color="var(--profit)" aria-label={repT('ccAgrees')} />
                ) : (
                  <AlertTriangle size={16} color="var(--loss)" aria-label={repT('ccDiffers', { amount: formatMoney(Math.abs(c.report - c.other)) })} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
