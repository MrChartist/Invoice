import { Fragment, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ChevronRight, Clock, Copy, Download, FileText, Mail, Percent, Wallet, Scale,
} from 'lucide-react';
import { localDb } from '../lib/localDb';
import {
  AGING_BUCKETS, agingCsv, buildLedger, buildReceivables, buildStatementText, computeDso,
  currenciesIn, debtorShare, monthlyCollections, overallEfficiency, topDebtors,
  type PartyReceivable, type ReceiptRow,
} from '../lib/receivables';
import { formatMoney, formatCurrency, formatDate, todayInput, toDateInput } from '../lib/utils';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/useToast';
import { AgingStack, CollectionsChart, ShareBar, AgeChip } from '../components/receivables/Charts';
import { StatementViewer } from '../components/receivables/StatementViewer';
import { downloadTextFile } from '../components/receivables/exportUtils';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Receivables.module.css';

type Tab = 'aging' | 'statements' | 'collections';
const TABS: { id: Tab; label: string }[] = [
  { id: 'aging', label: 'Aging' },
  { id: 'statements', label: 'Statements' },
  { id: 'collections', label: 'Collections' },
];

/** 1 April of the Indian financial year containing `d`. */
function fyStart(d: Date): Date {
  return new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
}

function loadData() {
  return {
    invoices: localDb.invoices.getAll(),
    payments: localDb.payments.getAll() as ReceiptRow[],
    clients: localDb.clients.getAll(),
  };
}

