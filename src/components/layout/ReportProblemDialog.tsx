/**
 * Private beta: Help → "Report a problem" v2 (R6-A5). Problem / Idea / Question with typed fields (scrubbed), the
 * masked diagnostic block (src/lib/diagnostics.ts) and the screens visited before (route-trail.ts). Nothing leaves
 * the device until the tester taps Share / WhatsApp / E-mail, and those open with no fixed recipient. The build id
 * comes from the service worker's Cache Storage name, everything else from this tab. Lazy chunk, loaded when opened.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, MessageSquare, RefreshCw, Share2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { buildDiagnostics } from '../../lib/diagnostics';
import { APP_VERSION } from '../../lib/app-version';
import { recentRoutes } from '../../lib/route-trail';
import {
  FEEDBACK_DRAFT_KEY,
  capForShare,
  composeFeedback,
  emptyDraft,
  mailtoLink,
  parseDraft,
  subjectFor,
  whatsappLink,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackSeverity,
} from '../../lib/feedback';
import { helpIndex } from '../../lib/help/registry';
import { recentErrors } from '../../lib/error-ring';
import { assessStorage, measureStorage } from '../../lib/storage-health';
import { isIosSafari, isStandalone } from '../../lib/pwa';
import { DB_PREFIX, readRaw, storageBackend, storageFailure, vaultEnabled, writeRaw } from '../../lib/storage';
import { getLanguage, useT } from '../../i18n';
import { betaT } from '../../i18n/areas/beta';
import controls from '../../styles/controls.module.css';
import styles from './HelpModal.module.css';
import { SelectField } from '../ui/SelectField';

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
    appVersion: APP_VERSION,
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
    // The shell pushes every route; the last one is the current screen (already in "Screen").
    trail: recentRoutes().slice(0, -1),
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

const readDraft = (): FeedbackDraft | null => {
  try {
    return parseDraft(readRaw(FEEDBACK_DRAFT_KEY));
  } catch {
    return null;
  }
};
const writeDraft = (d: FeedbackDraft | null) => {
  try {
    writeRaw(FEEDBACK_DRAFT_KEY, d ? JSON.stringify(d) : '');
  } catch {
    /* storage blocked: the draft lasts while the dialog is open */
  }
};
const isBlank = (d: FeedbackDraft) => !d.did.trim() && !d.expected.trim() && !d.actual.trim();

const KINDS: readonly [FeedbackKind, 'kindProblem' | 'kindIdea' | 'kindQuestion'][] = [['problem', 'kindProblem'], ['idea', 'kindIdea'], ['question', 'kindQuestion']];
const SEVERITIES: readonly [FeedbackSeverity, 'sevBlocks' | 'sevAnnoying' | 'sevCosmetic'][] = [['blocks', 'sevBlocks'], ['annoying', 'sevAnnoying'], ['cosmetic', 'sevCosmetic']];

