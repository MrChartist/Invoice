import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FolderOpen, FolderSync, KeyRound, RefreshCw, Unplug } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { verifyPin } from '../../lib/auth';
import { companyDevice, companySyncPrefs, setCompanySyncPrefs, setDeviceName, syncDevice } from '../../lib/sync-device';
import {
  connectSync,
  devicePrefix,
  disconnectSync,
  getSyncConfig,
  isSyncSupported,
  needsPassphrase,
  reenterPassphrase,
  pickSyncFolder,
  runSyncNow,
  suggestGroupName,
  syncOverview,
  type SyncConfig,
} from '../../lib/sync-folder';
import { GROUP_RE, type SyncDir } from '../../lib/sync-files';
import { fieldMerge, resolveConflict, tableLabel, type Resolution, type RowConflict, type SyncConflict, type SyncReport } from '../../lib/sync-engine';
import { useT } from '../../i18n';
import { syncT } from '../../i18n/areas/sync';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Sync.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

// R4-C7: labelled, field-level merge per conflict and the bulk actions — lazy, only when there are conflicts.
const ConflictMerge = lazy(() => import('../trust/ConflictMerge'));
const BulkMerge = lazy(() => import('../trust/ConflictMerge').then((m) => ({ default: m.BulkMerge })));

const when = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString('en-IN') : syncT('never'));

