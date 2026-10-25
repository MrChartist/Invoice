import { reloadAfterFlush } from '../../lib/storage';
import { useEffect, useRef, useState } from 'react';
import { Download, FileLock2, Info, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  restoreBackup,
  saveSafetySnapshot,
  backupFilename,
  buildEncryptedBackup,
  decryptBackup,
  isEncryptedBackup,
  markBackupDone,
  parseBackup,
  attachmentRestoreNote,
  MAX_BACKUP_BYTES,
  type BackupSummary,
} from '../../lib/backup';
import { downloadText } from '../../lib/download';
import { takeShared } from '../../lib/share-inbox';
import { useT } from '../../i18n';
import { secT } from '../../i18n/areas/security';
import controls from '../../styles/controls.module.css';
import styles from './Security.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

interface Pending {
  text: string;
  fileName: string;
}

/**
 * Passphrase-encrypted export plus restore for files made by it. Restoring a
 * plain backup is still handled by the Data panel; this accepts either kind.
 */
export function EncryptedBackup({ notify }: { notify: Notify }) {
  useT(); // re-render on a language switch (5.4)
  const fileInput = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [pending, setPending] = useState<Pending | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [summary, setSummary] = useState<{ data: Record<string, string>; summary: BackupSummary } | null>(null);

  const exportEncrypted = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pass.length < 8) return setError(secT('errShortPass', { n: 8 }));
    if (pass !== again) return setError(secT('errPassMismatch'));
    setBusy(true);
    try {
      const text = await buildEncryptedBackup(pass);
      downloadText(backupFilename(new Date(), true), text, 'application/json');
      markBackupDone();
      setPass('');
      setAgain('');
      notify(secT('encDownloaded'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closeRestore = () => {
    setPending(null);
    setSummary(null);
    setRestorePass('');
    setRestoreError('');
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error(secT('fileTooBig'));
      const text = await file.text();
      if (isEncryptedBackup(text)) {
        setPending({ text, fileName: file.name });
      } else {
        // Plain file picked here: validate and go straight to confirmation.
        setSummary(parseBackup(text));
        setPending({ text, fileName: file.name });
      }
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // 8.20: a backup shared into the app (share target) opens here: same validation, passphrase and undo copy.
  useEffect(() => {
    const shared = takeShared('backup')?.[0];
    if (shared) void onFile(shared);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setRestoreError('');
    setBusy(true);
    try {
      setSummary(await decryptBackup(pending.text, restorePass));
    } catch (err) {
      setRestoreError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!summary) return;
    try {
      // Undo copy for Settings → Data → "Undo last restore" (owner only: checked before it is replaced).
      await saveSafetySnapshot('restore');
      restoreBackup(summary.data);
      notify(secT('restored'));
      setTimeout(reloadAfterFlush, 700);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    closeRestore();
  };

  const needsPassphrase = !!pending && !summary;

  return (
    <>
      <form className={styles.form} onSubmit={exportEncrypted} noValidate>
        <div className={styles.note}>
          <Info size={16} />
          <span>{secT('encIntro')}</span>
        </div>
        <div className={styles.passRow}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="enc-pass">{secT('passphrase')}</label>
            <input id="enc-pass" className={controls.input} type="password" autoComplete="new-password" value={pass}
              onChange={(e) => setPass(e.target.value)} placeholder={secT('atLeast', { n: 8 })} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="enc-pass2">{secT('repeatPass')}</label>
            <input id="enc-pass2" className={`${controls.input} ${again && again !== pass ? controls.inputInvalid : ''}`}
              type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
        </div>
        {error && <span className={controls.error} role="alert">{error}</span>}
        <div className={styles.buttons}>
          <button type="submit" className={controls.btnPrimary} disabled={busy || !pass}>
            <Download size={16} /> {busy && !pending ? secT('encrypting') : secT('downloadEnc')}
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => fileInput.current?.click()}>
            <Upload size={16} /> {secT('restoreEnc')}
          </button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json,text/plain,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </form>

      <Modal
        open={!!pending}
        onClose={closeRestore}
        size="sm"
        title={needsPassphrase ? secT('unlockEnc') : secT('restoreTitle')}
        subtitle={pending?.fileName}
        footer={
          needsPassphrase ? (
            <>
              <button type="button" className={controls.btnOutline} onClick={closeRestore}>{secT('cancel')}</button>
              <button type="submit" form="enc-restore-form" className={controls.btnPrimary} disabled={busy || !restorePass}>
                <FileLock2 size={16} /> {busy ? secT('decrypting') : secT('decrypt')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={controls.btnOutline} onClick={closeRestore}>{secT('cancel')}</button>
              <button type="button" className={controls.btnPrimary} onClick={restore}>{secT('restore')}</button>
            </>
          )
        }
      >
        {needsPassphrase ? (
          <form id="enc-restore-form" className={styles.form} onSubmit={decrypt} noValidate>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="enc-restore-pass">{secT('passphrase')}</label>
              <input id="enc-restore-pass" className={controls.input} type="password" autoComplete="off" autoFocus
                value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
            </div>
            {restoreError && <span className={controls.error} role="alert">{restoreError}</span>}
          </form>
        ) : (
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
            {secT('contains', { invoices: summary?.summary.invoices ?? 0, clients: summary?.summary.clients ?? 0 })} {attachmentRestoreNote(summary?.summary)} {secT('replaceWarn')}
          </p>
        )}
      </Modal>
    </>
  );
}
