import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { PreflightIssue } from '../../lib/einvoice';
import type { PreflightResult } from '../../lib/einvoice-validate';
import styles from './einvoice.module.css';
import { useT } from '../../i18n';
import { einvT } from '../../i18n/areas/einvoice';
import { plural } from '../../i18n/areas/plural';

export interface ReadinessListProps {
  result: PreflightResult;
  /** Shown when there are no issues at all. */
  okText: string;
}

function Row({ item }: { item: PreflightIssue }) {
  useT();
  const isError = item.severity === 'error';
  const Icon = isError ? XCircle : AlertTriangle;
  return (
    <li className={styles.check}>
      <Icon
        size={16}
        className={`${styles.checkIcon} ${isError ? styles.iconErr : styles.iconWarn}`}
        aria-hidden="true"
      />
      <span>
        <span className={styles.srOnly}>{isError ? einvT('blockingError') : einvT('warningPrefix')}</span>
        <span className={styles.checkField}>{item.field}</span> — {item.message}
      </span>
    </li>
  );
}

/** Errors first, then warnings; a green line when everything passes. */
export function ReadinessList({ result, okText }: ReadinessListProps) {
  useT();
  const { errors, warnings } = result;
  return (
    <div className={styles.section} aria-live="polite">
      <h3 className={styles.sectionTitle}>{einvT('readiness')}</h3>
      <div className={styles.summary}>
        <span className={errors.length ? styles.pillBad : styles.pillOk}>
          {errors.length ? einvT('blocking', { n: errors.length }) : einvT('noBlocking')}
        </span>
        <span className={warnings.length ? styles.pillWarn : styles.pill}>
          {plural(einvT, 'warningsOne', 'warningsMany', warnings.length)}
        </span>
      </div>
      {errors.length + warnings.length === 0 ? (
        <p className={styles.check}>
          <CheckCircle2 size={16} className={`${styles.checkIcon} ${styles.iconOk}`} aria-hidden="true" />
          <span>{okText}</span>
        </p>
      ) : (
        <ul className={styles.checklist}>
          {errors.map((e, i) => (
            <Row key={`e${i}-${e.code}`} item={e} />
          ))}
          {warnings.map((w, i) => (
            <Row key={`w${i}-${w.code}`} item={w} />
          ))}
        </ul>
      )}
    </div>
  );
}
