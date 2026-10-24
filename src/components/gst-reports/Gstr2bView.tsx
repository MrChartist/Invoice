import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Download, FilePlus2, FileUp } from 'lucide-react';
import {
  billFromLine,
  bookBills,
  diffText,
  effectiveAction,
  gstr2bActionsDb,
  IMS_LABELS,
  itcEffect,
  MATCH_LABELS,
  matchGstr2b,
  parseGstr2bJson,
  parseGstr2bWorkbook,
  worksheetRows,
  type Gstr2bData,
  type Heads3,
  type ImsAction,
  type MatchClass,
  type MatchRow,
} from '../../lib/gstr2b';
import { periodFp, periodLabel, periodRange, type ReportPeriod } from '../../lib/gst-reports';
import { purchasesDb } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { MAX_IMPORT_BYTES, toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { downloadXlsx, readXlsx, XLSX_FILE_RE } from '../../lib/xlsx';
import { round2 } from '../../lib/invoice-calc';
import { formatDate, formatMoney } from '../../lib/utils';
import { DataTable, Money, type Column } from './DataTable';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gstr2b.module.css';

export interface Gstr2bViewProps {
  period: ReportPeriod;
  /** Filer GSTIN selected on the page ('' = all profiles). */
  gstin: string;
  filerStateCode: string;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const CLASSES: MatchClass[] = ['matched', 'mismatch', 'missing_in_books', 'not_in_2b', 'itc_unavailable'];
const ACTIONS: ImsAction[] = ['ACCEPT', 'PENDING', 'REJECT'];
const total3 = (h: Heads3) => round2(h.igst + h.cgst + h.sgst);

/** "2B match" tab: load the portal's GSTR-2B (JSON / Excel), match it to purchase bills, keep an IMS worksheet. */
export function Gstr2bView({ period, gstin, filerStateCode, notify }: Gstr2bViewProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<Gstr2bData | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState<MatchClass | 'all'>('all');
  // Bumped after a write (IMS action, new bill) so the derived data re-reads storage.
  const [rev, setRev] = useState(0);

  const range = useMemo(() => periodRange(period), [period]);
  const actionPeriod = data?.period || periodFp(period);
  // `rev` is read so the memo re-reads storage after a bill is created / an action is saved.
  const bills = useMemo(() => (rev >= 0 ? bookBills(purchasesDb.all(), filerStateCode) : []), [filerStateCode, rev]);
  const match = useMemo(() => (data ? matchGstr2b(data, bills, { period: range }) : null), [data, bills, range]);
  const actions = useMemo(() => (rev >= 0 ? gstr2bActionsDb.forPeriod(actionPeriod) : new Map()), [actionPeriod, rev]);
  const effect = useMemo(() => (match ? itcEffect(match, bills, actions, actionPeriod, range) : null), [match, bills, actions, actionPeriod, range]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_IMPORT_BYTES) {
      setError('That file is larger than 25 MB.');
      return;
    }
    setBusy(true);
    try {
      let parsed: Gstr2bData;
      if (XLSX_FILE_RE.test(file.name)) parsed = parseGstr2bWorkbook(await readXlsx(await file.arrayBuffer()));
      else if (/\.json$/i.test(file.name) || file.type.includes('json')) parsed = parseGstr2bJson(JSON.parse(await file.text()));
      else throw new Error('Choose the GSTR-2B JSON or Excel (.xlsx) file downloaded from the GST portal.');
      if (parsed.lines.length === 0) {
        setError(parsed.warnings[0] ?? 'No documents found in that file.');
        setData(null);
      } else {
        setData(parsed);
        setFileName(file.name);
        setFilter('all');
      }
    } catch (err) {
      setError(err instanceof SyntaxError ? 'That JSON file is damaged or incomplete.' : err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files?.[0]);
  };

  const setAction = (row: MatchRow, action: ImsAction) => {
    if (!row.line) return;
    try {
      gstr2bActionsDb.set(actionPeriod, row.line, action);
      setRev((n) => n + 1);
    } catch {
      notify('Could not save the action — storage is full or unavailable', 'error');
    }
  };

  const createBill = (row: MatchRow) => {
    const line = row.line;
    if (!line) return;
    if (!line.date) {
      notify('This 2B line has no readable date; add the bill from Expenses instead', 'error');
      return;
    }
    const vendor = vendorsDb.all().find((v) => (v.gstin ?? '').toUpperCase() === line.ctin);
    try {
      purchasesDb.save(billFromLine(line, vendor?.id));
      setRev((n) => n + 1);
      notify(`Bill ${line.number} added to purchases — review it in Expenses`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not create the bill', 'error');
    }
  };

  const fileBase = `GSTR2B_IMS_${data?.gstin || gstin || 'all'}_${actionPeriod}`;
  const exportCsv = () => match && downloadText(`${fileBase}.csv`, '﻿' + toCsv(worksheetRows(match, actions, actionPeriod)), 'text/csv');
  const exportXlsx = async () => {
    if (!match) return;
    try {
      await downloadXlsx(`${fileBase}.xlsx`, [{ name: 'IMS worksheet', rows: worksheetRows(match, actions, actionPeriod) }]);
    } catch {
      notify('Could not build the Excel file', 'error');
    }
  };

  const rows = match ? match.rows.filter((r) => filter === 'all' || r.cls === filter) : [];
  const columns: Column<MatchRow>[] = [
    { key: 'st', label: 'Status', render: (r) => <span className={styles[r.cls]}>{MATCH_LABELS[r.cls]}</span> },
    {
      key: 'sup',
      label: 'Supplier',
      render: (r) => (
        <>
          {r.line?.tradeName || r.bill?.partyName || '-'}
          <span className={`${styles.sub} ${surface.mono}`}>{r.line?.ctin || r.bill?.gstin || ''}</span>
        </>
      ),
    },
    {
      key: 'doc',
      label: '2B document',
      render: (r) =>
        r.line ? (
          <>
            <span className={surface.mono}>{r.line.number}</span>
            <span className={styles.sub}>
              {r.line.section}
              {r.line.docType === 'CN' ? ' · credit note' : r.line.docType === 'DN' ? ' · debit note' : ''} · {r.line.date ? formatDate(r.line.date) : 'no date'}
            </span>
          </>
        ) : (
          '-'
        ),
    },
    { key: 'tx', label: '2B taxable', numeric: true, render: (r) => (r.line ? <Money value={r.line.sign * r.line.taxable} /> : '-') },
    { key: 'tax', label: '2B tax', numeric: true, render: (r) => (r.line ? <Money value={r.line.sign * total3(r.line)} /> : '-') },
    {
      key: 'book',
      label: 'Books bill',
      render: (r) =>
        r.bill ? (
          <>
            <span className={surface.mono}>{r.bill.number || '(no number)'}</span>
            <span className={styles.sub}>{formatDate(r.bill.date)} · tax {formatMoney(r.bill.tax)}</span>
          </>
        ) : (
          '-'
        ),
    },
    {
      key: 'diff',
      label: 'Difference',
      render: (r) =>
        r.cls === 'not_in_2b'
          ? 'Not in 2B: ITC at risk (Sec 16(2)(aa))'
          : r.line && !r.line.itcAvailable
            ? `ITC not available${r.line.reason ? ` (${r.line.reason})` : ''}`
            : r.diffs.length
              ? `${diffText(r.diffs)}${r.taxDiff ? ` · tax ${formatMoney(r.taxDiff)}` : ''}`
              : '',
    },
    {
      key: 'ims',
      label: 'IMS action',
      render: (r) =>
        r.line ? (
          <select
            className={`${controls.select} ${styles.actionSelect}`}
            aria-label={`IMS action for ${r.line.number}`}
            value={effectiveAction(actions, actionPeriod, r.line)}
            onChange={(e) => setAction(r, e.target.value as ImsAction)}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{IMS_LABELS[a]}</option>
            ))}
          </select>
        ) : (
          ''
        ),
    },
    {
      key: 'act',
      label: '',
      render: (r) =>
        r.cls === 'missing_in_books' && r.line && r.line.sign > 0 ? (
          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => createBill(r)}>
            <FilePlus2 size={14} aria-hidden /> Create bill
          </button>
        ) : null,
    },
  ];

  const periodMismatch = data?.period && period.kind === 'month' && data.period !== periodFp(period);
  const gstinMismatch = data?.gstin && gstin && data.gstin !== gstin;

  return (
    <>
      <div
        className={dragging ? styles.dropOn : styles.drop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className={styles.dropText}>
          {data
            ? <>Loaded <strong>{fileName}</strong>. Load another file to replace it.</>
            : <>Download your <strong>GSTR-2B</strong> from the GST portal (Returns → GSTR-2B → Download JSON or Excel) and load it here. It is read on this device only; nothing is uploaded.</>}
        </p>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp size={16} aria-hidden /> {busy ? 'Reading…' : data ? 'Load another file' : 'Load GSTR-2B'}
        </button>
        <input
          ref={fileRef}
          type="file"
          className={surface.srOnly}
          accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Choose a GSTR-2B JSON or Excel file"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </div>
      {error && <p className={controls.error} role="alert">{error}</p>}

      {data && match && effect && (
        <>
          <div className={styles.meta}>
            <span>2B GSTIN <strong className={surface.mono}>{data.gstin || 'not stated'}</strong></span>
            <span>Return period <strong>{data.period ? `${data.period.slice(0, 2)}/${data.period.slice(2)}` : `not stated (using ${periodLabel(period)})`}</strong></span>
            <span><strong>{data.lines.length}</strong> documents in 2B</span>
            <span><strong>{bills.length}</strong> bills in books</span>
            {data.generatedOn && <span>Generated {data.generatedOn}</span>}
          </div>
          {gstinMismatch && <p className={styles.warn}>This 2B is for {data.gstin}, but the page is filtered to {gstin}.</p>}
          {periodMismatch && (
            <p className={styles.warn}>
              This 2B is for {data.period.slice(0, 2)}/{data.period.slice(2)}; "in books only" and the 3B comparison use bills dated in {periodLabel(period)}. Pick the matching month above.
            </p>
          )}
          {data.warnings.map((w) => <p key={w} className={styles.warn}>{w}</p>)}

          <div className={surface.statGrid}>
            {CLASSES.map((c) => (
              <div key={c} className={surface.stat}>
                <div className={surface.statTop}><span className={surface.statLabel}>{MATCH_LABELS[c]}</span></div>
                <div className={surface.statValue}>{match.counts[c]}</div>
              </div>
            ))}
          </div>

          <h3 className={local.tbHeading}>GSTR-3B Table 4A(5) — books vs 2B</h3>
          <div className={`${surface.tableWrap} ${styles.effect}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Input tax credit comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Figure</th>
                  <th scope="col" style={{ textAlign: 'right' }}>IGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>CGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>SGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Books (what the GSTR-3B tab shows today)', effect.books],
                  ['Books, limited to bills matched in 2B and accepted', effect.restricted],
                  ['Difference: ITC at risk', effect.atRisk],
                  ['Per 2B: accepted lines with ITC available', effect.per2b],
                ] as [string, Heads3][]).map(([label, h]) => (
                  <tr key={label}>
                    <th scope="row" style={{ fontWeight: 500 }}>{label}</th>
                    <td className={surface.numeric}><Money value={h.igst} /></td>
                    <td className={surface.numeric}><Money value={h.cgst} /></td>
                    <td className={surface.numeric}><Money value={h.sgst} /></td>
                    <td className={surface.numeric}><Money value={total3(h)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={controls.hint} style={{ margin: 0 }}>
            The GSTR-3B report is not changed. Since 1 Jan 2022 (Sec 16(2)(aa)) ITC can only be claimed for invoices that appear in GSTR-2B; for a value mismatch the lower of books and 2B is counted.
            {effect.rejected + effect.pending > 0 ? ` ${effect.rejected} rejected and ${effect.pending} pending line(s) are left out.` : ''} ISD credit (4A(4)), reverse charge (4A(3)) and imports (4A(1)) are outside this comparison.
            Lines with no action are deemed accepted, as on the IMS dashboard. Working paper only — verify with your CA before filing.
          </p>

          <div className={local.toolbar}>
            <div className={styles.chips} role="group" aria-label="Filter by status">
              <button type="button" className={filter === 'all' ? styles.chipOn : styles.chip} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                All ({match.rows.length})
              </button>
              {CLASSES.map((c) => (
                <button key={c} type="button" className={filter === c ? styles.chipOn : styles.chip} aria-pressed={filter === c} onClick={() => setFilter(c)}>
                  {MATCH_LABELS[c]} ({match.counts[c]})
                </button>
              ))}
            </div>
            <div className={styles.chips}>
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={exportCsv}>
                <Download size={14} aria-hidden /> Worksheet CSV
              </button>
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportXlsx()}>
                <Download size={14} aria-hidden /> Worksheet .xlsx
              </button>
            </div>
          </div>

          <DataTable caption="GSTR-2B match" emptyText="Nothing in this group." rows={rows} rowKey={(r) => r.key} columns={columns} />
        </>
      )}
    </>
  );
}

export default Gstr2bView;
