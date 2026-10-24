import { useEffect, useState } from 'react';
import { AlertTriangle, LockKeyhole, ShieldCheck } from 'lucide-react';
import {
  changeVaultPassphrase,
  disableVault,
  enableVault,
  reloadAfterFlush,
  storageBackend,
  vaultEnabled,
} from '../../lib/storage';
import { hasBackupEncryption, getConfig } from '../../lib/auto-backup';
import { MIN_PASSPHRASE } from '../../lib/vault';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
type Mode = 'idle' | 'enable' | 'change' | 'disable';

/** Settings → Security → Vault mode (5.8): encrypt the whole store on this device. */
export function VaultPanel({ notify }: { notify: Notify }) {
  const [on, setOn] = useState(vaultEnabled);
  const [mode, setMode] = useState<Mode>('idle');
  const [current, setCurrent] = useState('');
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plainFolderBackup, setPlainFolderBackup] = useState(false);
  const supported = storageBackend() === 'idb' && typeof crypto !== 'undefined' && !!crypto.subtle;

  useEffect(() => {
    let alive = true;
    if (on && getConfig().enabled) {
      void hasBackupEncryption().then((enc) => {
        if (alive) setPlainFolderBackup(!enc);
      });
    }
    return () => {
      alive = false;
    };
  }, [on]);

  const reset = (next: Mode = 'idle') => {
    setMode(next);
    setCurrent('');
    setPass('');
    setAgain('');
    setAck(false);
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode !== 'disable') {
      if (pass.length < MIN_PASSPHRASE) return setError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`);
      if (pass !== again) return setError('The passphrases do not match.');
    }
    if (mode === 'enable' && !ack) return setError('Tick the box to confirm you understand there is no recovery.');
    setBusy(true);
    try {
      if (mode === 'enable') {
        await enableVault(pass);
        setOn(true);
        notify('Vault mode is on. Your data on this device is now encrypted.');
      } else if (mode === 'change') {
        await changeVaultPassphrase(current, pass);
        notify('Vault passphrase changed.');
      } else if (mode === 'disable') {
        await disableVault(current);
        setOn(false);
        notify('Vault mode is off. Data on this device is stored readable again.', 'info');
      }
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={surface.card} aria-labelledby="vault-title">
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="vault-title">
          <LockKeyhole size={16} /> Vault mode
        </span>
        <span className={on ? styles.badgeOk : styles.badge}>{on ? 'On' : 'Off'}</span>
      </div>
      <div className={surface.cardBody}>
        <div className={styles.form}>
          <div className={styles.note}>
            <ShieldCheck size={16} />
            <span>
              Encrypts everything this app stores on this device (invoices, clients, books, settings) with AES-256. The key is unlocked
              by a passphrase you type each time the app opens, so someone who copies this browser&rsquo;s data cannot read it. Unlike
              the PIN, this protects the stored data itself. While the app is open and unlocked, the data is in memory as usual.
            </span>
          </div>

          {!supported && (
            <div className={styles.note} role="status">
              <AlertTriangle size={16} />
              <span>Vault mode needs this browser&rsquo;s database (IndexedDB) and a secure (https) page, which are not available here.</span>
            </div>
          )}

          {on && plainFolderBackup && (
            <div className={styles.note} role="status">
              <AlertTriangle size={16} />
              <span>Automatic folder backups are not encrypted. Set a backup passphrase under Data &amp; backup so copies outside the vault are protected too.</span>
            </div>
          )}

          {mode === 'idle' ? (
            <div className={styles.buttons}>
              {!on && (
                <button type="button" className={controls.btnPrimary} disabled={!supported} onClick={() => reset('enable')}>
                  <LockKeyhole size={16} /> Turn on vault mode
                </button>
              )}
              {on && (
                <>
                  <button type="button" className={controls.btnOutline} onClick={() => reloadAfterFlush()}>
                    Lock vault now
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => reset('change')}>
                    Change passphrase
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => reset('disable')}>
                    Turn off
                  </button>
                </>
              )}
            </div>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate>
              {mode === 'enable' && (
                <div className={styles.note} role="note">
                  <AlertTriangle size={16} />
                  <span>
                    <strong>There is no recovery.</strong> If you forget this passphrase, the data on this device cannot be opened by anyone.
                    Keep a backup (preferably encrypted) somewhere else.
                  </span>
                </div>
              )}
              {(mode === 'change' || mode === 'disable') && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="vault-current">Current passphrase</label>
                  <input id="vault-current" className={controls.input} type="password" autoComplete="current-password" value={current}
                    onChange={(e) => setCurrent(e.target.value)} />
                </div>
              )}
              {mode !== 'disable' && (
                <div className={styles.passRow}>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="vault-pass">{mode === 'change' ? 'New passphrase' : 'Passphrase'}</label>
                    <input id="vault-pass" className={controls.input} type="password" autoComplete="new-password" value={pass}
                      onChange={(e) => setPass(e.target.value)} placeholder={`At least ${MIN_PASSPHRASE} characters`} />
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="vault-pass2">Repeat passphrase</label>
                    <input id="vault-pass2" className={`${controls.input} ${again && again !== pass ? controls.inputInvalid : ''}`}
                      type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
                  </div>
                </div>
              )}
              {mode === 'enable' && (
                <label className={styles.rowText} style={{ flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I understand that a lost passphrase means lost data.</span>
                </label>
              )}
              {error && <span className={controls.error} role="alert">{error}</span>}
              <div className={styles.buttons}>
                <button type="submit" className={mode === 'disable' ? controls.btnDanger : controls.btnPrimary} disabled={busy}>
                  {busy ? 'Working…' : mode === 'enable' ? 'Encrypt my data' : mode === 'change' ? 'Change passphrase' : 'Turn off vault mode'}
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => reset()} disabled={busy}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
