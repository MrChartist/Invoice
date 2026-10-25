import { cn } from '../../lib/utils';
import type { StockStatus } from '../../lib/inventory';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import styles from './inventory.module.css';

const TONE: Record<StockStatus, string> = {
  ok: styles.chipOk,
  low: styles.chipLow,
  out: styles.chipOut,
  negative: styles.chipNegative,
  untracked: styles.chipUntracked,
};

/** Reusable status chip — the lead can also drop this into the invoice item picker. */
export function StockChip({ status, className }: { status: StockStatus; className?: string }) {
  useT(); // re-render on a language switch (5.4)
  return <span className={cn(styles.chip, TONE[status], className)}>{invT(`st.${status}`)}</span>;
}
