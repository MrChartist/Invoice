/** R6-A4 Help → "What's new": every release-notes entry, newest first; items with a screen open it. */
import { useEffect, useState } from 'react';
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { WHATS_NEW } from '../../lib/whats-new';
import { formatDate } from '../../lib/utils';
import styles from './help.module.css';

/** R16-D4: "Announced, not yet in force" — Council recommendations awaiting notification (lazy, EN / HI). */
function Pending() {
  const [m, setM] = useState<typeof import('../../lib/pending-changes') | null>(null);
  useEffect(() => void import('../../lib/pending-changes').then(setM, () => undefined), []);
  const rows = m?.pendingAll() ?? [];
  return m && rows.length ? (
    <section className={styles.entry} data-whats-pending>
      <h3 className={styles.entryHead}>{m.pendingHead()}</h3>
      <p className={styles.muted}>{m.pendingLead()}</p>
      <ul className={styles.items}>{rows.map((r) => <li key={r.id}>{m.pendingLine(r)}</li>)}</ul>
    </section>
  ) : null;
}

export default function WhatsNew({ onNavigate }: { onNavigate: (href: string) => void }) {
  useT();
  const hi = getLanguage() === 'hi';
  return (
    <div className={styles.stack} data-whats-new>
      <Pending />
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
