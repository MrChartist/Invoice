/**
 * Editor shortcuts (8G): Alt+D duplicates the open document into a NEW unsaved one of the same type —
 * same party, lines, notes and tax settings; a fresh number, today's dates, nothing paid, and none of
 * the original's snapshots (acceptance, party balance, amendment, transport, attachments, order links).
 */

import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';

export function duplicateInEditor(): boolean {
  const src = useInvoiceStore.getState();
  if (!src.items.some((i) => i.name.trim() || i.rate > 0) && !src.client?.name?.trim()) return false;
  const copy = {
    client: src.client,
    items: src.items.map(({ order_line_id: _o, ...rest }) => ({ ...rest, id: `${rest.id}-c${Date.now().toString(36)}` }) as InvoiceItem),
    notes: src.notes,
    terms: src.terms,
    gst_mode: src.gst_mode,
    place_of_supply: src.place_of_supply,
    discount_type: src.discount_type,
    discount_rate: src.discount_rate,
    shipping: src.shipping,
    other_charges: src.other_charges,
    round_off_enabled: src.round_off_enabled,
    price_includes_tax: src.price_includes_tax,
    currency: src.currency,
    exchange_rate: src.exchange_rate,
    ship_to: src.ship_to,
    custom_values: src.custom_values,
  };
  const docType = src.doc_type;
  src.newDraft(docType);
  const next = useInvoiceStore.getState();
  next.patch(copy);
  next.recalculate();
  return true;
}
