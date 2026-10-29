import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FolderOpen, HardDrive, Lock, Play, Share2, Unplug } from 'lucide-react';
import {
  RETENTION_OPTIONS,
  chooseBackupFolder,
  clearBackupPassphrase,
  describeAge,
  disconnectFolder,
  downloadBackupNow,
  getConfig,
  getFolderHandle,
  getLastBackup,
  hasBackupEncryption,
  isFolderBackupSupported,
  runAutoBackup,
  saveConfig,
  setBackupPassphrase,
  type AutoBackupConfig,
  type BackupFrequency,
  type BackupResult,
} from '../../lib/auto-backup';
import { requestPersistentStorage, type StorageStatus } from '../../lib/pwa';
import { useT } from '../../i18n';
import { syncT } from '../../i18n/areas/sync';
import { vaultEnabled } from '../../lib/storage';
import { VAULT_PLAIN_BACKUP_MESSAGE } from '../../lib/backup';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Pwa.module.css';
import { phoneT } from '../../i18n/areas/phone';
import { libMsg } from '../../i18n/lib-msg';

// 8.20: phones have no folder backups; they share an encrypted file instead.
const ShareBackupDialog = lazy(() => import('./ShareBackupDialog').then((m) => ({ default: m.ShareBackupDialog })));

export interface AutoBackupPanelProps {
  /** Wire to useToast().notify so results surface as toasts. */
  onNotify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const FREQS: BackupFrequency[] = ['daily', 'weekly', 'on-close'];

function mb(bytes: number | null): string {
  return bytes === null ? '-' : `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

export function AutoBackupPanel({ onNotify }: AutoBackupPanelProps) {
  useT(); // re-render on a language switch (5.4)
  const supported = isFolderBackupSupported();
  const [config, setConfig] = useState<AutoBackupConfig>(getConfig);
  const [folder, setFolder] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(getLastBackup);
  const [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encrypted, setEncrypted] = useState<boolean | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    getFolderHandle().then((h) => alive && setFolder(h?.name ?? null));
    hasBackupEncryption().then((on) => alive && setEncrypted(on));
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
          ? syncT('savedTo', { folder: r.folder ?? syncT('yourFolder') })
          : syncT('downloadedAs', { file: r.filename }),
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
      onNotify?.(syncT('willSaveTo', { folder: r.name }), 'success');
    } else if (r.reason === 'failed') {
      setError(syncT('folderFail'));
    }
  };

  const runNow = async () => {
    setBusy(true);
    const r = folder ? await runAutoBackup({ interactive: true }) : await downloadBackupNow();
    setBusy(false);
    report(r);
  };

  const enableEncryption = async () => {
    if (pass !== pass2) return setError(syncT('passMismatch'));
    setBusy(true);
    const r = await setBackupPassphrase(pass);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setPass('');
    setPass2('');
    setError(null);
    setEncrypted(true);
    onNotify?.(syncT('encOn'), 'success');
  };

  const disableEncryption = async () => {
    await clearBackupPassphrase();
    setEncrypted(false);
    onNotify?.(syncT('encOff'), 'info');
  };

  const disconnect = async () => {
    await disconnectFolder();
    setFolder(null);
    update({ enabled: false });
    onNotify?.(syncT('disconnected'), 'info');
  };

  const now = new Date();
  const stale = last === null || now.getTime() - Date.parse(last) > 7 * 86_400_000;

  return (
    <section className={surface.card} aria-labelledby="auto-backup-title">
      <header className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="auto-backup-title">
          <HardDrive size={16} aria-hidden="true" /> {syncT('autoTitle')}
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
            {syncT('lastBackup')} <strong>{libMsg(describeAge(last, now))}</strong>
            {last && <small>{new Date(last).toLocaleString('en-IN')}</small>}
          </span>
        </div>

        {error && (
          <p className={controls.error} role="alert">
            <AlertTriangle size={13} aria-hidden="true" /> {error}
          </p>
        )}

        {encrypted === false && vaultEnabled() && (
          <p className={controls.error} role="alert">
            <AlertTriangle size={13} aria-hidden="true" /> {VAULT_PLAIN_BACKUP_MESSAGE} {syncT('noBackupUntil')}
          </p>
        )}

        {!supported ? (
          <p className={controls.hint}>
            {syncT('noFolderSupport')}
          </p>
        ) : (
          <>
            <div className={styles.folder}>
              <div>
                <span className={controls.label}>{syncT('backupFolder')}</span>
                <div className={styles.folderName}>{folder ?? syncT('notConnected')}</div>
              </div>
              <div className={styles.buttons}>
                <button type="button" className={controls.btnOutline} onClick={choose}>
                  <FolderOpen size={15} aria-hidden="true" /> {folder ? syncT('changeFolder') : syncT('chooseFolderBtn')}
                </button>
                {folder && (
                  <button type="button" className={controls.btnGhost} onClick={disconnect}>
                    <Unplug size={15} aria-hidden="true" /> {syncT('disconnect')}
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
                  {syncT('autoOn')}
                </label>
                <div className={controls.row}>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ab-freq">{syncT('howOften')}</label>
                    <select
                      id="ab-freq"
                      className={controls.select}
                      value={config.frequency}
                      disabled={!config.enabled}
                      onChange={(e) => update({ frequency: e.target.value as BackupFrequency })}
                    >
                      {FREQS.map((f) => (
                        <option key={f} value={f}>{syncT(`freq.${f}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ab-keep">{syncT('keepNewest')}</label>
                    <select
                      id="ab-keep"
                      className={controls.select}
                      value={config.retention}
                      onChange={(e) => update({ retention: Number(e.target.value) })}
                    >
                      {RETENTION_OPTIONS.map((n) => (
                        <option key={n} value={n}>{syncT('nBackups', { n })}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className={controls.hint}>
                  {syncT('scheduleHint')}
                </p>
              </>
            )}
          </>
        )}

