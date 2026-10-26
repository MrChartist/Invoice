import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TemplateEngine } from '../templates/TemplateEngine';
import { designForDoc, resolve as resolveDesign } from '../../lib/design-prefs';
import { calcInputFromRecord, calculateInvoice } from '../../lib/invoice-calc';
import { blankProfile, localDb } from '../../lib/localDb';
import { copyBillImage, renderBillImages, shareOrDownloadImages } from '../../lib/share-image';
import type { InvoiceRecord } from '../../types/invoice';
import styles from './restaurant.module.css';

export interface BillImageShareProps {
  invoice: InvoiceRecord;
  /** Copy the first page to the clipboard instead of sharing. */
  copy?: boolean;
  onDone: (result: { ok: boolean; message?: string; copied?: boolean }) => void;
}

/**
 * R3-A5 at the counter: the saved bill drawn off-screen on the 80 mm roll (its own sender snapshot —
 * Critical Rule 3), captured as a PNG and shared / downloaded / copied. Nothing is stored.
 */
export function BillImageShare({ invoice, copy, onDone }: BillImageShareProps) {
  const host = useRef<HTMLDivElement>(null);
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const design = useMemo(() => designForDoc({ ...resolveDesign(sender.id), paper: 'thermal80' as const }, invoice.doc_type), [sender.id, invoice.doc_type]);
  const totals = useMemo(() => calculateInvoice(calcInputFromRecord(invoice)), [invoice]);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const node = host.current?.firstElementChild as HTMLElement | null;
        if (!node) throw new Error('nothing rendered');
        const files = await renderBillImages(node, invoice.invoice_number, design);
        if (!live) return;
        if (copy && files[0]) {
          const ok = await copyBillImage(files[0]);
          done.current(ok ? { ok, copied: true } : { ok: false, message: 'clipboard' });
          return;
        }
        await shareOrDownloadImages(files, invoice.invoice_number);
        done.current({ ok: true });
      } catch (err) {
        if (live) done.current({ ok: false, message: (err as Error).message });
      }
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [invoice, design, copy]);

  return createPortal(
    <div ref={host} className={styles.offscreen} aria-hidden="true" data-bill-image={invoice.invoice_number}>
      <TemplateEngine invoice={invoice} sender={sender} totals={totals} templateId={invoice.template_id} design={design} pageRule />
    </div>,
    document.body,
  );
}
