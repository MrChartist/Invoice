/**
 * Create-on-the-fly dialog (Tally Alt+C): Group or Ledger Creation in a modal over the current
 * screen. Default export, loaded lazily by `useCreateOnTheFly`.
 */
import { Modal } from '../ui/Modal';
import { mastersT } from '../../i18n/areas/masters';
import { GroupForm } from './GroupForm';
import { LedgerForm, type SavedLedger } from './LedgerForm';

export interface CreateMasterRequest {
  kind: 'ledger' | 'group';
  /** Text already typed in the field. */
  name?: string;
  /** Group to suggest under "Under". */
  under?: string;
}

export interface CreateMasterDialogProps extends CreateMasterRequest {
  onClose: (created?: SavedLedger) => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

export default function CreateMasterDialog({ kind, name, under, onClose, notify }: CreateMasterDialogProps) {
  return (
    <Modal open onClose={() => onClose()} title={kind === 'group' ? mastersT('groupCreation') : mastersT('ledgerCreation')} size="lg">
      {kind === 'group' ? (
        <GroupForm mode="create" initialName={name} initialParent={under} onDone={(g) => onClose(g ? { id: g.id, name: g.name } : undefined)} onBack={() => onClose()} notify={notify} />
      ) : (
        <LedgerForm mode="create" initialName={name} initialGroup={under} onDone={(l) => onClose(l)} onBack={() => onClose()} notify={notify} />
      )}
    </Modal>
  );
}
