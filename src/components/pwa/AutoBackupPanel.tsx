import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FolderOpen, HardDrive, Play, Unplug } from 'lucide-react';
import {
  RETENTION_OPTIONS,
  chooseBackupFolder,
  describeAge,
  disconnectFolder,
  downloadBackupNow,
  getConfig,
  getFolderHandle,
  getLastBackup,
  isFolderBackupSupported,
  runAutoBackup,
  saveConfig,
  type AutoBackupConfig,
  type BackupFrequency,
  type BackupResult,
} from '../../lib/auto-backup';
import { requestPersistentStorage, type StorageStatus } from '../../lib/pwa';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Pwa.module.css';

export interface AutoBackupPanelProps {
  /** Wire to useToast().notify so results surface as toasts. */
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const FREQ_LABEL: Record<BackupFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  'on-close': 'When I close or leave the app',
};

function mb(bytes: number | null): string {
  return bytes === null ? '-' : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

export function AutoBackupPanel({ onNotify }: AutoBackupPanelProps) {
  const supported = isFolderBackupSupported();
  const [config, setConfig] = useState<AutoBackupConfig>(getConfig);
  const [folder, setFolder] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(getLastBackup);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getFolderHandle().then((h) => alive && setFolder(h?.name ?? null));
    requestPersistentStorage().then((s) => alive && setStorage(s));
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<AutoBackupConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  const report = (r: BackupResult) => {
    setLast(getLastBackup());
    if (r.ok) {
      setError(null);
      onNotify?.(
        r.method === 'folder'
          ? `Backup saved to ${r.folder ?? 'your folder'}`
          : `Backup downloaded as ${r.filename}`,
        'success',
      );
    } else {
      setError(r.message);
      onNotify?.(r.message, 'error');
    }
  };

  const choose = async () => {
    const r = await chooseBackupFolder();
    if (r.ok) {
      setFolder(r.name);
      setError(null);
      update({ enabled: true });
      onNotify?.(`Backups will be saved to ${r.name}`, 'success');
    } else if (r.reason === 'failed') {
      setError('Could not remember that folder. Try a different one.');
    }
  };

  const runNow = async () => {
    setBusy(true);
    const r = folder ? await runAutoBackup({ interactive: true }) : downloadBackupNow();
    setBusy(false);
    report(r);
  };

  const disconnect = async () => {
    await disconnectFolder();
    setFolder(null);
    update({ enabled: false });
    onNotify?.('Backup folder disconnected', 'info');
  };

  const now = new Date();
  const stale = last === null || now.getTime() - Date.parse(last) > 7 * 86_400_000;

  return (
    <section className={surface.card} aria-labelledby="auto-backup-title">
      <header className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="auto-backup-title">
          <HardDrive size={16} aria-hidden="true" /> Automatic backups
        </span>
      </header>
      <div className={`${surface.cardBody} ${styles.panelBody}`}>
        <div className={styles.status} role="status">
          {stale ? (
            <AlertTriangle size={18} className={styles.statusWarn} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={18} className={styles.statusOk} aria-hidden="true" />
          )}
          <span className={styles.statusText}>
            Last backup: <strong>{describeAge(last, now)}</strong>
            {last && <small>{new Date(last).toLocaleString('en-IN')}</small>}
          </span>
        </div>

        {error && (
          <p className={controls.error} role="alert">
            <AlertTriangle size={13} aria-hidden="true" /> {error}
          </p>
        )}

        {!supported ? (
          <p className={controls.hint}>
            This browser cannot save to a folder automatically (Safari and Firefox). Use the button below to download a
            backup file regularly, and keep it somewhere safe like iCloud Drive or Google Drive.
          </p>
        ) : (
          <>
            <div className={styles.folder}>
              <div>
                <span className={controls.label}>Backup folder</span>
                <div className={styles.folderName}>{folder ?? 'Not connected'}</div>
              </div>
              <div className={styles.buttons}>
                <button type="button" className={controls.btnOutline} onClick={choose}>
                  <FolderOpen size={15} aria-hidden="true" /> {folder ? 'Change folder' : 'Choose folder'}
                </button>
                {folder && (
                  <button type="button" className={controls.btnGhost} onClick={disconnect}>
                    <Unplug size={15} aria-hidden="true" /> Disconnect
                  </button>
                )}
              </div>
            </div>

            {folder && (
              <>
                <label className={styles.toggleRow}>
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => update({ enabled: e.target.checked })}
                  />
                  Back up automatically
                </label>
                <div className={controls.row}>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ab-freq">How often</label>
                    <select
                      id="ab-freq"
                      className={controls.select}
                      value={config.frequency}
                      disabled={!config.enabled}
                      onChange={(e) => update({ frequency: e.target.value as BackupFrequency })}
                    >
                      {(Object.keys(FREQ_LABEL) as BackupFrequency[]).map((f) => (
                        <option key={f} value={f}>{FREQ_LABEL[f]}</option>
                      ))}
                    </select>
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ab-keep">Keep newest</label>
                    <select
                      id="ab-keep"
                      className={controls.select}
                      value={config.retention}
                      onChange={(e) => update({ retention: Number(e.target.value) })}
                    >
                      {RETENTION_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n} backups</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className={controls.hint}>
                  Scheduled backups run while the app is open. After a browser restart the browser may ask you to
                  re-allow folder access; click Back up now once to do that. Older files beyond the limit are removed,
                  but only files this app created.
                </p>
              </>
            )}
          </>
        )}

        <div className={styles.buttons}>
          <button type="button" className={controls.btnPrimary} onClick={runNow} disabled={busy}>
            <Play size={15} aria-hidden="true" /> {busy ? 'Backing up...' : 'Back up now'}
          </button>
          {folder && (
            <button type="button" className={controls.btnOutline} onClick={() => report(downloadBackupNow())}>
              <Download size={15} aria-hidden="true" /> Download a copy
            </button>
          )}
        </div>

        {storage?.supported && (
          <p className={controls.hint}>
            Browser storage: {storage.persisted ? 'protected from automatic clean-up' : 'not yet protected from clean-up'}
            {storage.usage !== null && storage.quota !== null && ` (${mb(storage.usage)} of ${mb(storage.quota)} used)`}.
          </p>
        )}
      </div>
    </section>
  );
}
