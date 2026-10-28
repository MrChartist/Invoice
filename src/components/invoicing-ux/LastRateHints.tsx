import { useMemo } from 'react';
import { History } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { KEYS, peekTable } from '../../lib/storage';
import { LAST_RATE_BASIS, lastRatesFor } from '../../lib/last-rate';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import ux from './ux.module.css';

const PRICED = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN']);

/**
 * 8.104 "Last rate to this party" chips under the lines: the rate each item was last billed to this
 * customer (date + document). One pass over the invoices per party change (`lastRatesFor`), not per
 * keystroke. "Use" applies it; a line already on the last rate offers the catalogue rate back.
 */
export function LastRateHints() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['client', 'id', 'currency', 'doc_type', 'items'])));
  const partyKey = `${s.client?.id ?? ''}|${(s.client?.name ?? '').trim().toLowerCase()}`;
  const rates = useMemo(
    () => lastRatesFor(peekTable<InvoiceRecord>(KEYS.invoices), s.client, { excludeId: s.id, currency: s.currency }),
    // The party, document and currency decide the map; lines are matched below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partyKey, s.id, s.currency],
  );
  if (!PRICED.has(s.doc_type) || rates.size === 0) return null;
  const rows = (s.items as InvoiceItem[])
    .filter((l) => l.name?.trim() && !l.free_of)
    .map((l) => ({ line: l, last: rates.get(l.name.trim().toLowerCase()) }))
    .filter((r): r is { line: InvoiceItem; last: NonNullable<typeof r.last> } => !!r.last);
  if (!rows.length) return null;
  const catalogue = (name: string) => peekTable<Partial<InvoiceItem>>(KEYS.items).find((c) => (c.name ?? '').trim().toLowerCase() === name.trim().toLowerCase());
  const st = () => useInvoiceStore.getState();

  return (
    <div className={`${ux.notice} no-print`} role="status" aria-label={uxT('lrAria')} data-last-rate>
      <ul className={ux.list}>
        {rows.map(({ line, last }) => {
          const onLast = line.price_basis === LAST_RATE_BASIS || line.rate === last.rate;
          const cat = catalogue(line.name);
          return (
            <li key={line.id}>
              <span>
                <History size={12} aria-hidden="true" /> {uxT('lrLine', { item: line.name, rate: formatCurrency(last.rate, s.currency), date: formatDate(last.date), number: last.number })}
              </span>
              {!onLast ? (
                <button type="button" className={ux.linkBtn} onClick={() => st().patchItem(line.id, { rate: last.rate, price_basis: LAST_RATE_BASIS })}>{uxT('lrUse')}</button>
              ) : line.price_basis === LAST_RATE_BASIS && cat && Number(cat.rate) > 0 && Number(cat.rate) !== line.rate ? (
                <button type="button" className={ux.linkBtn} onClick={() => st().patchItem(line.id, { rate: Number(cat.rate), price_basis: undefined })}>
                  {uxT('lrCatalogue', { rate: formatCurrency(Number(cat.rate), s.currency) })}
                </button>
              ) : (
                <span className={ux.chip}>{uxT('lrApplied')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default LastRateHints;
