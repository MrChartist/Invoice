/** R6-A2 "On this screen": what / when / steps / related for one help topic, with the "Verify with your CA" box. */
import { Info, ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import type { HelpTopic } from '../../lib/help/types';
import { topicTitle } from './labels';
import styles from './help.module.css';

export function ScreenHelp({ topic, loading, onNavigate, heading }: { topic: HelpTopic | null; loading?: boolean; onNavigate: (href: string) => void; heading?: string }) {
  useT();
  if (loading) return <p className={styles.muted}>{helpT('loading')}</p>;
  if (!topic) return <p className={styles.muted}>{helpT('noTopic')}</p>;
  const s = topic.statutory;
  return (
    <section className={styles.screen} aria-label={heading ?? topicTitle(topic)} data-screen-help={topic.id}>
      <h3 className={styles.screenTitle}>
        <Info size={16} aria-hidden="true" /> {heading ?? helpT('onScreen', { title: topicTitle(topic) })}
      </h3>
      <p className={styles.label}>{helpT('what')}</p>
      <p className={styles.text}>{topic.what}</p>
      <p className={styles.label}>{helpT('when')}</p>
      <p className={styles.text}>{topic.when}</p>
      {topic.steps?.length ? (
        <>
          <p className={styles.label}>{helpT('steps')}</p>
          <ol className={styles.steps}>
            {topic.steps.map((x) => <li key={x}>{x}</li>)}
          </ol>
        </>
      ) : null}
      {s && (
        <div className={styles.ca} role="note" data-help-ca>
          <ShieldAlert size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--warning)' }} />
          <span>
            <strong>{helpT('caTitle')}</strong>
            {helpT('caText')}
            {s.forms && <span className={styles.muted}> {helpT('forms', { forms: s.forms })}</span>}
            {s.due && <span className={styles.muted}> {s.due}</span>}
            {s.caItems?.length ? <span className={styles.muted} style={{ display: 'block' }}>{helpT('caItems', { ids: s.caItems.join(', ') })}</span> : null}
          </span>
        </div>
      )}
      {topic.related?.length ? (
        <>
          <p className={styles.label}>{helpT('related')}</p>
          <div className={styles.chips}>
            {topic.related.map((r) => (
              <button key={r.href} type="button" className={styles.chip} onClick={() => onNavigate(r.href)}>{r.label}</button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
