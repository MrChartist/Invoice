import { Link } from 'react-router-dom';
import { useTimer } from '../../hooks/useTimer';
import { elapsedMs, formatElapsed } from '../../lib/timer';
import styles from './TimerPill.module.css';

/** Header pill shown only while a timer runs; links to the Time page. */
export function TimerPill() {
  const { timer, now } = useTimer();
  if (!timer || timer.started_at === null) return null;
  const label = [timer.client_name, timer.project].filter(Boolean).join(' · ') || 'Timer';
  const elapsed = formatElapsed(elapsedMs(timer, now));
  return (
    <Link to="/time" className={styles.pill} title={`Timer running: ${label}`} aria-label={`Timer running for ${label}, ${elapsed}. Open Time.`}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.time}>{elapsed}</span>
    </Link>
  );
}
