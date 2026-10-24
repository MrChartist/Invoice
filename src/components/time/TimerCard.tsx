import { useState } from 'react';
import { Pause, Play, Square, Trash2 } from 'lucide-react';
import type { Client } from '../../types/invoice';
import type { TimePrefs } from '../../types/time';
import { useTimer } from '../../hooks/useTimer';
import { elapsedMs, formatElapsed, pauseTimer, resumeTimer, startTimer, timerMinutes, writeTimer } from '../../lib/timer';
import { formatMinutes, timeDb } from '../../lib/timesheets';
import { ClientSelect } from './TimeForms';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './time.module.css';

/** Start / pause / resume / stop. Stopping turns the clock into a time entry. */
export function TimerCard({ clients, prefs, onLogged }: { clients: Client[]; prefs: TimePrefs; onLogged: (message: string) => void }) {
  const { timer, now } = useTimer();
  const [clientId, setClientId] = useState('');
  const [project, setProject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const start = () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return setError('Choose a client to start the timer.');
    setError('');
    writeTimer(startTimer({
      client_id: client.id,
      client_name: client.name,
      project: project.trim() || undefined,
      description: description.trim(),
      hourly_rate: prefs.default_rate,
      billable: true,
    }, Date.now()));
  };

  const stop = () => {
    if (!timer) return;
    const minutes = timerMinutes(timer, Date.now());
    if (minutes > 0) {
      timeDb.save({
        client_id: timer.client_id,
        client_name: timer.client_name ?? '',
        project: timer.project,
        description: timer.description ?? '',
        date: timer.date,
        minutes,
        hourly_rate: timer.hourly_rate ?? prefs.default_rate,
        billable: timer.billable !== false,
      });
      onLogged(`${formatMinutes(minutes)} logged for ${timer.client_name}`);
    } else {
      onLogged('Under a minute — nothing logged');
    }
    writeTimer(null);
    setProject('');
    setDescription('');
  };

  if (timer) {
    const running = timer.started_at !== null;
    return (
      <section className={surface.card} aria-label="Timer">
        <div className={styles.timer}>
          <div className={styles.timerClock} aria-live="off">{formatElapsed(elapsedMs(timer, now))}</div>
          <div className={styles.timerMeta}>
            <strong>{timer.client_name}</strong>
            <span>{[timer.project, timer.description].filter(Boolean).join(' · ') || 'No description'}</span>
            <span className={styles.muted}>{running ? 'Running' : 'Paused'} · started {timer.date}</span>
          </div>
          <div className={styles.timerActions}>
            {running ? (
              <button type="button" className={controls.btnOutline} onClick={() => writeTimer(pauseTimer(timer, Date.now()))}>
                <Pause size={16} /> Pause
              </button>
            ) : (
              <button type="button" className={controls.btnOutline} onClick={() => writeTimer(resumeTimer(timer, Date.now()))}>
                <Play size={16} /> Resume
              </button>
            )}
            <button type="button" className={controls.btnPrimary} onClick={stop}>
              <Square size={16} /> Stop &amp; log
            </button>
            <button type="button" className={controls.btnGhost} onClick={() => writeTimer(null)} aria-label="Discard timer" title="Discard timer">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={surface.card} aria-label="Timer">
      <form className={styles.timerForm} onSubmit={(e) => { e.preventDefault(); start(); }}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-client">Client</label>
          <ClientSelect id="tm-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-project">Project</label>
          <input id="tm-project" className={controls.input} value={project} onChange={(e) => setProject(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-desc">What are you working on?</label>
          <input id="tm-desc" className={controls.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button type="submit" className={controls.btnPrimary}>
          <Play size={16} /> Start timer
        </button>
      </form>
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </section>
  );
}
