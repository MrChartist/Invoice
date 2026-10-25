/**
 * Private beta: Help → "Report a problem". Builds a local diagnostic text (src/lib/diagnostics.ts)
 * with a Copy button. Nothing leaves the device: the build id comes from the service worker's
 * Cache Storage name, everything else from this tab. Lazy chunk, loaded only when opened.
 */
import { useEffect, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { version as appVersion } from '../../../package.json';
import { Modal } from '../ui/Modal';
import { buildDiagnostics } from '../../lib/diagnostics';
import { recentErrors } from '../../lib/error-ring';
import { assessStorage, measureStorage } from '../../lib/storage-health';
import { isIosSafari, isStandalone } from '../../lib/pwa';
import { DB_PREFIX, readRaw, storageBackend, storageFailure, vaultEnabled } from '../../lib/storage';
import { getLanguage, useT } from '../../i18n';
import { betaT } from '../../i18n/areas/beta';
import controls from '../../styles/controls.module.css';
import styles from './HelpModal.module.css';

/** `mci-shell-<id>` caches (public/sw.js): the precache build this tab was installed from. */
async function precacheBuild(): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const ids = (await caches.keys()).map((k) => /^mci-shell-(.+)$/.exec(k)?.[1]).filter((x): x is string => !!x);
    return ids.length ? ids.join(' + ') : null;
  } catch {
    return null;
  }
}

async function storageEstimate(): Promise<{ persisted: boolean | null; quota: number | null }> {
  try {
    const sm = navigator.storage;
    const persisted = sm?.persisted ? await sm.persisted() : null;
    const quota = sm?.estimate ? ((await sm.estimate()).quota ?? null) : null;
    return { persisted, quota };
  } catch {
    return { persisted: null, quota: null };
  }
}

async function collect(): Promise<string> {
  const [buildId, est] = await Promise.all([precacheBuild(), storageEstimate()]);
  const backend = storageBackend();
  const lastRaw = readRaw(`${DB_PREFIX}last_backup`);
  const lastBackupIso = lastRaw && !Number.isNaN(Date.parse(lastRaw)) ? lastRaw : null;
  const measured = measureStorage();
  const health = assessStorage({
    ...measured,
    ...(backend === 'idb' && est.quota ? { quotaChars: Math.floor(est.quota / 2) } : {}),
    persisted: est.persisted,
    iosSafari: isIosSafari(),
    standalone: isStandalone(),
    lastBackupIso,
    now: new Date(),
  });
  return buildDiagnostics({
    appVersion,
    buildId,
    userAgent: navigator.userAgent,
    uiLanguage: getLanguage(),
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    online: navigator.onLine,
    standalone: isStandalone(),
    offlineReady: Boolean(navigator.serviceWorker?.controller),
    viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    pathname: window.location.pathname,
    search: window.location.search,
    errors: recentErrors(),
    storage: {
      backend,
      vault: vaultEnabled(),
      failure: storageFailure()?.message ?? null,
      level: health.level,
      pct: health.pct,
      usedChars: health.usedChars,
      quotaChars: health.quotaChars,
      keyCount: measured.tables.length,
      persisted: est.persisted,
      lastBackupIso,
      findings: health.findings.map((f) => `${f.id}:${f.level}`),
    },
    now: new Date(),
  });
}

export default function ReportProblemDialog({ onClose }: { onClose: () => void }) {
  useT(); // re-render on a language switch (5.4)
  const [report, setReport] = useState('');
  const [status, setStatus] = useState<'' | 'copied' | 'failed'>('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    collect().then(
      (text) => alive && setReport(text),
      () => alive && setReport(''),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  const refresh = () => {
    setStatus('');
    setTick((n) => n + 1);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={betaT('title')}
      subtitle={betaT('subtitle')}
      size="md"
      footer={
        <>
          <button type="button" className={controls.btnGhost} onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" /> {betaT('refresh')}
          </button>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {betaT('close')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={() => void copy()} disabled={!report}>
            <Copy size={14} aria-hidden="true" /> {betaT('copy')}
          </button>
        </>
      }
    >
      <p className={styles.featureText}>{betaT('privacy')}</p>
      <p className={styles.featureText}>{betaT('steps')}</p>
      <label className={controls.field}>
        <span className={controls.label}>{betaT('reportLabel')}</span>
        <textarea
          className={controls.textarea}
          value={report || betaT('preparing')}
          readOnly
          rows={14}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          data-report-problem
        />
      </label>
      <p className={styles.featureText} role="status" aria-live="polite">
        {status === 'copied' ? betaT('copied') : status === 'failed' ? betaT('copyFailed') : ''}
      </p>
    </Modal>
  );
}
