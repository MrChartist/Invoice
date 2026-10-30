/**
 * TDS tab of the Receivables page: the quarter × deductor × section register,
 * Form 16A tracking and a 26AS / AIS CSV reconciliation. Loaded lazily, so none
 * of this (or the CSV / import-mapping code it pulls in) touches the main bundle.
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { MAX_IMPORT_BYTES } from '../../lib/csv';
import { Link } from 'react-router-dom';
import {
  BadgeCheck, CheckCircle2, Download, FileSearch, FileWarning, Landmark, Receipt, Upload, X,
} from 'lucide-react';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import {
  TDS_CERT_TABLE, buildTdsRegister, fyLabel, parseTdsCsv, reconcileTds, setCertificate,
  tdsReconCsv, tdsRegisterCsv, quarterLabel,
  type CertStatus, type TdsCertificate, type TdsCsvResult, type TdsExpectedLine, type TdsQuarterBlock, type TdsRecon,
} from '../../lib/tds-register';
import { getTable, setTable } from '../../lib/storage';
import { isPackOn } from '../../lib/industry-packs'; // R5-A5
import { localDb } from '../../lib/localDb';
import { isoDay } from '../../lib/dates';
import { getIndianFY } from '../../lib/invoice-number';
import { formatCurrency, formatDate, formatMoney, todayInput } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { StatCard } from '../ui/StatCard';
import { downloadTextFile } from './exportUtils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { rcvT } from '../../i18n/areas/receivables';
import { ita25Words } from '../../i18n/areas/ita2025';
import { formText, quarterStart, sectionText } from '../../lib/ita2025';
import styles from './TdsTab.module.css';

// R14 (PS-D3): certificates to chase (Form 131 / 16A) with a chase letter — lazy panel.
const ChasePanel = lazy(() => import('../prof/TdsChasePanel'));

export interface TdsTabProps {
  data: { invoices: InvoiceRecord[]; payments: Payment[]; clients: Client[]; extraExpected?: TdsExpectedLine[] };
  notify: (message: string, tone?: 'success' | 'error') => void;
}

const BADGE: Record<CertStatus, string> = {
  received: surface.badgePaid,
  awaited: surface.badgeSent,
  overdue: surface.badgeOverdue,
};

const money = (n: number) => (n ? formatMoney(n, 'INR') : '-');

function loadCerts(): TdsCertificate[] {
  try {
    return getTable<TdsCertificate>(TDS_CERT_TABLE);
  } catch {
    return [];
  }
}

export default function TdsTab({ data: rawData, notify }: TdsTabProps) {
  useT(); // re-render on a language switch (5.4)
  // R5-A5: 194-O deducted by marketplaces (settlement lines) joins the register and the 26AS match — pack on only.
  const [extra, setExtra] = useState<TdsExpectedLine[]>([]);
  useEffect(() => {
    if (!isPackOn(localDb.settings.get(), 'marketplace')) return;
    import('../../lib/marketplace/tds-194o').then((m) => setExtra(m.liveTds194oLines()), () => undefined);
  }, []);
  const data = useMemo(() => (extra.length ? { ...rawData, extraExpected: extra } : rawData), [rawData, extra]);
  const [certs, setCerts] = useState<TdsCertificate[]>(loadCerts);
  const today = isoDay(new Date());
  const all = useMemo(() => buildTdsRegister({ ...data, certificates: certs }, { today }), [data, certs, today]);
  const currentFy = getIndianFY(today).startYear;
  const [fyPick, setFyPick] = useState<number | 'all' | null>(null);
  const fy = fyPick ?? (all.fys.includes(currentFy) ? currentFy : all.fys[0] ?? currentFy);
  const reg = useMemo(
    () => (fy === 'all' ? all : buildTdsRegister({ ...data, certificates: certs }, { today, fy })),
    [all, data, certs, today, fy],
  );

  const toggleCert = (block: TdsQuarterBlock, partyKey: string, partyName: string, received: boolean) => {
    const next = setCertificate(certs, {
      partyKey, partyName, fy: block.fy, quarter: block.quarter, received, receivedOn: received ? today : undefined,
    });
    try {
      setTable(TDS_CERT_TABLE, next);
      setCerts(next);
      notify(received ? rcvT('tdsMarked', { party: partyName, q: block.quarter }) : rcvT('tdsCleared'));
    } catch (err) {
      notify((err as Error).message || rcvT('couldNotSave'), 'error');
    }
  };

  if (all.rows.length === 0) {
    return (
      <div className={surface.card}>
        <EmptyState
          icon={Landmark}
          title={rcvT('tdsEmptyTitle')}
          text={rcvT('tdsEmptyText')}
          action={<Link to="/invoice" className={`${controls.btn} ${controls.btnPrimary}`}>{rcvT('createInvoice')}</Link>}
        />
      </div>
    );
  }

  const fmt = (n: number) => formatCurrency(n, 'INR');
  const certStats = reg.quarters.reduce(
    (a, q) => ({ in: a.in + q.certificatesReceived, of: a.of + q.deductors, late: a.late + q.certificatesOverdue }),
    { in: 0, of: 0, late: 0 },
  );

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <label className={styles.inline}>
          <span className={controls.label}>{rcvT('fy')}</span>
          <select className={controls.select} value={String(fy)}
            onChange={(e) => setFyPick(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            {all.fys.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
            {all.fys.length > 1 && <option value="all">{rcvT('allYears')}</option>}
          </select>
        </label>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
          onClick={() => downloadTextFile(`TDS_register_${fy === 'all' ? 'all' : fyLabel(fy)}_${todayInput()}.csv`, tdsRegisterCsv(reg))}>
          <Download size={16} /> {rcvT('exportCsv')}
        </button>
      </div>

      <div className={surface.statGrid}>
        <StatCard label={rcvT('tdsExpected')} value={fmt(reg.totals.tdsExpected)} icon={Receipt}
          hint={reg.totals.invoiceCount === 1 ? rcvT('tdsWithOne') : rcvT('tdsWithMany', { n: reg.totals.invoiceCount })} />
        <StatCard label={rcvT('tdsSettled')} value={fmt(reg.totals.tdsSettled)} icon={CheckCircle2} tone="profit"
          hint={rcvT('tdsSettledHint')} />
        <StatCard label={rcvT('tdsPending')} value={fmt(reg.totals.tdsPending)} icon={FileWarning} tone="warning"
          hint={rcvT('tdsPendingHint')} />
        <StatCard label={rcvT('tdsInHand')} value={`${certStats.in} / ${certStats.of}`} icon={BadgeCheck}
          tone={certStats.late ? 'loss' : 'default'}
          hint={certStats.late ? rcvT('tdsLate', { n: certStats.late }) : rcvT('tdsDeductorQ')} />
      </div>

      {reg.quarters.map((q) => <QuarterCard key={q.key} block={q} onToggle={toggleCert} />)}

      <Reconcile data={data} notify={notify} />

      <Suspense fallback={null}><ChasePanel reg={all} clients={data.clients} /></Suspense>

      <p className={surface.sectionNote}>
        {rcvT('tdsNote')}
      </p>
    </div>
  );
}

/* ── One quarter ──────────────────────────────────────────────── */

