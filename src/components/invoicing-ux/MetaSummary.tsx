import { useMemo, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { localDb } from '../../lib/localDb';
import { formatDate } from '../../lib/utils';
import { daysUntil } from '../../lib/reminders';
import { DOCUMENT_LABELS, type DocumentType } from '../../types/invoice';
import { docLabel } from '../../i18n/labels';
import { t, useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (meta.type)
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import ux from './ux.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * A5 "customer & items first": the document details card (type, number, dates, currency) shown as one
 * line — "INV/… · 25 Oct 2026 · due in 15 d · Edit" — below the items. It opens by itself when there
 * are errors, the typed number clashes with another document, or the currency is not rupees.
 */
const DOC_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];

export function MetaSummary({ forceOpen, editing, children }: { forceOpen?: boolean; editing?: boolean; children: ReactNode }) {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['id', 'doc_type', 'invoice_number', 'issue_date', 'due_date', 'currency', 'setDocType'])));
  const [open, setOpen] = useState(false);
  const clash = useMemo(() => (s.invoice_number.trim() ? !localDb.invoices.checkNumber(s.invoice_number, s.id || undefined).ok : false), [s.invoice_number, s.id]);
  const foreign = (s.currency || 'INR').toUpperCase() !== 'INR';
  if (open || forceOpen || clash || foreign) {
    return (
      <div data-meta-open>
        {open && !forceOpen && !clash && !foreign && (
          <div className={ux.row} style={{ justifyContent: 'flex-end' }}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(false)}>{uxT('metaCollapse')}</button>
          </div>
        )}
        {children}
      </div>
    );
  }
  const raw = s.due_date ? daysUntil(s.due_date, new Date()) : NaN;
  const days = Number.isFinite(raw) ? raw : null;
  const due = days === null ? '' : days > 0 ? uxT('metaDueIn', { n: days }) : days === 0 ? uxT('metaDueToday') : uxT('metaOverdue', { n: -days });
  return (
    <section className={surface.card} data-meta-summary>
      <div className={ux.box}>
        <div className={ux.row}>
          {/* QA-3 F21: the type (Quotation, Proforma…) is picked here, not behind "Edit"; locked once a saved doc has a number. */}
          <SelectField className={`${controls.select} ${ux.typePick}`} value={s.doc_type} onChange={(e) => s.setDocType(e.target.value as DocumentType)} disabled={!!editing && Boolean(s.invoice_number)} aria-label={t('meta.type')} data-meta-type>
            {DOC_TYPES.map((d) => <option key={d} value={d}>{docLabel(d)}</option>)}
          </SelectField>
          <span>{s.invoice_number || uxT('metaAutoNumber')}</span>
          <span className={ux.muted}>· {formatDate(s.issue_date)}</span>
          {due && <span className={`${ux.muted} ${ux.nowrap}`}>· {due}</span>}
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(true)} data-meta-edit>
            <Pencil size={14} /> {uxT('metaEdit')}
          </button>
        </div>
      </div>
    </section>
  );
}

export default MetaSummary;
