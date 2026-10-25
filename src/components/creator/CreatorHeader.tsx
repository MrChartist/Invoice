import { Eye, FilePlus2, Save, X } from 'lucide-react';
import { PageHeader } from '../ui/PageHeader';
import { StatusBadge } from '../ui/StatusBadge';
import type { InvoiceStatus } from '../../types/invoice';
import { useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
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
  const { t, lang } = useT();
  // English writes the type in lower case mid-sentence ("New tax invoice"); Hindi has no case.
  const doc = lang === 'en' ? label.toLowerCase() : label;
  return (
    <PageHeader
      title={
        <>
          {editing ? t('editor.editDoc', { doc }) : t('editor.newDoc', { doc })}
          {invoiceNumber && <span className={styles.number}>{invoiceNumber}</span>}
          {editing && <StatusBadge status={status} />}
        </>
      }
      subtitle={dirty ? t('editor.subDirty') : editing ? t('editor.subSaved') : t('editor.subNew')}
      actions={
        <>
          {editing && (
            <button type="button" className={controls.btnOutline} onClick={onNew}>
              <FilePlus2 size={16} /> {t('common.new')}
            </button>
          )}
          <button type="button" className={controls.btnOutline} onClick={onPreview}>
            <Eye size={16} /> {t('common.preview')}
          </button>
          {!editing && (
            <button type="button" className={controls.btnOutline} onClick={onSaveDraft} disabled={readOnly}>
              {t('editor.saveDraft')}
            </button>
          )}
          <button type="button" className={controls.btnPrimary} onClick={onSave} disabled={readOnly} title={readOnly ? t('editor.lockedTitle') : t('editor.saveTitle')}>
            <Save size={16} /> {t('common.save')}
          </button>
          <button type="button" className={controls.btnOutline} onClick={onClose} title={t('editor.closeTitle')} aria-label={t('common.close')}>
            <X size={16} /> {t('common.close')}
          </button>
        </>
      }
    />
  );
}
