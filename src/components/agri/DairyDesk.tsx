/**
 * R12 DairyDesk (`/inventory?tab=dairy&view=`; views charts / collection / bills / dispatch / products / cards): a stub until AG-B replaces this file with its desk
 * (same default export and props). `Inventory.tsx` mounts it lazily and is not edited again.
 */
import R12Stub from './R12Stub';

export default function DairyDesk(props: { view?: string; onDone: (msg: string, error?: boolean) => void }) {
  void props;
  return <R12Stub desk="dairy" />;
}
