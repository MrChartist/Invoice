/**
 * R12 ColdDesk (`/inventory?tab=cold&view=`; views lots / gatepasses / rent / loans / chambers): a stub until AG-D replaces this file with its desk
 * (same default export and props). `Inventory.tsx` mounts it lazily and is not edited again.
 */
import R12Stub from './R12Stub';

export default function ColdDesk(props: { view?: string; onDone: (msg: string, error?: boolean) => void }) {
  void props;
  return <R12Stub desk="cold" />;
}
