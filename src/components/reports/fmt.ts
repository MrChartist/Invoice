import { formatMoney } from '../../lib/utils';

/** Grouped rupee figure without a symbol (tables, CSV-adjacent text). */
export const money = (n: number) => formatMoney(n);
