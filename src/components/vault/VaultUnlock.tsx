import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { eraseLockedDevice, unlockStorage } from '../../lib/storage';
import controls from '../../styles/controls.module.css';
import styles from './VaultUnlock.module.css';

/**
 * Boot screen for vault mode (5.8): shown by main.tsx before the app when the data on this
 * device is encrypted. Nothing else has read the store yet; `onUnlocked` continues the boot.
 */
export function VaultUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unreadable, setUnreadable] = useState<string[] | null>(null);
  const [forgot, setForgot] = useState(false);
  const [confirm, setConfirm] = useState('');

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pass) return;
    setError('');
    setBusy(true);
    try {
      const res = await unlockStorage(pass);
      setPass('');
      if (res.unreadable.length > 0) setUnreadable(res.unreadable);
      else onUnlocked();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const erase = async () => {
    setBusy(true);
    try {
      await eraseLockedDevice();
    } finally {
      window.location.reload();
    }
  };

  if (unreadable) {
    return (
      <main className={styles.shell}>
        <div className={styles.card} role="alert">
          <h1 className={styles.title}>Some data could not be decrypted</h1>
          <p className={styles.text}>
            {unreadable.length} stored item{unreadable.length === 1 ? '' : 's'} on this device appear damaged
            ({unreadable.map((k) => k.replace(/^mrchartist_inv_/, '')).join(', ')}). They are left untouched; everything else opened.
            Restoring a backup replaces them.
          </p>
          <button type="button" className={controls.btnPrimary} onClick={onUnlocked}>Continue</button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <span className={styles.icon} aria-hidden="true"><LockKeyhole size={20} /></span>
        <h1 className={styles.title}>Unlock your vault</h1>
        <p className={styles.text}>The data on this device is encrypted. Enter your vault passphrase to open it.</p>
        <form className={styles.form} onSubmit={unlock} noValidate>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="vault-unlock">Vault passphrase</label>
            <input id="vault-unlock" className={controls.input} type="password" autoComplete="current-password" autoFocus
              value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
          </div>
          {error && <span className={controls.error} role="alert">{error}</span>}
          <button type="submit" className={controls.btnPrimary} disabled={busy || !pass}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
        {!forgot ? (
          <button type="button" className={styles.link} onClick={() => setForgot(true)}>Forgot the passphrase?</button>
        ) : (
          <div className={styles.danger}>
            <p className={styles.text}>
              Without the passphrase this data cannot be decrypted by anyone. You can erase everything this app stored on this device
              and start again (then restore a backup if you have one). Type <strong>ERASE</strong> to confirm.
            </p>
            <input className={controls.input} aria-label="Type ERASE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="button" className={controls.btnDanger} disabled={busy || confirm !== 'ERASE'} onClick={() => void erase()}>
              Erase this device
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
