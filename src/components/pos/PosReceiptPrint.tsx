import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { TemplateEngine } from '../templates/TemplateEngine';
import { resolve as resolveDesign } from '../../lib/design-prefs';
import { calcInputFromRecord, calculateInvoice } from '../../lib/invoice-calc';
import { blankProfile, localDb } from '../../lib/localDb';
import type { InvoiceRecord } from '../../types/invoice';
import styles from './pos.module.css';

/**
 * Prints a saved POS bill on the 80 mm roll: the existing receipt layout (the template engine's
 * `thermal80` paper) rendered off-screen, then the browser's print dialog. Calls `onDone` after
 * printing (or straight away where `afterprint` never fires).
 */
export function PosReceiptPrint({ invoice, onDone }: { invoice: InvoiceRecord; onDone: () => void }) {
  // The bill's own sender snapshot first (Critical Rule 3).
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const design = useMemo(() => ({ ...resolveDesign(sender.id), paper: 'thermal80' as const }), [sender.id]);
  const totals = useMemo(() => calculateInvoice(calcInputFromRecord(invoice)), [invoice]);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone();
    };
    window.addEventListener('afterprint', finish, { once: true });
    // Let the portal paint (fonts, QR) before opening the dialog.
    const t = setTimeout(() => {
      try {
        window.print();
      } finally {
        // Browsers that block in print() have already fired afterprint; others get a grace period.
        setTimeout(finish, 1500);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  return createPortal(
    <div className={styles.printHost} aria-hidden="true" data-pos-print={invoice.invoice_number}>
      <TemplateEngine invoice={invoice} sender={sender} totals={totals} templateId={invoice.template_id} design={design} pageRule />
    </div>,
    document.body,
  );
}
