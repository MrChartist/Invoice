import { formatMoney } from '../../../lib/utils';

/** Paise → grouped rupees. */
export const money = (paise: number) => formatMoney(paise / 100);

/** Signed paise → "1,234.00 Dr" / "Cr" ('' for zero). */
export function drCr(paise: number): string {
  if (!paise) return '—';
  return `${formatMoney(Math.abs(paise) / 100)} ${paise > 0 ? 'Dr' : 'Cr'}`;
}

export const CA_NOTE =
  'Working paper built from the documents and vouchers in this app. Verify with your CA before filing or relying on it.';
