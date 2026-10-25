import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useCan } from '../../hooks/useCan';
import { vaultEnabled } from '../../lib/storage';
import { downloadBackupNow, hasBackupEncryption, setBackupPassphrase } from '../../lib/auto-backup';
import { MIN_SHARE_PASSPHRASE, canShareBackup, shareBackupNow } from '../../lib/backup-share';
import { useT } from '../../i18n';
import { phoneT } from '../../i18n/areas/phone';
import controls from '../../styles/controls.module.css';
import styles from './PhoneBackup.module.css';

export interface ShareBackupDialogProps {
  open: boolean;
  onClose: () => void;
  /** Toast hook: called after a share / download, ok or not. */
  onResult?: (message: string, ok: boolean) => void;
}

/**
 * "Share backup" (8.20): encrypted backup → OS share sheet (Drive, WhatsApp, Files). Owner only.
 * Two taps when no passphrase is stored yet: setting the passphrase (slow key derivation) first,
 * then Share, so the share sheet still has a fresh user gesture.
 */
export function ShareBackupDialog({ open, onClose, onResult }: ShareBackupDialogProps) {
  useT();
  const { can } = useCan();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [remember, setRemember] = useState(true);
  const [oneOff, setOneOff] = useState('');
  const [plainAsk, setPlainAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const vault = vaultEnabled();
  const shareable = canShareBackup();

  useEffect(() => {
    if (!open) return;
    let live = true;
    void hasBackupEncryption().then((v) => live && setHasKey(v));
    return () => {
      live = false;
    };
  }, [open]);

  if (!can('data.backup')) return null;

  const finish = (message: string, ok: boolean) => {
    onResult?.(message, ok);
    if (ok) onClose();
    else setError(message);
  };

  const share = async (opts: { passphrase?: string; allowPlain?: boolean } = {}) => {
    setBusy(true);
    setError('');
    const r = await shareBackupNow(opts);
    setBusy(false);
    if (r.ok) finish(phoneT('shared', { file: r.filename }), true);
    else if (r.reason !== 'cancelled') finish(r.message, false);
  };

  const download = async () => {
    setBusy(true);
    const r = await downloadBackupNow();
    setBusy(false);
    finish(r.ok ? phoneT('shared', { file: r.filename }) : r.message, r.ok);
  };

  const setPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pass.length < MIN_SHARE_PASSPHRASE) return setError(phoneT('errShort', { n: MIN_SHARE_PASSPHRASE }));
    if (pass !== again) return setError(phoneT('errMismatch'));
    if (!remember) {
      setOneOff(pass);
      return;
    }
    setBusy(true);
    const r = await setBackupPassphrase(pass);
    setBusy(false);
    if (r.ok) setHasKey(true);
    else setError(r.message);
  };

  const ready = hasKey || !!oneOff;

  return (
    <Modal open={open} onClose={onClose} size="sm" title={phoneT('shareTitle')} subtitle={phoneT('shareSub')}>
      <div className={styles.stack} data-share-backup>
        {!shareable ? (
          <>
            <p className={styles.note}>{phoneT('noShare')}</p>
            <button type="button" className={controls.btnPrimary} onClick={download} disabled={busy}>{phoneT('download')}</button>
          </>
        ) : ready ? (
          <>
            <p className={styles.note}>{phoneT('shareKeyReady')}</p>
            <button type="button" className={`${controls.btnPrimary} ${controls.btnLg}`} onClick={() => share(oneOff ? { passphrase: oneOff } : {})} disabled={busy}>
              <Share2 size={18} aria-hidden="true" /> {busy ? phoneT('sharing') : phoneT('shareNow')}
            </button>
          </>
        ) : hasKey === false ? (
          <form className={styles.stack} onSubmit={setPassphrase} noValidate>
            <p className={styles.note}>{phoneT('shareNeedPass', { n: MIN_SHARE_PASSPHRASE })}</p>
            <label className={controls.field}>
              <span className={controls.label}>{phoneT('passphrase')}</span>
              <input className={controls.input} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{phoneT('passAgain')}</span>
              <input className={controls.input} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {phoneT('remember')}
            </label>
            <button type="submit" className={controls.btnPrimary} disabled={busy}>{busy ? phoneT('sharing') : phoneT('setPass')}</button>
          </form>
        ) : null}
        {shareable && !ready && hasKey === false && (
          vault ? <p className={styles.muted}>{phoneT('vaultNoPlain')}</p>
            : plainAsk ? (
              <div className={styles.warn} role="alert">
                <p>{phoneT('plainWarn')}</p>
                <div className={styles.row}>
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => share({ allowPlain: true })} disabled={busy}>{phoneT('plainConfirm')}</button>
                  <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setPlainAsk(false)}>{phoneT('cancel')}</button>
                </div>
              </div>
            ) : (
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setPlainAsk(true)}>{phoneT('plainLink')}</button>
            )
        )}
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
