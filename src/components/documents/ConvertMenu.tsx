import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, ChevronDown, FilePlus2, FileMinus2 } from 'lucide-react';
import { allowedConversions, canRaiseNote, convertDocument } from '../../lib/documents';
import type { InvoiceRecord } from '../../types/invoice';
import { useToast } from '../ui/useToast';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { docLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import styles from './documents.module.css';

export interface ConvertMenuProps {
  invoice: InvoiceRecord;
  /** Called with the new saved draft. Default: navigate to /invoice/:id. */
  onCreated?: (record: InvoiceRecord) => void;
  /** When provided, a "Create credit note" entry is shown for issued invoices. */
  onRequestCreditNote?: () => void;
  /** When provided, a "Create debit note" entry is shown next to it. */
  onRequestDebitNote?: () => void;
}

/** Dropdown of valid document conversions for one document. */
export function ConvertMenu({ invoice, onCreated, onRequestCreditNote, onRequestDebitNote }: ConvertMenuProps) {
  useT(); // re-render on a language switch (5.4)
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { notify, toastNode } = useToast();

  const options = allowedConversions(invoice);
  const showCredit = Boolean(onRequestCreditNote) && canRaiseNote(invoice);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (options.length === 0 && !showCredit) return null;

  const run = (target: (typeof options)[number]['target']) => {
    setBusy(true);
    try {
      const rec = convertDocument(invoice, target);
      setOpen(false);
      notify(salesT('cv.created', { number: rec.invoice_number }));
      if (onCreated) onCreated(rec);
      else navigate(`/invoice/${rec.id}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : salesT('cv.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        className={controls.btnOutline}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
      >
        <ArrowRightLeft size={16} aria-hidden="true" />
        {salesT('cv.convert')}
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label={salesT('cv.menu')}>
          {options.map((o) => (
            <button
              key={o.target}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => run(o.target)}
              disabled={busy}
            >
              <FilePlus2 size={16} aria-hidden="true" />
              {salesT(invoice.doc_type === 'SALES_ORDER' ? 'cv.toPending' : 'cv.to', { doc: docLabel(o.target) })}
            </button>
          ))}
          {showCredit && (
            <>
              {options.length > 0 && <div className={styles.menuSep} role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onRequestCreditNote?.();
                }}
              >
                <FileMinus2 size={16} aria-hidden="true" />
                {salesT('cv.creditNote')}
              </button>
              {onRequestDebitNote && (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => {
                    setOpen(false);
                    onRequestDebitNote();
                  }}
                >
                  <FilePlus2 size={16} aria-hidden="true" />
                  {salesT('cv.debitNote')}
                </button>
              )}
            </>
          )}
          {options.length > 0 && (
            <p className={styles.menuNote}>{salesT('cv.note')}</p>
          )}
        </div>
      )}
      {toastNode}
    </div>
  );
}
