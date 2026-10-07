import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReconIssue, Severity } from '../../lib/gst-reports';
import surface from '../../styles/surface.module.css';
import styles from './gst-reports.module.css';

const ICON = { error: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const TONE: Record<Severity, string> = { error: styles.reconErr, warning: styles.reconWarn, info: '' };

/** Reconciliation banner: what will likely be rejected or mismatched, with a way to fix each. */
export function ReconBanner({ issues }: { issues: ReconIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const blocking = errors + warnings;

  return (
    <section className={`${surface.card} ${styles.recon}`} aria-labelledby="recon-title">
      <div className={styles.reconHead}>
        <h2 id="recon-title" className={`${styles.reconTitle} ${errors ? styles.reconErr : warnings ? styles.reconWarn : styles.reconOk}`}>
          {blocking === 0 ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
          {blocking === 0
            ? 'Reconciliation: no mismatches found'
            : `Reconciliation: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}
        </h2>
        <span className={surface.sectionNote}>Fix these in the source documents, then reopen this page.</span>
      </div>
      {issues.length > 0 && (
        <ul className={styles.issueList}>
          {issues.map((i) => {
            const Icon = ICON[i.severity];
            return (
              <li key={i.id} className={`${styles.issue} ${styles[`issue_${i.severity}`]}`}>
                <Icon size={15} className={`${styles.issueIcon} ${TONE[i.severity]}`} aria-label={i.severity} />
                <span className={styles.issueMsg}>{i.message}</span>
                {i.link && (
                  <Link className={styles.issueLink} to={i.link}>
                    {i.linkLabel ?? 'Fix'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
