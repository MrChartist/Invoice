/**
 * R12 MillDesk (`/inventory?tab=mill&view=`; views intake / batches / cmr / yield): a stub until AG-C replaces this file with its desk
 * (same default export and props). `Inventory.tsx` mounts it lazily and is not edited again.
 */
import R12Stub from './R12Stub';

export default function MillDesk(props: { view?: string; onDone: (msg: string, error?: boolean) => void }) {
  void props;
  return <R12Stub desk="mill" />;
}
