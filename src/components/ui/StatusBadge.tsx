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

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <span className={cn(styles.badge, TONE_CLASS[statusTone(status)], className)}>{status}</span>
  );
}
