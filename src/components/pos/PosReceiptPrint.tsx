import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { TemplateEngine } from '../templates/TemplateEngine';
import { designForDoc, resolve as resolveDesign } from '../../lib/design-prefs';
import { calcInputFromRecord, calculateInvoice } from '../../lib/invoice-calc';
import { blankProfile, localDb } from '../../lib/localDb';
import type { InvoiceRecord } from '../../types/invoice';
import styles from './pos.module.css';
import { loadPrinterPrefs } from '../../lib/escpos';

// 7U: raw text / ESC-POS receipts when chosen on this device (default: the browser print below).
const RawReceiptPrint = lazy(() => import('../extras7u/PosPrinter').then((m) => ({ default: m.RawReceiptPrint })));

export function PosReceiptPrint({ invoice, onDone }: { invoice: InvoiceRecord; onDone: () => void }) {
  const [raw, setRaw] = useState(() => loadPrinterPrefs().mode !== 'browser');
  if (raw) return <Suspense fallback={null}><RawReceiptPrint invoice={invoice} onDone={onDone} onFail={() => setRaw(false)} /></Suspense>;
  return <BrowserReceiptPrint invoice={invoice} onDone={onDone} />;
}

/**
 * Prints a saved POS bill on the 80 mm roll: the existing receipt layout (the template engine's
 * `thermal80` paper) rendered off-screen, then the browser's print dialog. Calls `onDone` after
 * printing (or straight away where `afterprint` never fires).
 */
function BrowserReceiptPrint({ invoice, onDone }: { invoice: InvoiceRecord; onDone: () => void }) {
  // The bill's own sender snapshot first (Critical Rule 3).
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const design = useMemo(() => designForDoc({ ...resolveDesign(sender.id), paper: 'thermal80' as const }, invoice.doc_type), [sender.id, invoice.doc_type]);
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
