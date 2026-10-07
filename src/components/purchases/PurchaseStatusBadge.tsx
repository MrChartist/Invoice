import { cn } from '../../lib/utils';
import type { PurchaseStatus } from '../../lib/purchases';
import surface from '../../styles/surface.module.css';

const TONE: Record<PurchaseStatus, string> = {
  Unpaid: surface.badgeSent,
  'Partially paid': surface.badgePartial,
  Paid: surface.badgePaid,
  Overdue: surface.badgeOverdue,
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  return <span className={cn(surface.badge, TONE[status])}>{status}</span>;
}
