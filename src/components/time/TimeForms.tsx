import { useState } from 'react';
import type { Client } from '../../types/invoice';
import type { MileageEntry, TimeEntry, TimePrefs } from '../../types/time';
import { formatMinutes, mileageDb, parseDuration, timeDb } from '../../lib/timesheets';
import { todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentres';
import { matchCostCentre } from '../../lib/cost-centres';
import controls from '../../styles/controls.module.css';
import styles from './time.module.css';
import { useT } from '../../i18n';
import { timeT } from '../../i18n/areas/time';
import { RateSourceTag, TaskSelect, WorkTypeSelect, rateFor, useRateMasters } from './rate-ui'; // R3-B1 / B2

/** Client dropdown over CRM rows with an id (billing links by id). */
export function ClientSelect({ id, clients, value, onChange }: {
  id: string;
  clients: Client[];
  value: string;
  onChange: (clientId: string) => void;
}) {
  return (
    <select id={id} className={controls.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{timeT('chooseClient')}</option>
      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

const nameOf = (clients: Client[], id: string) => clients.find((c) => c.id === id)?.name ?? '';

export function EntryModal({ open, entry, clients, prefs, onClose, onSaved }: {
  open: boolean;
  entry?: TimeEntry | null;
  clients: Client[];
  prefs: TimePrefs;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal open={open} onClose={onClose} size="md" title={entry ? timeT('editEntryTitle') : timeT('addEntryTitle')}>
      <EntryForm key={entry?.id ?? 'new'} entry={entry ?? undefined} clients={clients} prefs={prefs} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function EntryForm({ entry, clients, prefs, onClose, onSaved }: {
  entry?: TimeEntry;
  clients: Client[];
  prefs: TimePrefs;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [clientId, setClientId] = useState(entry?.client_id ?? '');
  const [project, setProject] = useState(entry?.project ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [date, setDate] = useState(entry?.date ?? todayInput());
  const [duration, setDuration] = useState(entry ? `${Math.floor(entry.minutes / 60)}:${String(Math.round(entry.minutes % 60)).padStart(2, '0')}` : '');
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const centres = useCostCentres();
  const [costCentre, setCostCentre] = useState<string | undefined>(entry?.cost_centre_id ?? matchCostCentre(entry?.project, centres));
  const [error, setError] = useState('');
  // R3-B1 / B2: task + work type; a new entry takes the rate the cards resolve until a rate is typed.
  // An existing entry keeps its captured rate (shown as typed) — "Re-rate unbilled" is the bulk way.
  const masters = useRateMasters();
  const [taskId, setTaskId] = useState(entry?.task_id ?? '');
  const [workTypeId, setWorkTypeId] = useState(entry?.work_type_id ?? '');
  const [typedRate, setTypedRate] = useState<number | null>(entry ? entry.hourly_rate : null);
  const resolved = rateFor({ client_id: clientId || entry?.client_id, task_id: taskId || undefined, cost_centre_id: costCentre, work_type_id: workTypeId || undefined }, masters, clients, prefs);
  const rate = typedRate ?? resolved.rate;
  const setRate = (v: number) => setTypedRate(v);
  const pickTask = (id: string) => {
    setTaskId(id);
    const t = masters.tasks.find((x) => x.id === id);
    if (!t) return;
    setCostCentre(t.cost_centre_id);
    const cc = centres.find((c) => c.id === t.cost_centre_id);
    if (cc && !project.trim()) setProject(cc.name);
  };

  const submit = () => {
    const minutes = parseDuration(duration);
    if (!clientId && !entry?.client_name) return setError(timeT('errClient'));
    if (!date) return setError(timeT('errDate'));
    if (!Number.isFinite(minutes) || minutes <= 0) return setError(timeT('errTime'));
    timeDb.save({
      ...entry,
      client_id: clientId || entry?.client_id,
      client_name: nameOf(clients, clientId) || entry?.client_name || '',
      project: project.trim() || undefined,
      description: description.trim(),
      date,
      minutes,
      hourly_rate: Math.max(Number(rate) || 0, 0),
      billable,
      cost_centre_id: costCentre,
      task_id: taskId || undefined,
      work_type_id: workTypeId || undefined,
    });
    onSaved(entry ? timeT('entryUpdated') : timeT('logged', { time: formatMinutes(minutes) }));
    onClose();
  };

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-client">{timeT('client')}</label>
          <ClientSelect id="te-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-project">{timeT('projectOpt')}</label>
          <input id="te-project" className={controls.input} value={project} onChange={(e) => setProject(e.target.value)} />
        </div>
      </div>
      <CostCentreSelect
        id="te-cost-centre"
        label={timeT('costCentre')}
        centres={centres}
        value={costCentre}
        onChange={(v) => {
          setCostCentre(v);
          // Picking a project fills an empty project label with its name.
          const c = centres.find((x) => x.id === v);
          if (c?.kind === 'project' && !project.trim()) setProject(c.name);
        }}
        hint={timeT('ccHint')}
      />
      <div className={controls.row}>
        <TaskSelect id="te-task" masters={masters} clientId={clientId} value={taskId} onChange={pickTask} />
        <WorkTypeSelect id="te-wt" workTypes={masters.workTypes} value={workTypeId} onChange={setWorkTypeId} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="te-desc">{timeT('description')}</label>
        <input id="te-desc" className={controls.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={timeT('descPh')} />
      </div>
      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-date">{timeT('date')}</label>
          <input id="te-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-dur">{timeT('duration')}</label>
          <input id="te-dur" className={controls.input} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1:30" autoFocus />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-rate">{timeT('ratePerHour')} <RateSourceTag source={typedRate === null ? resolved.source : 'manual'} /></label>
          <input id="te-rate" type="number" min={0} step="0.01" className={controls.input} value={rate || ''} onChange={(e) => setRate(Number(e.target.value) || 0)} />
        </div>
      </div>
      <label className={controls.check}>
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
        {timeT('billable')}
      </label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{timeT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{entry ? timeT('saveChanges') : timeT('addEntry')}</button>
      </div>
    </form>
  );
}

export function MileageModal({ open, trip, clients, prefs, onClose, onSaved }: {
  open: boolean;
  trip?: MileageEntry | null;
  clients: Client[];
  prefs: TimePrefs;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal open={open} onClose={onClose} size="md" title={trip ? timeT('editTripTitle') : timeT('logTripTitle')}>
      <MileageForm key={trip?.id ?? 'new'} trip={trip ?? undefined} clients={clients} prefs={prefs} onClose={onClose} onSaved={onSaved} />
    </Modal>
  );
}

function MileageForm({ trip, clients, prefs, onClose, onSaved }: {
  trip?: MileageEntry;
  clients: Client[];
  prefs: TimePrefs;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [clientId, setClientId] = useState(trip?.client_id ?? '');
  const [date, setDate] = useState(trip?.date ?? todayInput());
  const [from, setFrom] = useState(trip?.from ?? '');
  const [to, setTo] = useState(trip?.to ?? '');
  const [purpose, setPurpose] = useState(trip?.purpose ?? '');
  const [km, setKm] = useState(trip?.km ?? 0);
  const [rate, setRate] = useState(trip?.rate_per_km ?? prefs.mileage_rate);
  const centres = useCostCentres();
  const [costCentre, setCostCentre] = useState<string | undefined>(trip?.cost_centre_id);
  const [error, setError] = useState('');

  const submit = () => {
    if (!clientId && !trip?.client_name) return setError(timeT('errClient'));
    if (!date) return setError(timeT('errDate'));
    if (!(km > 0)) return setError(timeT('errKm'));
    mileageDb.save({
      ...trip,
      client_id: clientId || trip?.client_id,
      client_name: nameOf(clients, clientId) || trip?.client_name || '',
      date,
      from: from.trim(),
      to: to.trim(),
      purpose: purpose.trim(),
      km,
      rate_per_km: Math.max(Number(rate) || 0, 0),
      cost_centre_id: costCentre,
    });
    onSaved(trip ? timeT('tripUpdated') : timeT('kmLogged', { n: km }));
    onClose();
  };

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-client">{timeT('client')}</label>
          <ClientSelect id="mi-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-date">{timeT('date')}</label>
          <input id="mi-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-from">{timeT('from')}</label>
          <input id="mi-from" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-to">{timeT('to')}</label>
          <input id="mi-to" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="mi-purpose">{timeT('purpose')}</label>
        <input id="mi-purpose" className={controls.input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={timeT('purposePh')} />
      </div>
      <CostCentreSelect id="mi-cost-centre" label={timeT('costCentre')} centres={centres} value={costCentre} onChange={setCostCentre} />
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-km">{timeT('distance')}</label>
          <input id="mi-km" type="number" min={0} step="0.1" className={controls.input} value={km || ''} onChange={(e) => setKm(Math.max(Number(e.target.value) || 0, 0))} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-rate">{timeT('ratePerKm')}</label>
          <input id="mi-rate" type="number" min={0} step="0.01" className={controls.input} value={rate || ''} onChange={(e) => setRate(Number(e.target.value) || 0)} />
        </div>
      </div>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{timeT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{trip ? timeT('saveChanges') : timeT('logTrip')}</button>
      </div>
    </form>
  );
}
