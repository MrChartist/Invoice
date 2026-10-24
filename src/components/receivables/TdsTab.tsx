/**
 * TDS tab of the Receivables page: the quarter × deductor × section register,
 * Form 16A tracking and a 26AS / AIS CSV reconciliation. Loaded lazily, so none
 * of this (or the CSV / import-mapping code it pulls in) touches the main bundle.
 */
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck, CheckCircle2, Download, FileSearch, FileWarning, Landmark, Receipt, Upload, X,
} from 'lucide-react';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import {
  TDS_CERT_TABLE, buildTdsRegister, certStatusLabel, fyLabel, parseTdsCsv, reconcileTds, setCertificate,
  tdsReconCsv, tdsRegisterCsv, quarterLabel,
  type CertStatus, type TdsCertificate, type TdsCsvResult, type TdsQuarterBlock, type TdsRecon,
} from '../../lib/tds-register';
import { getTable, setTable } from '../../lib/storage';
import { isoDay } from '../../lib/dates';
import { getIndianFY } from '../../lib/invoice-number';
import { formatCurrency, formatDate, formatMoney, todayInput } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { StatCard } from '../ui/StatCard';
import { downloadTextFile } from './exportUtils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './TdsTab.module.css';

export interface TdsTabProps {
  data: { invoices: InvoiceRecord[]; payments: Payment[]; clients: Client[] };
  notify: (message: string, tone?: 'success' | 'error') => void;
}

const BADGE: Record<CertStatus, string> = {
  received: surface.badgePaid,
  awaited: surface.badgeSent,
  overdue: surface.badgeOverdue,
};

const money = (n: number) => (n ? formatMoney(n, 'INR') : '—');

function loadCerts(): TdsCertificate[] {
  try {
    return getTable<TdsCertificate>(TDS_CERT_TABLE);
  } catch {
    return [];
  }
}

