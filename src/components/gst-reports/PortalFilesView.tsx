import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileWarning, Trash2, Upload } from 'lucide-react';
import type { Gstr1Report, ReportPeriod } from '../../lib/gst-reports';
import {
  bookDocs,
  buildRecord,
  diffFindings,
  diffPortalBooks,
  errorFindings,
  findByHash,
  matchErrors,
  portalFilesDb,
  readPortalFile,
  subsetChecks,
  subsetReport,
  type ErrorHint,
  type ParsedPortalFile,
  type PortalFileRecord,
  type PortalFinding,
  type SubsetIssue,
} from '../../lib/gst-portal-files';
import { buildGstr1Json } from '../../lib/gstr-json';
import { downloadText } from '../../lib/download';
import { formatDate, formatMoney } from '../../lib/utils';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import { VirtualGap } from '../ui/VirtualGap';
import { useT } from '../../i18n';
import { dkT } from '../../i18n/areas/desks-r3';
import controls from '../../styles/controls.module.css';
import styles from './desks-r3.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;

const HINT_KEY: Record<ErrorHint, Parameters<typeof dkT>[0]> = {
  date_period: 'pf.hint.date_period',
  gstin_invalid: 'pf.hint.gstin_invalid',
  duplicate: 'pf.hint.duplicate',
  pos_mismatch: 'pf.hint.pos_mismatch',
  rate_not_allowed: 'pf.hint.rate_not_allowed',
  other: 'pf.hint.other',
};

const CLASS_KEY = { missing_on_portal: 'pf.cls.missing_on_portal', missing_in_books: 'pf.cls.missing_in_books', value_diff: 'pf.cls.value_diff' } as const;

const ISSUE_KEY: Record<SubsetIssue['problem'], Parameters<typeof dkT>[0]> = { gstin: 'pf.chk.gstin', date: 'pf.chk.date', number: 'pf.chk.number' };

