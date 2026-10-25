/**
 * Drill-down path model (WP-2, P0-4) shared by every ledger report and the DrillStack component:
 *   report (BS / P&L / TB / Group Summary root) → group → sub-group … → ledger (→ party)
 *   → monthly summary → ledger vouchers (one month) → voucher (open the document / voucher editor).
 * `drillDown` says where Enter on a row goes; `drillTitle` gives the Tally screen title for the
 * breadcrumb. Pure: the UI renders each level with the report functions in this folder.
 */

import type { Period } from '../books';
import type { Ledger, LedgerVoucher } from './postings';
import { reportGroup } from './report-groups';

export type DrillLevel =
  | { kind: 'group'; groupId: string | null; period: Period }
  | { kind: 'groupVouchers'; groupId: string; period: Period }
  | { kind: 'ledger'; accountId: string; party?: string; period: Period }
  | { kind: 'vouchers'; accountId: string; party?: string; period: Period }
  | { kind: 'voucher'; voucherId: string };

/** A row the user pressed Enter on. */
export type DrillRow =
  | { kind: 'group'; id: string }
  | { kind: 'ledger'; accountId: string; party?: string }
  | { kind: 'party'; accountId: string; party: string }
  | { kind: 'month'; period: Period }
  | { kind: 'voucher'; voucherId: string };

/** Next level for Enter on `row` while showing `at`; null when there is nowhere further to go. */
export function drillDown(at: DrillLevel, row: DrillRow): DrillLevel | null {
  const period = 'period' in at ? at.period : undefined;
  switch (row.kind) {
    case 'group':
      return period ? { kind: 'group', groupId: row.id, period } : null;
    case 'ledger':
    case 'party':
      return period ? { kind: 'ledger', accountId: row.accountId, party: row.party, period } : null;
    case 'month':
      return at.kind === 'ledger' ? { kind: 'vouchers', accountId: at.accountId, party: at.party, period: row.period } : null;
    case 'voucher':
      return { kind: 'voucher', voucherId: row.voucherId };
  }
}

/** Tally screen title for a level ("Group Summary: Current assets", "Ledger Monthly Summary: Cash"). */
export function drillTitle(level: DrillLevel, ledger: Ledger): string {
  switch (level.kind) {
    case 'group':
      return level.groupId ? `Group Summary: ${reportGroup(level.groupId)?.label ?? level.groupId}` : 'Group Summary';
    case 'groupVouchers':
      return `Group Vouchers: ${reportGroup(level.groupId)?.label ?? level.groupId}`;
    case 'ledger': {
      const a = ledger.byId.get(level.accountId);
      return `Ledger Monthly Summary: ${a?.name ?? level.accountId}${level.party ? ` — ${level.party}` : ''}`;
    }
    case 'vouchers': {
      const a = ledger.byId.get(level.accountId);
      return `Ledger Vouchers: ${a?.name ?? level.accountId}${level.party ? ` — ${level.party}` : ''}`;
    }
    case 'voucher': {
      const v = findVoucher(ledger, level.voucherId);
      return v ? `${v.kind} ${v.number}`.trim() : 'Voucher';
    }
  }
}

export function findVoucher(ledger: Ledger, id: string): LedgerVoucher | undefined {
  return ledger.vouchers.find((v) => v.id === id);
}

/** Where a voucher opens: the document page, the manual-voucher editor, or nowhere (read-only). */
export function voucherTarget(v: LedgerVoucher): { type: 'link'; to: string } | { type: 'manual'; id: string } | { type: 'none' } {
  if (v.manualId) return { type: 'manual', id: v.manualId };
  if (v.link) return { type: 'link', to: v.link };
  return { type: 'none' };
}
