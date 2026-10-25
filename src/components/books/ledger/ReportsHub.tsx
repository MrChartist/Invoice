/**
 * Books → Reports (WP-2): Tally's "Display More Reports" list — Group Summary, voucher registers, exception reports, statistics and funds flow. Every report drills down
 * through the shared DrillStack (Enter / Esc) to ledgers and vouchers.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { buildReceivables } from '../../../lib/receivables';
import { getTable } from '../../../lib/storage';
import type { CreditLinkRow } from '../../../lib/amount-due';
import {
  REGISTER_LABELS,
  columnarRegister,
  exceptionReport,
  fundsFlow,
  voucherRegister,
  voucherStatistics,
  type Ledger,
  type LedgerVoucher,
  type RegisterId,
} from '../../../lib/ledger';
import type { BooksData, Period } from '../../../lib/books';
import type { StockPosition } from '../../../lib/inventory';
import { formatDate } from '../../../lib/utils';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { br2T } from '../../../i18n/areas/books-r2';
import { capT } from '../../../i18n/areas/capture';
import { duplicateBillPairs } from '../../../lib/bill-duplicates';
import type { PurchaseRecord } from '../../../types/purchases';
import { useT } from '../../../i18n';
import { DrillStack } from './DrillStack';
import { useDrill, useDrillRows } from './drill-hooks';
import { GroupSummaryView } from './ReportViews';
import { ledgerFrame } from './report-frames';
import { useOpenVoucher, useReportEnv } from './report-env';
import { drCr, money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

// Ratio Analysis lives in the Books → Ratio analysis tab (src/components/books/tally/RatioTab.tsx), with closing stock.
export type ReportId = 'group' | 'registers' | 'exceptions' | 'stats' | 'funds' | 'annual';
const REPORTS: ReportId[] = ['group', 'registers', 'exceptions', 'stats', 'funds', 'annual'];
// R2-C1: annual accounts pack with notes to accounts (own lazy chunk).
const AnnualPackTab = lazy(() => import('./AnnualPackTab'));

interface Props {
  period: Period;
  data: BooksData;
  today: string;
  positions: () => StockPosition[];
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

export function ReportsHub(props: Props) {
  useT();
  const [report, setReport] = useState<ReportId>('group');
  const title: Record<ReportId, string> = {
    group: reportsT('groupSummary'),
    registers: reportsT('registers'),
    exceptions: reportsT('exceptions'),
    stats: reportsT('statistics'),
    funds: reportsT('fundsFlow'),
    annual: br2T('annual'),
  };
  return (
    <div className={books.stack}>
      <div className={`${books.presets} no-print`} role="group" aria-label={reportsT('reports')}>
        {REPORTS.map((r) => (
          <button key={r} type="button" className={report === r ? books.chipActive : books.chip} aria-pressed={report === r} onClick={() => setReport(r)}>
            {title[r]}
          </button>
        ))}
      </div>
      {report === 'annual' && (
        <Suspense fallback={null}>
          <AnnualPackTab period={props.period} today={props.today} notify={props.notify} />
        </Suspense>
      )}
      {report !== 'annual' && (
      <DrillStack rootTitle={title[report]} resetKey={`${report}:${props.period.start}:${props.period.end}`}>
        {report === 'group' && <GroupSummaryView groupId={null} period={props.period} />}
        {report === 'registers' && <RegistersView period={props.period} />}
        {report === 'exceptions' && <ExceptionsView {...props} />}
        {report === 'stats' && <StatisticsView period={props.period} />}
        {report === 'funds' && <FundsFlowView period={props.period} />}
      </DrillStack>
      )}
    </div>
  );
}

function VoucherTable({ vouchers, ledger }: { vouchers: LedgerVoucher[]; ledger: Ledger }) {
  useT();
  const openVoucher = useOpenVoucher();
  const [columnar, setColumnar] = useState(false);
  const col = useMemo(() => columnarRegister(ledger, vouchers), [ledger, vouchers]);
  const nav = useDrillRows(vouchers.length, (i) => openVoucher(vouchers[i]));
  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <label className={styles.inlineField}>
          <input type="checkbox" checked={columnar} onChange={(e) => setColumnar(e.target.checked)} />
          <span>{reportsT('columnar')}</span>
        </label>
      </StatementToolbar>
      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table} {...nav.table}>
            <caption className={surface.srOnly}>{reportsT('registers')}</caption>
            <thead>
              <tr>
                <th scope="col">{reportsT('date')}</th>
                <th scope="col">{reportsT('particulars')}</th>
                <th scope="col">{reportsT('vchNo')}</th>
                {columnar ? col.columns.map((c) => <th key={c.accountId} scope="col" className={surface.numeric}>{c.label}</th>) : <th scope="col" className={surface.numeric}>{reportsT('amount')}</th>}
              </tr>
            </thead>
            <tbody id={nav.bodyId}>
              {col.rows.map((r, i) => (
                <tr key={r.voucher.id} {...nav.row(i)}>
                  <td>{formatDate(r.voucher.date)}</td>
                  <td>{r.voucher.party || r.voucher.narration || r.voucher.kind}</td>
                  <td className={surface.mono}>{r.voucher.number || '—'}</td>
                  {columnar ? r.values.map((v, k) => <td key={k} className={surface.numeric}>{drCr(v)}</td>) : <td className={surface.numeric}>{money(r.amount)}</td>}
                </tr>
              ))}
              <tr className={books.totalRow}>
                <td colSpan={3}>{reportsT('total')}</td>
                {columnar ? col.totals.map((v, k) => <td key={k} className={surface.numeric}>{drCr(v)}</td>) : <td className={surface.numeric}>{money(col.amount)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RegistersView({ period }: { period: Period }) {
  useT();
  const { ledger } = useReportEnv();
  const drill = useDrill();
  const [id, setId] = useState<RegisterId>('sales');
  const reg = useMemo(() => voucherRegister(ledger, id, period), [ledger, id, period]);
  const push = (i: number) => {
    const m = reg.months[i];
    drill.push({ key: `reg:${id}:${m.key}`, title: `${REGISTER_LABELS[id]}: ${m.label}`, render: () => <VoucherTable vouchers={m.vouchers} ledger={ledger} /> });
  };
  const nav = useDrillRows(reg.months.length, push);
  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <select className={controls.select} value={id} onChange={(e) => setId(e.target.value as RegisterId)} aria-label={reportsT('register')}>
          {(Object.keys(REGISTER_LABELS) as RegisterId[]).map((r) => <option key={r} value={r}>{REGISTER_LABELS[r]}</option>)}
        </select>
        <button type="button" className={controls.btnOutline} onClick={() => drill.push({ key: `reg:${id}:all`, title: REGISTER_LABELS[id], render: () => <VoucherTable vouchers={reg.months.flatMap((m) => m.vouchers)} ledger={ledger} /> })}>
          {reportsT('allVouchers')}
        </button>
      </StatementToolbar>
      <PrintTitle title={REGISTER_LABELS[id]} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table} {...nav.table}>
            <caption className={surface.srOnly}>{REGISTER_LABELS[id]}</caption>
            <thead>
              <tr>
                <th scope="col">{reportsT('month')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('vouchers')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('amount')}</th>
              </tr>
            </thead>
            <tbody id={nav.bodyId}>
              {reg.months.map((m, i) => (
                <tr key={m.key} {...nav.row(i)}>
                  <td><button type="button" className={styles.rowButton} onClick={() => push(i)}>{m.label}</button></td>
                  <td className={surface.numeric}>{m.count || ''}</td>
                  <td className={surface.numeric}>{m.amount ? money(m.amount) : ''}</td>
                </tr>
              ))}
              <tr className={books.totalRow}>
                <td>{reportsT('grandTotal')}</td>
                <td className={surface.numeric}>{reg.count}</td>
                <td className={surface.numeric}>{money(reg.amount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExceptionsView({ period, data, today, positions }: Props) {
  useT();
  const { ledger } = useReportEnv();
  const drill = useDrill();
  const openVoucher = useOpenVoucher();
  const ex = useMemo(() => {
    const rec = buildReceivables({ invoices: data.invoices, payments: data.transactions, advances: data.advances, links: getTable<CreditLinkRow>('doc_links') });
    const overdue = rec.parties.flatMap((p) =>
      p.bills.filter((b) => b.daysOverdue > 0).map((b) => ({ party: p.name, number: b.number, dueDate: b.dueDate, outstanding: Math.round(b.outstanding * 100), daysOverdue: b.daysOverdue, invoiceId: b.invoiceId })),
    );
    return exceptionReport(ledger, period, today, { positions: positions(), overdue, duplicateBills: duplicateBillPairs(data.purchases as unknown as PurchaseRecord[]) });
  }, [ledger, period, today, data, positions]);
  const reasons: Record<string, string> = {
    cash_negative: reportsT('exCash'),
    debtor_credit: reportsT('exDebtor'),
    creditor_debit: reportsT('exCreditor'),
    asset_credit: reportsT('exAsset'),
    liability_debit: reportsT('exLiability'),
  };
  const section = (title: string, count: number, body: React.ReactNode) => (
    <div className={surface.card}>
      <div className={surface.cardHead}>{title} ({count})</div>
      {count === 0 ? <p className={surface.cardBody}><span className={books.muted}>{reportsT('exNone')}</span></p> : <div className={`${surface.tableWrap} ${styles.wrap}`}>{body}</div>}
    </div>
  );
  return (
    <div className={books.stack}>
      <StatementToolbar filename="" />
      {section(reportsT('exNegativeLedgers'), ex.negativeLedgers.length, (
        <table className={surface.table}>
          <tbody>
            {ex.negativeLedgers.map((n, i) => (
              <tr key={i}>
                <td><button type="button" className={styles.rowButton} onClick={() => drill.push(ledgerFrame(ledger, n.accountId, period, n.party))}>{n.label}{n.party ? ` — ${n.party}` : ''}</button></td>
                <td>{reasons[n.reason]}{n.firstDate ? ` · ${reportsT('exFrom', { date: formatDate(n.firstDate) })}` : ''}</td>
                <td className={surface.numeric}>{drCr(n.lowest ?? n.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section(reportsT('exNegativeStock'), ex.negativeStock.length, (
        <table className={surface.table}>
          <tbody>
            {ex.negativeStock.map((s) => (
              <tr key={s.itemId}>
                <td>{s.name}</td>
                <td>{reportsT('exFrom', { date: formatDate(s.firstDate) })}</td>
                <td className={surface.numeric}>{s.lowestQty}</td>
                <td className={surface.numeric}>{s.closingQty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section(reportsT('exOverdue'), ex.overdue.length, (
        <table className={surface.table}>
          <tbody>
            {ex.overdue.slice(0, 200).map((o, i) => (
              <tr key={i}>
                <td>{o.party}</td>
                <td className={surface.mono}>{o.number}</td>
                <td>{formatDate(o.dueDate)} · {reportsT('exDaysOverdue', { days: o.daysOverdue })}</td>
                <td className={surface.numeric}>{money(o.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section(reportsT('exPostDated'), ex.postDated.length, (
        <table className={surface.table}>
          <tbody>
            {ex.postDated.map((v) => (
              <tr key={v.id}>
                <td>{formatDate(v.date)}</td>
                <td><button type="button" className={styles.rowButton} onClick={() => openVoucher(v)}>{v.kind} {v.number}</button></td>
                <td>{v.narration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section(capT('exDupTitle'), ex.duplicateBills.length, (
        <table className={surface.table}>
          <tbody>
            {ex.duplicateBills.slice(0, 200).map((d) => (
              <tr key={`${d.a.id}-${d.b.id}`}>
                <td>{d.b.vendor_name}</td>
                <td className={surface.mono}>{d.a.bill_number || '—'} / {d.b.bill_number || '—'}</td>
                <td>{formatDate(d.a.date)} / {formatDate(d.b.date)} · {d.kind === 'exact' ? capT('exDupExact') : capT('exDupNear')}</td>
                <td className={surface.numeric}>{money(Math.round(d.b.total * 100))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {section(reportsT('exWarnings'), ex.warnings.length, (
        <ul className={books.statement}>{ex.warnings.map((w) => <li key={w} className={books.stmtRow}><span>{w}</span></li>)}</ul>
      ))}
    </div>
  );
}

function StatisticsView({ period }: { period: Period }) {
  useT();
  const { ledger } = useReportEnv();
  const s = useMemo(() => voucherStatistics(ledger, period), [ledger, period]);
  return (
    <div className={books.stack}>
      <StatementToolbar filename="" />
      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{reportsT('statistics')}</caption>
            <thead>
              <tr>
                <th scope="col">{reportsT('vchType')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('automatic')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('manual')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('total')}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.kind}>
                  <td>{r.kind}</td>
                  <td className={surface.numeric}>{r.auto}</td>
                  <td className={surface.numeric}>{r.manual}</td>
                  <td className={surface.numeric}>{r.total}</td>
                </tr>
              ))}
              <tr className={books.totalRow}>
                <td colSpan={3}>{reportsT('total')}</td>
                <td className={surface.numeric}>{s.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className={books.muted}>{reportsT('statsLedgers', { used: s.accountsUsed, total: s.accountsInChart })}</p>
    </div>
  );
}

function FundsFlowView({ period }: { period: Period }) {
  useT();
  const { ledger, stock } = useReportEnv();
  const f = useMemo(() => fundsFlow(ledger, period, stock), [ledger, period, stock]);
  const list = (title: string, lines: typeof f.sources, totalAmount: number) => (
    <div className={surface.card}>
      <div className={surface.cardHead}>{title}</div>
      <ul className={books.statement}>
        {lines.map((l) => <li key={l.label} className={books.stmtRow}><span>{l.label}</span><span className={books.amt}>{money(l.amount)}</span></li>)}
        <li className={books.stmtTotal}><span>{reportsT('total')}</span><span className={books.amt}>{money(totalAmount)}</span></li>
      </ul>
    </div>
  );
  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <span className={f.difference === 0 ? styles.tieOk : styles.tieBad}>{f.difference === 0 ? reportsT('fundsTies') : money(f.difference)}</span>
      </StatementToolbar>
      <PrintTitle title={reportsT('fundsFlow')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
      <div className={books.twoCol}>
        {list(reportsT('sources'), f.sources, f.totalSources)}
        {list(reportsT('applications'), f.applications, f.totalApplications)}
      </div>
      <p className={books.muted}>
        {reportsT('fundsWc', { open: money(f.openingWorkingCapital), close: money(f.closingWorkingCapital), change: money(f.closingWorkingCapital - f.openingWorkingCapital) })}
      </p>
    </div>
  );
}
