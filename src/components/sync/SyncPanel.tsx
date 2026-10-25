import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FolderOpen, FolderSync, KeyRound, RefreshCw, Unplug } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { verifyPin } from '../../lib/auth';
import { companySyncPrefs, setCompanySyncPrefs, setDeviceName, syncDevice } from '../../lib/sync-device';
import {
  connectSync,
  devicePrefix,
  disconnectSync,
  getSyncConfig,
  isSyncSupported,
  pickSyncFolder,
  runSyncNow,
  suggestGroupName,
  syncOverview,
  type SyncConfig,
} from '../../lib/sync-folder';
import { GROUP_RE, type SyncDir } from '../../lib/sync-files';
import { resolveConflict, tableLabel, type RowConflict, type SyncConflict, type SyncReport } from '../../lib/sync-engine';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Sync.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

const when = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString('en-IN') : 'never');

function describeRow(key: string, v: unknown): string {
  if (!v || typeof v !== 'object') return 'deleted';
  const r = v as Record<string, unknown>;
  const client = (r.client as { name?: string } | undefined)?.name;
  const parts = [r.invoice_number, r.bill_number, r.number, r.name, r.vendor_name, client, r.title]
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  const head = [...new Set(parts)].slice(0, 2).join(' · ');
  const total = typeof r.total === 'number' ? ` · ${r.total.toLocaleString('en-IN')}` : '';
  return head ? `${head}${total}` : `${tableLabel(key)} ${String(r.id ?? '')}`;
}

/** Top-level fields that differ between the two versions (a hint, not a full diff). */
function changedFields(a: unknown, b: unknown): { field: string; mine: string; theirs: string }[] {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [];
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const show = (v: unknown) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
    return s.length > 40 ? `${s.slice(0, 39)}…` : s;
  };
  return [...new Set([...Object.keys(x), ...Object.keys(y)])]
    .filter((k) => k !== 'updated_at' && JSON.stringify(x[k]) !== JSON.stringify(y[k]))
    .slice(0, 6)
    .map((k) => ({ field: k, mine: show(x[k]), theirs: show(y[k]) }));
}

function ConflictItem({ c, onResolve }: { c: SyncConflict; onResolve: (id: string, choice: 'mine' | 'theirs' | 'ack', override?: boolean) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  if (c.kind === 'duplicate') {
    return (
      <li className={styles.item}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{tableLabel(c.key)}: number {c.number} is used by {c.ids.length} documents</span>
          <span className={styles.meta}>found {when(c.at)}</span>
        </div>
        <ul className={styles.diff}>
          {c.docs.map((d) => (
            <li key={d.id}>
              {c.key.endsWith('_invoices') ? <Link to={`/invoice/${d.id}`}>{d.number || d.id}</Link> : d.number || d.id} · {d.client || '—'} · {d.date} · {d.total.toLocaleString('en-IN')}
              {d.device ? ` · from ${d.device}` : ''}
            </li>
          ))}
        </ul>
        <p className={controls.hint}>Issued numbers are never changed automatically. Renumber the one issued by mistake (or cancel it and issue a credit note), then mark this reviewed.</p>
        <div className={styles.buttons}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(c.id, 'ack')}>Mark reviewed</button>
        </div>
      </li>
    );
  }
  const rc = c as RowConflict;
  const isRow = rc.kind === 'row';
  const title = isRow ? `${tableLabel(rc.key)}: ${describeRow(rc.key, rc.local.value ?? rc.remote.value)}` : `${tableLabel(rc.key)} (setting)`;
  const reason =
    rc.reason === 'locked'
      ? isRow
        ? `${rc.device_name || 'Another device'} changed a document in a locked period. It was not applied.`
        : `${rc.device_name || 'Another device'} moved the period lock earlier or removed it. It was not applied.`
      : rc.reason === 'lww'
        ? `Changed on this device and on ${rc.device_name || 'another device'} at the same time. The ${rc.applied === 'remote' ? `version from ${rc.device_name}` : "this device's version"} is in use.`
        : `Changed on this device and on ${rc.device_name || 'another device'} since the last sync. This device's version is kept.`;
  const diff = isRow ? changedFields(rc.local.value, rc.remote.value) : [];
  const theirsLabel = rc.remote.value === null ? 'Delete it (theirs)' : `Use ${rc.device_name || 'their'} version`;
  const mineLabel = rc.local.value === null ? (rc.local.meta ? 'Keep it deleted' : 'Leave it out') : 'Keep mine';

  const applyLocked = async () => {
    if (!(await verifyPin(pin))) {
      setPinError('Wrong PIN.');
      return;
    }
    setPinError('');
    await onResolve(rc.id, 'theirs', true);
  };

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>{title}</span>
        <span className={styles.meta}>found {when(rc.at)}</span>
      </div>
      <span className={styles.meta}>{reason}</span>
      {rc.local.value === null && isRow && <span className={styles.meta}>This device: {rc.local.meta ? 'deleted' : 'not present'}.</span>}
      {rc.remote.value === null && isRow && <span className={styles.meta}>{rc.device_name || 'Other device'}: deleted.</span>}
      {diff.length > 0 && (
        <ul className={styles.diff}>
          {diff.map((d) => (
            <li key={d.field}>
              <b>{d.field}</b>: mine {d.mine} → theirs {d.theirs}
            </li>
          ))}
        </ul>
      )}
      {rc.reason === 'locked' ? (
        <div className={styles.buttons}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(rc.id, 'mine')}>
            {mineLabel} (keep my books)
          </button>
          <input
            type="password"
            inputMode="numeric"
            className={`${controls.input} ${styles.pin}`}
            aria-label="PIN to apply a change in a locked period"
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={pin.length < 4} onClick={() => void applyLocked()}>
            <KeyRound size={14} aria-hidden="true" /> Apply with PIN
          </button>
          {pinError && <span className={controls.error} role="alert">{pinError}</span>}
        </div>
      ) : (
        <div className={styles.buttons}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(rc.id, 'mine')}>{mineLabel}</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(rc.id, 'theirs')}>{theirsLabel}</button>
        </div>
      )}
    </li>
  );
}

