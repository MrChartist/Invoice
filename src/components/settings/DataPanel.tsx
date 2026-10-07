import { useMemo, useRef, useState } from 'react';
import { DatabaseBackup, Download, FolderDown, FolderUp, HardDrive, Package, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import { backupFilename, applyBackup, buildBackup, parseBackup, wipeAppData, type BackupSummary } from '../../lib/backup';
import { appDataSize } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceItem } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Settings.module.css';

// localStorage is ~5 MB in every mainstream browser.
const QUOTA_BYTES = 5 * 1024 * 1024;

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

interface PendingRestore {
  data: Record<string, string>;
  summary: BackupSummary;
  fileName: string;
}

export function DataPanel({ notify }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const used = useMemo(() => appDataSize(), [version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalog = useMemo<InvoiceItem[]>(() => localDb.items.getAll(), [version]);
  const pct = Math.min(100, Math.round((used / QUOTA_BYTES) * 100));

  const exportBackup = () => {
    downloadText(backupFilename(), JSON.stringify(buildBackup(), null, 2), 'application/json');
    notify('Backup downloaded');
  };

  const saveToDisk = async () => {
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    if (!picker) return notify('Your browser cannot save to a folder. Use “Download backup” instead.', 'info');
    try {
      const handle = await picker({
        suggestedName: backupFilename(),
        types: [{ description: 'Invoice backup', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' }));
      await writable.close();
      notify('Backup saved to disk');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') notify(`Could not save: ${(err as Error).message}`, 'error');
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const { data, summary } = parseBackup(await file.text());
      setPending({ data, summary, fileName: file.name });
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restore = () => {
    if (!pending) return;
    try {
      applyBackup(pending.data);
      notify('Backup restored — reloading…');
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    setPending(null);
  };

  return (
    <div className={styles.editor}>
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <HardDrive size={16} /> Storage on this device
          </span>
          <span className={surface.mono}>
            {(used / 1024).toFixed(0)} KB of ~5 MB
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Browser storage used">
            <div className={`${styles.meterFill} ${pct > 80 ? styles.meterWarn : ''}`} style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          <p className={surface.sectionNote}>
            Everything lives in this browser only. Clearing site data, switching browser or using a private window
            will lose it — download a backup regularly.
          </p>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <DatabaseBackup size={16} /> Backup &amp; restore
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.actionGrid}>
            <button type="button" className={styles.action} onClick={exportBackup}>
              <strong><Download size={16} /> Download backup</strong>
              <span>A single JSON file with invoices, clients, catalogue, profiles and settings. Your PIN is not included.</span>
            </button>
            <button type="button" className={styles.action} onClick={saveToDisk}>
              <strong><FolderDown size={16} /> Save to a folder</strong>
              <span>Chrome &amp; Edge only. Pick a synced folder (Drive, OneDrive) to keep an off-browser copy.</span>
            </button>
            <button type="button" className={styles.action} onClick={() => fileInput.current?.click()}>
              <strong><Upload size={16} /> Restore from file</strong>
              <span>Replaces matching data on this device with the contents of a backup file.</span>
            </button>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <Package size={16} /> Item catalogue
          </span>
          <span className={styles.defaultTag}>{catalog.length} saved</span>
        </div>
        {catalog.length === 0 ? (
          <p className={surface.sectionNote} style={{ padding: '1.25rem' }}>
            Items you use on invoices are remembered here automatically, so you can pick them again in one click.
          </p>
        ) : (
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {catalog.map((item) => (
              <div key={item.id} className={styles.catalogRow}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {formatCurrency(item.rate)} {item.hsn ? `· HSN/SAC ${item.hsn}` : ''} {typeof item.tax_rate === 'number' ? `· GST ${item.tax_rate}%` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className={controls.btnDanger}
                  aria-label={`Remove ${item.name} from the catalogue`}
                  onClick={() => {
                    localDb.items.remove(item.id);
                    setVersion((v) => v + 1);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={`${surface.card} ${styles.danger}`}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon} style={{ color: 'var(--destructive)' }}>
            <FolderUp size={16} /> Danger zone
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>Permanently erase every invoice, client, item and profile on this device. Your PIN stays.</p>
          <button type="button" className={controls.btnOutline} style={{ alignSelf: 'flex-start', color: 'var(--destructive)' }} onClick={() => setWipeOpen(true)}>
            <Trash2 size={16} /> Erase all data
          </button>
        </div>
      </section>

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title="Restore this backup?"
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className={controls.btnPrimary} onClick={restore}>Restore</button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
          <strong style={{ color: 'var(--foreground)' }}>{pending?.fileName}</strong> contains {pending?.summary.invoices} invoice
          {pending?.summary.invoices === 1 ? '' : 's'} and {pending?.summary.clients} client{pending?.summary.clients === 1 ? '' : 's'}.
          Data of the same kind on this device will be replaced. Download a backup first if you are unsure.
        </p>
      </Modal>

      <ConfirmDialog
        open={wipeOpen}
        destructive
        title="Erase all data?"
        message="This cannot be undone. Download a backup first if there is anything you may need."
        confirmLabel="Erase everything"
        onConfirm={() => {
          wipeAppData();
          window.location.reload();
        }}
        onClose={() => setWipeOpen(false)}
      />
    </div>
  );
}
