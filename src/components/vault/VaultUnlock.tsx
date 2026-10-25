import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { eraseLockedDevice, unlockStorage } from '../../lib/storage';
import { tNodes, useT } from '../../i18n';
import { LanguageSwitch } from '../ui/LanguageSwitch';
import controls from '../../styles/controls.module.css';
import styles from './VaultUnlock.module.css';

/**
 * Boot screen for vault mode (5.8): shown by main.tsx before the app when the data on this
 * device is encrypted. Nothing else has read the store yet; `onUnlocked` continues the boot.
 */
export function VaultUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useT();
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
          <h1 className={styles.title}>{t('vault.damagedTitle')}</h1>
          <p className={styles.text}>
            {t(unreadable.length === 1 ? 'vault.damagedOne' : 'vault.damagedMany', {
              n: unreadable.length,
              keys: unreadable.map((k) => k.replace(/^mrchartist_inv_/, '')).join(', '),
            })}
          </p>
          <button type="button" className={controls.btnPrimary} onClick={onUnlocked}>{t('vault.continue')}</button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <LanguageSwitch compact className={styles.lang} />
        <span className={styles.icon} aria-hidden="true"><LockKeyhole size={20} /></span>
        <h1 className={styles.title}>{t('vault.title')}</h1>
        <p className={styles.text}>{t('vault.text')}</p>
        <form className={styles.form} onSubmit={unlock} noValidate>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="vault-unlock">{t('vault.passphrase')}</label>
            <input id="vault-unlock" className={controls.input} type="password" autoComplete="current-password" autoFocus
              value={pass} onChange={(e) => setPass(e.target.value)} disabled={busy} />
          </div>
          {error && <span className={controls.error} role="alert">{error}</span>}
          <button type="submit" className={controls.btnPrimary} disabled={busy || !pass}>
            {busy ? t('vault.unlocking') : t('vault.unlock')}
          </button>
        </form>
        {!forgot ? (
          <button type="button" className={styles.link} onClick={() => setForgot(true)}>{t('vault.forgot')}</button>
        ) : (
          <div className={styles.danger}>
            <p className={styles.text}>{tNodes('vault.forgotText', { word: <strong>ERASE</strong> })}</p>
            <input className={controls.input} aria-label={t('vault.typeErase')} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button type="button" className={controls.btnDanger} disabled={busy || confirm !== 'ERASE'} onClick={() => void erase()}>
              {t('vault.erase')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
