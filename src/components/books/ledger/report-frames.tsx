/**
 * Drill frames (WP-2): the screens a report pushes on its DrillStack — Group Summary, Ledger Monthly
 * Summary, Ledger Vouchers, Group Vouchers — with their Tally titles.
 */
import type { Period } from '../../../lib/books';
import { drillTitle, type GroupSummaryRow, type Ledger } from '../../../lib/ledger';
import { useDrill, type DrillFrame } from './drill-hooks';
import { useReportEnv } from './report-env';
import { GroupSummaryView, GroupVouchersView, LedgerMonthlyView, LedgerVouchersView } from './ReportViews';

export function groupFrame(ledger: Ledger, groupId: string | null, period: Period): DrillFrame {
  return { key: `g:${groupId ?? 'root'}`, title: drillTitle({ kind: 'group', groupId, period }, ledger), render: () => <GroupSummaryView groupId={groupId} period={period} /> };
}

export function ledgerFrame(ledger: Ledger, accountId: string, period: Period, party?: string): DrillFrame {
  return { key: `l:${accountId}:${party ?? ''}`, title: drillTitle({ kind: 'ledger', accountId, party, period }, ledger), render: () => <LedgerMonthlyView accountId={accountId} party={party} period={period} /> };
}

export function vouchersFrame(ledger: Ledger, accountId: string, period: Period, party?: string, label?: string): DrillFrame {
  const title = drillTitle({ kind: 'vouchers', accountId, party, period }, ledger);
  return { key: `v:${accountId}:${party ?? ''}:${period.start}`, title: label ? `${title} (${label})` : title, render: () => <LedgerVouchersView accountId={accountId} party={party} period={period} /> };
}

export function groupVouchersFrame(ledger: Ledger, groupId: string, period: Period): DrillFrame {
  return { key: `gv:${groupId}`, title: drillTitle({ kind: 'groupVouchers', groupId, period }, ledger), render: () => <GroupVouchersView groupId={groupId} period={period} /> };
}

/** Push the next level for a Group Summary row. */
export function useRowDrill(period: Period) {
  const { ledger } = useReportEnv();
  const drill = useDrill();
  return (r: Pick<GroupSummaryRow, 'kind' | 'id' | 'accountId' | 'party'>) => {
    if (r.kind === 'group') drill.push(groupFrame(ledger, r.id, period));
    else if (r.accountId) drill.push(ledgerFrame(ledger, r.accountId, period, r.party));
  };
}

