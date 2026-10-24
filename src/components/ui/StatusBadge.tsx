import { cn } from '../../lib/utils';
import { statusTone } from '../../lib/invoice-status';
import type { InvoiceStatus } from '../../types/invoice';
import styles from '../../styles/surface.module.css';

const TONE_CLASS: Record<string, string> = {
  draft: styles.badgeDraft,
  sent: styles.badgeSent,
  partial: styles.badgePartial,
  paid: styles.badgePaid,
  overdue: styles.badgeOverdue,
  cancelled: styles.badgeCancelled,
};

/** Invoice status badge; pass `tone` for other labels (e.g. a quotation's Accepted / Expired). */
export function StatusBadge({ status, tone, className }: { status: InvoiceStatus | string; tone?: string; className?: string }) {
  return (
    <span className={cn(styles.badge, TONE_CLASS[tone ?? statusTone(status as InvoiceStatus)], className)}>{status}</span>
  );
}