function describeRow(key: string, v: unknown): string {
  if (!v || typeof v !== 'object') return syncT('deleted');
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

function ConflictItem({ c, onResolve }: { c: SyncConflict; onResolve: (id: string, choice: Resolution, override?: boolean) => Promise<void> }) {
  useT(); // re-render on a language switch (5.4)
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  if (c.kind === 'duplicate') {
    return (
      <li className={styles.item}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{syncT('dupTitle', { table: tableLabel(c.key), number: c.number, n: c.ids.length })}</span>
          <span className={styles.meta}>{syncT('found', { date: when(c.at) })}</span>
        </div>
        <ul className={styles.diff}>
          {c.docs.map((d) => (
            <li key={d.id}>
              {c.key.endsWith('_invoices') ? <Link to={`/invoice/${d.id}`}>{d.number || d.id}</Link> : d.number || d.id} · {d.client || '-'} · {d.date} · {d.total.toLocaleString('en-IN')}
              {d.device ? syncT('fromDevice', { device: d.device }) : ''}
            </li>
          ))}
        </ul>
        <p className={controls.hint}>{syncT('dupHint')}</p>
        <div className={styles.buttons}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(c.id, 'ack')}>{syncT('markReviewed')}</button>
        </div>
      </li>
    );
  }
  const rc = c as RowConflict;
  const isRow = rc.kind === 'row';
  const title = isRow ? `${tableLabel(rc.key)}: ${describeRow(rc.key, rc.local.value ?? rc.remote.value)}` : syncT('settingSuffix', { table: tableLabel(rc.key) });
  const reason =
    rc.reason === 'locked'
      ? isRow
        ? syncT('lockedRow', { device: rc.device_name || syncT('anotherDevice') })
        : syncT('lockedSetting', { device: rc.device_name || syncT('anotherDevice') })
      : rc.reason === 'payment'
        ? syncT('paymentHeld', { device: rc.device_name || syncT('anotherDevice') })
      : rc.reason === 'lww'
        ? syncT(rc.applied === 'remote' ? 'lwwRemote' : 'lwwLocal', { device: rc.device_name || syncT('anotherDeviceLc') })
        : syncT('keptLocal', { device: rc.device_name || syncT('anotherDeviceLc') });
  const diff = isRow ? changedFields(rc.local.value, rc.remote.value) : [];
  const theirsLabel = rc.remote.value === null ? syncT('deleteTheirs') : syncT('useTheirs', { device: rc.device_name || syncT('their') });
  const mineLabel = rc.local.value === null ? (rc.local.meta ? syncT('keepDeleted') : syncT('leaveOut')) : syncT('keepMine');

  const withPin = async (choice: 'mine' | 'theirs') => {
    if (!(await verifyPin(pin))) {
      setPinError(syncT('wrongPin'));
      return;
    }
    setPinError('');
    await onResolve(rc.id, choice, true);
  };

  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>{title}</span>
        <span className={styles.meta}>{syncT('found', { date: when(rc.at) })}</span>
      </div>
      <span className={styles.meta}>{reason}</span>
      {rc.local.value === null && isRow && <span className={styles.meta}>{rc.local.meta ? syncT('thisDeviceDeleted') : syncT('thisDeviceAbsent')}</span>}
      {rc.remote.value === null && isRow && <span className={styles.meta}>{syncT('otherDeleted', { device: rc.device_name || syncT('otherDevice') })}</span>}
      {isRow && rc.local.value && rc.remote.value ? (
        <Suspense fallback={null}><ConflictMerge c={rc} onResolve={onResolve} fm={fieldMerge} /></Suspense>
      ) : diff.length > 0 && (
        <ul className={styles.diff}>
          {diff.map((d) => (
            <li key={d.field}>
              <b>{d.field}</b>: {syncT('mineTheirs', { mine: d.mine, theirs: d.theirs })}
            </li>
          ))}
        </ul>
      )}
      {rc.reason === 'locked' ? (
        <div className={styles.buttons}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void onResolve(rc.id, 'mine')}>
            {syncT('keepBooks', { label: mineLabel })}
          </button>
          <input
            type="password"
            inputMode="numeric"
            className={`${controls.input} ${styles.pin}`}
            aria-label={syncT('pinLockedAria')}
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={pin.length < 4} onClick={() => void withPin('theirs')}>
            <KeyRound size={14} aria-hidden="true" /> {syncT('applyPin')}
          </button>
          {pinError && <span className={controls.error} role="alert">{pinError}</span>}
        </div>
      ) : rc.locked ? (
        <div className={styles.buttons}>
          <span className={styles.meta}>{syncT('lockedChoose')}</span>
          <input
            type="password"
            inputMode="numeric"
            className={`${controls.input} ${styles.pin}`}
            aria-label={syncT('pinBooksAria')}
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={pin.length < 4} onClick={() => void withPin('mine')}>{mineLabel}</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={pin.length < 4} onClick={() => void withPin('theirs')}>{theirsLabel}</button>
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
  useT(); // re-render on a language switch (5.4)
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

  const [needPass, setNeedPass] = useState(false);
  useEffect(() => {
    let alive = true;
    void getSyncConfig().then((c) => alive && setConfig(c));
    void needsPassphrase().then((n) => alive && setNeedPass(n));
    return () => {
      alive = false;
    };
  }, []);

  const report = (r: SyncReport) => {
    refresh();
    if (r.ok) {
      setError(null);
      const moved = r.added + r.updated + r.deleted;
      const result = `${moved ? syncT('changesApplied', { n: moved }) : syncT('upToDate')}${r.newConflicts ? syncT('toReviewSuffix', { n: r.newConflicts }) : ''}`;
      notify?.(
        r.peers ? syncT('syncedWith', { n: r.peers, result }) : syncT('synced', { result }),
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
      if (r.reason !== 'cancelled') setError(r.message || syncT('openFolderFail'));
      return;
    }
    const company = localDb.settings.activeProfile()?.companyName || syncT('myBooks');
    setSetup({ handle: r.handle, groups: r.groups, mode: r.groups.length ? 'join' : 'create', group: r.groups[0] ?? suggestGroupName(company) });
  };

  const turnOn = async () => {
    if (!setup) return;
    if (setup.mode === 'create' && pass !== pass2) return setError(syncT('passMismatch'));
    if (!GROUP_RE.test(setup.group)) return setError(syncT('groupRule'));
    setBusy(true);
    setDeviceName(name);
    const r = await connectSync({ handle: setup.handle, group: setup.group, passphrase: pass });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setPass('');
    setPass2('');
    setSetup(null);
    setConfig(await getSyncConfig());
    notify?.(r.created ? syncT('groupCreated') : syncT('joined'), 'success');
    report(r.report);
  };

  const turnOff = async () => {
    if (!window.confirm(syncT('confirmOff'))) return;
    await disconnectSync();
    setConfig(null);
    refresh();
    notify?.(syncT('syncOff'), 'info');
  };

  const onResolve = async (id: string, choice: Resolution, override = false) => {
    const r = await resolveConflict(id, choice, companyDevice(), { override });
    if (!r.ok) setError(r.message ?? syncT('resolveFail'));
    else {
      setError(null);
      notify?.(syncT('resolved'), 'success');
    }
    refresh();
  };

  const { state, conflicts, shared, self } = overview;
  const peers = Object.entries(state.peers).filter(([id]) => id !== self);
  const myPrefix = config ? devicePrefix() : '';
  const samePrefix = peers.filter(([, p]) => p.status === 'ok' && p.prefix && p.prefix === myPrefix).map(([, p]) => p.name);
  const last = overview.last;
  const lastSync = [state.last_sync, last?.ok ? last.at : undefined].filter(Boolean).sort().pop();

  return (
    <section className={surface.card} aria-labelledby="sync-title">
      <header className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="sync-title">
          <FolderSync size={16} aria-hidden="true" /> {syncT('syncFolder')}
        </span>
      </header>
      <div className={`${surface.cardBody} ${styles.body}`}>
        {!supported ? (
          <p className={controls.hint} data-testid="sync-unsupported">
            {syncT('unsupported')}
          </p>
        ) : config === undefined ? null : !config ? (
          <>
            <p className={controls.hint}>
              {syncT('intro')}
            </p>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="sync-device-name">{syncT('deviceName')}</label>
              <input id="sync-device-name" className={controls.input} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!setup ? (
              <div className={styles.buttons}>
                <button type="button" className={controls.btnOutline} onClick={() => void choose()}>
                  <FolderOpen size={15} aria-hidden="true" /> {syncT('chooseFolder')}
                </button>
              </div>
            ) : (
              <>
                <p className={controls.hint}>{syncT('folderN')} <strong>{setup.handle.name}</strong></p>
                {setup.groups.length > 0 && (
                  <fieldset className={controls.field}>
                    <legend className={controls.label}>{syncT('group')}</legend>
                    {setup.groups.map((g) => (
                      <label key={g} className={styles.radio}>
                        <input type="radio" name="sync-group" checked={setup.mode === 'join' && setup.group === g} onChange={() => setSetup({ ...setup, mode: 'join', group: g })} />
                        {syncT('joinGroup', { group: g })}
                      </label>
                    ))}
                    <label className={styles.radio}>
                      <input
                        type="radio"
                        name="sync-group"
                        checked={setup.mode === 'create'}
                        onChange={() => setSetup({ ...setup, mode: 'create', group: suggestGroupName(localDb.settings.activeProfile()?.companyName || syncT('myBooks')) })}
                      />
                      {syncT('newGroup')}
                    </label>
                  </fieldset>
                )}
                {setup.mode === 'create' && (
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="sync-group-name">{syncT('newGroupName')}</label>
                    <input
                      id="sync-group-name"
                      className={`${controls.input} ${controls.inputMono}`}
                      maxLength={40}
                      value={setup.group}
                      onChange={(e) => setSetup({ ...setup, group: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    />
                    <span className={controls.hint}>{syncT('groupHint')}</span>
                  </div>
                )}
                <div className={controls.row}>
                  <input
                    type="password"
                    className={controls.input}
                    aria-label={syncT('passAria')}
                    placeholder={setup.mode === 'create' ? syncT('newPassPh') : syncT('passPh')}
                    autoComplete={setup.mode === 'create' ? 'new-password' : 'current-password'}
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                  {setup.mode === 'create' && (
                    <input
                      type="password"
                      className={controls.input}
                      aria-label={syncT('repeatAria')}
                      placeholder={syncT('repeatPh')}
                      autoComplete="new-password"
                      value={pass2}
                      onChange={(e) => setPass2(e.target.value)}
                    />
                  )}
                </div>
                <p className={controls.hint}>
                  {syncT('passHint')}
                </p>
                <div className={styles.buttons}>
                  <button type="button" className={controls.btnPrimary} disabled={busy || pass.length < 8} onClick={() => void turnOn()}>
                    <FolderSync size={15} aria-hidden="true" /> {busy ? syncT('settingUp') : setup.mode === 'create' ? syncT('createSync') : syncT('joinSync')}
                  </button>
                  <button type="button" className={controls.btnGhost} onClick={() => setSetup(null)}>{syncT('cancel')}</button>
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
                <span>{syncT('lastSync')} <strong>{when(lastSync)}</strong></span>
                <small>
                  {config.folder} / mrchartist-sync / {config.group} · {syncT('thisDevice', { name: syncDevice().name })}
                  {conflicts.length ? syncT('toReview', { n: conflicts.length }) : ''}
                </small>
                {last && !last.ok && last.message && <small>{last.message}</small>}
              </span>
            </div>

            {needPass && (
              <div className={styles.warn} role="alert">
                <p className={controls.hint}>{syncT('reenter')}</p>
                <div className={styles.buttons}>
                  <input type="password" className={controls.input} aria-label={syncT('passAria')} autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                  <button
                    type="button"
                    className={controls.btnOutline}
                    disabled={busy || pass.length < 8}
                    onClick={async () => {
                      setBusy(true);
                      const r = await reenterPassphrase(pass);
                      setBusy(false);
                      if (!r.ok) return setError(r.message ?? syncT('badPass'));
                      setPass('');
                      setNeedPass(false);
                      void syncNow();
                    }}
                  >
                    <KeyRound size={15} aria-hidden="true" /> {syncT('resume')}
                  </button>
                </div>
              </div>
            )}
            {samePrefix.length > 0 && (
              <p className={styles.warn} role="alert">
                {syncT('samePrefix', { devices: samePrefix.join(', '), prefix: myPrefix })}
              </p>
            )}
            {shared.map((w) => (
              <p key={w.series} className={styles.warn}>
                {syncT('sharedSeries', { series: w.series, devices: w.devices.join(syncT('and')) })}
              </p>
            ))}
            {!peers.length && (
              <p className={controls.hint}>
                {syncT('noPeers', { group: config.group })}
              </p>
            )}

            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sync-profile">{syncT('issuesAs')}</label>
                <select
                  id="sync-profile"
                  className={controls.select}
                  value={prefs.profile_id ?? ''}
                  onChange={(e) => {
                    setCompanySyncPrefs({ profile_id: e.target.value || undefined });
                    refresh();
                  }}
                >
                  <option value="">{syncT('activeProfile')}</option>
                  {settings.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.companyName || syncT('untitled')} ({p.invoicePrefix || settings.invoicePrefix || 'INV'})
                    </option>
                  ))}
                </select>
                <span className={controls.hint}>{syncT('numberAs', { prefix: myPrefix })}</span>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sync-device-name">{syncT('deviceName')}</label>
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
                    <th scope="col">{syncT('thDevice')}</th>
                    <th scope="col">{syncT('thLastFile')}</th>
                    <th scope="col">{syncT('thStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.map(([id, p]) => (
                    <tr key={id}>
                      <td>{p.name || id.slice(0, 8)}</td>
                      <td>{when(p.written_at)}</td>
                      <td>{p.status === 'ok' ? syncT('ok') : p.message || syncT('unreadable')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {conflicts.length > 0 && (
              <>
                <span className={controls.label}>{syncT('toReviewN', { n: conflicts.length })}</span>
                <Suspense fallback={null}>
                  <BulkMerge fm={fieldMerge} conflicts={conflicts} resolve={(id, choice) => resolveConflict(id, choice, companyDevice())} onDone={(msg) => { refresh(); notify?.(msg, 'info'); }} />
                </Suspense>
                <ul className={styles.list}>
                  {conflicts.map((c) => (
                    <ConflictItem key={c.id} c={c} onResolve={onResolve} />
                  ))}
                </ul>
              </>
            )}

            <div className={styles.buttons}>
              <button type="button" className={controls.btnPrimary} disabled={busy} onClick={() => void syncNow()}>
                <RefreshCw size={15} aria-hidden="true" /> {busy ? syncT('syncing') : last?.reason === 'permission' ? syncT('allowSync') : syncT('syncNow')}
              </button>
              <button type="button" className={controls.btnGhost} onClick={() => void turnOff()}>
                <Unplug size={15} aria-hidden="true" /> {syncT('turnOff')}
              </button>
            </div>
            <p className={controls.hint}>
              {syncT('footHint')}
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
