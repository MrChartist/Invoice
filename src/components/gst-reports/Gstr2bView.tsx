import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Download, FilePlus2, FileUp } from 'lucide-react';
import {
  billFromLine,
  bookBills,
  diffText,
  effectiveAction,
  gstr2bActionsDb,
  itcEffect,
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
import { getTable } from '../../lib/storage';
import type { PurchaseReturn } from '../../types/purchases';
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
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { nodes } from '../../i18n/areas/nodes';
import { VendorFollowUp } from './VendorFollowUp';

const MATCH_KEY = {
  matched: 'mMatched',
  mismatch: 'mMismatch',
  missing_in_books: 'mMissing',
  not_in_2b: 'mNotIn2b',
  itc_unavailable: 'mItcUnavailable',
} as const;
const IMS_KEY = { ACCEPT: 'imsAccept', REJECT: 'imsReject', PENDING: 'imsPending' } as const;
const matchLabel = (c: MatchClass) => gvT(MATCH_KEY[c]);

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
  useT();
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
  const bills = useMemo(() => (rev >= 0 ? bookBills(purchasesDb.all(), filerStateCode, getTable<PurchaseReturn>('purchase_returns')) : []), [filerStateCode, rev]);
  const match = useMemo(() => (data ? matchGstr2b(data, bills, { period: range }) : null), [data, bills, range]);
  const actions = useMemo(() => (rev >= 0 ? gstr2bActionsDb.forPeriod(actionPeriod) : new Map()), [actionPeriod, rev]);
  const effect = useMemo(() => (match ? itcEffect(match, bills, actions, actionPeriod, range) : null), [match, bills, actions, actionPeriod, range]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_IMPORT_BYTES) {
      setError(gvT('tooLarge'));
      return;
    }
    setBusy(true);
    try {
      let parsed: Gstr2bData;
      if (XLSX_FILE_RE.test(file.name)) parsed = parseGstr2bWorkbook(await readXlsx(await file.arrayBuffer()));
      else if (/\.json$/i.test(file.name) || file.type.includes('json')) parsed = parseGstr2bJson(JSON.parse(await file.text()));
      else throw new Error(gvT('wrongFile'));
      if (parsed.lines.length === 0) {
        setError(parsed.warnings[0] ?? gvT('noDocs'));
        setData(null);
      } else {
        setData(parsed);
        setFileName(file.name);
        setFilter('all');
      }
    } catch (err) {
      setError(err instanceof SyntaxError ? gvT('damagedJson') : err instanceof Error ? err.message : gvT('readFailed'));
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
      notify(gvT('actionSaveFailed'), 'error');
    }
  };

  const createBill = (row: MatchRow) => {
    const line = row.line;
    if (!line) return;
    if (!line.date) {
      notify(gvT('noDate'), 'error');
      return;
    }
    const vendor = vendorsDb.all().find((v) => (v.gstin ?? '').toUpperCase() === line.ctin);
    try {
      purchasesDb.save(billFromLine(line, vendor?.id));
      setRev((n) => n + 1);
      notify(gvT('billAdded', { number: line.number }));
    } catch (err) {
      notify(err instanceof Error ? err.message : gvT('billFailed'), 'error');
    }
  };

  const fileBase = `GSTR2B_IMS_${data?.gstin || gstin || 'all'}_${actionPeriod}`;
  const exportCsv = () => match && downloadText(`${fileBase}.csv`, '﻿' + toCsv(worksheetRows(match, actions, actionPeriod)), 'text/csv');
  const exportXlsx = async () => {
    if (!match) return;
    try {
      await downloadXlsx(`${fileBase}.xlsx`, [{ name: 'IMS worksheet', rows: worksheetRows(match, actions, actionPeriod) }]);
    } catch {
      notify(gvT('xlsxFailed'), 'error');
    }
  };

  const rows = match ? match.rows.filter((r) => filter === 'all' || r.cls === filter) : [];
  const columns: Column<MatchRow>[] = [
    { key: 'st', label: gvT('colStatus'), render: (r) => <span className={styles[r.cls]}>{matchLabel(r.cls)}</span> },
    {
      key: 'sup',
      label: gvT('colSupplier'),
      render: (r) => (
        <>
          {r.line?.tradeName || r.bill?.partyName || '-'}
          <span className={`${styles.sub} ${surface.mono}`}>{r.line?.ctin || r.bill?.gstin || ''}</span>
        </>
      ),
    },
    {
      key: 'doc',
      label: gvT('col2bDoc'),
      render: (r) =>
        r.line ? (
          <>
            <span className={surface.mono}>{r.line.number}</span>
            <span className={styles.sub}>
              {r.line.section}
              {r.line.docType === 'CN' ? gvT('creditNote') : r.line.docType === 'DN' ? gvT('debitNote') : ''} · {r.line.date ? formatDate(r.line.date) : gvT('noDateShort')}
            </span>
          </>
        ) : (
          '-'
        ),
    },
    { key: 'tx', label: gvT('col2bTaxable'), numeric: true, render: (r) => (r.line ? <Money value={r.line.sign * r.line.taxable} /> : '-') },
    { key: 'tax', label: gvT('col2bTax'), numeric: true, render: (r) => (r.line ? <Money value={r.line.sign * total3(r.line)} /> : '-') },
    {
      key: 'book',
      label: gvT('colBooksBill'),
      render: (r) =>
        r.bill ? (
          <>
            <span className={surface.mono}>{r.bill.number || gvT('noNumber')}</span>
            <span className={styles.sub}>{gvT('billSub', { date: formatDate(r.bill.date), tax: formatMoney(r.bill.tax) })}</span>
          </>
        ) : (
          '-'
        ),
    },
    {
      key: 'diff',
      label: gvT('colDifference'),
      render: (r) =>
        r.cls === 'not_in_2b'
          ? gvT('notIn2bRisk')
          : r.line && !r.line.itcAvailable
            ? `${gvT('itcNotAvailable')}${r.line.reason ? ` (${r.line.reason})` : ''}`
            : r.diffs.length
              ? `${diffText(r.diffs)}${r.taxDiff ? gvT('taxDiff', { amount: formatMoney(r.taxDiff) }) : ''}`
              : '',
    },
    {
      key: 'ims',
      label: gvT('colIms'),
      render: (r) =>
        r.line ? (
          <select
            className={`${controls.select} ${styles.actionSelect}`}
            aria-label={gvT('imsAria', { number: r.line.number })}
            value={effectiveAction(actions, actionPeriod, r.line)}
            onChange={(e) => setAction(r, e.target.value as ImsAction)}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{gvT(IMS_KEY[a])}</option>
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
            <FilePlus2 size={14} aria-hidden /> {gvT('createBill')}
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
            ? nodes(gvT('loaded'), { file: <strong>{fileName}</strong> })
            : nodes(gvT('intro'), { gstr2b: <strong>GSTR-2B</strong> })}
        </p>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp size={16} aria-hidden /> {busy ? gvT('reading') : data ? gvT('loadAnother') : gvT('load2b')}
        </button>
        <input
          ref={fileRef}
          type="file"
          className={surface.srOnly}
          accept=".json,.xlsx,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={gvT('chooseFile')}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </div>
      {error && <p className={controls.error} role="alert">{error}</p>}

      {data && match && effect && (
        <>
          <div className={styles.meta}>
            <span>{gvT('meta2bGstin')} <strong className={surface.mono}>{data.gstin || gvT('notStated')}</strong></span>
            <span>{gvT('metaPeriod')} <strong>{data.period ? `${data.period.slice(0, 2)}/${data.period.slice(2)}` : gvT('notStatedUsing', { period: periodLabel(period) })}</strong></span>
            <span>{nodes(gvT('metaDocs'), { n: <strong>{data.lines.length}</strong> })}</span>
            <span>{nodes(gvT('metaBills'), { n: <strong>{bills.length}</strong> })}</span>
            {data.generatedOn && <span>{gvT('generated', { date: data.generatedOn })}</span>}
          </div>
          {gstinMismatch && <p className={styles.warn}>{gvT('gstinMismatch', { g2b: data.gstin, gstin })}</p>}
          {periodMismatch && (
            <p className={styles.warn}>
              {gvT('periodMismatch', { p2b: `${data.period.slice(0, 2)}/${data.period.slice(2)}`, period: periodLabel(period) })}
            </p>
          )}
          {data.warnings.map((w) => <p key={w} className={styles.warn}>{w}</p>)}

          <div className={surface.statGrid}>
            {CLASSES.map((c) => (
              <div key={c} className={surface.stat}>
                <div className={surface.statTop}><span className={surface.statLabel}>{matchLabel(c)}</span></div>
                <div className={surface.statValue}>{match.counts[c]}</div>
              </div>
            ))}
          </div>

          <h3 className={local.tbHeading}>{gvT('t4a5Head')}</h3>
          <div className={`${surface.tableWrap} ${styles.effect}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{gvT('itcCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{gvT('colFigure')}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>IGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>CGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>SGST</th>
                  <th scope="col" style={{ textAlign: 'right' }}>{gvT('total')}</th>
                </tr>
              </thead>
              <tbody>
                {([
                  [gvT('effBooks'), effect.books],
                  [gvT('effRestricted'), effect.restricted],
                  [gvT('effAtRisk'), effect.atRisk],
                  [gvT('effPer2b'), effect.per2b],
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
            {gvT('effHint1')}
            {effect.rejected + effect.pending > 0 ? gvT('effHintLeftOut', { rejected: effect.rejected, pending: effect.pending }) : ''}
            {gvT('effHint2')}
          </p>
          <VendorFollowUp match={match} effect={effect} period={actionPeriod} periodLabel={periodLabel(period)} gstin={gstin} notify={notify} />

          <div className={local.toolbar}>
            <div className={styles.chips} role="group" aria-label={gvT('filterStatus')}>
              <button type="button" className={filter === 'all' ? styles.chipOn : styles.chip} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                {gvT('allCount', { n: match.rows.length })}
              </button>
              {CLASSES.map((c) => (
                <button key={c} type="button" className={filter === c ? styles.chipOn : styles.chip} aria-pressed={filter === c} onClick={() => setFilter(c)}>
                  {matchLabel(c)} ({match.counts[c]})
                </button>
              ))}
            </div>
            <div className={styles.chips}>
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={exportCsv}>
                <Download size={14} aria-hidden /> {gvT('worksheetCsv')}
              </button>
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportXlsx()}>
                <Download size={14} aria-hidden /> {gvT('worksheetXlsx')}
              </button>
            </div>
          </div>

          <DataTable caption={gvT('cap2b')} emptyText={gvT('empty2b')} rows={rows} rowKey={(r) => r.key} columns={columns} />
        </>
      )}
    </>
  );
}

export default Gstr2bView;
