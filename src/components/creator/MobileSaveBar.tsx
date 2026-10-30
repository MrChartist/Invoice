import { Eye, Save } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import controls from '../../styles/controls.module.css';
import styles from '../../pages/InvoiceCreator.module.css';

interface Props {
  total: number;
  currency: string;
  readOnly: boolean;
  onPreview: () => void;
  onSave: () => void;
}

/**
 * Total + Preview + Save bar (InvoiceCreator.module.css `.mobileBar`): fixed at the bottom while the editor is one
 * column, the form column's sticky footer while the live preview is on, hidden otherwise (the summary is beside).
 * The page reserves room for it with useBottomBarInset().
 */
export function MobileSaveBar({ total, currency, readOnly, onPreview, onSave }: Props) {
  const { t } = useT();
  return (
    <div className={cn(styles.mobileBar, 'no-print')}>
      <div>
        <span>{t('editor.total')}</span>
        <strong>{formatCurrency(total, currency)}</strong>
      </div>
      <button type="button" className={controls.btnOutline} onClick={onPreview} aria-label={t('common.preview')}>
        <Eye size={16} />
      </button>
      <button type="button" className={controls.btnPrimary} onClick={onSave} disabled={readOnly}>
        <Save size={16} /> {t('common.save')}
      </button>
    </div>
  );
}
