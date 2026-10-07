import { cn } from '../../lib/utils';
import type { StockStatus } from '../../lib/inventory';
import styles from './inventory.module.css';

const LABEL: Record<StockStatus, string> = {
  ok: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
  negative: 'Negative',
  untracked: 'Not tracked',
};

const TONE: Record<StockStatus, string> = {
  ok: styles.chipOk,
  low: styles.chipLow,
  out: styles.chipOut,
  negative: styles.chipNegative,
  untracked: styles.chipUntracked,
};

/** Reusable status chip — the lead can also drop this into the invoice item picker. */
export function StockChip({ status, className }: { status: StockStatus; className?: string }) {
  return <span className={cn(styles.chip, TONE[status], className)}>{LABEL[status]}</span>;
}
