/**
 * R14 PS-B5 release orders: a purchase order carrying `ps.media` prints as a "Release order" — publication / platform,
 * insertion or slot schedule, size / duration, rate and the client's reference. RO numbers are the PO series (no new
 * table, no new series). Lazy: loaded by the PO print path only for such an order.
 */
import type { PurchaseOrder } from '../../types/purchases';
import { poHtml, type PoBuyer } from '../purchase-orders';
import { mediaOf, type MediaBuy } from './ps-media';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The release-order particulars printed above the schedule. */
export function roFields(po: Pick<PurchaseOrder, 'po_number'> & { ps?: unknown }, clientName = ''): [string, string][] | null {
  const m: MediaBuy | undefined = mediaOf(po);
  if (!m) return null;
  return ([
    ['RO no.', m.ro_no || po.po_number],
    ['Medium', m.medium],
    ['Publication / platform', m.publication ?? ''],
    ['Schedule', [m.insert_from, m.insert_to].filter(Boolean).join(' – ')],
    ['Client', clientName],
    ['Client reference', m.client_ref ?? ''],
  ] as [string, string][]).filter(([, v]) => v);
}

/** The printable release order (falls back to the purchase order when the PO carries no media). */
export function roHtml(po: PurchaseOrder, buyer: PoBuyer, vendor?: { address?: string; phone?: string; email?: string }, clientName = ''): string {
  const html = poHtml(po, buyer, vendor);
  const f = roFields(po as PurchaseOrder & { ps?: unknown }, clientName);
  if (!f) return html;
  const block = `<table style="margin-bottom:16px">${f.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  return html
    .replace('<title>Purchase order', '<title>Release order')
    .replace('<h1>Purchase order</h1>', '<h1>Release order</h1>')
    .replace('<div class="muted">To (supplier)</div>', '<div class="muted">To (publication / media)</div>')
    .replace('<th>Item</th>', '<th>Insertion / slot</th>')
    .replace('<th class="n">Qty</th>', '<th class="n">Size / duration</th>')
    .replace('<table><thead>', `${block}<table><thead>`);
}
