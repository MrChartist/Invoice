import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReconIssue, Severity } from '../../lib/gst-reports';
import surface from '../../styles/surface.module.css';
import styles from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { plural } from '../../i18n/areas/plural';

const SEVERITY_KEY = { error: 'sevError', warning: 'sevWarning', info: 'sevInfo' } as const;

const ICON = { error: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const TONE: Record<Severity, string> = { error: styles.reconErr, warning: styles.reconWarn, info: '' };

/** Reconciliation banner: what will likely be rejected or mismatched, with a way to fix each. */
export function ReconBanner({ issues }: { issues: ReconIssue[] }) {
  useT();
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const blocking = errors + warnings;

  return (
    <section className={`${surface.card} ${styles.recon}`} aria-labelledby="recon-title">
      <div className={styles.reconHead}>
        <h2 id="recon-title" className={`${styles.reconTitle} ${errors ? styles.reconErr : warnings ? styles.reconWarn : styles.reconOk}`}>
          {blocking === 0 ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
          {blocking === 0
            ? gvT('reconOk')
            : gvT('reconCounts', { errors: plural(gvT, 'errorsOne', 'errorsMany', errors), warnings: plural(gvT, 'warningsOne', 'warningsMany', warnings) })}
        </h2>
        <span className={surface.sectionNote}>{gvT('reconHint')}</span>
      </div>
      {issues.length > 0 && (
        <ul className={styles.issueList}>
          {issues.map((i) => {
            const Icon = ICON[i.severity];
            return (
              <li key={i.id} className={`${styles.issue} ${styles[`issue_${i.severity}`]}`}>
                <Icon size={15} className={`${styles.issueIcon} ${TONE[i.severity]}`} aria-label={gvT(SEVERITY_KEY[i.severity])} />
                <span className={styles.issueMsg}>{i.message}</span>
                {i.link && (
                  <Link className={styles.issueLink} to={i.link}>
                    {i.linkLabel ?? gvT('fix')}
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
