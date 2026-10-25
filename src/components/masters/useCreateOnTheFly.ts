/**
 * Alt+C create-on-the-fly for any screen (voucher entry, Gateway, forms):
 *
 *   const { open, node } = useCreateOnTheFly(notify);
 *   <input onKeyDown={(e) => isAltC(e.nativeEvent) && open({ kind: 'ledger', name: e.currentTarget.value }).then(pick)} />
 *   {node}
 *
 * `open` resolves with `{ id, name }` of the created master (an account id, a party ledger id
 * `party:debtor:<clientId>`, or a group id), or undefined when cancelled. The dialog chunk loads
 * only on first use, so screens pay nothing until Alt+C is pressed.
 */
import { Suspense, createElement, lazy, useCallback, useState, type ReactNode } from 'react';
import type { CreateMasterRequest } from './CreateMasterDialog';
import type { SavedLedger } from './LedgerForm';

const CreateMasterDialog = lazy(() => import('./CreateMasterDialog'));

interface Pending {
  req: CreateMasterRequest;
  resolve: (v: SavedLedger | undefined) => void;
}

export function useCreateOnTheFly(notify?: (msg: string, tone?: 'success' | 'error') => void): {
  open: (req: CreateMasterRequest) => Promise<SavedLedger | undefined>;
  node: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const open = useCallback(
    (req: CreateMasterRequest) =>
      new Promise<SavedLedger | undefined>((resolve) => {
        setPending({ req, resolve });
      }),
    [],
  );
  const node = pending
    ? createElement(
        Suspense,
        { fallback: null },
        createElement(CreateMasterDialog, {
          ...pending.req,
          notify,
          onClose: (v?: SavedLedger) => {
            pending.resolve(v);
            setPending(null);
          },
        }),
      )
    : null;
  return { open, node };
}
