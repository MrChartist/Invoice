import { useMemo, useState } from 'react';
import { ScanBarcode, Tags } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { ScanField } from '../scan/ScanField';
import { addScannedCode, editorPricing, hasCodes, repriceAll } from './pricing-actions';
import controls from '../../styles/controls.module.css';
import styles from './ItemsTable.module.css';

/**
 * Above the items: the scan box (6.7) — shown once any item has a barcode / SKU, or on demand —
 * and the party's price level (6.9) with a "re-price lines" action. Renders a single small
 * "Scan barcode" button for users who use neither.
 */
export function ScanBar({ disabled }: { disabled?: boolean }) {
  const clientName = useInvoiceStore((s) => s.client.name);
  const clientId = useInvoiceStore((s) => s.client.id);
  const docType = useInvoiceStore((s) => s.doc_type);
  const [codes] = useState(hasCodes);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const level = useMemo(
    () => editorPricing()?.level ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientName, clientId, docType],
  );
  const show = (codes || open) && !disabled;

  return (
    <div className={styles.scanBar}>
      {show ? (
        <ScanField id="editor-scan" label="Scan barcode or SKU" onCode={addScannedCode} autoFocus={open} />
      ) : (
        !disabled && (
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(true)}>
            <ScanBarcode size={14} /> Scan barcode
          </button>
        )
      )}
      {level && (
        <p className={styles.levelNote}>
          <Tags size={14} aria-hidden="true" /> {clientName} buys at <strong>{level.name}</strong> prices.
          <button
            type="button"
            className={`${controls.btnGhost} ${controls.btnSm}`}
            disabled={disabled}
            onClick={() => {
              const n = repriceAll();
              setNote(n ? `Re-priced ${n} line${n === 1 ? '' : 's'}.` : 'No catalogue lines to re-price.');
            }}
          >
            Re-price lines
          </button>
          {note && <span role="status">{note}</span>}
        </p>
      )}
    </div>
  );
}
