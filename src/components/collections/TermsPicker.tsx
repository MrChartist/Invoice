import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { localDb } from '../../lib/localDb';
import { defaultTermFor, loadPaymentTerms, msmeNote, termPatch } from '../../lib/payment-terms';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import styles from './collections.module.css';

const TERM_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'PROFORMA', 'QUOTATION', 'SALES_ORDER', 'DEBIT_NOTE']);

/**
 * R2-A1 terms picker next to the due date. Picking a term sets the due date to its final instalment, fills the
 * 8G payment schedule (instalment terms) and snapshots the term (name + early-pay offer). A new document for a
 * client with a default term pre-selects it. When the issue date or the total changes, the picked term is
 * worked out again (so a converted / copied document is recomputed on issue). Editing the due date by hand
 * clears the term to "Custom" (DocumentMetaCard).
 */
export function TermsPicker() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['id', 'client', 'doc_type', 'issue_date', 'due_date', 'totals', 'payment_terms', 'sender', 'status', 'currency', 'patch'])));
  const terms = useMemo(() => loadPaymentTerms(), []);
  const total = s.totals.total;
  const tds = s.totals.tds_amount;
  const termId = s.payment_terms?.id ?? '';
  const term = terms.find((t) => t.id === termId);

  // A new document pre-selects the client's default term (once per client; "Custom" afterwards is respected).
  const preselected = useRef('');
  useEffect(() => {
    const clientKey = s.client?.id || s.client?.name || '';
    if (s.id || !clientKey || preselected.current === clientKey || s.payment_terms) return;
    preselected.current = clientKey;
    const master = s.client?.id ? localDb.clients.getById(s.client.id) : undefined;
    const def = defaultTermFor(master ?? s.client, terms);
    if (def) s.patch(termPatch(def, { issue_date: s.issue_date, total, tds_amount: tds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.client?.id, s.client?.name, s.id]);

  // Re-work the picked term when the issue date or the total changes.
  const last = useRef('');
  useEffect(() => {
    if (!term) return;
    const key = `${term.id}|${s.issue_date}|${total}|${tds}`;
    if (last.current === key) return;
    const first = last.current === '';
    last.current = key;
    if (first && s.id) return; // a saved document keeps its snapshot until something changes
    s.patch(termPatch(term, { issue_date: s.issue_date, total, tds_amount: tds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term?.id, s.issue_date, total, tds]);

  if (!TERM_DOCS.has(s.doc_type)) return null;
  const choose = (id: string) => {
    const t = terms.find((x) => x.id === id);
    if (!t) return s.patch({ payment_terms: undefined });
    s.patch(termPatch(t, { issue_date: s.issue_date, total, tds_amount: tds }));
  };
  const e = s.payment_terms?.early_discount;
  const msme = msmeNote(s.sender, s.issue_date, s.due_date, s.client?.gstin ?? '');
  return (
    <div className={styles.stack} data-terms-picker>
      <label className={controls.field}>
        <span className={controls.label}>{colT('tpLabel')}</span>
        <select className={controls.select} value={termId} onChange={(ev) => choose(ev.target.value)} data-terms-select>
          <option value="">{colT('tpCustom')}</option>
          {terms.filter((t) => !t.inactive || t.id === termId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          {termId && !term && <option value={termId}>{s.payment_terms?.name}</option>}
        </select>
        {e && <span className={controls.hint}>{colT('tpEarly', { percent: e.percent, date: formatDate(e.until), amount: formatCurrency(e.amount, s.currency) })}</span>}
      </label>
      {msme && <p className={styles.warn} role="note" data-msme-note>{colT('tpMsme')}</p>}
    </div>
  );
}

export default TermsPicker;
