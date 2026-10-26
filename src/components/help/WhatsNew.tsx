/** R6-A4 Help → "What's new": every release-notes entry, newest first; items with a screen open it. */
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { WHATS_NEW } from '../../lib/whats-new';
import { formatDate } from '../../lib/utils';
import styles from './help.module.css';

export default function WhatsNew({ onNavigate }: { onNavigate: (href: string) => void }) {
  useT();
  const hi = getLanguage() === 'hi';
  return (
    <div className={styles.stack} data-whats-new>
      {WHATS_NEW.map((e) => (
        <section key={e.version} className={styles.entry} aria-label={`${e.version} ${e.label}`}>
          <h3 className={styles.entryHead}>
            <span>{helpT('versionLabel', { v: e.version })} · {e.label}</span>
            <span className={styles.entryDate}>{formatDate(e.date)}</span>
          </h3>
          <ul className={styles.items}>
            {e.items.map((it) => (
              <li key={it.title}>
                {it.href ? (
                  <button type="button" className={styles.chip} onClick={() => onNavigate(it.href!)}>{hi ? it.hi : it.title}</button>
                ) : (
                  <strong>{hi ? it.hi : it.title}</strong>
                )}
                {it.text && <span className={styles.muted} style={{ display: 'block' }}>{it.text}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