export default function ReportProblemDialog({ onClose, area = '' }: { onClose: () => void; area?: string }) {
  useT(); // re-render on a language switch (5.4)
  const [diag, setDiag] = useState('');
  const [status, setStatus] = useState<'' | 'copied' | 'failed' | 'shortened' | 'shared'>('');
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<FeedbackDraft>(() => {
    const kept = readDraft();
    return kept && !isBlank(kept) ? kept : emptyDraft(area);
  });
  const [areas, setAreas] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    collect().then(
      (text) => alive && setDiag(text),
      () => alive && setDiag(''),
    );
    return () => {
      alive = false;
    };
  }, [tick]);
  useEffect(() => {
    let alive = true;
    helpIndex().then(
      (all) => alive && setAreas([...new Set(all.filter((x) => !x.id.includes(':')).map((x) => x.title))].sort((a, b) => a.localeCompare(b))),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  // The unsent draft stays on this device until it is shared or cleared.
  useEffect(() => writeDraft(isBlank(draft) ? null : draft), [draft]);

  const patch = (p: Partial<FeedbackDraft>) => {
    setStatus('');
    setDraft((d) => ({ ...d, ...p }));
  };
  const report = useMemo(() => (diag ? composeFeedback(draft, diag) : ''), [draft, diag]);
  const capped = useMemo(() => (diag ? capForShare(draft, diag) : { text: '', shortened: false }), [draft, diag]);
  // QA7 G4: a link that cannot be built (malformed text) leaves Copy / Share, never crashes the app.
  const links = useMemo(() => {
    try {
      return { wa: whatsappLink(capped.text), mail: mailtoLink(subjectFor(draft), capped.text) };
    } catch {
      return null;
    }
  }, [capped, draft]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(report);
      return true;
    } catch {
      return false;
    }
  };
  const sent = () => {
    writeDraft(null);
    setStatus('shared');
  };
  const share = async () => {
    try {
      await navigator.share({ title: subjectFor(draft), text: report });
      sent();
    } catch {
      /* cancelled by the tester */
    }
  };
  /** WhatsApp / e-mail: when the link text had to be shortened, the full report goes to the clipboard as well. */
  const viaLink = () => {
    if (capped.shortened) void copy().then((ok) => setStatus(ok ? 'shortened' : 'failed'));
    else sent();
  };
  const refresh = () => {
    setStatus('');
    setTick((n) => n + 1);
  };
  const clear = () => {
    writeDraft(null);
    setDraft(emptyDraft(area));
    setStatus('');
  };
  const areaOptions = draft.area && !areas.includes(draft.area) ? [draft.area, ...areas] : areas;

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
          <button type="button" className={controls.btnGhost} onClick={clear}>
            {betaT('clear')}
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => void copy().then((ok) => setStatus(ok ? 'copied' : 'failed'))} disabled={!report}>
            <Copy size={14} aria-hidden="true" /> {betaT('copy')}
          </button>
          {report && links && (
            <>
              <a className={controls.btnOutline} href={links.wa} target="_blank" rel="noopener noreferrer" onClick={viaLink} data-report-whatsapp>
                <MessageSquare size={14} aria-hidden="true" /> {betaT('whatsapp')}
              </a>
              <a className={controls.btnOutline} href={links.mail} onClick={viaLink} data-report-email>
                {betaT('email')}
              </a>
            </>
          )}
          {canShare && (
            <button type="button" className={controls.btnPrimary} onClick={() => void share()} disabled={!report} data-report-share>
              <Share2 size={14} aria-hidden="true" /> {betaT('share')}
            </button>
          )}
        </>
      }
    >
      <p className={styles.featureText}>{betaT('privacy')}</p>
      <div className={controls.segment} role="radiogroup" aria-label={betaT('kind')}>
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={draft.kind === k}
            className={draft.kind === k ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => patch({ kind: k })}
            data-report-kind={k}
          >
            {betaT(label)}
          </button>
        ))}
      </div>
      <label className={controls.field}>
        <span className={controls.label}>{betaT('area')}</span>
        <SelectField className={controls.select} value={draft.area} onChange={(e) => patch({ area: e.target.value })} data-report-area>
          <option value="">{betaT('areaNone')}</option>
          {areaOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </SelectField>
      </label>
      <label className={controls.field}>
        <span className={controls.label}>{draft.kind === 'idea' ? betaT('didIdea') : draft.kind === 'question' ? betaT('didQuestion') : betaT('did')}</span>
        <textarea className={controls.textarea} rows={3} value={draft.did} onChange={(e) => patch({ did: e.target.value })} data-report-did />
      </label>
      {draft.kind === 'problem' && (
        <>
          <label className={controls.field}>
            <span className={controls.label}>{betaT('expected')}</span>
            <textarea className={controls.textarea} rows={2} value={draft.expected} onChange={(e) => patch({ expected: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{betaT('actual')}</span>
            <textarea className={controls.textarea} rows={2} value={draft.actual} onChange={(e) => patch({ actual: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{betaT('severity')}</span>
            <SelectField className={controls.select} value={draft.severity} onChange={(e) => patch({ severity: e.target.value as FeedbackSeverity })}>
              {SEVERITIES.map(([v, label]) => (
                <option key={v} value={v}>{betaT(label)}</option>
              ))}
            </SelectField>
          </label>
        </>
      )}
      <p className={styles.featureText}>
        {betaT('channel')} {betaT('draftKept')}
      </p>
      <label className={controls.field}>
        <span className={controls.label}>{betaT('reportLabel')}</span>
        <textarea
          className={controls.textarea}
          value={report || betaT('preparing')}
          readOnly
          rows={10}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          data-report-problem
        />
      </label>
      <p className={styles.featureText} role="status" aria-live="polite">
        {status === 'copied' ? betaT('copied') : status === 'failed' ? betaT('copyFailed') : status === 'shortened' ? betaT('shortened') : status === 'shared' ? betaT('shared') : ''}
      </p>
    </Modal>
  );
}