        {encrypted !== null && (
          <div className={controls.field}>
            <span className={controls.label}>
              <Lock size={13} aria-hidden="true" /> {syncT('encryption')}
            </span>
            {encrypted ? (
              <>
                <p className={controls.hint}>
                  {syncT('encOnText')}
                </p>
                <div className={styles.buttons}>
                  <button type="button" className={controls.btnGhost} onClick={disableEncryption}>
                    {syncT('stopEnc')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className={controls.hint}>
                  {syncT('encOffText')}
                </p>
                <div className={controls.row}>
                  <input
                    type="password"
                    className={controls.input}
                    aria-label={syncT('backupPassAria')}
                    placeholder={syncT('backupPassPh')}
                    autoComplete="new-password"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                  <input
                    type="password"
                    className={controls.input}
                    aria-label={syncT('repeatBackupAria')}
                    placeholder={syncT('repeatPh')}
                    autoComplete="new-password"
                    value={pass2}
                    onChange={(e) => setPass2(e.target.value)}
                  />
                </div>
                <div className={styles.buttons}>
                  <button type="button" className={controls.btnOutline} onClick={enableEncryption} disabled={busy || pass.length < 8}>
                    <Lock size={15} aria-hidden="true" /> {syncT('encryptBackups')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className={styles.buttons}>
          <button type="button" className={controls.btnPrimary} onClick={runNow} disabled={busy}>
            <Play size={15} aria-hidden="true" /> {busy ? syncT('backingUp') : syncT('backUpNow')}
          </button>
          {folder && (
            <button type="button" className={controls.btnOutline} onClick={async () => report(await downloadBackupNow())}>
              <Download size={15} aria-hidden="true" /> {syncT('downloadCopy')}
            </button>
          )}
          {!supported && (
            <button type="button" className={controls.btnOutline} onClick={() => setSharing(true)} data-share-backup-open>
              <Share2 size={15} aria-hidden="true" /> {phoneT('shareNow')}
            </button>
          )}
        </div>
        {sharing && (
          <Suspense fallback={null}>
            <ShareBackupDialog
              open
              onClose={() => {
                setSharing(false);
                setLast(getLastBackup());
                void hasBackupEncryption().then(setEncrypted);
              }}
              onResult={(m, ok) => onNotify?.(m, ok ? 'success' : 'error')}
            />
          </Suspense>
        )}

        {storage?.supported && (
          <p className={controls.hint}>
            {storage.persisted ? syncT('storageProtected') : syncT('storageNotProtected')}
            {storage.usage !== null && storage.quota !== null && syncT('usedOf', { used: mb(storage.usage), quota: mb(storage.quota) })}.
          </p>
        )}
      </div>
    </section>
  );
}
