import { useDeferredValue, useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { peekTable } from '../../lib/storage';
import { can } from '../../lib/access';
import { buildUnitCosts, documentMargin, marginTone } from '../../lib/margin';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import ux from './ux.module.css';

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER']);

/**
 * 8.102 live gross-margin chip in the summary. Costs are built once per editor visit (latest purchase
 * rate → standard cost → opening rate); the margin follows the lines through `useDeferredValue`, so
 * typing never waits for it. Hidden from viewers; `noPrint` and outside the paper, so never printed.
 */
export function MarginChip() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['items', 'doc_type', 'currency', 'totals'])));
  const items = useDeferredValue(s.items);
  const costs = useMemo(() => {
    try {
      return buildUnitCosts(peekTable('purchases'), peekTable<{ name: string }>('stock_items'), peekTable('vendors'));
    } catch {
      return new Map();
    }
  }, []);
  const billDiscount = Number(s.totals?.invoice_discount_amount) || 0;
  const m = useMemo(() => documentMargin(items, costs, billDiscount), [items, costs, billDiscount]);
  if (!can('doc.edit') || !SALES.has(s.doc_type) || costs.size === 0 || (s.currency || 'INR').toUpperCase() !== 'INR') return null;
  if (!m.costed) return null;
  const tone = marginTone(m.pct);
  const cls = tone === 'loss' ? ux.chipBad : tone === 'thin' ? ux.chipWarn : ux.chipGood;
  return (
    <div className={`${ux.row} ${ux.noPrint} no-print`} data-margin-chip title={uxT('mgTitle')}>
      <span className={cls}>
        <TrendingUp size={12} aria-hidden="true" /> {uxT('mgChip', { pct: String(m.pct ?? 0), amount: formatCurrency(m.margin, 'INR') })}
      </span>
      {m.uncosted > 0 && <span className={ux.muted}>{uxT('mgUncosted', { n: m.uncosted })}</span>}
    </div>
  );
}

export default MarginChip;
