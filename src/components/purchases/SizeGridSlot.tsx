/**
 * R9 (RT-C2, PENDING #23): the apparel *Size grid* button for every purchase line editor — supplier bill, purchase order
 * and GRN. One small module holds the lazy import, so the desk's preload list is carried once, not by each host.
 * Renders nothing without the apparel pack.
 */
import { lazy, Suspense } from 'react';
import type { PurchaseLine } from '../../types/purchases';
import { impliedPacks } from '../../lib/shop-mode';
import { localDb } from '../../lib/localDb';

const BillGrid = lazy(() => import('../retail-r9/ApparelDesk').then((m) => ({ default: m.BillGrid })));

export function SizeGridSlot({ lines, onChange, date }: { lines: PurchaseLine[]; onChange: (lines: PurchaseLine[]) => void; date?: string }) {
  if (!impliedPacks(localDb.settings.get()).includes('apparel')) return null;
  return <Suspense fallback={null}><BillGrid lines={lines} onChange={onChange} date={date} /></Suspense>;
}