export function Receivables() {
  const [params, setParams] = useSearchParams();
  const [data] = useState(loadData);
  const { notify, toastNode } = useToast();

  const tab: Tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'aging');
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  const currencies = useMemo(() => currenciesIn(data.invoices), [data.invoices]);
  const [currencyPick, setCurrencyPick] = useState('');
  const currency = currencyPick || currencies[0] || 'INR';

  const now = useMemo(() => new Date(), []);
  const report = useMemo(() => buildReceivables(data, { currency, now }), [data, currency, now]);
  const months = useMemo(() => monthlyCollections(report, 12, now), [report, now]);
  const dso = useMemo(() => computeDso(report, 90, now), [report, now]);
  const efficiency = overallEfficiency(months);
  const fmt = (n: number) => formatCurrency(n, currency);

  if (report.parties.length === 0) {
    return (
      <div className={surface.page}>
        <Header />
        <div className={surface.card}>
          <EmptyState
            icon={Scale}
            title="Nothing to reconcile yet"
            text="Issue an invoice to a client and record payments against it. Outstanding balances, aging and client statements appear here automatically."
            action={<Link to="/invoice" className={`${controls.btn} ${controls.btnPrimary}`}>Create invoice</Link>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={surface.page}>
      <Header>
        {currencies.length > 1 && (
          <label className={styles.inline}>
            <span className={controls.label}>Currency</span>
            <select className={controls.select} value={currency} onChange={(e) => setCurrencyPick(e.target.value)}>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
          onClick={() => downloadTextFile(`Receivables_aging_${todayInput()}.csv`, agingCsv(report))}>
          <Download size={16} /> Export CSV
        </button>
      </Header>

      <div className={surface.statGrid}>
        <Stat label="Net outstanding" value={fmt(report.totals.net)} icon={Wallet}
          hint={`${report.totals.billCount} open bill${report.totals.billCount === 1 ? '' : 's'}`} />
        <Stat label="Overdue" value={fmt(report.totals.overdue)} icon={AlertTriangle} tone="loss"
          hint={report.totals.gross > 0 ? `${Math.round((report.totals.overdue / report.totals.gross) * 100)}% of open bills` : 'All clear'} />
        <Stat label="DSO (90 days)" value={dso === null ? '—' : `${dso} days`} icon={Clock}
          hint="Avg. days to collect" />
        <Stat label="Collection efficiency" value={efficiency === null ? '—' : `${efficiency}%`} icon={Percent}
          hint="Received ÷ billed, last 12 months" />
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Receivables reports">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`rcv-tab-${t.id}`} aria-selected={tab === t.id}
            aria-controls={`rcv-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? styles.tabActive : styles.tab} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rcv-panel-${tab}`} aria-labelledby={`rcv-tab-${tab}`}>
        {tab === 'aging' && <AgingTab report={report} currency={currency} fmt={fmt}
          onStatement={(p) => { const n = new URLSearchParams(params); n.set('tab', 'statements'); n.set('party', p.key); setParams(n, { replace: true }); }} />}
        {tab === 'statements' && <StatementsTab report={report} data={data} currency={currency} now={now}
          partyKey={params.get('party') ?? ''} onPick={(k) => { const n = new URLSearchParams(params); n.set('party', k); setParams(n, { replace: true }); }}
          notify={notify} />}
        {tab === 'collections' && (
          <div className={surface.card}>
            <div className={surface.cardHead}><h2 className={styles.h2}>Billed vs received — last 12 months</h2></div>
            <div className={surface.cardBody}>
              <CollectionsChart rows={months} currency={currency} />
            </div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>Monthly collections</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th><th scope="col" className={surface.numeric}>Billed</th>
                    <th scope="col" className={surface.numeric}>Credit notes</th>
                    <th scope="col" className={surface.numeric}>Received</th>
                    <th scope="col" className={surface.numeric}>Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((r) => (
                    <tr key={r.month}>
                      <td>{formatDate(`${r.month}-01`).replace(/^1 /, '')}</td>
                      <td className={surface.numeric}>{formatMoney(r.billed, currency)}</td>
                      <td className={surface.numeric}>{r.credited ? formatMoney(r.credited, currency) : '—'}</td>
                      <td className={surface.numeric}>{formatMoney(r.received, currency)}</td>
                      <td className={surface.numeric}>{r.efficiency === null ? '—' : `${r.efficiency}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {toastNode}
    </div>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <div className={surface.pageHead}>
      <div>
        <h1 className={surface.pageTitle}><Scale size={24} aria-hidden="true" /> Receivables</h1>
        <p className={surface.pageSubtitle}>Who owes you what, how old it is, and a statement to send them.</p>
      </div>
      <div className={surface.pageActions}>{children}</div>
    </div>
  );
}

function Stat({ label, value, hint, icon: Icon, tone }: {
  label: string; value: string; hint: string; icon: typeof Wallet; tone?: 'loss';
}) {
  return (
    <div className={surface.stat}>
      <div className={surface.statTop}>
        <span className={surface.statLabel}>{label}</span>
        <span className={surface.statIcon}><Icon size={16} aria-hidden="true" color={tone === 'loss' ? 'var(--loss)' : 'var(--primary)'} /></span>
      </div>
      <div className={surface.statValue} style={tone === 'loss' ? { color: 'var(--loss)' } : undefined}>{value}</div>
      <div className={surface.statHint}>{hint}</div>
    </div>
  );
}

/* ── Aging ────────────────────────────────────────────────────── */

function AgingTab({ report, currency, fmt, onStatement }: {
  report: ReturnType<typeof buildReceivables>;
  currency: string;
  fmt: (n: number) => string;
  onStatement: (p: PartyReceivable) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const top = topDebtors(report, 5);
  const m = (n: number) => (n ? formatMoney(n, currency) : '—');

  return (
    <div className={styles.stack}>
      <div className={surface.card}>
        <div className={surface.cardHead}><h2 className={styles.h2}>Outstanding by age</h2></div>
        <div className={surface.cardBody}><AgingStack buckets={report.totals.buckets} currency={currency} /></div>
      </div>

      {top.length > 0 && (
        <div className={surface.card}>
          <div className={surface.cardHead}><h2 className={styles.h2}>Top debtors</h2></div>
          <ol className={styles.debtors}>
            {top.map((p) => (
              <li key={p.key} className={styles.debtor}>
                <div className={styles.debtorTop}>
                  <button type="button" className={styles.linkBtn} onClick={() => onStatement(p)}>{p.name}</button>
                  <strong className={styles.amt}>{fmt(p.net)}</strong>
                </div>
                <ShareBar percent={debtorShare(report, p)} />
                <span className={surface.statHint}>
                  {debtorShare(report, p)}% of receivables{p.oldestOverdueDays > 0 ? ` · oldest ${p.oldestOverdueDays} days overdue` : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={surface.card}>
        <div className={surface.cardHead}><h2 className={styles.h2}>Party-wise outstanding</h2></div>
        <div className={surface.tableWrap}>
          <table className={`${surface.table} ${styles.agingTable}`}>
            <caption className={surface.srOnly}>Outstanding by party and age. Expand a row to see its bills.</caption>
            <thead>
              <tr>
                <th scope="col">Party</th>
                {AGING_BUCKETS.map((b) => <th key={b} scope="col" className={surface.numeric}>{b}</th>)}
                <th scope="col" className={surface.numeric}>Credits</th>
                <th scope="col" className={surface.numeric}>Net</th>
              </tr>
            </thead>
            <tbody>
              {report.parties.map((p) => {
                const expanded = open.has(p.key);
                const canExpand = p.bills.length > 0;
                return (
                  <Fragment key={p.key}>
                    <tr>
                      <th scope="row" className={styles.partyCell}>
                        {canExpand ? (
                          <button type="button" className={styles.expand} aria-expanded={expanded} onClick={() => toggle(p.key)}>
                            <ChevronRight size={16} className={expanded ? styles.chevOpen : styles.chev} aria-hidden="true" />
                            {p.name}
                          </button>
                        ) : <span className={styles.noExpand}>{p.name}</span>}
                      </th>
                      {AGING_BUCKETS.map((b) => <td key={b} className={surface.numeric}>{m(p.buckets[b])}</td>)}
                      <td className={surface.numeric}>{m(p.creditNotes + p.advances)}</td>
                      <td className={`${surface.numeric} ${p.net < 0 ? styles.credit : ''}`}><strong>{formatMoney(p.net, currency)}</strong></td>
                    </tr>
                    {expanded && (
                      <tr className={styles.billsRow}>
                        <td colSpan={8}>
                          <table className={styles.bills}>
                            <thead>
                              <tr><th scope="col">Bill</th><th scope="col">Issued</th><th scope="col">Due</th>
                                <th scope="col" className={surface.numeric}>Total</th>
                                <th scope="col" className={surface.numeric}>Paid</th>
                                <th scope="col" className={surface.numeric}>Outstanding</th>
                                <th scope="col">Age</th></tr>
                            </thead>
                            <tbody>
                              {p.bills.map((b) => (
                                <tr key={b.invoiceId}>
                                  <td className={surface.mono}>{b.number}</td>
                                  <td>{formatDate(b.issueDate)}</td>
                                  <td>{formatDate(b.dueDate)}</td>
                                  <td className={surface.numeric}>{formatMoney(b.total, currency)}</td>
                                  <td className={surface.numeric}>{m(b.paid)}</td>
                                  <td className={surface.numeric}><strong>{formatMoney(b.outstanding, currency)}</strong></td>
                                  <td>
                                    <AgeChip bucket={b.bucket}>
                                      {b.daysOverdue > 0 ? `${b.daysOverdue} days overdue` : 'Not due'}
                                    </AgeChip>
                                  </td>
                                </tr>
                              ))}
                              {(p.creditNotes > 0 || p.advances > 0) && (
                                <tr>
                                  <td colSpan={7} className={surface.statHint}>
                                    Less unadjusted credits: {p.creditNotes > 0 && `credit notes ${formatMoney(p.creditNotes, currency)}`}
                                    {p.creditNotes > 0 && p.advances > 0 && ', '}
                                    {p.advances > 0 && `advances ${formatMoney(p.advances, currency)}`}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <th scope="row">Total</th>
                {AGING_BUCKETS.map((b) => <td key={b} className={surface.numeric}>{m(report.totals.buckets[b])}</td>)}
                <td className={surface.numeric}>{m(report.totals.creditNotes + report.totals.advances)}</td>
                <td className={surface.numeric}>{formatMoney(report.totals.net, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Statements ───────────────────────────────────────────────── */

function StatementsTab({ report, data, currency, now, partyKey, onPick, notify }: {
  report: ReturnType<typeof buildReceivables>;
  data: ReturnType<typeof loadData>;
  currency: string;
  now: Date;
  partyKey: string;
  onPick: (key: string) => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  const party = report.parties.find((p) => p.key === partyKey) ?? report.parties[0];
  const [from, setFrom] = useState(() => toDateInput(fyStart(now)));
  const [to, setTo] = useState(() => toDateInput(now));
  const [viewer, setViewer] = useState(false);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);

  const ledger = useMemo(() => buildLedger(party, from, to), [party, from, to]);
  const client = data.clients.find((c) => (party.clientId && c.id === party.clientId)
    || c.name?.trim().toLowerCase() === party.name.trim().toLowerCase());
  const text = useMemo(() => buildStatementText({ sender, party, ledger, currency }), [sender, party, ledger, currency]);
  const closeViewer = useCallback(() => setViewer(false), []);

  const preset = (kind: 'fy' | 'lastfy' | 'q' | 'all') => {
    const fy = fyStart(now);
    if (kind === 'fy') { setFrom(toDateInput(fy)); setTo(toDateInput(now)); }
    else if (kind === 'lastfy') {
      setFrom(toDateInput(new Date(fy.getFullYear() - 1, 3, 1)));
      setTo(toDateInput(new Date(fy.getFullYear(), 2, 31)));
    } else if (kind === 'q') {
      setFrom(toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89))); setTo(toDateInput(now));
    } else { setFrom(''); setTo(''); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Statement text copied — paste it into WhatsApp or email');
    } catch {
      notify('Could not access the clipboard in this browser', 'error');
    }
  };

  const invalidRange = Boolean(from && to && from > to);

  return (
    <div className={styles.stack}>
      <div className={`${surface.card} ${styles.filters}`}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-party">Party</label>
          <select id="rcv-party" className={controls.select} value={party.key} onChange={(e) => onPick(e.target.value)}>
            {[...report.parties].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-from">From</label>
          <input id="rcv-from" type="date" className={controls.input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-to">To</label>
          <input id="rcv-to" type="date" className={controls.input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className={styles.presets} role="group" aria-label="Date range presets">
          {([['fy', 'This FY'], ['lastfy', 'Last FY'], ['q', 'Last 90 days'], ['all', 'All time']] as const).map(([k, l]) => (
            <button key={k} type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => preset(k)}>{l}</button>
          ))}
        </div>
        {invalidRange && <p className={controls.error} role="alert">The start date is after the end date.</p>}
      </div>

      <div className={surface.card}>
        <div className={surface.cardHead}>
          <h2 className={styles.h2}>{party.name}</h2>
          <div className={surface.pageActions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={copy}>
              <Copy size={14} /> Copy text
            </button>
            {client?.email && (
              <a className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                href={`mailto:${client.email}?subject=${encodeURIComponent(`Statement of account – ${sender?.companyName ?? ''}`)}&body=${encodeURIComponent(text)}`}>
                <Mail size={14} /> Email
              </a>
            )}
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setViewer(true)} disabled={invalidRange}>
              <FileText size={14} /> Print / PDF
            </button>
          </div>
        </div>

        <div className={styles.ledgerSummary}>
          <Mini label="Opening" value={formatMoney(ledger.opening, currency)} dir={ledger.opening} />
          <Mini label="Debit" value={formatMoney(ledger.totalDebit, currency)} />
          <Mini label="Credit" value={formatMoney(ledger.totalCredit, currency)} />
          <Mini label="Closing" value={formatMoney(ledger.closing, currency)} dir={ledger.closing} strong />
        </div>

        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>Ledger for {party.name}</caption>
            <thead>
              <tr>
                <th scope="col">Date</th><th scope="col">Voucher</th><th scope="col">Particulars</th>
                <th scope="col" className={surface.numeric}>Debit</th>
                <th scope="col" className={surface.numeric}>Credit</th>
                <th scope="col" className={surface.numeric}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className={styles.openingRow}>
                <td>{from ? formatDate(from) : '—'}</td><td /><td><em>Opening balance</em></td><td /><td />
                <td className={surface.numeric}>{drcr(ledger.opening, currency)}</td>
              </tr>
              {ledger.entries.map((e, i) => (
                <tr key={`${e.ref}-${i}`}>
                  <td>{formatDate(e.date)}</td>
                  <td className={surface.mono}>{e.ref}</td>
                  <td>{e.particulars}</td>
                  <td className={surface.numeric}>{e.debit ? formatMoney(e.debit, currency) : ''}</td>
                  <td className={surface.numeric}>{e.credit ? formatMoney(e.credit, currency) : ''}</td>
                  <td className={surface.numeric}>{drcr(e.balance, currency)}</td>
                </tr>
              ))}
              {ledger.entries.length === 0 && (
                <tr><td colSpan={6} className={surface.statHint}>No transactions in this period.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <th scope="row" colSpan={3}>Closing balance</th>
                <td className={surface.numeric}>{formatMoney(ledger.totalDebit, currency)}</td>
                <td className={surface.numeric}>{formatMoney(ledger.totalCredit, currency)}</td>
                <td className={surface.numeric}>{drcr(ledger.closing, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className={`${surface.sectionNote} ${styles.note}`}>
          Dr = the party owes you; Cr = you owe the party (advance or credit note exceeds bills).
        </p>
      </div>

      <StatementViewer open={viewer} onClose={closeViewer} sender={sender} party={party} client={client}
        ledger={ledger} currency={currency} onError={(msg) => notify(msg, 'error')} />
    </div>
  );
}

function drcr(n: number, currency: string): string {
  return Math.abs(n) < 0.005 ? formatMoney(0, currency) : `${formatMoney(Math.abs(n), currency)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

function Mini({ label, value, dir, strong }: { label: string; value: string; dir?: number; strong?: boolean }) {
  return (
    <div className={styles.mini}>
      <span className={surface.statLabel}>{label}</span>
      <span className={strong ? styles.miniStrong : styles.miniValue}>
        {value}{dir !== undefined && Math.abs(dir) >= 0.005 ? (dir > 0 ? ' Dr' : ' Cr') : ''}
      </span>
    </div>
  );
}
