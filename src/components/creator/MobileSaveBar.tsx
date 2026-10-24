import { Eye, Save } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
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
 * Fixed total + Preview + Save bar shown on phones and tablets (CSS hides it on desktop).
 * The page reserves room for it with useBottomBarInset().
 */
export function MobileSaveBar({ total, currency, readOnly, onPreview, onSave }: Props) {
  return (
    <div className={cn(styles.mobileBar, 'no-print')}>
      <div>
        <span>Total</span>
        <strong>{formatCurrency(total, currency)}</strong>
      </div>
      <button type="button" className={controls.btnOutline} onClick={onPreview} aria-label="Preview">
        <Eye size={16} />
      </button>
      <button type="button" className={controls.btnPrimary} onClick={onSave} disabled={readOnly}>
        <Save size={16} /> Save
      </button>
    </div>
  );
}
