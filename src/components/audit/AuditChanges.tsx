import type { AuditChange } from '../../types/audit';
import surface from '../../styles/surface.module.css';
import styles from './audit.module.css';

/** Readable before → after list for one audit row. */
export function AuditChanges({ changes }: { changes?: AuditChange[] }) {
  if (!changes || changes.length === 0) return null;
  return (
    <ul className={styles.changes} aria-label="Changes">
      {changes.map((c, i) => (
        <li key={`${c.field}-${i}`} className={styles.change}>
          <span className={styles.field}>{c.field}</span>
          <span className={styles.vals}>
            {c.from !== null && <span className={styles.from}>{c.from}</span>}
            {c.from !== null && c.to !== null && (
              <span className={styles.arrow} aria-label="changed to">
                →
              </span>
            )}
            {c.to !== null ? <span className={styles.to}>{c.to}</span> : <span className={`${styles.from} ${styles.none}`}>removed</span>}
            {c.from === null && c.to !== null && <span className={surface.srOnly}> (new)</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
