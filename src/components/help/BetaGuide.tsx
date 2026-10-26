/** R6-A6 Help → "Beta guide": the tester guide from `lib/help/beta-guide.ts` (a copy of docs/BETA_GUIDE.md). */
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { BETA_GUIDE } from '../../lib/help/beta-guide';
import styles from './help.module.css';

export default function BetaGuide({ onNavigate, onReport }: { onNavigate: (href: string) => void; onReport: () => void }) {
  useT();
  const hi = getLanguage() === 'hi';
  return (
    <article className={styles.stack} data-beta-guide>
      {BETA_GUIDE.map((s) => (
        <section key={s.heading} className={styles.entry}>
          <h3 className={styles.entryHead}>{hi ? s.hiHeading : s.heading}</h3>
          {s.lines.map((l) => <p key={l} className={styles.text}>{l}</p>)}
          {s.links?.length ? (
            <div className={styles.chips}>
              {s.links.map((l) => (
                <button key={l.href} type="button" className={styles.chip} onClick={() => onNavigate(l.href)}>{helpT('open')}: {l.label}</button>
              ))}
            </div>
          ) : null}
          {s.report && (
            <div className={styles.chips}>
              <button type="button" className={styles.chip} onClick={onReport}>{helpT('guideReport')}</button>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}
