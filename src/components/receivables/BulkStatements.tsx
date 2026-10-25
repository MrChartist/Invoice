import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, Printer } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { StatementDocument } from './StatementDocument';
import { buildLedger, type Ledger, type PartyReceivable } from '../../lib/receivables';
import { clientFor, printConfirmationLetters } from './letters';
import { nextPaint, PdfBuilder, safeStem, zipFiles } from '../../lib/pdf-batch';
import { downloadBlob } from '../../lib/download';
import { todayInput } from '../../lib/utils';
import type { Client, SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import { printT } from '../../i18n/areas/printing';
import controls from '../../styles/controls.module.css';
import styles from './StatementViewer.module.css';
import { STATEMENT_STYLES, loadStatementPrefs, saveStatementPrefs, skipInBulk, type StatementStyle } from '../../lib/statement-styles';
import { colT } from '../../i18n/areas/collections';

interface Props {
  parties: PartyReceivable[];
  clients: Client[];
  sender: SenderProfile | null;
  currency: string;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
}

/**
 * Bulk statements (P1-6 print part): pick parties and a period → one combined statement PDF, a
 * ZIP with one PDF per party, or printed confirmation-of-accounts letters. Statements are the
 * same StatementDocument as the single viewer, rendered off-screen one at a time.
 */
export function BulkStatements({ parties, clients, sender, currency, defaultFrom, defaultTo, onClose }: Props) {
  useT();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [onlyBalance, setOnlyBalance] = useState(true);
  // R2-A6: style + ageing strip; parties with no activity in range (or no open balance for open-item) are skipped.
  const [prefs, setPrefs] = useState(loadStatementPrefs);
  const setStyle = (next: typeof prefs) => { setPrefs(next); saveStatementPrefs(next); };
  const sorted = useMemo(() => [...parties].sort((a, b) => a.name.localeCompare(b.name)), [parties]);
  const shown = useMemo(() => sorted.filter((p) => {
    const ledger = buildLedger(p, from, to);
    if (onlyBalance && Math.abs(ledger.closing) < 0.005) return false;
    return !skipInBulk(p, ledger, prefs.style);
  }), [sorted, onlyBalance, from, to, prefs.style]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(parties.map((p) => p.key)));
  const chosen = shown.filter((p) => picked.has(p.key));
  const [job, setJob] = useState<{ party: PartyReceivable; ledger: Ledger } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const paper = useRef<HTMLDivElement>(null);
  const painted = useRef<(() => void) | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!job || !painted.current) return;
    const done = painted.current;
    painted.current = null;
    void nextPaint().then(done);
  }, [job]);
  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const statements = async (zip: boolean) => {
    cancelled.current = false;
    setError('');
    setProgress({ done: 0, total: chosen.length });
    try {
      const combined = zip ? null : await PdfBuilder.create();
      const files: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < chosen.length; i++) {
        if (cancelled.current) return;
        const party = chosen[i];
        await new Promise<void>((resolve) => {
          painted.current = resolve;
          setJob({ party, ledger: buildLedger(party, from, to) });
        });
        if (!paper.current) continue;
        const target = combined ?? (await PdfBuilder.create());
        await target.addPaper(paper.current, null);
        if (!combined) files.push({ name: `Statement_${safeStem(party.name, 'party')}_${to || 'all'}.pdf`, data: await target.bytes() });
        setProgress({ done: i + 1, total: chosen.length });
      }
      if (combined) downloadBlob(`Statements_${to || todayInput()}.pdf`, combined.blob());
      else downloadBlob(`Statements_${to || todayInput()}.zip`, await zipFiles(files));
    } catch (err) {
      console.error('Bulk statements failed', err);
      setError(printT('failed'));
    } finally {
      setJob(null);
      setProgress(null);
    }
  };

  const toggle = (key: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(key);
    else next.delete(key);
    setPicked(next);
  };
  const busy = progress !== null;
  const invalid = Boolean(from && to && from > to) || chosen.length === 0;

  return (
    <Modal
      open
      size="md"
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      title={printT('bulkTitle')}
      subtitle={printT('offline')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} disabled={busy || invalid} onClick={() => printConfirmationLetters(chosen, clients, sender, from, to, currency)}>
            <Printer size={16} /> {printT('letters')}
          </button>
          <button type="button" className={controls.btnOutline} disabled={busy || invalid} onClick={() => statements(true)}>
            <Download size={16} /> {printT('statementsZip')}
          </button>
          <button type="button" className={controls.btnPrimary} disabled={busy || invalid} onClick={() => statements(false)}>
            {busy ? <Loader2 size={16} className={styles.spin} /> : <Download size={16} />} {printT('statementsPdf')}
          </button>
        </>
      }
    >
      <div className={controls.row3}>
        <label className={controls.field}>
          <span className={controls.label}>{printT('from')}</span>
          <input type="date" className={controls.input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{printT('to')}</span>
          <input type="date" className={controls.input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className={controls.check} style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={onlyBalance} onChange={(e) => setOnlyBalance(e.target.checked)} />
          {printT('withBalance')}
        </label>
      </div>
      <div className={controls.row}>
        <label className={controls.field}>
          <span className={controls.label}>{colT('stStyle')}</span>
          <select className={controls.select} value={prefs.style} onChange={(e) => setStyle({ ...prefs, style: e.target.value as StatementStyle })} data-bulk-style>
            {STATEMENT_STYLES.map((st) => <option key={st} value={st}>{colT(`st.${st}`)}</option>)}
          </select>
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={prefs.ageing} onChange={(e) => setStyle({ ...prefs, ageing: e.target.checked })} />
          {colT('stAgeing')}
        </label>
      </div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
        <legend className={controls.label}>
          {printT('parties')} · {printT('selected', { n: chosen.length })}{' '}
          <button type="button" className={controls.btnGhost} onClick={() => setPicked(new Set(parties.map((p) => p.key)))}>{printT('selectAll')}</button>
          <button type="button" className={controls.btnGhost} onClick={() => setPicked(new Set())}>{printT('selectNone')}</button>
        </legend>
        <div style={{ maxHeight: 260, overflow: 'auto', display: 'grid', gap: 4 }}>
          {shown.map((p) => (
            <label key={p.key} className={controls.check}>
              <input type="checkbox" checked={picked.has(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      {progress && (
        <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
          <progress max={progress.total} value={progress.done} style={{ width: '100%' }} />
          <div className={controls.hint}>{printT('progress', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</div>
        </div>
      )}
      {error && <p className={controls.error} role="alert">{error}</p>}
      {job &&
        createPortal(
          <div style={{ position: 'fixed', left: -12000, top: 0, pointerEvents: 'none' }} aria-hidden="true" className="no-print">
            <StatementDocument ref={paper} sender={sender} party={job.party} client={clientFor(job.party, clients)} ledger={job.ledger} currency={currency}
              styleKind={prefs.style} ageing={prefs.ageing ? { asOf: to || todayInput() } : undefined} />
          </div>,
          document.body,
        )}
    </Modal>
  );
}
