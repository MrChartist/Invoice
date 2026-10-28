/**
 * R4-C4 "Deleted · Undo" for the lists that delete straight away (bills, vouchers, parties, items): when this tab's
 * user sends rows to the recycle bin, an Undo toast (no auto-dismiss, Alt+Z) restores them from the bin. Lazy;
 * render-less apart from its toast. Watches the bin (the shared parsed table, so a check costs nothing while it is unchanged).
 */
import { useEffect, useRef } from 'react';
import type { BinEntry } from '../../types/trade-r4';
import { useToast } from '../ui/useToast';
import { currentActor } from '../../lib/access';
import { peekTable } from '../../lib/storage';
import { BIN_TABLE, PARENTS, describeEntry, restoreEntries } from '../../lib/trust/recycle-bin';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';

export default function UndoDeleted() {
  const { notify, toastNode } = useToast();
  const seen = useRef(new Set(peekTable<BinEntry>(BIN_TABLE).map((e) => e.id)));
  useEffect(() => {
    const timer = setInterval(() => {
      const me = currentActor()?.name;
      const fresh = peekTable<BinEntry>(BIN_TABLE).filter((e) => !seen.current.has(e.id) && e.deleted_by === me);
      for (const e of peekTable<BinEntry>(BIN_TABLE)) seen.current.add(e.id);
      // Parents first (a bill before its payments); children come back with their parent.
      const heads = fresh.filter((e) => !PARENTS[e.table] || !fresh.some((p) => p.table === PARENTS[e.table].table));
      if (!heads.length) return;
      const label = heads.length === 1 ? `${describeEntry(heads[0]).label.toLowerCase()} ${describeEntry(heads[0]).number || describeEntry(heads[0]).name}`.trim() : `${heads.length}`;
      notify(trT('undoDeleted', { label }), 'success', {
        action: {
          label: trT('undo'),
          onClick: () => {
            try {
              // One all-or-nothing step through the bin's own path (module checks, rights, period lock — QA6-1 F1 / F17).
              restoreEntries(heads.map((e) => e.id), { withChildren: true });
              notify(trT('undoDone'));
            } catch (err) {
              notify(trErr(err), 'error');
            }
          },
        },
      });
    }, 600);
    return () => clearInterval(timer);
  }, [notify]);
  return toastNode;
}
