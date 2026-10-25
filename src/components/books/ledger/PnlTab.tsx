/**
 * Profit & Loss from the ledger (WP-2, P0-3): Tally's horizontal Trading account (opening stock,
 * purchases, direct expenses, closing stock → Gross Profit c/o) and Profit & Loss account (indirect
 * incomes / expenses → Nett Profit). Every posting is included — documents, manual vouchers,
 * depreciation, fixed assets — and closing stock comes from the inventory engine or a typed figure.
 * The older documents-only view is kept, labelled "indicative", with its accrual / cash basis switch.
 */
import { useMemo, useState } from 'react';
import { Info, Package } from 'lucide-react';
import {
  isDirectGroup,
  ledgerProfitAndLoss,
  previousPeriod,
  type Ledger,
  type LedgerProfitLoss,
  type StockValuer,
} from '../../../lib/ledger';
import type { BooksData, Period } from '../../../lib/books';
import { toCsv } from '../../../lib/csv';
import { formatDate } from '../../../lib/utils';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import { ProfitLossTab } from '../ProfitLossTab';
import { DrillStack } from './DrillStack';
import { useDrill, useDrillRows, useReportPrefs } from './drill-hooks';
import { ReportOptions } from './ReportToolbar';
import { groupFrame, ledgerFrame } from './report-frames';
import { ClosingStockDialog } from './ClosingStockDialog';
import { StockJournalNotice } from './StockJournalNotice';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

