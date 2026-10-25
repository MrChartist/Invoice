import { formatMoney } from '../../../lib/utils';
import { ledgerT } from '../../../i18n/areas/books-ledger';

/** Paise → grouped rupees. */
export const money = (paise: number) => formatMoney(paise / 100);

/** Signed paise → "1,234.00 Dr" / "Cr" ('' for zero). */
export function drCr(paise: number): string {
  if (!paise) return '—';
  return `${formatMoney(Math.abs(paise) / 100)} ${paise > 0 ? 'Dr' : 'Cr'}`;
}

/** "Working paper … verify with your CA" line printed under each statement title. */
export const caNote = (): string => ledgerT('caNote');
