import { useState } from 'react';
import { FileJson } from 'lucide-react';
import controls from '../../styles/controls.module.css';
import type { InvoiceRecord } from '../../types/invoice';
import { EInvoiceModal } from './EInvoiceModal';

/** Drop-in trigger: a button that opens the e-Invoice / e-Way modal for one invoice. */
export function EInvoiceButton({ invoice, label = 'e-Invoice / e-Way' }: { invoice: InvoiceRecord; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(true)}>
        <FileJson size={16} aria-hidden="true" /> {label}
      </button>
      <EInvoiceModal invoice={invoice} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
