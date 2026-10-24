import { reloadAfterFlush, storageBackend } from '../../lib/storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, DatabaseBackup, Download, FileUp, FolderDown, FolderUp, HardDrive, Info, Package, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import {
  backupFilename,
  buildBackup,
  clearSafetySnapshot,
  getLastBackup,
  getSafetySnapshot,
  markBackupDone,
  parseBackup,
  restoreBackup,
  saveSafetySnapshot,
  wipeAppData,
  attachmentRestoreNote,
  MAX_BACKUP_BYTES,
  type BackupSummary,
  type SafetySnapshot,
} from '../../lib/backup';
import { forgetDeviceData } from '../../lib/auto-backup';
import { ImportWizard } from '../import/ImportWizard';
import { SampleDataCard } from '../demo/SampleDataCard';
import { assessStorage, formatChars, measureStorage } from '../../lib/storage-health';
import { cleanupUnusedAttachments } from '../../lib/attachments';
import { isIosSafari, isStandalone, requestPersistentStorage } from '../../lib/pwa';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceItem } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Settings.module.css';

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
  const [importKind, setImportKind] = useState<'clients' | 'items' | 'invoices' | null>(null);
  const [safety, setSafety] = useState<SafetySnapshot | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [browserQuota, setBrowserQuota] = useState<number | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getSafetySnapshot().then((snap) => alive && setSafety(snap));
    requestPersistentStorage().then((st) => {
      if (!alive) return;
      setPersisted(st.supported ? st.persisted : null);
      setBrowserQuota(st.quota);
    });
    return () => {
      alive = false;
    };
  }, []);

  const health = useMemo(
    () =>
      assessStorage({
        ...measureStorage(),
        // IndexedDB backend: the browser's own estimate (bytes; strings take up to 2 bytes a character).
        ...(storageBackend() === 'idb' && browserQuota ? { quotaChars: Math.floor(browserQuota / 2) } : {}),
        persisted,
        iosSafari: isIosSafari(),
        standalone: isStandalone(),
        lastBackupIso: getLastBackup(),
        now: new Date(),
      }),
    [version, persisted, browserQuota], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalog = useMemo<InvoiceItem[]>(() => localDb.items.getAll(), [version]);
  const pct = health.pct;

  const exportBackup = () => {
    downloadText(backupFilename(), JSON.stringify(buildBackup(), null, 2), 'application/json');
    markBackupDone();
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
      markBackupDone();
      notify('Backup saved to disk');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') notify(`Could not save: ${(err as Error).message}`, 'error');
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This file is larger than 200 MB — not a file this app wrote.');
      const { data, summary } = parseBackup(await file.text());
      setPending({ data, summary, fileName: file.name });
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restore = async () => {
    if (!pending) return;
    // Keep what is on the device now, so the restore can be undone from this panel.
    if (!(await saveSafetySnapshot('restore'))) notify('Could not keep an undo copy in this browser; restoring anyway.', 'info');
    try {
      restoreBackup(pending.data);
      notify('Backup restored — reloading…');
      setTimeout(reloadAfterFlush, 700);
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
            {formatChars(health.usedChars)} of ~{formatChars(health.quotaChars)}
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Browser storage used">
            <div className={`${styles.meterFill} ${pct > 80 ? styles.meterWarn : ''}`} style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          {health.findings.length > 0 && (
            <ul className={styles.health} aria-label="Storage health">
              {health.findings.map((f) => (
                <li key={f.id}>
                  {f.level === 'ok' ? (
                    <Info size={16} className={styles.healthOk} aria-hidden="true" />
                  ) : (
                    <AlertTriangle size={16} className={f.level === 'critical' ? styles.healthCritical : styles.healthWarn} aria-hidden="true" />
                  )}
                  <div>
                    <strong>{f.title}</strong>
                    <span>{f.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {health.attachments.count > 0 && (
            <div className={styles.attachRow}>
              <span className={surface.sectionNote}>
                Attached files: {health.attachments.count} ({formatChars(health.attachments.chars)})
                {health.attachments.unused > 0 && ` · ${health.attachments.unused} unused (${formatChars(health.attachments.unusedChars)})`}
              </span>
              {health.attachments.unused > 0 && (
                <button
                  type="button"
                  className={`${controls.btnOutline} ${controls.btnSm}`}
                  onClick={() => {
                    try {
                      const r = cleanupUnusedAttachments();
                      notify(`Removed ${r.removed} unused file${r.removed === 1 ? '' : 's'} (${formatChars(r.chars)})`);
                    } catch (err) {
                      notify((err as Error).message, 'error');
                    }
                    setVersion((v) => v + 1);
                  }}
                >
                  <Trash2 size={14} /> Clean up unused files
                </button>
              )}
            </div>
          )}
          {health.biggest.length > 0 && (
            <p className={surface.sectionNote}>
              Largest: {health.biggest.map((t) => `${t.name.replace(/_/g, ' ')} ${formatChars(t.chars)}`).join(' · ')}
            </p>
          )}
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
              <span>Replaces everything on this device with the contents of a backup file (your PIN is kept).</span>
            </button>
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          {safety && (
            <div className={styles.actionGrid}>
              <button type="button" className={styles.action} onClick={() => setUndoOpen(true)}>
                <strong><RotateCcw size={16} /> Undo last {safety.reason === 'wipe' ? 'erase' : 'restore'}</strong>
                <span>
                  A copy of your data was kept on {new Date(safety.at).toLocaleString('en-IN')}, just before it was
                  replaced. Put it back if the restore was a mistake.
                </span>
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <FileUp size={16} /> Import from another tool
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>
            Bring clients, items or past invoices from Excel, Vyapar, Zoho Books, Tally or Busy exports (CSV). You map the columns and review every row before anything is saved.
          </p>
          <div className={styles.actionGrid}>
            <button type="button" className={styles.action} onClick={() => setImportKind('clients')}>
              <strong>Clients</strong>
              <span>Names, GSTIN, address, contact details.</span>
            </button>
            <button type="button" className={styles.action} onClick={() => setImportKind('items')}>
              <strong>Items &amp; services</strong>
              <span>Name, HSN/SAC, rate, GST %, unit.</span>
            </button>
            <button type="button" className={styles.action} onClick={() => setImportKind('invoices')}>
              <strong>Past invoices</strong>
              <span>Opening records that keep their original numbers and totals.</span>
            </button>
          </div>
        </div>
      </section>

      <SampleDataCard notify={notify} />

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

      <ImportWizard
        open={importKind !== null}
        kind={importKind ?? undefined}
        onClose={() => setImportKind(null)}
        onDone={(report) => {
          setVersion((v) => v + 1);
          notify(`Imported ${report.created + report.updated} record${report.created + report.updated === 1 ? '' : 's'}`);
        }}
      />

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
          {' '}{attachmentRestoreNote(pending?.summary)}{' '}
          Everything currently on this device will be replaced by this backup (your PIN is kept). Download a backup first if you are unsure.
        </p>
      </Modal>

      <ConfirmDialog
        open={wipeOpen}
        destructive
        title="Erase all data?"
        message="Every invoice, client, payment and setting on this device will be permanently deleted, together with the restore undo copy, the backup encryption key and the backup-folder link (your PIN is kept). This cannot be undone — download a backup first if there is anything you may need."
        confirmLabel="Erase everything"
        requireText="ERASE"
        onConfirm={async () => {
          await forgetDeviceData();
          wipeAppData();
          reloadAfterFlush();
        }}
        onClose={() => setWipeOpen(false)}
      />

      <ConfirmDialog
        open={undoOpen}
        destructive
        title={`Undo the last ${safety?.reason === 'wipe' ? 'erase' : 'restore'}?`}
        message={`Everything on this device will be replaced by the copy taken on ${safety ? new Date(safety.at).toLocaleString('en-IN') : ''}. Your PIN is kept.`}
        confirmLabel="Put it back"
        onConfirm={async () => {
          if (!safety) return;
          try {
            restoreBackup(safety.data);
            await clearSafetySnapshot();
            notify('Previous data put back — reloading…');
            setTimeout(reloadAfterFlush, 700);
          } catch (err) {
            notify((err as Error).message, 'error');
          }
        }}
        onClose={() => setUndoOpen(false)}
      />
    </div>
  );
}
