/** Small helpers shared by the masters screens (kept out of component files for fast refresh). */
import type { AccountNature } from '../../lib/ledger';
import { mastersT } from '../../i18n/areas/masters';

export function natureLabel(n: AccountNature): string {
  switch (n) {
    case 'asset':
      return mastersT('natureAsset');
    case 'liability':
      return mastersT('natureLiability');
    case 'equity':
      return mastersT('natureEquity');
    case 'income':
      return mastersT('natureIncome');
    default:
      return mastersT('natureExpense');
  }
}

/** "1,234.50" → 123450 paise (0 for blank / invalid). */
export function parsePaise(text: string): number {
  const n = parseFloat(String(text).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number(`${Math.abs(n).toFixed(2)}e2`));
}

export const paiseText = (p: number) => (p ? (Math.abs(p) / 100).toFixed(2) : '');