interface Props {
  ledger: Ledger;
  data: BooksData;
  period: Period;
  stock?: StockValuer;
  onStockChanged: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

export function PnlTab(props: Props) {
  useT();
  const [view, setView] = useState<'ledger' | 'docs'>('ledger');
  return (
    <div className={books.stack}>
      <div className={`${controls.segment} no-print`} role="group" aria-label={reportsT('pnlView')}>
        <button type="button" className={view === 'ledger' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={view === 'ledger'} onClick={() => setView('ledger')}>
          {reportsT('pnlLedgerView')}
        </button>
        <button type="button" className={view === 'docs' ? controls.segmentBtnActive : controls.segmentBtn} aria-pressed={view === 'docs'} onClick={() => setView('docs')}>
          {reportsT('pnlDocsView')}
        </button>
      </div>
      {view === 'docs' ? (
        <>
          <div className={books.notice} role="note">
            <Info size={16} className={books.noticeIcon} aria-hidden="true" />
            <span>{reportsT('pnlDocsNote')}</span>
          </div>
          <ProfitLossTab data={props.data} period={props.period} />
        </>
      ) : (
        <DrillStack rootTitle={reportsT('profitLoss')} resetKey={`${props.period.start}:${props.period.end}`}>
          <PnlRoot {...props} />
        </DrillStack>
      )}
    </div>
  );
}

interface Line {
  key: string;
  label: string;
  amount: number;
  prev?: number;
  groupId?: string;
  accountId?: string;
  depth: number;
  strong?: boolean;
}

function sides(pl: LedgerProfitLoss, prev: LedgerProfitLoss | null, detailed: boolean, labels: Record<string, string>) {
  const sectionLines = (list: LedgerProfitLoss['income'], prevList: LedgerProfitLoss['income'] | undefined, direct: boolean, out: Line[]) => {
    const groups = new Map(list.map((s) => [s.group, s]));
    for (const s of prevList ?? []) if (!groups.has(s.group)) groups.set(s.group, { ...s, total: 0, lines: [] });
    for (const s of groups.values()) {
      if (isDirectGroup(s.group) !== direct) continue;
      const p = prevList?.find((x) => x.group === s.group);
      out.push({ key: `g:${s.group}`, label: s.label, amount: s.total, prev: p?.total ?? 0, groupId: s.group, depth: 0 });
      if (detailed) for (const l of s.lines) out.push({ key: `a:${l.account.id}`, label: l.account.name, amount: l.amount, prev: p?.lines.find((x) => x.account.id === l.account.id)?.amount ?? 0, accountId: l.account.id, depth: 1 });
    }
  };
  const t = pl.trading;
  const tp = prev?.trading;
  const tradingDr: Line[] = [];
  const tradingCr: Line[] = [];
  if (t.openingStock || tp?.openingStock) tradingDr.push({ key: 'os', label: labels.openingStock, amount: t.openingStock, prev: tp?.openingStock, groupId: 'INVENTORIES', depth: 0 });
  sectionLines(pl.expenses, prev?.expenses, true, tradingDr);
  sectionLines(pl.income, prev?.income, true, tradingCr);
  if (t.closingStock || tp?.closingStock) tradingCr.push({ key: 'cs', label: labels.closingStock, amount: t.closingStock, prev: tp?.closingStock, depth: 0 });
  const gp = t.grossProfit;
  const gpPrev = tp?.grossProfit ?? 0;
  if (gp >= 0) tradingDr.push({ key: 'gpco', label: labels.gpCo, amount: gp, prev: gpPrev, depth: 0, strong: true });
  else tradingCr.push({ key: 'glco', label: labels.glCo, amount: -gp, prev: -gpPrev, depth: 0, strong: true });

  const pnlDr: Line[] = [];
  const pnlCr: Line[] = [];
  if (gp >= 0) pnlCr.push({ key: 'gpbf', label: labels.gpBf, amount: gp, prev: gpPrev, depth: 0, strong: true });
  else pnlDr.push({ key: 'glbf', label: labels.glBf, amount: -gp, prev: -gpPrev, depth: 0, strong: true });
  sectionLines(pl.expenses, prev?.expenses, false, pnlDr);
  sectionLines(pl.income, prev?.income, false, pnlCr);
  const np = pl.netProfit;
  const npPrev = prev?.netProfit ?? 0;
  if (np >= 0) pnlDr.push({ key: 'np', label: labels.netProfit, amount: np, prev: npPrev, depth: 0, strong: true });
  else pnlCr.push({ key: 'nl', label: labels.netLoss, amount: -np, prev: -npPrev, depth: 0, strong: true });
  return { tradingDr, tradingCr, pnlDr, pnlCr };
}

const total = (lines: Line[], k: 'amount' | 'prev') => lines.filter((l) => l.depth === 0).reduce((s, l) => s + (l[k] ?? 0), 0);

function PnlRoot({ ledger, period, stock, onStockChanged, notify }: Props) {
  useT();
  const drill = useDrill();
  const [prefs, setPrefs] = useReportPrefs('pnl');
  const [stockOpen, setStockOpen] = useState(false);
  const pl = useMemo(() => ledgerProfitAndLoss(ledger, period, stock), [ledger, period, stock]);
  const compare = prefs.columns === 'previous';
  const prevPeriod = useMemo(() => previousPeriod(period), [period]);
  const prev = useMemo(() => (compare ? ledgerProfitAndLoss(ledger, prevPeriod, stock) : null), [compare, ledger, prevPeriod, stock]);
  const labels = {
    openingStock: reportsT('openingStock'),
    closingStock: stock ? reportsT('closingStockOf', { method: stock.label }) : reportsT('closingStock'),
    gpCo: reportsT('gpCo'),
    glCo: reportsT('glCo'),
    gpBf: reportsT('gpBf'),
    glBf: reportsT('glBf'),
    netProfit: reportsT('netProfit'),
    netLoss: reportsT('netLoss'),
  };
  const s = sides(pl, prev, prefs.detailed, labels);
  const all = [...s.tradingDr, ...s.tradingCr, ...s.pnlDr, ...s.pnlCr];
  const drillable = all.filter((l) => l.groupId || l.accountId);
  const open = (l: Line) => {
    if (l.accountId) drill.push(ledgerFrame(ledger, l.accountId, period));
    else if (l.groupId) drill.push(groupFrame(ledger, l.groupId, period));
  };
  const nav = useDrillRows(drillable.length, (i) => open(drillable[i]));
  const indexOf = (l: Line) => drillable.indexOf(l);

  const csv = () =>
    toCsv([
      ['Trading and Profit & Loss account', `${period.start} to ${period.end}`, 'Working paper — verify with your CA'],
      ['Side', 'Particulars', 'Amount', ...(compare ? ['Previous period'] : [])],
      ...([['Dr', s.tradingDr], ['Cr', s.tradingCr], ['Dr', s.pnlDr], ['Cr', s.pnlCr]] as const).flatMap(([side, lines]) =>
        lines.map((l) => [side, `${'  '.repeat(l.depth)}${l.label}`, l.amount / 100, ...(compare ? [(l.prev ?? 0) / 100] : [])]),
      ),
    ]);

  const sideCard = (title: string, lines: Line[], other: Line[]) => {
    const tot = Math.max(total(lines, 'amount'), total(other, 'amount'));
    const totPrev = Math.max(total(lines, 'prev'), total(other, 'prev'));
    return (
      <div className={surface.card}>
        <div className={surface.cardHead}>{title}</div>
        <ul className={books.statement}>
          {lines.map((l) => {
            const i = indexOf(l);
            const rp = i >= 0 ? nav.row(i) : undefined;
            return (
              <li key={l.key} {...(rp ?? {})} className={[l.strong ? books.stmtTotal : l.depth ? books.stmtSub : books.stmtRow, rp?.className].filter(Boolean).join(' ')}>
                <span style={{ paddingLeft: `${l.depth * 1.25}rem` }}>
                  {i >= 0 ? <button type="button" className={styles.rowButton} onClick={() => open(l)}>{l.label}</button> : l.label}
                </span>
                <span className={books.amt}>
                  {money(l.amount)}
                  {compare && <span className={styles.prevAmt}>{money(l.prev ?? 0)}</span>}
                </span>
              </li>
            );
          })}
          <li className={books.stmtTotal}>
            <span>{reportsT('total')}</span>
            <span className={books.amt}>
              {money(tot)}
              {compare && <span className={styles.prevAmt}>{money(totPrev)}</span>}
            </span>
          </li>
        </ul>
      </div>
    );
  };

  return (
    <div className={books.stack}>
      <StatementToolbar csv={csv} filename={`profit-loss-ledger-${period.start}_to_${period.end}.csv`}>
        <ReportOptions prefs={prefs} onChange={setPrefs} />
        <label className={styles.inlineField}>
          <input type="checkbox" checked={compare} onChange={(e) => setPrefs({ columns: e.target.checked ? 'previous' : 'none' })} />
          <span>{reportsT('comparePrevious')}</span>
        </label>
        <button type="button" className={controls.btnOutline} onClick={() => setStockOpen(true)}>
          <Package size={16} /> {reportsT('closingStockSettings')}
        </button>
      </StatementToolbar>
      <PrintTitle title={reportsT('profitLoss')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      <div className={books.notice} role="note">
        <Info size={16} className={books.noticeIcon} aria-hidden="true" />
        <span>
          {reportsT('pnlLedgerNote')} {stock ? reportsT('pnlStockNote', { method: stock.label }) : reportsT('pnlNoStockNote')}
          {compare && ` ${reportsT('prevColumnNote', { from: formatDate(prevPeriod.start), to: formatDate(prevPeriod.end) })}`}
        </span>
      </div>

      <StockJournalNotice stock={stock} onChanged={onStockChanged} notify={notify} />

      <div className={surface.statGrid}>
        <div className={surface.stat}>
          <div className={surface.statTop}><span className={surface.statLabel}>{reportsT('salesAccounts')}</span></div>
          <div className={surface.statValue}>{money(pl.trading.sales)}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}><span className={surface.statLabel}>{reportsT('grossProfit')}</span></div>
          <div className={`${surface.statValue} ${pl.trading.grossProfit < 0 ? books.neg : books.pos}`}>{money(pl.trading.grossProfit)}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}><span className={surface.statLabel}>{reportsT('netProfit')}</span></div>
          <div className={`${surface.statValue} ${pl.netProfit < 0 ? books.neg : books.pos}`} data-testid="ledger-net-profit">{money(pl.netProfit)}</div>
        </div>
        <div className={surface.stat}>
          <div className={surface.statTop}><span className={surface.statLabel}>{reportsT('closingStock')}</span></div>
          <div className={surface.statValue}>{money(pl.trading.closingStock)}</div>
        </div>
      </div>

      <div className={`${styles.drillTable}`} tabIndex={0} onKeyDown={nav.table.onKeyDown} id={nav.bodyId}>
        <h3 className={styles.sectionTitle}>{reportsT('tradingAccount')}</h3>
        <div className={books.twoCol}>
          {sideCard(reportsT('particularsDr'), s.tradingDr, s.tradingCr)}
          {sideCard(reportsT('particularsCr'), s.tradingCr, s.tradingDr)}
        </div>
        <h3 className={styles.sectionTitle}>{reportsT('pnlAccount')}</h3>
        <div className={books.twoCol}>
          {sideCard(reportsT('particularsDr'), s.pnlDr, s.pnlCr)}
          {sideCard(reportsT('particularsCr'), s.pnlCr, s.pnlDr)}
        </div>
      </div>
      <p className={books.muted}>{reportsT('drillHint')}</p>

      {stockOpen && (
        <ClosingStockDialog
          onClose={() => setStockOpen(false)}
          onSaved={() => {
            setStockOpen(false);
            notify(reportsT('stockSaved'));
            onStockChanged();
          }}
        />
      )}
    </div>
  );
}