function QuarterCard({ block, onToggle }: {
  block: TdsQuarterBlock;
  onToggle: (block: TdsQuarterBlock, partyKey: string, partyName: string, received: boolean) => void;
}) {
  // Rows are sorted by party, so a deductor's sections are adjacent: the
  // Form 16A cell (per deductor × quarter) spans them.
  const spans = new Map<number, number>();
  block.rows.forEach((r, i) => {
    if (i > 0 && block.rows[i - 1].partyKey === r.partyKey) {
      let start = i - 1;
      while (!spans.has(start)) start--;
      spans.set(start, (spans.get(start) ?? 1) + 1);
    } else {
      spans.set(i, 1);
    }
  });

  return (
    <section className={surface.card} aria-labelledby={`tds-${block.key}`}>
      <div className={surface.cardHead}>
        <h2 id={`tds-${block.key}`} className={styles.h2}>{block.label}</h2>
        <span className={surface.statHint}>{rcvT('tdsDueBy', { date: formatDate(block.certDue) })}</span>
      </div>
      <div className={surface.tableWrap}>
        <table className={`${surface.table} ${styles.table}`}>
          <caption className={surface.srOnly}>{rcvT('tdsCaption', { label: block.label })}</caption>
          <thead>
            <tr>
              <th scope="col">{rcvT('deductor')}</th>
              <th scope="col">{rcvT('section')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('invoices')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('taxable')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('invoiceTotal')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('tdsExpected')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('settled')}</th>
              <th scope="col" className={surface.numeric}>{rcvT('pending')}</th>
              <th scope="col">{formText('16A', quarterStart(block.fy, block.quarter), ita25Words())}</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => {
              const span = spans.get(i);
              const linked = !r.partyKey.startsWith('name:');
              return (
                <tr key={r.key}>
                  <th scope="row" className={styles.party}>
                    <span className={styles.partyName}>{r.partyName}</span>
                    <span className={styles.ids}>
                      {r.pan && <span>PAN {r.pan}</span>}
                      {r.tan ? <span>TAN {r.tan}</span> : linked ? (
                        <Link to={`/clients?edit=${encodeURIComponent(r.partyKey)}`} className={styles.addTan}>{rcvT('addTan')}</Link>
                      ) : <span>{rcvT('noTan')}</span>}
                    </span>
                  </th>
                  <td className={surface.mono}>{r.section ? sectionText(r.section, quarterStart(block.fy, block.quarter), ita25Words()) : '-'}</td>
                  <td className={surface.numeric} title={r.invoices.map((l) => l.number).join(', ')}>{r.invoiceCount}</td>
                  <td className={surface.numeric}>{money(r.taxable)}</td>
                  <td className={surface.numeric}>{money(r.total)}</td>
                  <td className={`${surface.numeric} ${styles.strong}`}>{money(r.tdsExpected)}</td>
                  <td className={surface.numeric}>{money(r.tdsSettled)}</td>
                  <td className={surface.numeric}>{money(r.tdsPending)}</td>
                  {span !== undefined && (
                    <td rowSpan={span} className={styles.certCell}>
                      <span className={BADGE[r.certificate]}>{rcvT(`cert.${r.certificate}`)}</span>
                      <label className={styles.check}>
                        <input type="checkbox" checked={r.certificate === 'received'}
                          onChange={(e) => onToggle(block, r.partyKey, r.partyName, e.target.checked)} />
                        {rcvT('receivedChk')}
                      </label>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <th scope="row" colSpan={2}>{rcvT('quarterTotal')}</th>
              <td className={surface.numeric}>{block.totals.invoiceCount}</td>
              <td className={surface.numeric}>{money(block.totals.taxable)}</td>
              <td className={surface.numeric}>{money(block.totals.total)}</td>
              <td className={surface.numeric}>{money(block.totals.tdsExpected)}</td>
              <td className={surface.numeric}>{money(block.totals.tdsSettled)}</td>
              <td className={surface.numeric}>{money(block.totals.tdsPending)}</td>
              <td>{block.certificatesReceived} / {block.deductors}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ── 26AS / AIS reconciliation ────────────────────────────────── */

function Reconcile({ data, notify }: TdsTabProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<TdsCsvResult | null>(null);
  const [tolerance, setTolerance] = useState(1);
  const recon: TdsRecon | null = useMemo(
    () => (parsed && parsed.credits.length ? reconcileTds(parsed.credits, data, { tolerance }) : null),
    [parsed, data, tolerance],
  );

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(rcvT('rcTooBig'));
      const result = parseTdsCsv(await file.text());
      setFileName(file.name);
      setParsed(result);
      if (result.missing.length) notify(rcvT('rcMissing', { list: result.missing.join(', ') }), 'error');
    } catch (err) {
      notify((err as Error).message || rcvT('rcReadFailed'), 'error');
    }
  };

  const clear = () => {
    setParsed(null);
    setFileName('');
  };

  return (
    <section className={surface.card} aria-labelledby="tds-recon">
      <div className={surface.cardHead}>
        <h2 id="tds-recon" className={styles.h2}>{rcvT('rcTitle')}</h2>
        {recon && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
            onClick={() => downloadTextFile(`TDS_26AS_reconciliation_${todayInput()}.csv`, tdsReconCsv(recon))}>
            <Download size={16} /> {rcvT('exportCsv')}
          </button>
        )}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          {rcvT('rcHelp')}
        </p>
        <div className={styles.reconControls}>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className={surface.srOnly} onChange={onFile}
            aria-label={rcvT('rcFileAria')} tabIndex={-1} />
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {parsed ? rcvT('rcAnother') : rcvT('rcChoose')}
          </button>
          <label className={styles.inline}>
            <span className={controls.label}>{rcvT('rcTolerance')}</span>
            <input className={`${controls.input} ${controls.inputNumeric} ${styles.tol}`} type="number" min={0} step={0.5}
              value={tolerance} onChange={(e) => setTolerance(Math.max(Number(e.target.value) || 0, 0))} />
          </label>
          {parsed && (
            <button type="button" className={controls.btnGhost} onClick={clear}>
              <X size={16} /> {rcvT('rcClear', { file: fileName })}
            </button>
          )}
        </div>

        {parsed && parsed.missing.length > 0 && (
          <p className={controls.error} role="alert">
            {rcvT('rcNoColumn', { file: fileName, list: parsed.missing.join(', '), found: parsed.headers.join(', ') || rcvT('rcNoHeader') })}
          </p>
        )}
        {parsed && !parsed.missing.length && (
          <p className={surface.statHint}>
            {parsed.credits.length === 1 ? rcvT('rcReadOne', { file: fileName }) : rcvT('rcReadMany', { file: fileName, n: parsed.credits.length })}
            {parsed.zeroRows ? rcvT('rcZero', { n: parsed.zeroRows }) : ''}
            {parsed.errors.length ? rcvT('rcBadRows', { n: parsed.errors.length, lines: parsed.errors.slice(0, 5).map((e) => e.line).join(', ') + (parsed.errors.length > 5 ? '…' : '') }) : ''}.
          </p>
        )}

        {recon && (
          <>
            <div className={styles.summary}>
              <Summary label={rcvT('matched')} value={recon.matched.length} amount={recon.totals.matched26as} tone="ok" />
              <Summary label={rcvT('only26as')} value={recon.only26as.length} amount={recon.totals.only26as} tone="warn" />
              <Summary label={rcvT('onlyBooks')} value={recon.onlyBooks.length} amount={recon.totals.onlyBooks} tone="bad" />
            </div>

            {recon.matched.length > 0 && (
              <ReconTable title={rcvT('matched')} numeric={[3, 4, 5]} head={[rcvT('quarter'), rcvT('deductor'), rcvT('invoicesCol'), rcvT('tds26as'), rcvT('tdsBooks'), rcvT('difference'), rcvT('note')]}
                rows={recon.matched.map((m, i) => ({
                  key: `m${i}`,
                  cells: [
                    `Q${m.quarter} ${fyLabel(m.fy)}`, m.partyName, m.invoices.map((l) => l.number).join(', '),
                    money(m.tds26as), money(m.tdsBooks), m.diff ? formatMoney(m.diff, 'INR') : '-',
                    [m.kind === 'group' ? rcvT('qTotal') : '', m.quarterShift ? rcvT('otherQuarter') : ''].filter(Boolean).join(' · ') || '-',
                  ],
                }))} />
            )}
            {recon.only26as.length > 0 && (
              <ReconTable title={rcvT('only26asTitle')} numeric={[4, 5]} head={[rcvT('date'), rcvT('deductor'), rcvT('tan'), rcvT('section'), rcvT('amountPaid'), rcvT('tds'), rcvT('note')]}
                rows={recon.only26as.map((c) => ({
                  key: `c${c.line}`,
                  cells: [formatDate(c.date), c.partyName, c.tan || '-', c.section || '-', money(c.amountPaid), money(c.tds),
                    c.known ? rcvT('knownNote') : rcvT('unknownNote')],
                }))} />
            )}
            {recon.onlyBooks.length > 0 && (
              <ReconTable title={rcvT('onlyBooksTitle')} numeric={[5]} head={[rcvT('quarter'), rcvT('deductor'), rcvT('invoice'), rcvT('date'), rcvT('section'), rcvT('tds'), rcvT('note')]}
                rows={recon.onlyBooks.map((l) => ({
                  key: `b${l.invoiceId}`,
                  cells: [`${quarterLabel(l.quarter)} ${fyLabel(l.fy)}`, l.partyName, l.number, formatDate(l.date), l.section || '-', money(l.tds),
                    l.settled ? rcvT('paidNote') : rcvT('notPaidNote')],
                }))} />
            )}
            {recon.matched.length > 0 && !recon.only26as.length && !recon.onlyBooks.length && (
              <p className={styles.allGood}><CheckCircle2 size={16} /> {rcvT('allMatched')}</p>
            )}
          </>
        )}
        {!parsed && (
          <p className={styles.hintRow}><FileSearch size={16} /> {rcvT('noFile')}</p>
        )}
      </div>
    </section>
  );
}

function Summary({ label, value, amount, tone }: { label: string; value: number; amount: number; tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={styles.summaryItem} data-tone={tone}>
      <span className={controls.label}>{label}</span>
      <strong className={styles.summaryValue}>{value}</strong>
      <span className={surface.statHint}>{rcvT('tdsAmount', { amount: formatMoney(amount, 'INR') })}</span>
    </div>
  );
}

function ReconTable({ title, head, rows, numeric }: { title: string; head: string[]; rows: { key: string; cells: string[] }[]; numeric: number[] }) {
  const numericCols = new Set(numeric);
  return (
    <div className={styles.reconBlock}>
      <h3 className={styles.h3}>{title}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{title}</caption>
          <thead>
            <tr>{head.map((h, i) => <th key={h} scope="col" className={numericCols.has(i) ? surface.numeric : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                {r.cells.map((c, i) => <td key={i} className={numericCols.has(i) ? surface.numeric : undefined}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
