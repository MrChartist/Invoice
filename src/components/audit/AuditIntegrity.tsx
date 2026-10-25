import { useState } from 'react';
import { Copy, Download, ShieldAlert, ShieldCheck } from 'lucide-react';
import { audit } from '../../lib/audit';
import { can } from '../../lib/access';
import { isPayrollAudit } from '../../lib/audit-query';
import { AUDIT_ENTITY_LABELS } from '../../types/audit';
import { describeChain, verifyAuditChain, type ChainReport } from '../../lib/audit-chain';
import { downloadText } from '../../lib/download';
import { localDayOf } from '../../lib/dates';
import { formatWhen } from './audit-format';
import controls from '../../styles/controls.module.css';
import styles from './audit.module.css';

const HEX64 = /^[0-9a-f]{64}$/i;

/** Settings → Activity: check the hash chain and hand out the head hash as an outside anchor. */
export function AuditIntegrity() {
  const [report, setReport] = useState<ChainReport | null>(null);
  const [noted, setNoted] = useState('');
  const [copied, setCopied] = useState(false);
  const head = audit.head();
  const notedOk = noted.trim() === '' || HEX64.test(noted.trim());

  const run = () => {
    // WP-7: the whole chain — archive segments + live log — verifies as one.
    setReport(verifyAuditChain(audit.fullRows(), { notedHead: noted.trim() || undefined }));
  };

  const copy = async () => {
    if (!head) return;
    try {
      await navigator.clipboard.writeText(head);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const exportHead = () => {
    if (!head) return;
    const now = new Date();
    downloadText(
      `activity-log-head-${localDayOf(now)}.txt`,
      [
        'Mr. Chartist Invoice: activity log chain head',
        `Head hash (SHA-256): ${head}`,
        `Entries in the log:  ${audit.count()}${audit.archivedCount() ? ` (+ ${audit.archivedCount()} in archive segments)` : ''}`,
        `Noted at:            ${now.toISOString()}`,
        '',
        'Keep this file (or send it to your CA). Later, paste the hash into Settings > Activity >',
        '"Check a hash you noted" and press Verify: if the log was rewritten, or entries after this',
        'point were removed, verification fails. This detects changes to the log; it does not stop',
        'someone with full access to the device from replacing all of the data.',
        '',
      ].join('\n'),
    );
  };

  const brokenRow = report?.broken && report.broken.index < report.total ? audit.fullRows()[report.broken.index] : undefined;

  return (
    <div className={styles.integrity}>
      <div className={styles.integrityHead}>
        <strong>Integrity</strong>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={run} disabled={!notedOk}>
          <ShieldCheck size={14} aria-hidden="true" /> Verify integrity
        </button>
      </div>
      <p className={styles.integrityNote}>
        Each entry is sealed with a SHA-256 hash that includes the entry before it, so editing, deleting or reordering
        entries inside the app&apos;s data shows up here. Someone with full access to this device could still rewrite
        everything, hashes included &mdash; note the head hash below (or send it to your CA) to make that detectable later.
      </p>

      <div className={styles.headRow}>
        <span className={controls.label}>Chain head</span>
        <code className={styles.hash}>{head ?? 'not started yet: it begins with the next change'}</code>
        <span className={styles.headActions}>
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={copy} disabled={!head}>
            <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={exportHead} disabled={!head}>
            <Download size={14} aria-hidden="true" /> Export
          </button>
        </span>
      </div>

      <label className={controls.field}>
        <span className={controls.label}>Check a hash you noted (optional)</span>
        <input
          className={`${controls.input} ${controls.inputMono}`}
          value={noted}
          onChange={(e) => {
            setNoted(e.target.value);
            setReport(null);
          }}
          placeholder="64-character head hash"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!notedOk}
        />
        {!notedOk && <span className={controls.error}>A head hash is 64 characters, 0-9 and a-f.</span>}
      </label>

      {report && (
        <div className={`${styles.integrityResult} ${report.ok ? styles.integrityOk : styles.integrityBad}`} role="status">
          {report.ok ? <ShieldCheck size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
          <div>
            <strong>{report.ok ? 'No tampering found' : `Integrity check failed (${report.broken?.reason})`}</strong>
            <div>{describeChain(report)}</div>
            {brokenRow && (
              <div className={styles.tMeta}>
                Entry {report.broken!.index + 1}: {formatWhen(brokenRow.at)} &middot; {isPayrollAudit(brokenRow) && !can('payroll.view') ? AUDIT_ENTITY_LABELS[brokenRow.entity] : brokenRow.summary}
              </div>
            )}
            {report.noted?.status === 'present' && (
              <div className={styles.tMeta}>
                The noted hash is entry {report.noted.index + 1}; {report.noted.newer} entr{report.noted.newer === 1 ? 'y has' : 'ies have'} been added since.
              </div>
            )}
            {report.noted?.status === 'replaced' && (
              <div className={styles.tMeta}>The noted hash belonged to a log that a backup restore replaced on {formatWhen(report.noted.at)}.</div>
            )}
            {report.restores > 0 && (
              <div className={styles.tMeta}>
                {report.restores} restore{report.restores === 1 ? '' : 's'} recorded; each marker notes the backup&apos;s head and the head of the log it replaced.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
