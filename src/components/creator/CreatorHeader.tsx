import { Eye, FilePlus2, Save, X } from 'lucide-react';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import type { InvoiceStatus } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from '../../pages/InvoiceCreator.module.css';

interface Props {
  /** Document type label, e.g. "Tax Invoice". */
  label: string;
  editing: boolean;
  invoiceNumber: string;
  status: InvoiceStatus;
  dirty: boolean;
  readOnly: boolean;
  onNew: () => void;
  onPreview: () => void;
  onSaveDraft: () => void;
  onSave: () => void;
  onClose: () => void;
}

/** Title, save state and the top action row of the invoice editor. */
export function CreatorHeader({ label, editing, invoiceNumber, status, dirty, readOnly, onNew, onPreview, onSaveDraft, onSave, onClose }: Props) {
  return (
    <PageHeader
      title={
        <>
          {editing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}
          {invoiceNumber && <span className={styles.number}>{invoiceNumber}</span>}
          {editing && <StatusBadge status={status} />}
        </>
      }
      subtitle={dirty ? 'Unsaved changes — autosaved as a draft on this device' : editing ? 'All changes saved' : 'Fill in the details, then save.'}
      actions={
        <>
          {editing && (
            <button type="button" className={controls.btnOutline} onClick={onNew}>
              <FilePlus2 size={16} /> New
            </button>
          )}
          <button type="button" className={controls.btnOutline} onClick={onPreview}>
            <Eye size={16} /> Preview
          </button>
          {!editing && (
            <button type="button" className={controls.btnOutline} onClick={onSaveDraft} disabled={readOnly}>
              Save draft
            </button>
          )}
          <button type="button" className={controls.btnPrimary} onClick={onSave} disabled={readOnly} title={readOnly ? 'Locked — unlock with your PIN to edit' : 'Save and issue — counts in reports; use Save draft to keep it out (Ctrl+S)'}>
            <Save size={16} /> Save
          </button>
          <button type="button" className={controls.btnOutline} onClick={onClose} title="Close (Esc) — drafts are kept" aria-label="Close">
            <X size={16} /> Close
          </button>
        </>
      }
    />
  );
}
