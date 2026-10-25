/**
 * Double-entry tabs of the Books page (Phase 6.1–6.4). Loaded lazily by Books.tsx, so the
 * ledger engine never reaches the app shell's bundle.
 */
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { scopeLedger, buildLedger, loadLedgerInput, loadStockPositions, loadStockValuer, loadVouchers, type LedgerVoucher, type ManualVoucher } from '../../../lib/ledger';
import type { StockPosition } from '../../../lib/inventory';
import type { BooksData, Period } from '../../../lib/books';
import { todayIso } from '../../../lib/tax-rules';
import { ChartTab } from './ChartTab';
import { VouchersTab } from './VouchersTab';
import { TrialBalanceTab } from './TrialBalanceTab';
import { LedgerTab } from './LedgerTab';
import { BalanceSheetTab } from './BalanceSheetTab';
import { CashFlowTab } from './CashFlowTab';
import { VoucherEditor } from './VoucherEditor';
import { ProjectsTab } from '../planning/ProjectsTab';
import { BudgetsTab } from '../planning/BudgetsTab';
import { ledgerT } from '../../../i18n/areas/books-ledger';
import { DayBookTab } from './DayBookTab';
import { PnlTab } from './PnlTab';
import { ReportsHub } from './ReportsHub';
import { ReportEnvProvider } from './ReportViews';
import { branchT } from '../../../i18n/areas/branch-books';
import { loadBranchStockValuer } from '../../../lib/ledger/branch-stock';
import { s7mT } from '../../../i18n/areas/inventory-7s-mini';
import books from '../books.module.css';

// WP-9: branch-wise books. The filter renders nothing until a branch exists.
const BranchFilter = lazy(() => import('../../branches/BranchFilter').then((m) => ({ default: m.BranchFilter })));
const BRANCH_TABS = new Set<LedgerTabId>(['day', 'pnl', 'rpt', 'tb', 'ledger', 'bs', 'cf']);

export type LedgerTabId = 'day' | 'pnl' | 'rpt' | 'coa' | 'vch' | 'tb' | 'ledger' | 'bs' | 'cf' | 'proj' | 'budget';

export interface LedgerPanelProps {
  tab: LedgerTabId;
  data: BooksData;
  period: Period;
  asOf: string;
  account: string;
  party: string;
  onOpenAccount: (id: string, party?: string) => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

export default function LedgerPanel({ tab, data, period, asOf, account, party, onOpenAccount, notify }: LedgerPanelProps) {
  // Bumped after any ledger write so the stored vouchers / accounts / assets are re-read.
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<ManualVoucher | null>(null);
  const today = todayIso();
  const input = useMemo(() => {
    void version;
    return loadLedgerInput(data, today);
  }, [data, today, version]);
  const fullLedger = useMemo(() => buildLedger(input), [input]);
  // Branch filter for the statements (P1-19): whole vouchers of that branch only (`scopeLedger`).
  const [branchId, setBranchId] = useState('');
  const branchView = BRANCH_TABS.has(tab) && !!branchId;
  const ledger = useMemo(() => (branchView ? scopeLedger(fullLedger, { branchId }) : fullLedger), [fullLedger, branchView, branchId]);
  const changed = () => setVersion((v) => v + 1);
  // Closing stock (report-time): the inventory engine runs once per data change, and only when a
  // statement asks for it.
  const positions = useMemo(() => {
    void version;
    void data;
    let cache: StockPosition[] | undefined;
    return () => (cache ??= loadStockPositions());
  }, [data, version]);
  const companyStock = useMemo(() => loadStockValuer(undefined, positions, input.manual), [positions, input.manual]);
  // 7S (7.84): a branch view values the stock in the branch's godowns ("No branch" takes the rest).
  const branchStock = useMemo(() => (branchView ? loadBranchStockValuer(branchId, positions, companyStock) : undefined), [branchView, branchId, positions, companyStock]);
  const stock = branchView ? branchStock : companyStock;
  const getPositions = useCallback(() => positions(), [positions]);

  const openVoucher = (v: LedgerVoucher) => {
    const m = v.manualId ? loadVouchers().find((x) => x.id === v.manualId) : undefined;
    if (m) setEditing(m);
  };

  return (
    <ReportEnvProvider value={{ ledger, stock, onOpenManual: openVoucher }}>
      {BRANCH_TABS.has(tab) && (
        <Suspense fallback={null}>
          <div className={`${books.toolbar} no-print`}>
            <BranchFilter value={branchId} onChange={setBranchId} testId="books-branch" />
            {branchView && <span className={books.muted}>{branchStock ? s7mT('branchStockNote') : branchT('scopeNote')}</span>}
          </div>
        </Suspense>
      )}
      {tab === 'day' && <DayBookTab ledger={ledger} period={period} />}
      {tab === 'pnl' && <PnlTab ledger={ledger} data={data} period={period} stock={stock} onStockChanged={changed} notify={notify} />}
      {tab === 'rpt' && <ReportsHub period={period} data={data} today={today} positions={getPositions} notify={notify} />}
      {tab === 'coa' && <ChartTab ledger={ledger} asOf={asOf} onChanged={changed} onOpenAccount={(id) => onOpenAccount(id)} notify={notify} />}
      {tab === 'vch' && <VouchersTab ledger={ledger} period={period} onChanged={changed} onOpenAccount={onOpenAccount} notify={notify} />}
      {tab === 'tb' && <TrialBalanceTab ledger={ledger} period={period} stock={stock} />}
      {tab === 'ledger' && <LedgerTab ledger={ledger} period={period} accountId={account} party={party} onSelect={onOpenAccount} onOpenVoucher={openVoucher} />}
      {tab === 'bs' && (
        <BalanceSheetTab ledger={ledger} asOf={asOf} period={period} stock={stock} assets={input.assets} today={today} onChanged={changed} notify={notify} />
      )}
      {tab === 'cf' && <CashFlowTab ledger={ledger} period={period} stock={stock} />}
      {tab === 'proj' && <ProjectsTab ledger={ledger} period={period} notify={notify} />}
      {tab === 'budget' && <BudgetsTab ledger={ledger} notify={notify} />}
      {editing && (
        <VoucherEditor
          accounts={fullLedger.accounts}
          voucher={editing}
          defaultDate={editing.date}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setEditing(null);
            notify(ledgerT('voucherSaved', { number: v.number }));
            changed();
          }}
        />
      )}
    </ReportEnvProvider>
  );
}