interface SetupState {
  handle: SyncDir;
  groups: string[];
  mode: 'join' | 'create';
  group: string;
}

/**
 * Settings → Data & backup → Sync folder (roadmap 5.7). Lazily loaded with the sync code.
 */
export function SyncPanel({ notify }: { notify?: Notify }) {
  const supported = isSyncSupported();
  const [config, setConfig] = useState<SyncConfig | null | undefined>(undefined);
  const [overview, setOverview] = useState(() => syncOverview());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [name, setName] = useState(() => syncDevice().name);
  const [prefs, setPrefs] = useState(() => companySyncPrefs());
  const settings = useMemo(() => localDb.settings.get(), []);

  const refresh = useCallback(() => {
    setOverview(syncOverview());
    setPrefs(companySyncPrefs());
  }, []);

  useEffect(() => {
    let alive = true;
    void getSyncConfig().then((c) => alive && setConfig(c));
    return () => {
      alive = false;
    };
  }, []);

  const report = (r: SyncReport) => {
    refresh();
    if (r.ok) {
      setError(null);
      const moved = r.added + r.updated + r.deleted;
      notify?.(
        `Synced${r.peers ? ` with ${r.peers} device${r.peers === 1 ? '' : 's'}` : ''}: ${moved ? `${moved} change${moved === 1 ? '' : 's'} applied` : 'up to date'}${r.newConflicts ? `, ${r.newConflicts} to review` : ''}.`,
        r.newConflicts ? 'info' : 'success',
      );
    } else if (r.message) {
      setError(r.message);
      if (r.reason !== 'permission') notify?.(r.message, 'error');
    }
  };

  const syncNow = async () => {
    setBusy(true);
    try {
      report(await runSyncNow({ interactive: true }));
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    setError(null);
    const r = await pickSyncFolder();
    if (!r.ok) {
      if (r.reason !== 'cancelled') setError(r.message || 'Could not open that folder.');
      return;
    }
    const company = localDb.settings.activeProfile()?.companyName || 'my books';
    setSetup({ handle: r.handle, groups: r.groups, mode: r.groups.length ? 'join' : 'create', group: r.groups[0] ?? suggestGroupName(company) });
  };

  const turnOn = async () => {
    if (!setup) return;
    if (setup.mode === 'create' && pass !== pass2) return setError('The two passphrases do not match.');
    if (!GROUP_RE.test(setup.group)) return setError('Use 2–40 lower-case letters, digits or dashes for the group name.');
    setBusy(true);
    setDeviceName(name);
    const r = await connectSync({ handle: setup.handle, group: setup.group, passphrase: pass });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setPass('');
    setPass2('');
    setSetup(null);
    setConfig(await getSyncConfig());
    notify?.(r.created ? 'Sync group created. Set up your other devices with the same folder and passphrase.' : 'Joined the sync group.', 'success');
    report(r.report);
  };

  const turnOff = async () => {
    if (!window.confirm('Stop syncing this company on this device? Files in the folder and other devices are not touched; conflicts stay listed.')) return;
    await disconnectSync();
    setConfig(null);
    refresh();
    notify?.('Sync turned off on this device', 'info');
  };

  const onResolve = async (id: string, choice: 'mine' | 'theirs' | 'ack', override = false) => {
    const d = syncDevice();
    const r = await resolveConflict(id, choice, { id: d.id, name: d.name }, { override });
    if (!r.ok) setError(r.message ?? 'Could not resolve that conflict.');
    else {
      setError(null);
      notify?.('Conflict resolved. Other devices pick it up at their next sync.', 'success');
    }
    refresh();
  };

  const { state, conflicts, shared, self } = overview;
  const peers = Object.entries(state.peers).filter(([id]) => id !== self);
  const myPrefix = config ? devicePrefix() : '';
  const samePrefix = peers.filter(([, p]) => p.status === 'ok' && p.prefix && p.prefix === myPrefix).map(([, p]) => p.name);
  const last = state.last_report;

  return (
    <section className={surface.card} aria-labelledby="sync-title">
      <header className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="sync-title">
          <FolderSync size={16} aria-hidden="true" /> Sync folder
        </span>
      </header>
      <div className={`${surface.cardBody} ${styles.body}`}>
        {!supported ? (
          <p className={controls.hint} data-testid="sync-unsupported">
            Folder sync is not supported in this browser. It needs Chrome or Edge on a computer (File System Access). To move your
            data to another device, download a backup here and restore it there.
          </p>
        ) : config === undefined ? null : !config ? (
          <>
            <p className={controls.hint}>
              Keep this company in step across your computers through a folder your cloud app already syncs (Google Drive, Dropbox,
              OneDrive or iCloud for desktop). The app only reads and writes encrypted files in that folder; your cloud app moves
              them. Each device writes its own file, and edits made on two devices at once are listed for you to choose, never
              overwritten.
            </p>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="sync-device-name">This device’s name</label>
              <input id="sync-device-name" className={controls.input} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!setup ? (
              <div className={styles.buttons}>
                <button type="button" className={controls.btnOutline} onClick={() => void choose()}>
                  <FolderOpen size={15} aria-hidden="true" /> Choose sync folder
                </button>
              </div>
            ) : (
              <>
                <p className={controls.hint}>Folder: <strong>{setup.handle.name}</strong></p>
                {setup.groups.length > 0 && (
                  <fieldset className={controls.field}>
                    <legend className={controls.label}>Sync group</legend>
                    {setup.groups.map((g) => (
                      <label key={g} className={styles.radio}>
                        <input type="radio" name="sync-group" checked={setup.mode === 'join' && setup.group === g} onChange={() => setSetup({ ...setup, mode: 'join', group: g })} />
                        Join “{g}”
                      </label>
                    ))}
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name="sync-group"
                        checked={setup.mode === 'create'}
                        onChange={() => setSetup({ ...setup, mode: 'create', group: suggestGroupName(localDb.settings.activeProfile()?.companyName || 'my books') })}
                      />
                      Start a new group
                    </label>
                  </fieldset>
                )}
                {setup.mode === 'create' && (
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="sync-group-name">New group name</label>
                    <input
                      id="sync-group-name"
                      className={`${controls.input} ${controls.inputMono}`}
                      maxLength={40}
                      value={setup.group}
                      onChange={(e) => setSetup({ ...setup, group: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    />
                    <span className={controls.hint}>Shown as a folder name in your cloud drive (the contents are encrypted). Use the same group on every device of this company.</span>
                  </div>
                )}
                <div className={controls.row}>
                  <input
                    type="password"
                    className={controls.input}
                    aria-label="Sync passphrase"
                    placeholder={setup.mode === 'create' ? 'New sync passphrase (8+ characters)' : 'Sync passphrase'}
                    autoComplete={setup.mode === 'create' ? 'new-password' : 'current-password'}
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                  {setup.mode === 'create' && (
                    <input
                      type="password"
                      className={controls.input}
                      aria-label="Repeat sync passphrase"
                      placeholder="Repeat passphrase"
                      autoComplete="new-password"
                      value={pass2}
                      onChange={(e) => setPass2(e.target.value)}
                    />
                  )}
                </div>
                <p className={controls.hint}>
                  Separate from your PIN and vault passphrase. Every device needs it once; it is not stored (a key derived from it
                  is), and a lost passphrase means the folder cannot be read. Join only with this company’s data or a fresh company.
                </p>
                <div className={styles.buttons}>
                  <button type="button" className={controls.btnPrimary} disabled={busy || pass.length < 8} onClick={() => void turnOn()}>
                    <FolderSync size={15} aria-hidden="true" /> {busy ? 'Setting up…' : setup.mode === 'create' ? 'Create group and sync' : 'Join and sync'}
                  </button>
                  <button type="button" className={controls.btnGhost} onClick={() => setSetup(null)}>Cancel</button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className={styles.status} role="status">
              {last && !last.ok ? (
                <AlertTriangle size={18} className={styles.warnIcon} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={18} className={styles.ok} aria-hidden="true" />
              )}
              <span className={styles.statusText}>
                <span>Last sync: <strong>{when(state.last_sync)}</strong></span>
                <small>
                  {config.folder} / mrchartist-sync / {config.group} · this device: {syncDevice().name}
                  {conflicts.length ? ` · ${conflicts.length} to review` : ''}
                </small>
                {last && !last.ok && last.message && <small>{last.message}</small>}
              </span>
            </div>

            {samePrefix.length > 0 && (
              <p className={styles.warn} role="alert">
                This device and {samePrefix.join(', ')} both number invoices as <strong>{myPrefix}/FY…</strong>. Two devices can then
                issue the same number. Give each device its own business profile with a different prefix and pick it below.
              </p>
            )}
            {shared.map((w) => (
              <p key={w.series} className={styles.warn}>
                Documents in the series <strong>{w.series}</strong> were issued on {w.devices.join(' and ')}. Keep one series per device to
                avoid duplicate numbers.
              </p>
            ))}
            {!peers.length && (
              <p className={controls.hint}>
                No other device has synced yet. On your other computer open this company, choose the same folder and join “{config.group}”.
              </p>
            )}

            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sync-profile">This device issues as</label>
                <select
                  id="sync-profile"
                  className={controls.select}
                  value={prefs.profile_id ?? ''}
                  onChange={(e) => {
                    setCompanySyncPrefs({ profile_id: e.target.value || undefined });
                    refresh();
                  }}
                >
                  <option value="">The active profile</option>
                  {settings.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.companyName || 'Untitled'} ({p.invoicePrefix || settings.invoicePrefix || 'INV'})
                    </option>
                  ))}
                </select>
                <span className={controls.hint}>New invoices on this device number as {myPrefix}/FY…/0001.</span>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sync-device-name">This device’s name</label>
                <input
                  id="sync-device-name"
                  className={controls.input}
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    setDeviceName(name);
                    refresh();
                  }}
                />
              </div>
            </div>

            {peers.length > 0 && (
              <table className={styles.peers}>
                <thead>
                  <tr>
                    <th scope="col">Device</th>
                    <th scope="col">Its last file</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.map(([id, p]) => (
                    <tr key={id}>
                      <td>{p.name || id.slice(0, 8)}</td>
                      <td>{when(p.written_at)}</td>
                      <td>{p.status === 'ok' ? 'OK' : p.message || 'could not be read'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {conflicts.length > 0 && (
              <>
                <span className={controls.label}>To review ({conflicts.length})</span>
                <ul className={styles.list}>
                  {conflicts.map((c) => (
                    <ConflictItem key={c.id} c={c} onResolve={onResolve} />
                  ))}
                </ul>
              </>
            )}

            <div className={styles.buttons}>
              <button type="button" className={controls.btnPrimary} disabled={busy} onClick={() => void syncNow()}>
                <RefreshCw size={15} aria-hidden="true" /> {busy ? 'Syncing…' : last?.reason === 'permission' ? 'Allow access and sync' : 'Sync now'}
              </button>
              <button type="button" className={controls.btnGhost} onClick={() => void turnOff()}>
                <Unplug size={15} aria-hidden="true" /> Turn off sync
              </button>
            </div>
            <p className={controls.hint}>
              Syncs when the app opens and every 5 minutes while it is open. After a browser restart the browser may ask to allow the
              folder again: click Sync now once.
            </p>
          </>
        )}

        {error && (
          <p className={controls.error} role="alert">
            <AlertTriangle size={13} aria-hidden="true" /> {error}
          </p>
        )}
      </div>
    </section>
  );
}
