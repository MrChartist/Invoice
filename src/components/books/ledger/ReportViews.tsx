/**
 * Drill-down screens shared by every ledger report (WP-2): Group Summary (with Alt+F1, F12 and
 * comparative columns), Group Vouchers, Ledger Monthly Summary and Ledger Vouchers. Each is pushed
 * on a DrillStack with the `*Frame` helpers; `ReportEnvProvider` supplies the ledger and how to open
 * a voucher (document page, manual-voucher editor), so the Gateway viewer can reuse the screens.
 */
import { useMemo, type ReactNode } from 'react';
import {
  accountStatement,
  columnsFor,
  drillTitle,
  flattenRows,
  groupSummary,
  groupSummaryColumns,
  groupVouchers,
  monthlySummary,
  voucherTarget,
} from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import { EmptyState } from '../../ui/EmptyState';
import { Layers } from 'lucide-react';
import { useDrill, useDrillRows, useReportPrefs } from './drill-hooks';
import { ReportOptions } from './ReportToolbar';
import { EnvContext, useOpenVoucher, useReportEnv, type ReportEnv } from './report-env';
import { groupVouchersFrame, useRowDrill, vouchersFrame } from './report-frames';
import { drCr, money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

export function ReportEnvProvider({ value, children }: { value: ReportEnv; children: ReactNode }) {
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

/* ── Group Summary ──────────────────────────────────────────────── */

export function GroupSummaryView({ groupId, period, reportId = 'group-summary' }: { groupId: string | null; period: Period; reportId?: string }) {
  useT();
  const { ledger } = useReportEnv();
  const drill = useDrill();
  const [prefs, setPrefs] = useReportPrefs(reportId);
  const open = useRowDrill(period);
  const gs = useMemo(() => groupSummary(ledger, period, groupId, { showZero: prefs.showZero }), [ledger, period, groupId, prefs.showZero]);
  const cols = useMemo(
    () => (prefs.columns === 'none' ? null : groupSummaryColumns(ledger, columnsFor(period, prefs.columns), groupId, { showZero: prefs.showZero, detailed: prefs.detailed })),
    [ledger, period, groupId, prefs.columns, prefs.showZero, prefs.detailed],
  );
  const rows = useMemo(() => flattenRows(gs.rows, prefs.detailed), [gs, prefs.detailed]);
  const list = cols ? cols.rows : rows;
  const nav = useDrillRows(list.length, (i) => open(list[i]));
  const title = drillTitle({ kind: 'group', groupId, period }, ledger);

  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <ReportOptions prefs={prefs} onChange={setPrefs} options={['showZero', 'showOpening', 'showTransactions']} columns />
        {groupId && (
          <button type="button" className={`${controls.btnOutline} no-print`} onClick={() => drill.push(groupVouchersFrame(ledger, groupId, period))}>
            {reportsT('groupVouchers')}
          </button>
        )}
      </StatementToolbar>
      <PrintTitle title={title} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
      <div className={surface.card}>
        {list.length === 0 ? (
          <EmptyState icon={Layers} title={reportsT('nothingHere')} text={reportsT('nothingHereText')} />
        ) : cols ? (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table} {...nav.table}>
              <caption className={surface.srOnly}>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">{reportsT('particulars')}</th>
                  {cols.columns.map((c) => <th key={c.key} scope="col" className={surface.numeric}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody id={nav.bodyId}>
                {cols.rows.map((r, i) => (
                  <tr key={r.id} {...nav.row(i)}>
                    <td style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}>
                      <button type="button" className={r.kind === 'group' ? styles.rowButtonGroup : styles.rowButton} onClick={() => open(r)}>{r.label}</button>
                    </td>
                    {r.values.map((v, k) => <td key={k} className={surface.numeric}>{drCr(v)}</td>)}
                  </tr>
                ))}
                <tr className={books.totalRow}>
                  <td>{reportsT('grandTotal')}</td>
                  {cols.totals.map((v, k) => <td key={k} className={surface.numeric}>{drCr(v)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table} {...nav.table}>
              <caption className={surface.srOnly}>{title}</caption>
              <thead>
                <tr>
                  <th scope="col">{reportsT('particulars')}</th>
                  {prefs.showOpening && <th scope="col" className={surface.numeric}>{reportsT('opening')}</th>}
                  {prefs.showTransactions && <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>}
                  {prefs.showTransactions && <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>}
                  <th scope="col" className={surface.numeric}>{reportsT('closing')}</th>
                </tr>
              </thead>
              <tbody id={nav.bodyId}>
                {rows.map((r, i) => (
                  <tr key={r.id} {...nav.row(i)}>
                    <td style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}>
                      <button type="button" className={r.kind === 'group' ? styles.rowButtonGroup : styles.rowButton} onClick={() => open(r)}>{r.label}</button>
                    </td>
                    {prefs.showOpening && <td className={surface.numeric}>{drCr(r.opening)}</td>}
                    {prefs.showTransactions && <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>}
                    {prefs.showTransactions && <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>}
                    <td className={surface.numeric}>{drCr(r.closing)}</td>
                  </tr>
                ))}
                <tr className={books.totalRow}>
                  <td>{reportsT('grandTotal')}</td>
                  {prefs.showOpening && <td className={surface.numeric}>{drCr(gs.totals.opening)}</td>}
                  {prefs.showTransactions && <td className={surface.numeric}>{money(gs.totals.debit)}</td>}
                  {prefs.showTransactions && <td className={surface.numeric}>{money(gs.totals.credit)}</td>}
                  <td className={surface.numeric}>{drCr(gs.totals.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={books.muted}>{reportsT('drillHint')}</p>
    </div>
  );
}

/* ── Group Vouchers ─────────────────────────────────────────────── */

export function GroupVouchersView({ groupId, period }: { groupId: string; period: Period }) {
  useT();
  const { ledger } = useReportEnv();
  const openVoucher = useOpenVoucher();
  const gv = useMemo(() => groupVouchers(ledger, period, groupId), [ledger, period, groupId]);
  const nav = useDrillRows(gv.rows.length, (i) => openVoucher(gv.rows[i].voucher));
  return (
    <div className={surface.card}>
      <div className={`${surface.tableWrap} ${styles.wrap}`}>
        <table className={surface.table} {...nav.table}>
          <caption className={surface.srOnly}>{drillTitle({ kind: 'groupVouchers', groupId, period }, ledger)}</caption>
          <thead>
            <tr>
              <th scope="col">{reportsT('date')}</th>
              <th scope="col">{reportsT('particulars')}</th>
              <th scope="col">{reportsT('vchType')}</th>
              <th scope="col">{reportsT('vchNo')}</th>
              <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>
              <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>
            </tr>
          </thead>
          <tbody id={nav.bodyId}>
            {gv.rows.map((r, i) => (
              <tr key={r.voucher.id} {...nav.row(i)}>
                <td>{formatDate(r.voucher.date)}</td>
                <td>{r.accounts.join(', ')}<div className={books.narration}>{[r.voucher.party, r.voucher.narration].filter(Boolean).join(' · ')}</div></td>
                <td><span className={r.voucher.source === 'manual' ? styles.badgeManual : styles.badge}>{r.voucher.kind}</span></td>
                <td className={surface.mono}>{r.voucher.number || '—'}</td>
                <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>
                <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>
              </tr>
            ))}
            <tr className={books.totalRow}>
              <td colSpan={4}>{reportsT('total')}</td>
              <td className={surface.numeric}>{money(gv.debit)}</td>
              <td className={surface.numeric}>{money(gv.credit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Ledger Monthly Summary ─────────────────────────────────────── */

export function LedgerMonthlyView({ accountId, party, period }: { accountId: string; party?: string; period: Period }) {
  useT();
  const { ledger } = useReportEnv();
  const drill = useDrill();
  const ms = useMemo(() => monthlySummary(ledger, accountId, period, party), [ledger, accountId, period, party]);
  const rows = ms?.rows ?? [];
  const nav = useDrillRows(rows.length, (i) => drill.push(vouchersFrame(ledger, accountId, rows[i].period, party, rows[i].label)));
  if (!ms) return null;
  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <button type="button" className={`${controls.btnOutline} no-print`} onClick={() => drill.push(vouchersFrame(ledger, accountId, period, party))}>
          {reportsT('allVouchers')}
        </button>
      </StatementToolbar>
      <PrintTitle title={drillTitle({ kind: 'ledger', accountId, party, period }, ledger)} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />
      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table} {...nav.table}>
            <caption className={surface.srOnly}>{drillTitle({ kind: 'ledger', accountId, party, period }, ledger)}</caption>
            <thead>
              <tr>
                <th scope="col">{reportsT('month')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('closing')}</th>
              </tr>
            </thead>
            <tbody id={nav.bodyId}>
              <tr className={styles.groupRow}>
                <td>{reportsT('openingBalance')}</td>
                <td />
                <td />
                <td className={surface.numeric}>{drCr(ms.opening)}</td>
              </tr>
              {rows.map((r, i) => (
                <tr key={r.key} {...nav.row(i)}>
                  <td><button type="button" className={styles.rowButton} onClick={() => drill.push(vouchersFrame(ledger, accountId, r.period, party, r.label))}>{r.label}</button></td>
                  <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>
                  <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>
                  <td className={surface.numeric}>{drCr(r.closing)}</td>
                </tr>
              ))}
              <tr className={books.totalRow}>
                <td>{reportsT('grandTotal')}</td>
                <td className={surface.numeric}>{money(ms.debit)}</td>
                <td className={surface.numeric}>{money(ms.credit)}</td>
                <td className={surface.numeric}>{drCr(ms.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Ledger Vouchers ────────────────────────────────────────────── */

export function LedgerVouchersView({ accountId, party, period }: { accountId: string; party?: string; period: Period }) {
  useT();
  const { ledger } = useReportEnv();
  const openVoucher = useOpenVoucher();
  const [prefs, setPrefs] = useReportPrefs('ledger-vouchers');
  const st = useMemo(() => accountStatement(ledger, accountId, period, party), [ledger, accountId, period, party]);
  const rows = st?.rows ?? [];
  const nav = useDrillRows(rows.length, (i) => openVoucher(rows[i].voucher));
  if (!st) return null;
  return (
    <div className={books.stack}>
      <StatementToolbar filename="">
        <ReportOptions prefs={prefs} onChange={setPrefs} options={['showNarration']} detailedToggle={false} />
      </StatementToolbar>
      <div className={surface.card}>
        <div className={`${surface.tableWrap} ${styles.wrap}`}>
          <table className={surface.table} {...nav.table}>
            <caption className={surface.srOnly}>{drillTitle({ kind: 'vouchers', accountId, party, period }, ledger)}</caption>
            <thead>
              <tr>
                <th scope="col">{reportsT('date')}</th>
                <th scope="col">{reportsT('particulars')}</th>
                <th scope="col">{reportsT('vchType')}</th>
                <th scope="col">{reportsT('vchNo')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>
                <th scope="col" className={surface.numeric}>{reportsT('balance')}</th>
              </tr>
            </thead>
            <tbody id={nav.bodyId}>
              <tr className={styles.groupRow}>
                <td>{formatDate(period.start)}</td>
                <td colSpan={5}>{reportsT('openingBalance')}</td>
                <td className={surface.numeric}>{drCr(st.opening)}</td>
              </tr>
              {rows.map((r, i) => (
                <tr key={r.voucher.id} {...nav.row(i)}>
                  <td>{formatDate(r.voucher.date)}</td>
                  <td>
                    <div>{r.particulars || '—'}</div>
                    {prefs.showNarration && <div className={books.narration}>{[r.voucher.party, r.voucher.narration].filter(Boolean).join(' · ')}</div>}
                  </td>
                  <td><span className={r.voucher.source === 'manual' ? styles.badgeManual : styles.badge}>{r.voucher.kind}</span></td>
                  <td>
                    {voucherTarget(r.voucher).type === 'none' ? (
                      <span className={surface.mono}>{r.voucher.number || '—'}</span>
                    ) : (
                      <button type="button" className={styles.rowButton} onClick={() => openVoucher(r.voucher)}>{r.voucher.number || reportsT('open')}</button>
                    )}
                  </td>
                  <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>
                  <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>
                  <td className={surface.numeric}>{drCr(r.balance)}</td>
                </tr>
              ))}
              <tr className={books.totalRow}>
                <td colSpan={4}>{reportsT('closingBalance')}</td>
                <td className={surface.numeric}>{money(st.totalDebit)}</td>
                <td className={surface.numeric}>{money(st.totalCredit)}</td>
                <td className={surface.numeric}>{drCr(st.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
