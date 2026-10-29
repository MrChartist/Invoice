/**
 * R5-C4 funds: a fund is a cost centre of kind `fund` with additive `fund: { nature, donor_id?, purpose?, start?,
 * end?, budget? }` (unrestricted / restricted / corpus / FCRA). Receipts and expenses are tagged to a fund through the
 * ordinary `cost_centre_id`, so the ledger carries the tag; a default "General fund" (unrestricted) is created once
 * when the pack is first used. Inter-fund transfers are one journal on the "Inter-fund transfers" ledger (nets to 0).
 */
import type { FundInfo, FundNature } from '../../types/institutions-r5';
import { loadCostCentres, saveCostCentre, type CostCentre } from '../cost-centres';
import { saveVoucher, type ManualVoucher } from '../ledger/vouchers';
import { withTablesRollback } from '../table-txn';
import { INTER_FUND_ACCOUNT, R5cError, day, ensureAccount, money, paise, str } from '../institutions/r5c';

export const NATURES: readonly FundNature[] = ['unrestricted', 'restricted', 'corpus', 'fcra'];
export const GENERAL_FUND = 'General fund';

export type Fund = CostCentre & { fund: FundInfo };

export function loadFunds(all: readonly CostCentre[] = loadCostCentres()): Fund[] {
  return all.filter((c) => c.kind === 'fund').map((c) => ({ ...c, fund: { nature: NATURES.includes(c.fund?.nature as FundNature) ? c.fund!.nature : 'unrestricted', ...c.fund } as FundInfo }));
}

/** The default "General fund" (unrestricted), created once. */
export function ensureGeneralFund(): Fund {
  const hit = loadFunds().find((f) => f.name.toLowerCase() === GENERAL_FUND.toLowerCase());
  if (hit) return hit;
  return saveFund({ name: GENERAL_FUND, fund: { nature: 'unrestricted' } });
}

export function saveFund(input: { id?: string; name: string; active?: boolean; fund: FundInfo }): Fund {
  const f = input.fund;
  const fund: FundInfo = {
    nature: NATURES.includes(f.nature) ? f.nature : 'unrestricted',
    ...(str(f.donor_id) ? { donor_id: str(f.donor_id) } : {}),
    ...(str(f.purpose) ? { purpose: str(f.purpose) } : {}),
    ...(day(f.start) ? { start: day(f.start) } : {}),
    ...(day(f.end) ? { end: day(f.end) } : {}),
    ...(money(f.budget) > 0 ? { budget: money(f.budget) } : {}),
  };
  return saveCostCentre({ ...(input.id ? { id: input.id } : {}), name: input.name, kind: 'fund', active: input.active !== false, fund }) as Fund;
}

export const ensureInterFundAccount = () => ensureAccount(INTER_FUND_ACCOUNT, 'RESERVES', 1320);

/** Move `amount` from one fund to another: Dr Inter-fund transfers (from) | Cr Inter-fund transfers (to). */
export function transferBetweenFunds(fromId: string, toId: string, amount: number, date: string, note = ''): ManualVoucher {
  if (!fromId || !toId || fromId === toId) throw new R5cError('funds');
  const p = paise(money(amount));
  if (!(p > 0)) throw new R5cError('amount');
  return withTablesRollback(['vouchers', 'accounts'], () => {
    const acc = ensureInterFundAccount();
    return saveVoucher({ type: 'JOURNAL', date, narration: `Inter-fund transfer${note ? `: ${note}` : ''}`, voucher_class: 'Inter-fund transfer', lines: [{ account_id: acc, dr: p, cr: 0, cost_centre_id: fromId }, { account_id: acc, dr: 0, cr: p, cost_centre_id: toId }] });
  });
}
