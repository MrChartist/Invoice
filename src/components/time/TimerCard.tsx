import { Suspense, lazy, useState } from 'react';
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
import { useT } from '../../i18n';
import { timeT } from '../../i18n/areas/time';
import { RateSourceTag, TaskSelect, WorkTypeSelect } from './rate-ui'; // R3-B1 / B2
import { rateFor, useRateMasters } from './rate-masters';
import { svcT } from '../../i18n/areas/service-r3';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';

// R14 (PS-A4): "Who" (the timekeeper) while the `practice` pack is on.
const WhoRow = lazy(() => import('../prof/WhoRow'));

/** Start / pause / resume / stop. Stopping turns the clock into a time entry. */
export function TimerCard({ clients, prefs, onLogged }: { clients: Client[]; prefs: TimePrefs; onLogged: (message: string) => void }) {
  useT(); // re-render on a language switch (5.4)
  const { timer, now } = useTimer();
  const [clientId, setClientId] = useState('');
  const [project, setProject] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  // R3-B: task (sets project + rate), work type, and the rate the cards resolve (overwritable).
  const masters = useRateMasters();
  const [taskId, setTaskId] = useState('');
  const [workTypeId, setWorkTypeId] = useState('');
  const [typedRate, setTypedRate] = useState<number | null>(null);
  const [who, setWho] = useState<{ id?: string; rate?: number }>({});
  const task = masters.tasks.find((t) => t.id === taskId);
  const ccId = task?.cost_centre_id ?? '';
  const resolved = rateFor({ client_id: clientId || undefined, task_id: taskId || undefined, cost_centre_id: ccId || undefined, work_type_id: workTypeId || undefined }, masters, clients, prefs, { staffRate: who.rate });
  const rate = typedRate ?? resolved.rate;
  const pickTask = (id: string) => {
    setTaskId(id);
    const t = masters.tasks.find((x) => x.id === id);
    const cc = t ? masters.centres.find((c) => c.id === t.cost_centre_id) : undefined;
    if (cc) setProject(cc.name);
  };

  const start = () => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return setError(timeT('errTimerClient'));
    setError('');
    writeTimer(startTimer({
      client_id: client.id,
      client_name: client.name,
      project: project.trim() || undefined,
      description: description.trim(),
      hourly_rate: rate,
      billable: true,
      ...(taskId ? { task_id: taskId } : {}),
      ...(ccId ? { cost_centre_id: ccId } : {}),
      ...(workTypeId ? { work_type_id: workTypeId } : {}),
      ...(who.id ? { staff_id: who.id } : {}),
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
        ...(timer.task_id ? { task_id: timer.task_id } : {}),
        ...(timer.cost_centre_id ? { cost_centre_id: timer.cost_centre_id } : {}),
        ...(timer.work_type_id ? { work_type_id: timer.work_type_id } : {}),
        ...(timer.staff_id ? { staff_id: timer.staff_id } : {}),
      });
      onLogged(timeT('loggedFor', { time: formatMinutes(minutes), client: timer.client_name ?? '' }));
    } else {
      onLogged(timeT('underMinute'));
    }
    writeTimer(null);
    setProject('');
    setDescription('');
    setTaskId('');
    setTypedRate(null);
  };

  if (timer) {
    const running = timer.started_at !== null;
    return (
      <section className={surface.card} aria-label={timeT('timer')}>
        <div className={styles.timer}>
          <div className={styles.timerClock} aria-live="off">{formatElapsed(elapsedMs(timer, now))}</div>
          <div className={styles.timerMeta}>
            <strong>{timer.client_name}</strong>
            <span>{[timer.project, timer.description].filter(Boolean).join(' · ') || timeT('noDescription')}</span>
            <span className={styles.muted}>{timeT('started', { state: running ? timeT('running') : timeT('paused'), date: timer.date })}</span>
          </div>
          <div className={styles.timerActions}>
            {running ? (
              <button type="button" className={controls.btnOutline} onClick={() => writeTimer(pauseTimer(timer, Date.now()))}>
                <Pause size={16} /> {timeT('pause')}
              </button>
            ) : (
              <button type="button" className={controls.btnOutline} onClick={() => writeTimer(resumeTimer(timer, Date.now()))}>
                <Play size={16} /> {timeT('resume')}
              </button>
            )}
            <button type="button" className={controls.btnPrimary} onClick={stop}>
              <Square size={16} /> {timeT('stopLog')}
            </button>
            <button type="button" className={controls.btnGhost} onClick={() => writeTimer(null)} aria-label={timeT('discard')} title={timeT('discard')}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={surface.card} aria-label={timeT('timer')}>
      <form className={styles.timerForm} onSubmit={(e) => { e.preventDefault(); start(); }}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-client">{timeT('client')}</label>
          <ClientSelect id="tm-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-project">{timeT('project')}</label>
          <input id="tm-project" className={controls.input} value={project} onChange={(e) => setProject(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-desc">{timeT('working')}</label>
          <input id="tm-desc" className={controls.input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <TaskSelect id="tm-task" masters={masters} clientId={clientId} value={taskId} onChange={pickTask} />
        <WorkTypeSelect id="tm-wt" workTypes={masters.workTypes} value={workTypeId} onChange={setWorkTypeId} />
        {isPackOn(localDb.settings.get(), 'practice') && <Suspense fallback={null}><WhoRow value={who.id} date={todayInput()} onChange={(id, r) => setWho({ id, rate: r })} /></Suspense>}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tm-rate">{svcT('rate')} <RateSourceTag source={typedRate === null ? resolved.source : 'manual'} /></label>
          <input id="tm-rate" type="number" min={0} step="0.01" className={controls.input} value={rate || ''} onChange={(e) => setTypedRate(e.target.value === '' ? null : Math.max(Number(e.target.value) || 0, 0))} />
        </div>
        <button type="submit" className={controls.btnPrimary}>
          <Play size={16} /> {timeT('start')}
        </button>
      </form>
      {error && <p className={styles.formError} role="alert">{error}</p>}
    </section>
  );
}
