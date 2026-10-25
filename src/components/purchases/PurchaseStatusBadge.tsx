import { cn } from '../../lib/utils';
import type { PurchaseStatus } from '../../lib/purchases';
import { useT } from '../../i18n';
import { purStatus } from '../../i18n/areas/purchases';
import surface from '../../styles/surface.module.css';

const TONE: Record<PurchaseStatus, string> = {
  Unpaid: surface.badgeSent,
  'Partially paid': surface.badgePartial,
  Paid: surface.badgePaid,
  Overdue: surface.badgeOverdue,
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  useT(); // re-render on a language switch (5.4)
  return <span className={cn(surface.badge, TONE[status])}>{purStatus(status)}</span>;
}
