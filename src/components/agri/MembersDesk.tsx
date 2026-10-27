/**
 * R12 MembersDesk (`/inventory?tab=members&view=`; views register / shares / patronage / papers): a stub until AG-D replaces this file with its desk
 * (same default export and props). `Inventory.tsx` mounts it lazily and is not edited again.
 */
import R12Stub from './R12Stub';

export default function MembersDesk(props: { view?: string; onDone: (msg: string, error?: boolean) => void }) {
  void props;
  return <R12Stub desk="members" />;
}
