/** Document actions → Packing list (R2-C4). The dialog and the packing engine load only on click. */
import { lazy, Suspense, useState } from 'react';
import { Package } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { pkT } from '../../i18n/areas/dispatch-r2';
import controls from '../../styles/controls.module.css';

const PackingListDialog = lazy(() => import('./PackingListDialog'));
const PACKABLE = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN']);

export function PackingListButton({ invoice }: { invoice: InvoiceRecord }) {
  useT();
  const [open, setOpen] = useState(false);
  if (!PACKABLE.has(invoice.doc_type) || invoice.status === 'Cancelled') return null;
  return (
    <>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(true)} data-packing-open>
        <Package size={16} aria-hidden /> {pkT('open')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <PackingListDialog invoice={invoice} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
