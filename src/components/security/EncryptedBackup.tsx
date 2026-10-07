import { useRef, useState } from 'react';
import { Download, FileLock2, Info, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  applyBackup,
  backupFilename,
  buildEncryptedBackup,
  decryptBackup,
  isEncryptedBackup,
  markBackupDone,
  parseBackup,
  type BackupSummary,
} from '../../lib/backup';
import { downloadText } from '../../lib/download';
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
    if (pass.length < 8) return setError('Use a passphrase of at least 8 characters.');
    if (pass !== again) return setError('The passphrases do not match.');
    setBusy(true);
    try {
      const text = await buildEncryptedBackup(pass);
      downloadText(backupFilename(new Date(), true), text, 'application/json');
      markBackupDone();
      setPass('');
      setAgain('');
      notify('Encrypted backup downloaded. Keep the passphrase safe — it cannot be recovered.');
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

  const restore = () => {
    if (!summary) return;
    try {
      applyBackup(summary.data);
      notify('Backup restored — reloading…');
      setTimeout(() => window.location.reload(), 700);
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
          <span>
            Encrypted backups are scrambled with AES-256 using a key derived from your passphrase. Without the passphrase the file
            cannot be opened — not even by us — so store it somewhere safe. Your PIN is never included in any backup.
          </span>
        </div>
        <div className={styles.passRow}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="enc-pass">Passphrase</label>
            <input id="enc-pass" className={controls.input} type="password" autoComplete="new-password" value={pass}
              onChange={(e) => setPass(e.target.value)} placeholder="At least 8 characters" />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="enc-pass2">Repeat passphrase</label>
            <input id="enc-pass2" className={`${controls.input} ${again && again !== pass ? controls.inputInvalid : ''}`}
              type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
        </div>
        {error && <span className={controls.error} role="alert">{error}</span>}
        <div className={styles.buttons}>
          <button type="submit" className={controls.btnPrimary} disabled={busy || !pass}>
            <Download size={16} /> {busy && !pending ? 'Encrypting…' : 'Download encrypted backup'}
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => fileInput.current?.click()}>
            <Upload size={16} /> Restore encrypted backup
          </button>
        </div>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </form>

      <Modal
        open={!!pending}
        onClose={closeRestore}
        size="sm"
        title={needsPassphrase ? 'Unlock encrypted backup' : 'Restore this backup?'}
        subtitle={pending?.fileName}
        footer={
          needsPassphrase ? (
            <>
              <button type="button" className={controls.btnOutline} onClick={closeRestore}>Cancel</button>
              <button type="submit" form="enc-restore-form" className={controls.btnPrimary} disabled={busy || !restorePass}>
                <FileLock2 size={16} /> {busy ? 'Decrypting…' : 'Decrypt'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={controls.btnOutline} onClick={closeRestore}>Cancel</button>
              <button type="button" className={controls.btnPrimary} onClick={restore}>Restore</button>
            </>
          )
        }
      >
        {needsPassphrase ? (
          <form id="enc-restore-form" className={styles.form} onSubmit={decrypt} noValidate>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="enc-restore-pass">Passphrase</label>
              <input id="enc-restore-pass" className={controls.input} type="password" autoComplete="off" autoFocus
                value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
            </div>
            {restoreError && <span className={controls.error} role="alert">{restoreError}</span>}
          </form>
        ) : (
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
            Contains {summary?.summary.invoices} invoice{summary?.summary.invoices === 1 ? '' : 's'} and {summary?.summary.clients}{' '}
            client{summary?.summary.clients === 1 ? '' : 's'}. Data of the same kind on this device will be replaced.
          </p>
        )}
      </Modal>
    </>
  );
}
