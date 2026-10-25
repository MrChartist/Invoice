import type { StockInputs, StockItem } from '../../lib/inventory';
import type { Godown } from '../../types/stock';
import { formatMoney } from '../../lib/utils';
import { generateId } from '../../lib/storage';
import type { VoucherOutputLine } from '../../types/manufacturing';

export type GridLine = VoucherOutputLine & { scrap_pct?: number };
export const blankLine = (): GridLine => ({ id: generateId(), item_id: '', qty: 1 });

/** What every manufacturing tab receives from the page. */
export interface MfgContext {
  /** Every stock item (tracked ones are offered in pickers). */
  items: StockItem[];
  godowns: Godown[];
  /** Live stock inputs, transfers and vouchers included. */
  inputs: StockInputs;
  version: number;
  /** Re-read live data and show a toast. */
  changed: (message: string) => void;
  error: (message: string) => void;
  /** The signed-in role may change books / masters. */
  canBooks: boolean;
  canMasters: boolean;
}

export const money = (n: number) => formatMoney(n);
export const qtyText = (n: number) => String(Math.round((n + Number.EPSILON) * 1000) / 1000);
