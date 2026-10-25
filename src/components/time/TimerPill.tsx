import { Link } from 'react-router-dom';
import { useTimer } from '../../hooks/useTimer';
import { elapsedMs, formatElapsed } from '../../lib/timer';
import styles from './TimerPill.module.css';
import { useT } from '../../i18n';
import { timerPillT } from '../../i18n/areas/timer';

/** Header pill shown only while a timer runs; links to the Time page. */
export function TimerPill() {
  useT(); // re-render on a language switch (5.4)
  const { timer, now } = useTimer();
  if (!timer || timer.started_at === null) return null;
  const label = [timer.client_name, timer.project].filter(Boolean).join(' · ') || timerPillT('timer');
  const elapsed = formatElapsed(elapsedMs(timer, now));
  return (
    <Link to="/time" className={styles.pill} title={timerPillT('title', { label })} aria-label={timerPillT('aria', { label, elapsed })}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.time}>{elapsed}</span>
    </Link>
  );
}
