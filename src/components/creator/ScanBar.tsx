import { lazy, Suspense, useMemo, useState } from 'react';
import { ScanBarcode, Tags } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { ScanField } from '../scan/ScanField';
import { addScannedCode, editorPricing, hasCodes, repriceAll } from './pricing-actions';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import { areaNodes } from '../../i18n/areas/nodes';
import styles from './ItemsTable.module.css';
import { can } from '../../lib/access';

// 8E (8.149): create an item from an unknown code (loads on first use).
const QuickItemSheet = lazy(() => import('../pos/QuickItemSheet').then((m) => ({ default: m.QuickItemSheet })));

/**
 * Above the items: the scan box (6.7) — shown once any item has a barcode / SKU, or on demand —
 * and the party's price level (6.9) with a "re-price lines" action. Renders a single small
 * "Scan barcode" button for users who use neither.
 */
export function ScanBar({ disabled }: { disabled?: boolean }) {
  useT(); // re-render on a language switch (5.4)
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
  const [unknown, setUnknown] = useState<string | null>(null);
  const onCode = (code: string) => {
    const r = addScannedCode(code);
    if (!r.ok && can('master.edit')) setUnknown(code);
    return r;
  };

  return (
    <div className={styles.scanBar}>
      {show ? (
        <ScanField id="editor-scan" label={edT('sbLabel')} onCode={onCode} autoFocus={open} />
      ) : (
        !disabled && (
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(true)}>
            <ScanBarcode size={14} /> {edT('sbScan')}
          </button>
        )
      )}
      {unknown && (
        <Suspense fallback={null}>
          <QuickItemSheet
            code={unknown}
            defaultTax={useInvoiceStore.getState().tax_rate}
            onClose={() => setUnknown(null)}
            onSaved={() => {
              const r = addScannedCode(unknown);
              setUnknown(null);
              setNote(r.message);
            }}
          />
        </Suspense>
      )}
      {level && (
        <p className={styles.levelNote}>
          <Tags size={14} aria-hidden="true" /> {areaNodes(edT('sbLevel', { client: clientName }), { level: <strong>{level.name}</strong> })}
          <button
            type="button"
            className={`${controls.btnGhost} ${controls.btnSm}`}
            disabled={disabled}
            onClick={() => {
              const n = repriceAll();
              setNote(n ? (n === 1 ? edT('sbRepricedOne') : edT('sbRepricedMany', { n })) : edT('sbNone'));
            }}
          >
            {edT('sbReprice')}
          </button>
          {note && <span role="status">{note}</span>}
        </p>
      )}
    </div>
  );
}
