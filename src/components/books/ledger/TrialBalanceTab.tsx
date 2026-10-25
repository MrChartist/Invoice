import { Fragment, useMemo } from 'react';
import { Scale } from 'lucide-react';
import { accountGroupId, flattenRows, groupSummary, reportGroups, syncReportGroups, trialBalance, trialBalanceCsv, type Ledger, type StockValuer } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { formatDate } from '../../../lib/utils';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import { EmptyState } from '../../ui/EmptyState';
import { DrillStack } from './DrillStack';
import { useDrill, useDrillRows, useReportPrefs } from './drill-hooks';
import { ReportOptions } from './ReportToolbar';
import { groupFrame, ledgerFrame } from './report-frames';
import { drCr, money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { ledgerT } from '../../../i18n/areas/books-ledger';

interface Props {
  ledger: Ledger;
  period: Period;
  stock?: StockValuer;
}

export function TrialBalanceTab(props: Props) {
  useT();
  return (
    <DrillStack rootTitle={reportsT('trialBalance')} resetKey={`${props.period.start}:${props.period.end}`}>
      <TrialBalanceRoot {...props} />
    </DrillStack>
  );
}

function TrialBalanceRoot({ ledger, period, stock }: Props) {
  useT();
  const drill = useDrill();
  const [prefs, setPrefs] = useReportPrefs('tb', { detailed: true });
  const tb = useMemo(() => trialBalance(ledger, period), [ledger, period]);
  const ok = tb.totals.debit === tb.totals.credit && tb.totals.closingDr === tb.totals.closingCr;

  // Detailed: groups with their ledgers (Tally ledger-wise TB). Condensed: primary groups → groups (Alt+F1).
  const rows = (() => {
    if (!prefs.detailed) return flattenRows(groupSummary(ledger, period, null, { showZero: prefs.showZero, parties: false }).rows, true).filter((r) => r.kind === 'group');
    syncReportGroups();
    const byGroup = new Map<string, typeof tb.rows>();
    const list = prefs.showZero
      ? ledger.accounts.map((a) => tb.rows.find((r) => r.account.id === a.id) ?? { account: a, opening: 0, debit: 0, credit: 0, closing: 0 })
      : tb.rows;
    for (const r of list) {
      const g = accountGroupId(r.account);
      byGroup.set(g, [...(byGroup.get(g) ?? []), r]);
    }
    const out: Array<{ kind: 'group' | 'ledger'; id: string; label: string; code?: string; accountId?: string; opening: number; debit: number; credit: number; closing: number; depth: number }> = [];
    for (const g of reportGroups()) {
      const rs = byGroup.get(g.id);
      if (!rs?.length) continue;
      const sum = (k: 'opening' | 'debit' | 'credit' | 'closing') => rs.reduce((s, r) => s + r[k], 0);
      out.push({ kind: 'group', id: g.id, label: g.label, opening: sum('opening'), debit: sum('debit'), credit: sum('credit'), closing: sum('closing'), depth: 0 });
      for (const r of rs) out.push({ kind: 'ledger', id: r.account.id, label: r.account.name, code: r.account.code, accountId: r.account.id, opening: r.opening, debit: r.debit, credit: r.credit, closing: r.closing, depth: 1 });
    }
    return out;
  })();

  const open = (i: number) => {
    const r = rows[i];
    if (r.kind === 'group') drill.push(groupFrame(ledger, r.id, period));
    else if (r.accountId) drill.push(ledgerFrame(ledger, r.accountId, period));
  };
  const nav = useDrillRows(rows.length, open);
  const cols = 2 + (prefs.showOpening ? 1 : 0) + (prefs.showTransactions ? 2 : 0);

  return (
    <div className={books.stack}>
      <StatementToolbar csv={() => trialBalanceCsv(tb)} filename={`trial-balance-${period.start}_to_${period.end}.csv`}>
        <span className={ok ? styles.tieOk : styles.tieBad}>{ok ? ledgerT('tbTie') : ledgerT('tbOut')}</span>
        <ReportOptions prefs={prefs} onChange={setPrefs} options={['showZero', 'showOpening', 'showTransactions']} />
      </StatementToolbar>
      <PrintTitle title={ledgerT('tbTitle')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={surface.card}>
        {tb.rows.length === 0 ? (
          <EmptyState icon={Scale} title={ledgerT('tbEmptyTitle')} text={ledgerT('tbEmptyText')} />
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table} {...nav.table}>
              <caption className={surface.srOnly}>{ledgerT('tbTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{reportsT('code')}</th>
                  <th scope="col">{reportsT('particulars')}</th>
                  {prefs.showOpening && <th scope="col" className={surface.numeric}>{reportsT('opening')}</th>}
                  {prefs.showTransactions && <th scope="col" className={surface.numeric}>{reportsT('debit')}</th>}
                  {prefs.showTransactions && <th scope="col" className={surface.numeric}>{reportsT('credit')}</th>}
                  <th scope="col" className={surface.numeric}>{reportsT('closing')}</th>
                </tr>
              </thead>
              <tbody id={nav.bodyId}>
                {rows.map((r, i) => (
                  <Fragment key={`${r.kind}:${r.id}`}>
                    <tr {...nav.row(i)} className={[nav.row(i).className, r.kind === 'group' && prefs.detailed ? styles.groupRow : ''].filter(Boolean).join(' ') || undefined}>
                      <td className={styles.code}>{'code' in r ? r.code : ''}</td>
                      <td style={{ paddingLeft: `${0.75 + (prefs.detailed ? 0 : r.depth * 1.25)}rem` }}>
                        <button type="button" className={r.kind === 'group' ? styles.rowButtonGroup : styles.rowButton} onClick={() => open(i)}>{r.label}</button>
                      </td>
                      {prefs.showOpening && <td className={surface.numeric}>{drCr(r.opening)}</td>}
                      {prefs.showTransactions && <td className={surface.numeric}>{r.debit ? money(r.debit) : ''}</td>}
                      {prefs.showTransactions && <td className={surface.numeric}>{r.credit ? money(r.credit) : ''}</td>}
                      <td className={surface.numeric}>{drCr(r.closing)}</td>
                    </tr>
                  </Fragment>
                ))}
                <tr className={books.totalRow}>
                  <td colSpan={2}>{ledgerT('total')}</td>
                  {prefs.showOpening && <td className={surface.numeric}>{money(tb.totals.openingDr)} Dr / {money(tb.totals.openingCr)} Cr</td>}
                  {prefs.showTransactions && <td className={surface.numeric}>{money(tb.totals.debit)}</td>}
                  {prefs.showTransactions && <td className={surface.numeric}>{money(tb.totals.credit)}</td>}
                  <td className={surface.numeric}>{money(tb.totals.closingDr)} Dr / {money(tb.totals.closingCr)} Cr</td>
                </tr>
                {stock && (
                  <tr>
                    <td colSpan={cols - 1} className={books.muted}>{reportsT('tbStockMemo', { method: stock.label })}</td>
                    <td className={surface.numeric}>{money(stock.value(period.end))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className={books.muted}>
        {ledgerT('tbNote')} {reportsT('drillHint')}
      </p>
    </div>
  );
}
