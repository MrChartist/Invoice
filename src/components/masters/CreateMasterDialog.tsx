/**
 * Create-on-the-fly dialog (Tally Alt+C): Group or Ledger Creation in a modal over the current
 * screen. Default export, loaded lazily by `useCreateOnTheFly`.
 */
import { Suspense, lazy } from 'react';
import { Modal } from '../ui/Modal';
import { mastersT } from '../../i18n/areas/masters';
import { GroupForm } from './GroupForm';
import { LedgerForm, type SavedLedger } from './LedgerForm';

// Stock item / godown creation (Alt+C in stock pickers) loads only when asked for.
const StockMasterCreate = lazy(() => import('./StockMasterCreate'));

export interface CreateMasterRequest {
  kind: 'ledger' | 'group' | 'stockItem' | 'godown';
  /** Text already typed in the field. */
  name?: string;
  /** Group to suggest under "Under". */
  under?: string;
  /** R20-B Ctrl+Enter: a ledger id (`party:debtor:<id>` …) to alter instead of creating. */
  alter?: string;
}

export interface CreateMasterDialogProps extends CreateMasterRequest {
  onClose: (created?: SavedLedger) => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

export default function CreateMasterDialog({ kind, name, under, alter, onClose, notify }: CreateMasterDialogProps) {
  if (kind === 'stockItem' || kind === 'godown') {
    return (
      <Suspense fallback={null}>
        <StockMasterCreate kind={kind} name={name} onClose={onClose} notify={notify} />
      </Suspense>
    );
  }
  return (
    <Modal open onClose={() => onClose()} title={kind === 'group' ? mastersT('groupCreation') : alter ? mastersT('ledgerAlteration') : mastersT('ledgerCreation')} size="lg">
      {kind === 'group' ? (
        <GroupForm mode="create" initialName={name} initialParent={under} onDone={(g) => onClose(g ? { id: g.id, name: g.name } : undefined)} onBack={() => onClose()} notify={notify} />
      ) : (
        <LedgerForm mode={alter ? 'alter' : 'create'} ledgerId={alter} initialName={name} initialGroup={under} onDone={(l) => onClose(l)} onBack={() => onClose()} notify={notify} />
      )}
    </Modal>
  );
}
