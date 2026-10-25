import type { PaymentScore } from '../../lib/payment-score';
import { cn } from '../../lib/utils';
import { colT } from '../../i18n/areas/collections';
import styles from './collections.module.css';

/** R2-A7 badge: the grade with its plain-language reasons as the tooltip (screen only, never printed). */
export function PaymentScoreBadge({ score }: { score: PaymentScore | null | undefined }) {
  if (!score) return null;
  const reasons = [...score.reasons, score.trend ? colT(`scTrend.${score.trend}`) : ''].filter(Boolean).join(' · ');
  if (!score.grade) {
    return <span className={cn(styles.grade, styles.gradeNone, 'no-print')} title={colT('scNone')} aria-label={colT('scNone')}>–</span>;
  }
  const tone = { A: styles.gradeA, B: styles.gradeB, C: styles.gradeC, D: styles.gradeD }[score.grade];
  return (
    <span className={cn(styles.grade, tone, 'no-print')} title={`${colT('scGrade', { grade: score.grade })} · ${reasons}`}
      aria-label={colT('scAria', { grade: score.grade, reasons })} data-payment-grade={score.grade}>
      {score.grade}
    </span>
  );
}

export default PaymentScoreBadge;
