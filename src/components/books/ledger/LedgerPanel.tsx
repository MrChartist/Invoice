/**
 * Double-entry tabs of the Books page (Phase 6.1–6.4). Loaded lazily by Books.tsx, so the
 * ledger engine never reaches the app shell's bundle.
 */
import { useCallback, useMemo, useState } from 'react';
import { buildLedger, loadLedgerInput, loadStockPositions, loadStockValuer, loadVouchers, type LedgerVoucher, type ManualVoucher } from '../../../lib/ledger';
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
  const ledger = useMemo(() => buildLedger(input), [input]);
  const changed = () => setVersion((v) => v + 1);
  // Closing stock (report-time): the inventory engine runs once per data change, and only when a
  // statement asks for it.
  const positions = useMemo(() => {
    void version;
    void data;
    let cache: StockPosition[] | undefined;
    return () => (cache ??= loadStockPositions());
  }, [data, version]);
  const stock = useMemo(() => loadStockValuer(undefined, positions, input.manual), [positions, input.manual]);
  const getPositions = useCallback(() => positions(), [positions]);

  const openVoucher = (v: LedgerVoucher) => {
    const m = v.manualId ? loadVouchers().find((x) => x.id === v.manualId) : undefined;
    if (m) setEditing(m);
  };

  return (
    <ReportEnvProvider value={{ ledger, stock, onOpenManual: openVoucher }}>
      {tab === 'day' && <DayBookTab ledger={ledger} period={period} />}
      {tab === 'pnl' && <PnlTab ledger={ledger} data={data} period={period} stock={stock} onStockChanged={changed} notify={notify} />}
      {tab === 'rpt' && <ReportsHub period={period} data={data} today={today} positions={getPositions} />}
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
          accounts={ledger.accounts}
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
