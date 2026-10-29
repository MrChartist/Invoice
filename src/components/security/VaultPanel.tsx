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
import '../../lib/backup'; // registers the undo-copy hook for vault switches
import '../../lib/sync-keystore'; // and the folder-sync key hook (sealed with the vault key)
import { MIN_PASSPHRASE } from '../../lib/vault';
import { useT } from '../../i18n';
import { secT } from '../../i18n/areas/security';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';
import { errText } from '../../i18n/lib-msg';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
type Mode = 'idle' | 'enable' | 'change' | 'disable';

/** Settings → Security → Vault mode (5.8): encrypt the whole store on this device. */
export function VaultPanel({ notify }: { notify: Notify }) {
  useT(); // re-render on a language switch (5.4)
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
      if (pass.length < MIN_PASSPHRASE) return setError(secT('errShortPass', { n: MIN_PASSPHRASE }));
      if (pass !== again) return setError(secT('errPassMismatch'));
    }
    if (mode === 'enable' && !ack) return setError(secT('errAck'));
    setBusy(true);
    try {
      if (mode === 'enable') {
        await enableVault(pass);
        setOn(true);
        notify(secT('vaultOn'));
      } else if (mode === 'change') {
        await changeVaultPassphrase(current, pass);
        notify(secT('vaultChanged'));
      } else if (mode === 'disable') {
        await disableVault(current);
        setOn(false);
        notify(secT('vaultOff'), 'info');
      }
      reset();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={surface.card} aria-labelledby="vault-title">
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="vault-title">
          <LockKeyhole size={16} /> {secT('vaultMode')}
        </span>
        <span className={on ? styles.badgeOk : styles.badge}>{on ? secT('on') : secT('off')}</span>
      </div>
      <div className={surface.cardBody}>
        <div className={styles.form}>
          <div className={styles.note}>
            <ShieldCheck size={16} />
            <span>{secT('vaultIntro')}</span>
          </div>

          {!supported && (
            <div className={styles.note} role="status">
              <AlertTriangle size={16} />
              <span>{secT('vaultUnsupported')}</span>
            </div>
          )}

          {on && plainFolderBackup && (
            <div className={styles.note} role="status">
              <AlertTriangle size={16} />
              <span>{secT('plainFolder')}</span>
            </div>
          )}

          {mode === 'idle' ? (
            <div className={styles.buttons}>
              {!on && (
                <button type="button" className={controls.btnPrimary} disabled={!supported} onClick={() => reset('enable')}>
                  <LockKeyhole size={16} /> {secT('turnOn')}
                </button>
              )}
              {on && (
                <>
                  <button type="button" className={controls.btnOutline} onClick={() => reloadAfterFlush()}>
                    {secT('lockVault')}
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => reset('change')}>
                    {secT('changePass')}
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => reset('disable')}>
                    {secT('turnOff')}
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
                    <strong>{secT('noRecovery')}</strong> {secT('noRecoveryText')}
                  </span>
                </div>
              )}
              {(mode === 'change' || mode === 'disable') && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="vault-current">{secT('currentPass')}</label>
                  <input id="vault-current" className={controls.input} type="password" autoComplete="current-password" value={current}
                    onChange={(e) => setCurrent(e.target.value)} />
                </div>
              )}
              {mode !== 'disable' && (
                <div className={styles.passRow}>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="vault-pass">{mode === 'change' ? secT('newPass') : secT('passphrase')}</label>
                    <input id="vault-pass" className={controls.input} type="password" autoComplete="new-password" value={pass}
                      onChange={(e) => setPass(e.target.value)} placeholder={secT('atLeast', { n: MIN_PASSPHRASE })} />
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="vault-pass2">{secT('repeatPass')}</label>
                    <input id="vault-pass2" className={`${controls.input} ${again && again !== pass ? controls.inputInvalid : ''}`}
                      type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
                  </div>
                </div>
              )}
              {mode === 'enable' && (
                <label className={styles.rowText} style={{ flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>{secT('ack')}</span>
                </label>
              )}
              {error && <span className={controls.error} role="alert">{error}</span>}
              <div className={styles.buttons}>
                <button type="submit" className={mode === 'disable' ? controls.btnDanger : controls.btnPrimary} disabled={busy}>
                  {busy ? secT('working') : mode === 'enable' ? secT('encrypt') : mode === 'change' ? secT('changePass') : secT('turnOffVault')}
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => reset()} disabled={busy}>
                  {secT('cancel')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
