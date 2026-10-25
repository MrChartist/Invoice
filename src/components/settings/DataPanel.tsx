import { reloadAfterFlush, storageBackend } from '../../lib/storage';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarCheck, DatabaseBackup, Download, FileCode2, FileUp, FolderDown, FolderUp, HardDrive, Info, Package, RotateCcw, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Modal } from '../ui/Modal';
import {
  backupFilename,
  clearSafetySnapshot,
  exportPlainBackup,
  plainBackupAllowed,
  VAULT_PLAIN_BACKUP_MESSAGE,
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
import { requireAccess } from '../../lib/access';
import { useCan } from '../../hooks/useCan';
import { ImportWizard } from '../import/ImportWizard';
import { SampleDataCard } from '../demo/SampleDataCard';
import { assessStorage, formatChars, measureStorage } from '../../lib/storage-health';
import { cleanupUnusedAttachments } from '../../lib/attachments';
import { isIosSafari, isStandalone, requestPersistentStorage } from '../../lib/pwa';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import type { InvoiceItem } from '../../types/invoice';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import { migT } from '../../i18n/areas/migration';

// WP-7: Tally import and the year-end wizard are separate lazy chunks, loaded on first open.
const TallyImport = lazy(() => import('../import/TallyImport').then((m) => ({ default: m.TallyImport })));
const YearEndWizard = lazy(() => import('../year-end/YearEndWizard').then((m) => ({ default: m.YearEndWizard })));
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
  useT(); // re-render on a language switch (5.4)
  const fileInput = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [importKind, setImportKind] = useState<'clients' | 'items' | 'invoices' | null>(null);
  const [wp7, setWp7] = useState<'tally' | 'yearEnd' | null>(null);
  const [safety, setSafety] = useState<SafetySnapshot | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [browserQuota, setBrowserQuota] = useState<number | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const { can } = useCan();
  const mayBackup = can('data.backup');
  const mayRestore = can('data.restore');
  // Vault mode (5.8): a readable backup file would undo the encryption at rest.
  const plainOk = plainBackupAllowed();

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
    try {
      downloadText(backupFilename(), exportPlainBackup(), 'application/json');
    } catch (err) {
      return notify((err as Error).message, 'error');
    }
    markBackupDone();
    notify(setT('backupDownloaded'));
  };

  const saveToDisk = async () => {
    const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
    if (!picker) return notify(setT('noFolderSave'), 'info');
    try {
      const text = exportPlainBackup(); // owner only; refused in vault mode — before any file is created
      const handle = await picker({
        suggestedName: backupFilename(),
        types: [{ description: 'Invoice backup', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: 'application/json' }));
      await writable.close();
      markBackupDone();
      notify(setT('backupSaved'));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') notify(setT('couldNotSave', { message: (err as Error).message }), 'error');
    }
  };

  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error(setT('fileTooBig'));
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
    try {
      // Role first (6.21): a refused restore must not replace the owner's undo copy either.
      requireAccess('data.restore');
      // Keep what is on the device now, so the restore can be undone from this panel.
      if (!(await saveSafetySnapshot('restore'))) notify(setT('noUndoCopy'), 'info');
      restoreBackup(pending.data);
      notify(setT('restored'));
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
            <HardDrive size={16} /> {setT('storage')}
          </span>
          <span className={surface.mono}>
            {setT('usedOf', { used: formatChars(health.usedChars), quota: formatChars(health.quotaChars) })}
          </span>
        </div>
        <div className={surface.cardBody}>
          <div className={styles.meter} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={setT('storageUsed')}>
            <div className={`${styles.meterFill} ${pct > 80 ? styles.meterWarn : ''}`} style={{ width: `${Math.max(pct, 1)}%` }} />
          </div>
          {health.findings.length > 0 && (
            <ul className={styles.health} aria-label={setT('storageHealth')}>
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
                {setT('attached', { n: health.attachments.count, size: formatChars(health.attachments.chars) })}
                {health.attachments.unused > 0 && setT('unusedFiles', { n: health.attachments.unused, size: formatChars(health.attachments.unusedChars) })}
              </span>
              {health.attachments.unused > 0 && (
                <button
                  type="button"
                  className={`${controls.btnOutline} ${controls.btnSm}`}
                  onClick={() => {
                    try {
                      const r = cleanupUnusedAttachments();
                      notify(setT(r.removed === 1 ? 'removedOne' : 'removedMany', { n: r.removed, size: formatChars(r.chars) }));
                    } catch (err) {
                      notify((err as Error).message, 'error');
                    }
                    setVersion((v) => v + 1);
                  }}
                >
                  <Trash2 size={14} /> {setT('cleanUp')}
                </button>
              )}
            </div>
          )}
          {health.biggest.length > 0 && (
            <p className={surface.sectionNote}>
              {setT('largest', { list: health.biggest.map((t) => `${t.name.replace(/_/g, ' ')} ${formatChars(t.chars)}`).join(' · ') })}
            </p>
          )}
          <p className={surface.sectionNote}>
            {setT('browserOnly')}
          </p>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <DatabaseBackup size={16} /> {setT('backupRestore')}
          </span>
        </div>
        <div className={surface.cardBody}>
          {mayBackup && !plainOk && (
            <p className={surface.sectionNote} role="note">
              <AlertTriangle size={14} aria-hidden="true" /> {VAULT_PLAIN_BACKUP_MESSAGE}
            </p>
          )}
          <div className={styles.actionGrid}>
            {mayBackup && (
              <>
                <button type="button" className={styles.action} onClick={exportBackup} disabled={!plainOk}>
                  <strong><Download size={16} /> {setT('downloadBackup')}</strong>
                  <span>{setT('downloadBackupText')}</span>
                </button>
                <button type="button" className={styles.action} onClick={saveToDisk} disabled={!plainOk}>
                  <strong><FolderDown size={16} /> {setT('saveFolder')}</strong>
                  <span>{setT('saveFolderText')}</span>
                </button>
              </>
            )}
            {mayRestore && (
            <button type="button" className={styles.action} onClick={() => fileInput.current?.click()}>
              <strong><Upload size={16} /> {setT('restoreFile')}</strong>
              <span>{setT('restoreFileText')}</span>
            </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="application/json,.json,text/plain,.txt" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          {safety && mayRestore && (
            <div className={styles.actionGrid}>
              <button type="button" className={styles.action} onClick={() => setUndoOpen(true)}>
                <strong><RotateCcw size={16} /> {safety.reason === 'wipe' ? setT('undoErase') : setT('undoRestore')}</strong>
                <span>{setT('undoText', { date: new Date(safety.at).toLocaleString('en-IN') })}</span>
              </button>
            </div>
          )}
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <FileUp size={16} /> {setT('importOther')}
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>
            {setT('importOtherText')}
          </p>
          <div className={styles.actionGrid}>
            <button type="button" className={styles.action} onClick={() => setImportKind('clients')}>
              <strong>{setT('impClients')}</strong>
              <span>{setT('impClientsText')}</span>
            </button>
            <button type="button" className={styles.action} onClick={() => setImportKind('items')}>
              <strong>{setT('impItems')}</strong>
              <span>{setT('impItemsText')}</span>
            </button>
            <button type="button" className={styles.action} onClick={() => setImportKind('invoices')}>
              <strong>{setT('impInvoices')}</strong>
              <span>{setT('impInvoicesText')}</span>
            </button>
          </div>
        </div>
      </section>

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <CalendarCheck size={16} /> {migT('cardTitle')}
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>{migT('cardText')}</p>
          <div className={styles.actionGrid}>
            {mayRestore && (
              <button type="button" className={styles.action} onClick={() => setWp7('tally')}>
                <strong><FileCode2 size={16} /> {migT('openImport')}</strong>
                <span>{migT('openImportText')}</span>
              </button>
            )}
            <button type="button" className={styles.action} onClick={() => setWp7('yearEnd')}>
              <strong><CalendarCheck size={16} /> {migT('openYearEnd')}</strong>
              <span>{migT('openYearEndText')}</span>
            </button>
          </div>
        </div>
      </section>
      {wp7 && (
        <Suspense fallback={null}>
          {wp7 === 'tally' ? (
            <TallyImport open onClose={() => setWp7(null)} notify={notify} />
          ) : (
            <YearEndWizard open onClose={() => setWp7(null)} notify={notify} />
          )}
        </Suspense>
      )}

      <SampleDataCard notify={notify} />

      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>
            <Package size={16} /> {setT('itemCatalogue')}
          </span>
          <span className={styles.defaultTag}>{setT('nSaved', { n: catalog.length })}</span>
        </div>
        {catalog.length === 0 ? (
          <p className={surface.sectionNote} style={{ padding: '1.25rem' }}>
            {setT('catalogueEmpty')}
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
                  aria-label={setT('removeFromCatalogue', { name: item.name })}
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
            <FolderUp size={16} /> {setT('dangerZone')}
          </span>
        </div>
        <div className={surface.cardBody}>
          <p className={surface.sectionNote}>{setT('dangerText')}</p>
          <button type="button" className={controls.btnOutline} style={{ alignSelf: 'flex-start', color: 'var(--destructive)' }} onClick={() => setWipeOpen(true)}>
            <Trash2 size={16} /> {setT('eraseAll')}
          </button>
        </div>
      </section>

      <ImportWizard
        open={importKind !== null}
        kind={importKind ?? undefined}
        onClose={() => setImportKind(null)}
        onDone={(report) => {
          setVersion((v) => v + 1);
          notify(setT(report.created + report.updated === 1 ? 'importedOne' : 'importedMany', { n: report.created + report.updated }));
        }}
      />

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title={setT('restoreTitle')}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setPending(null)}>{setT('cancel')}</button>
            <button type="button" className={controls.btnPrimary} onClick={restore}>{setT('restore')}</button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
          {setT('restoreContains', { file: pending?.fileName ?? '', invoices: pending?.summary.invoices ?? 0, clients: pending?.summary.clients ?? 0 })}
          {' '}{attachmentRestoreNote(pending?.summary)}{' '}
          {setT('restoreWarn')}
        </p>
      </Modal>

      <ConfirmDialog
        open={wipeOpen}
        destructive
        title={setT('eraseTitle')}
        message={setT('eraseMsg')}
        confirmLabel={setT('eraseConfirm')}
        requireText="ERASE"
        onConfirm={async () => {
          try {
            requireAccess('data.erase'); // before anything is forgotten (undo copy, backup key, vault)
          } catch (err) {
            return notify((err as Error).message, 'error');
          }
          await forgetDeviceData();
          wipeAppData();
          reloadAfterFlush();
        }}
        onClose={() => setWipeOpen(false)}
      />

      <ConfirmDialog
        open={undoOpen}
        destructive
        title={safety?.reason === 'wipe' ? setT('undoEraseTitle') : setT('undoRestoreTitle')}
        message={setT('undoMsg', { date: safety ? new Date(safety.at).toLocaleString('en-IN') : '' })}
        confirmLabel={setT('putBack')}
        onConfirm={async () => {
          if (!safety) return;
          try {
            restoreBackup(safety.data);
            await clearSafetySnapshot();
            notify(setT('putBackDone'));
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