export default function TdsTab({ data, notify }: TdsTabProps) {
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
      notify(received ? `Form 16A marked received — ${partyName}, Q${block.quarter}` : 'Form 16A mark cleared');
    } catch (err) {
      notify((err as Error).message || 'Could not save', 'error');
    }
  };

  if (all.rows.length === 0) {
    return (
      <div className={surface.card}>
        <EmptyState
          icon={Landmark}
          title="No TDS on your invoices yet"
          text="When a customer deducts TDS, switch on TDS (with its section) in the invoice's tax options. Each quarter's deductions, Form 16A status and a 26AS check then appear here."
          action={<Link to="/invoice" className={`${controls.btn} ${controls.btnPrimary}`}>Create invoice</Link>}
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
          <span className={controls.label}>Financial year</span>
          <select className={controls.select} value={String(fy)}
            onChange={(e) => setFyPick(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            {all.fys.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
            {all.fys.length > 1 && <option value="all">All years</option>}
          </select>
        </label>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
          onClick={() => downloadTextFile(`TDS_register_${fy === 'all' ? 'all' : fyLabel(fy)}_${todayInput()}.csv`, tdsRegisterCsv(reg))}>
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className={surface.statGrid}>
        <StatCard label="TDS expected" value={fmt(reg.totals.tdsExpected)} icon={Receipt}
          hint={`${reg.totals.invoiceCount} invoice${reg.totals.invoiceCount === 1 ? '' : 's'} with TDS`} />
        <StatCard label="TDS settled" value={fmt(reg.totals.tdsSettled)} icon={CheckCircle2} tone="profit"
          hint="On invoices paid in full" />
        <StatCard label="TDS pending" value={fmt(reg.totals.tdsPending)} icon={FileWarning} tone="warning"
          hint="On invoices not yet paid" />
        <StatCard label="Form 16A in hand" value={`${certStats.in} / ${certStats.of}`} icon={BadgeCheck}
          tone={certStats.late ? 'loss' : 'default'}
          hint={certStats.late ? `${certStats.late} overdue` : 'Deductor × quarter'} />
      </div>

      {reg.quarters.map((q) => <QuarterCard key={q.key} block={q} onToggle={toggleCert} />)}

      <Reconcile data={data} notify={notify} />

      <p className={surface.sectionNote}>
        TDS is bucketed by invoice date. &ldquo;Settled&rdquo; means the invoice is paid in full, so the customer has
        deducted it. This register is a working paper, not a TRACES statement — verify with your CA before you
        claim the credit in your return.
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
        <span className={surface.statHint}>Form 16A due by {formatDate(block.certDue)}</span>
      </div>
      <div className={surface.tableWrap}>
        <table className={`${surface.table} ${styles.table}`}>
          <caption className={surface.srOnly}>TDS by deductor and section, {block.label}</caption>
          <thead>
            <tr>
              <th scope="col">Deductor</th>
              <th scope="col">Section</th>
              <th scope="col" className={surface.numeric}>Invoices</th>
              <th scope="col" className={surface.numeric}>Taxable</th>
              <th scope="col" className={surface.numeric}>Invoice total</th>
              <th scope="col" className={surface.numeric}>TDS expected</th>
              <th scope="col" className={surface.numeric}>Settled</th>
              <th scope="col" className={surface.numeric}>Pending</th>
              <th scope="col">Form 16A</th>
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
                        <Link to={`/clients?edit=${encodeURIComponent(r.partyKey)}`} className={styles.addTan}>Add TAN</Link>
                      ) : <span>No TAN</span>}
                    </span>
                  </th>
                  <td className={surface.mono}>{r.section || '—'}</td>
                  <td className={surface.numeric} title={r.invoices.map((l) => l.number).join(', ')}>{r.invoiceCount}</td>
                  <td className={surface.numeric}>{money(r.taxable)}</td>
                  <td className={surface.numeric}>{money(r.total)}</td>
                  <td className={`${surface.numeric} ${styles.strong}`}>{money(r.tdsExpected)}</td>
                  <td className={surface.numeric}>{money(r.tdsSettled)}</td>
                  <td className={surface.numeric}>{money(r.tdsPending)}</td>
                  {span !== undefined && (
                    <td rowSpan={span} className={styles.certCell}>
                      <span className={BADGE[r.certificate]}>{certStatusLabel(r.certificate)}</span>
                      <label className={styles.check}>
                        <input type="checkbox" checked={r.certificate === 'received'}
                          onChange={(e) => onToggle(block, r.partyKey, r.partyName, e.target.checked)} />
                        Received
                      </label>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <th scope="row" colSpan={2}>Quarter total</th>
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
      const result = parseTdsCsv(await file.text());
      setFileName(file.name);
      setParsed(result);
      if (result.missing.length) notify(`Could not find: ${result.missing.join(', ')}`, 'error');
    } catch (err) {
      notify((err as Error).message || 'Could not read that file', 'error');
    }
  };

  const clear = () => {
    setParsed(null);
    setFileName('');
  };

  return (
    <section className={surface.card} aria-labelledby="tds-recon">
      <div className={surface.cardHead}>
        <h2 id="tds-recon" className={styles.h2}>Check against 26AS / AIS</h2>
        {recon && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
            onClick={() => downloadTextFile(`TDS_26AS_reconciliation_${todayInput()}.csv`, tdsReconCsv(recon))}>
            <Download size={16} /> Export CSV
          </button>
        )}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>
          Download Form 26AS (Part I) or the AIS TDS section from the income-tax portal, save it as CSV and pick it
          here. Columns are matched by name: deductor name, TAN, section, transaction date, amount paid / credited
          and TDS deducted. Credits are matched to your invoices by TAN (or name) and quarter. The file is read on
          this device and is not stored.
        </p>
        <div className={styles.reconControls}>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className={surface.srOnly} onChange={onFile}
            aria-label="26AS or AIS CSV file" tabIndex={-1} />
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {parsed ? 'Choose another file' : 'Choose CSV'}
          </button>
          <label className={styles.inline}>
            <span className={controls.label}>Tolerance (₹ per entry)</span>
            <input className={`${controls.input} ${controls.inputNumeric} ${styles.tol}`} type="number" min={0} step={0.5}
              value={tolerance} onChange={(e) => setTolerance(Math.max(Number(e.target.value) || 0, 0))} />
          </label>
          {parsed && (
            <button type="button" className={controls.btnGhost} onClick={clear}>
              <X size={16} /> Clear {fileName}
            </button>
          )}
        </div>

        {parsed && parsed.missing.length > 0 && (
          <p className={controls.error} role="alert">
            {fileName}: could not find a column for {parsed.missing.join(', ')}. Found: {parsed.headers.join(', ') || 'no header row'}.
          </p>
        )}
        {parsed && !parsed.missing.length && (
          <p className={surface.statHint}>
            {fileName}: {parsed.credits.length} TDS entr{parsed.credits.length === 1 ? 'y' : 'ies'} read
            {parsed.zeroRows ? `, ${parsed.zeroRows} with no TDS skipped` : ''}
            {parsed.errors.length ? `, ${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} could not be read (line ${parsed.errors.slice(0, 5).map((e) => e.line).join(', ')}${parsed.errors.length > 5 ? '…' : ''})` : ''}.
          </p>
        )}

        {recon && (
          <>
            <div className={styles.summary}>
              <Summary label="Matched" value={recon.matched.length} amount={recon.totals.matched26as} tone="ok" />
              <Summary label="Only in 26AS" value={recon.only26as.length} amount={recon.totals.only26as} tone="warn" />
              <Summary label="Only in books" value={recon.onlyBooks.length} amount={recon.totals.onlyBooks} tone="bad" />
            </div>

            {recon.matched.length > 0 && (
              <ReconTable title="Matched" head={['Quarter', 'Deductor', 'Invoice(s)', '26AS TDS', 'Books TDS', 'Difference', 'Note']}
                rows={recon.matched.map((m, i) => ({
                  key: `m${i}`,
                  cells: [
                    `Q${m.quarter} ${fyLabel(m.fy)}`, m.partyName, m.invoices.map((l) => l.number).join(', '),
                    money(m.tds26as), money(m.tdsBooks), m.diff ? formatMoney(m.diff, 'INR') : '—',
                    [m.kind === 'group' ? 'Quarter total' : '', m.quarterShift ? 'Other quarter' : ''].filter(Boolean).join(' · ') || '—',
                  ],
                }))} />
            )}
            {recon.only26as.length > 0 && (
              <ReconTable title="Only in 26AS — no matching invoice" head={['Date', 'Deductor', 'TAN', 'Section', 'Amount paid', 'TDS', 'Note']}
                rows={recon.only26as.map((c) => ({
                  key: `c${c.line}`,
                  cells: [formatDate(c.date), c.partyName, c.tan || '—', c.section || '—', money(c.amountPaid), money(c.tds),
                    c.known ? 'Invoice without TDS, or a different amount' : 'Deductor not in your clients — add their TAN'],
                }))} />
            )}
            {recon.onlyBooks.length > 0 && (
              <ReconTable title="Only in books — not yet in 26AS" head={['Quarter', 'Deductor', 'Invoice', 'Date', 'Section', 'TDS', 'Note']}
                rows={recon.onlyBooks.map((l) => ({
                  key: `b${l.invoiceId}`,
                  cells: [`${quarterLabel(l.quarter)} ${fyLabel(l.fy)}`, l.partyName, l.number, formatDate(l.date), l.section || '—', money(l.tds),
                    l.settled ? 'Paid — ask the customer to file or correct their TDS return' : 'Not fully paid yet'],
                }))} />
            )}
            {recon.matched.length > 0 && !recon.only26as.length && !recon.onlyBooks.length && (
              <p className={styles.allGood}><CheckCircle2 size={16} /> Every entry matched.</p>
            )}
          </>
        )}
        {!parsed && (
          <p className={styles.hintRow}><FileSearch size={16} /> No file loaded.</p>
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
      <span className={surface.statHint}>{formatMoney(amount, 'INR')} TDS</span>
    </div>
  );
}

function ReconTable({ title, head, rows }: { title: string; head: string[]; rows: { key: string; cells: string[] }[] }) {
  const numericCols = new Set(head.map((h, i) => (/TDS|Amount|Difference/.test(h) ? i : -1)).filter((i) => i >= 0));
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
