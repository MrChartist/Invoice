/**
 * Static product catalogue (WP-9, P2 — the offline alternative to an "online store").
 *
 * One self-contained, script-free HTML file built from the catalogue (`items_catalog`): name,
 * HSN, unit, price (with or without GST), MRP, optional stock status and an order link per item
 * (`wa.me` / `mailto:` — plain links in the exported file; the app itself makes no network call).
 * Share it by WhatsApp / e-mail or host it anywhere. Every value is HTML-escaped.
 */
import type { InvoiceItem } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export interface CatalogueOptions {
  business: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  /** Show the price including GST (default) or the base rate. */
  priceWithTax?: boolean;
  showPrices?: boolean;
  /** Item name (lower case) → quantity on hand; items not in the map show no stock line. */
  stock?: Map<string, number>;
  generatedAt?: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Digits only, with India's 91 when a 10-digit mobile is given. */
export function waNumber(phone: string | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 ? d : '';
}

export function cataloguePrice(item: Pick<InvoiceItem, 'rate' | 'tax_rate'>, withTax: boolean): number {
  const rate = num(item.rate);
  return round2(withTax ? rate * (1 + num(item.tax_rate) / 100) : rate);
}

export function buildCatalogueHtml(items: readonly InvoiceItem[], opts: CatalogueOptions): string {
  const withTax = opts.priceWithTax !== false;
  const showPrices = opts.showPrices !== false;
  const wa = waNumber(opts.phone);
  const list = items
    .filter((i) => (i.name || '').trim())
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const card = (i: InvoiceItem) => {
    const price = cataloguePrice(i, withTax);
    const mrp = num(i.mrp);
    const stock = opts.stock?.get(i.name.trim().toLowerCase());
    const order = `Order: ${i.name}${i.sku ? ` (${i.sku})` : ''}`;
    const link = wa
      ? `https://wa.me/${wa}?text=${encodeURIComponent(order)}`
      : opts.email
        ? `mailto:${encodeURIComponent(opts.email)}?subject=${encodeURIComponent(order)}`
        : '';
    return `<li class="item">
<h2>${esc(i.name)}</h2>
${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
<p class="meta">${[i.hsn && `HSN ${esc(i.hsn)}`, i.unit && esc(i.unit), i.sku && `SKU ${esc(i.sku)}`].filter(Boolean).join(' · ')}</p>
${showPrices ? `<p class="price">${esc(inr(price))}${mrp > price ? ` <s>MRP ${esc(inr(mrp))}</s>` : ''} <span>${withTax && num(i.tax_rate) ? `incl. ${esc(num(i.tax_rate))}% GST` : withTax ? '' : '+ GST'}</span></p>` : ''}
${stock === undefined ? '' : `<p class="${stock > 0 ? 'in' : 'out'}">${stock > 0 ? 'In stock' : 'Out of stock'}</p>`}
${link ? `<a class="order" href="${esc(link)}" rel="noopener">Order</a>` : ''}
</li>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.business || 'Catalogue')} — catalogue</title>
<style>
:root { color-scheme: light dark; --fg: #1d2433; --muted: #5d6779; --bg: #f7f8fa; --card: #ffffff; --line: #dde1e8; --accent: #1f4fd1; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8ebf1; --muted: #a3acbc; --bg: #12151c; --card: #1b2029; --line: #2c3340; --accent: #7aa2ff; } }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--fg); background: var(--bg); }
header, footer { padding: 20px 16px; max-width: 1100px; margin: 0 auto; }
header h1 { margin: 0 0 4px; font-size: 24px; }
header p, footer p { margin: 0; color: var(--muted); }
ul { list-style: none; margin: 0 auto; padding: 0 16px; max-width: 1100px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.item { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 6px; }
.item h2 { font-size: 16px; margin: 0; }
.desc, .meta { margin: 0; color: var(--muted); font-size: 13px; }
.price { margin: 0; font-weight: 700; font-size: 17px; }
.price s, .price span { font-weight: 400; font-size: 12px; color: var(--muted); }
.in, .out { margin: 0; font-size: 12px; }
.out { color: var(--muted); }
.order { margin-top: auto; align-self: flex-start; padding: 6px 14px; border-radius: 999px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
@media print { .order { display: none; } body { background: #fff; color: #000; } }
</style></head><body>
<header>
<h1>${esc(opts.business || 'Catalogue')}</h1>
<p>${[opts.address, opts.phone && `Phone ${opts.phone}`, opts.email, opts.gstin && `GSTIN ${opts.gstin}`].filter(Boolean).map(esc).join(' · ')}</p>
</header>
<ul>
${list.map(card).join('\n')}
</ul>
<footer><p>${list.length} items · prices ${withTax ? 'include GST' : 'exclude GST'} and may change · generated ${esc(opts.generatedAt ?? new Date().toLocaleDateString('en-IN'))}</p></footer>
</body></html>`;
}
