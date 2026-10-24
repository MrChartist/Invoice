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

/** Client dropdown over CRM rows with an id (billing links by id). */
export function ClientSelect({ id, clients, value, onChange }: {
  id: string;
  clients: Client[];
  value: string;
  onChange: (clientId: string) => void;
}) {
  return (
    <select id={id} className={controls.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a client…</option>
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
  return (
    <Modal open={open} onClose={onClose} size="md" title={entry ? 'Edit time entry' : 'Add time entry'}>
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
  const [rate, setRate] = useState(entry?.hourly_rate ?? prefs.default_rate);
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const centres = useCostCentres();
  const [costCentre, setCostCentre] = useState<string | undefined>(entry?.cost_centre_id ?? matchCostCentre(entry?.project, centres));
  const [error, setError] = useState('');

  const submit = () => {
    const minutes = parseDuration(duration);
    if (!clientId && !entry?.client_name) return setError('Choose a client.');
    if (!date) return setError('Choose the date.');
    if (!Number.isFinite(minutes) || minutes <= 0) return setError('Enter the time worked, e.g. 1:30, 1.5 or 90m.');
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
    });
    onSaved(entry ? 'Time entry updated' : `${formatMinutes(minutes)} logged`);
    onClose();
  };

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-client">Client</label>
          <ClientSelect id="te-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-project">Project (optional)</label>
          <input id="te-project" className={controls.input} value={project} onChange={(e) => setProject(e.target.value)} />
        </div>
      </div>
      <CostCentreSelect
        id="te-cost-centre"
        label="Cost centre"
        centres={centres}
        value={costCentre}
        onChange={(v) => {
          setCostCentre(v);
          // Picking a project fills an empty project label with its name.
          const c = centres.find((x) => x.id === v);
          if (c?.kind === 'project' && !project.trim()) setProject(c.name);
        }}
        hint="Billed lines carry it to the invoice for the project P&L."
      />
      <div className={controls.field}>
        <label className={controls.label} htmlFor="te-desc">Description</label>
        <input id="te-desc" className={controls.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Research report" />
      </div>
      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-date">Date</label>
          <input id="te-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-dur">Time (h:mm)</label>
          <input id="te-dur" className={controls.input} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1:30" autoFocus />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="te-rate">Rate / hour</label>
          <input id="te-rate" type="number" min={0} step="0.01" className={controls.input} value={rate || ''} onChange={(e) => setRate(Number(e.target.value) || 0)} />
        </div>
      </div>
      <label className={controls.check}>
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
        Billable
      </label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{entry ? 'Save changes' : 'Add entry'}</button>
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
  return (
    <Modal open={open} onClose={onClose} size="md" title={trip ? 'Edit trip' : 'Log a trip'}>
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
    if (!clientId && !trip?.client_name) return setError('Choose a client.');
    if (!date) return setError('Choose the date.');
    if (!(km > 0)) return setError('Enter the distance in km.');
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
    onSaved(trip ? 'Trip updated' : `${km} km logged`);
    onClose();
  };

  return (
    <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-client">Client</label>
          <ClientSelect id="mi-client" clients={clients} value={clientId} onChange={setClientId} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-date">Date</label>
          <input id="mi-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-from">From</label>
          <input id="mi-from" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-to">To</label>
          <input id="mi-to" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="mi-purpose">Purpose</label>
        <input id="mi-purpose" className={controls.input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Site visit" />
      </div>
      <CostCentreSelect id="mi-cost-centre" label="Cost centre" centres={centres} value={costCentre} onChange={setCostCentre} />
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-km">Distance (km)</label>
          <input id="mi-km" type="number" min={0} step="0.1" className={controls.input} value={km || ''} onChange={(e) => setKm(Math.max(Number(e.target.value) || 0, 0))} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="mi-rate">Rate per km</label>
          <input id="mi-rate" type="number" min={0} step="0.01" className={controls.input} value={rate || ''} onChange={(e) => setRate(Number(e.target.value) || 0)} />
        </div>
      </div>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{trip ? 'Save changes' : 'Log trip'}</button>
      </div>
    </form>
  );
}