function FindingsTable({ rec, onToggle }: { rec: PortalFileRecord; onToggle: (key: string, on: boolean) => void }) {
  const rows = rec.findings;
  const keys = useMemo(() => rows.map((f) => f.key), [rows]);
  const virtual = useVirtualRows(keys, { estimate: 44 });
  const isError = rec.kind === 'gstr1_error';
  const cols = isError ? 6 : 5;
  const fix = (f: PortalFinding) => {
    if (f.invoice_id) return <Link to={`/invoice/${f.invoice_id}`}>{f.hint === 'gstin_invalid' ? dkT('pf.fixDoc') : dkT('pf.fix')}</Link>;
    if (f.hint === 'gstin_invalid') return <Link to="/clients">{dkT('pf.fixParty')}</Link>;
    return <span className={styles.muted}>{dkT('pf.notFound')}</span>;
  };
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-rowcount={virtual.ariaRowCount(1)} data-portal-findings>
        <thead>
          <tr aria-rowindex={virtual.enabled ? 1 : undefined}>
            <th scope="col">{dkT('pf.colDoc')}</th>
            {isError ? (
              <>
                <th scope="col">{dkT('pf.colPortal')}</th>
                <th scope="col">{dkT('pf.colHint')}</th>
                <th scope="col">{dkT('pf.colFix')}</th>
              </>
            ) : (
              <>
                <th scope="col">{dkT('pf.colClass')}</th>
                <th scope="col" className={styles.num}>{dkT('pf.colDiff')}</th>
              </>
            )}
            <th scope="col">{dkT('pf.colDone')}</th>
            {isError && <th scope="col">{dkT('pf.colSection')}</th>}
          </tr>
        </thead>
        <tbody {...virtual.bodyProps}>
          {virtual.slots.map((slot) => {
            if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={cols} />;
            const f = rows[slot.index];
            const done = !!rec.resolved?.[f.key];
            return (
              <tr key={f.key} className={done ? styles.resolved : undefined} {...virtual.rowProps(slot.index)}>
                <td>
                  {f.number ? (
                    <>
                      {f.invoice_id ? <Link to={`/invoice/${f.invoice_id}`}>{f.number}</Link> : f.number}
                      <div className={styles.note}>{[f.date && formatDate(f.date), f.ctin].filter(Boolean).join(' · ')}</div>
                    </>
                  ) : <span className={styles.muted}>{f.section.toUpperCase() || '-'}</span>}
                </td>
                {isError ? (
                  <>
                    <td><span className={styles.mono}>{f.code || '-'}</span> {f.msg}</td>
                    <td>{f.hint ? dkT(HINT_KEY[f.hint]) : ''}</td>
                    <td>{f.number ? fix(f) : ''}</td>
                  </>
                ) : (
                  <>
                    <td>{f.cls ? dkT(CLASS_KEY[f.cls]) : ''}</td>
                    <td className={styles.num}>{f.cls === 'value_diff' ? `${formatMoney(f.d_taxable ?? 0)} / ${formatMoney(f.d_tax ?? 0)}` : ''}</td>
                  </>
                )}
                <td>
                  <input type="checkbox" checked={done} aria-label={dkT('pf.colDone')} onChange={(e) => onToggle(f.key, e.target.checked)} />
                </td>
                {isError && <td className={styles.mono}>{f.section.toUpperCase()}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * R3-C4 GST → Tools → Portal files: read the portal's GSTR-1 error report or the downloaded GSTR-1
 * (`.json` / `.zip`), see each error against our document with a hint and a Fix link, download a
 * corrected JSON of only the failed documents, or diff the portal data with the books. Layout
 * unverified — working paper; nothing is uploaded.
 */
export default function PortalFilesView({ g1, period, gstin, turnover, notify }: { g1: Gstr1Report; period: ReportPeriod; gstin: string; turnover: { gt: number; curGt: number }; notify: Notify }) {
  useT();
  const [records, setRecords] = useState<PortalFileRecord[]>(() => portalFilesDb.all());
  const [openId, setOpenId] = useState<string | null>(() => records.at(-1)?.id ?? null);
  const [status, setStatus] = useState<{ tone: 'warn' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SubsetIssue[] | null>(null);
  const books = useMemo(() => bookDocs(g1), [g1]);
  const open = records.find((r) => r.id === openId) ?? null;
  const reload = () => setRecords(portalFilesDb.all());

  const mismatch = (p: Pick<ParsedPortalFile, 'fp' | 'gstin'>) =>
    (p.fp && p.fp !== g1.fp) ? dkT('pf.otherPeriod', { fp: p.fp, cur: g1.fp }) : (p.gstin && gstin && p.gstin !== gstin) ? dkT('pf.otherGstin', { gstin: p.gstin, cur: gstin }) : '';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const parsed = await readPortalFile(new Uint8Array(await file.arrayBuffer()));
      if (parsed.kind === 'unknown') {
        setStatus({ tone: 'warn', text: dkT('pf.unknown') });
        return;
      }
      const same = findByHash(records, parsed.hash);
      if (same) {
        setOpenId(same.id);
        setStatus({ tone: 'info', text: dkT('pf.reimport', { date: formatDate(same.imported_at) }) });
        return;
      }
      const why = mismatch(parsed);
      if (why) {
        setStatus({ tone: 'warn', text: why });
        return;
      }
      let rec: PortalFileRecord;
      if (parsed.kind === 'gstr1_error') {
        const rows = matchErrors(parsed, books);
        rec = buildRecord({ parsed, fileName: file.name, findings: errorFindings(rows, parsed.sectionErrors), counts: { docs: parsed.docs.length, errors: rows.length, matched: rows.filter((r) => r.ours).length, section_errors: parsed.sectionErrors.length } });
      } else {
        const diff = diffPortalBooks(parsed, books);
        rec = buildRecord({
          parsed, fileName: file.name, findings: diffFindings(diff),
          counts: { docs: parsed.docs.length, missing_on_portal: diff.filter((d) => d.cls === 'missing_on_portal').length, missing_in_books: diff.filter((d) => d.cls === 'missing_in_books').length, value_diff: diff.filter((d) => d.cls === 'value_diff').length },
        });
      }
      portalFilesDb.save(rec);
      reload();
      setOpenId(rec.id);
      if (parsed.warnings.length) setStatus({ tone: 'info', text: parsed.warnings.slice(0, 3).join(' ') });
    } catch (err) {
      notify((err as Error).message || dkT('pf.readFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const subset = () => {
    if (!open) return null;
    const keep = new Set(open.findings.filter((f) => f.invoice_id && f.section).map((f) => `${f.section}|${f.invoice_id}`));
    return subsetReport(g1, keep);
  };
  const download = (force = false) => {
    const s = subset();
    if (!s) return;
    if (!s.counts.included) {
      notify(dkT('pf.nothingToFix'), 'info');
      return;
    }
    const issues = subsetChecks(s, period);
    if (issues.length && !force) {
      setPending(issues);
      return;
    }
    setPending(null);
    downloadText(`GSTR1_corrected_${gstin || 'all'}_${g1.fp}.json`, JSON.stringify(buildGstr1Json(s, turnover), null, 2), 'application/json');
    notify(dkT('pf.downloaded', { n: s.counts.included }), 'success');
  };

  return (
    <div className={styles.stack} data-portal-files>
      <section className={styles.section}>
        <h3 className={styles.head}>
          <FileWarning size={16} aria-hidden /> {dkT('pf.title')} <span className={styles.badge}>{dkT('unverified')}</span>
        </h3>
        <p className={styles.note}>{dkT('pf.intro')}</p>
        <div className={styles.row}>
          <label className={`${controls.btnOutline} ${controls.btnSm}`}>
            <Upload size={14} aria-hidden /> {busy ? dkT('reading') : dkT('pf.pick')}
            <input type="file" accept=".json,.zip,application/json,application/zip" hidden disabled={busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} data-portal-file-input />
          </label>
          <span className={styles.note}>{dkT('pf.privacy')}</span>
        </div>
        {status && <p className={styles.warn} role="status" data-portal-status>{status.text}</p>}
      </section>

      {open && (
        <section className={styles.section} data-portal-open={open.kind}>
          <h3 className={styles.head}>
            {open.kind === 'gstr1_error' ? dkT('pf.errorReport') : dkT('pf.downloaded1')} · {open.period || '-'}{open.gstin ? ` · ${open.gstin}` : ''}
          </h3>
          <p className={styles.note}>
            {open.kind === 'gstr1_error'
              ? dkT('pf.errSummary', { errors: open.counts.errors ?? 0, matched: open.counts.matched ?? 0, sections: open.counts.section_errors ?? 0 })
              : dkT('pf.diffSummary', { mp: open.counts.missing_on_portal ?? 0, mb: open.counts.missing_in_books ?? 0, vd: open.counts.value_diff ?? 0 })}
            {open.findings.length >= 2000 ? ` ${dkT('pf.capped')}` : ''}
          </p>
          {open.kind === 'gstr1_error' ? (
            <div className={styles.row}>
              <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => download()} disabled={open.period !== g1.fp} data-portal-corrected>
                {dkT('pf.corrected')}
              </button>
              {open.period !== g1.fp && <span className={styles.note}>{dkT('pf.choosePeriod', { fp: open.period })}</span>}
            </div>
          ) : (
            <p className={styles.note}>{dkT('pf.gstr1aHint')} <Link to="/gst-reports?tab=guards">{dkT('pf.gstr1aLink')}</Link></p>
          )}
          {pending && (
            <div className={styles.warn} role="alert" data-portal-preflight>
              <strong>{dkT('pf.preflight')}</strong>
              <ul>{pending.slice(0, 10).map((p, i) => <li key={i}>{p.number || '-'}: {dkT(ISSUE_KEY[p.problem])}</li>)}</ul>
              <div className={styles.row}>
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => download(true)}>{dkT('pf.anyway')}</button>
                <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setPending(null)}>{dkT('close')}</button>
              </div>
            </div>
          )}
          {open.findings.length ? (
            <FindingsTable rec={open} onToggle={(key, on) => { portalFilesDb.setResolved(open.id, key, on); reload(); }} />
          ) : <p className={styles.ok}>{dkT('pf.noFindings')}</p>}
          <p className={styles.note}>{dkT('pf.caNote')}</p>
        </section>
      )}

      {records.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.head}>{dkT('pf.history')}</h3>
          <ul className={styles.stack} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...records].reverse().map((r) => (
              <li key={r.id} className={styles.row}>
                <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-pressed={r.id === openId} onClick={() => setOpenId(r.id)}>
                  {r.kind === 'gstr1_error' ? dkT('pf.errorReport') : dkT('pf.downloaded1')} · {r.period || '-'} · {formatDate(r.imported_at)}
                </button>
                <span className={styles.note}>{r.file_name}</span>
                <button type="button" className={controls.btnIcon} aria-label={dkT('remove')} onClick={() => { portalFilesDb.remove(r.id); reload(); if (openId === r.id) setOpenId(null); }}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
