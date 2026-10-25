import type { InvoiceItem } from '../../types/invoice';
import type {} from '../../types/sales-r2';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { selectLine, setAltGroup, toggleOptional } from '../../lib/proposal-sections';
import { s2T } from '../../i18n/areas/sales-r2';
import styles from './QuoteLineFlags.module.css';

/**
 * R2-B3, quotations only: mark a line optional, select it, or put it in an alternative group
 * ("Option A / Option B" — exactly one of a group is selected). Unselected lines stay out of the total.
 */
export function QuoteLineFlags({ item, index }: { item: InvoiceItem; index: number }) {
  const edit = (fn: (items: InvoiceItem[]) => InvoiceItem[]) => {
    const st = useInvoiceStore.getState();
    st.patch({ items: fn(st.items) });
  };
  const grouped = !!(item.alt_group ?? '').trim();
  return (
    <div className={styles.flags} data-quote-flags>
      <label>
        <input type="checkbox" checked={!!item.optional} onChange={() => edit((l) => toggleOptional(l, item.id))} aria-label={`${s2T('q.optional')} ${index + 1}`} />
        {s2T('q.optional')}
      </label>
      {(item.optional || grouped) && (
        <label>
          <input type="checkbox" checked={!!item.selected} onChange={(e) => edit((l) => selectLine(l, item.id, e.target.checked))} aria-label={`${s2T('q.selected')} ${index + 1}`} />
          {s2T('q.selected')}
        </label>
      )}
      <label>
        {s2T('q.altGroup')}
        <input className={styles.group} value={item.alt_group ?? ''} maxLength={12} placeholder={s2T('q.altPh')}
          onChange={(e) => edit((l) => setAltGroup(l, item.id, e.target.value))} aria-label={`${s2T('q.altGroup')} ${index + 1}`} />
      </label>
    </div>
  );
}
