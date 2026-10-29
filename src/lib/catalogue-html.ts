/**
 * Product catalogue (WP-9; v2 in 8H, roadmap 8.122 — the offline answer to an online store).
 *
 * One self-contained HTML file built from the catalogue (`items_catalog`): photo, name, HSN, unit,
 * price (with or without GST), MRP with a "% off MRP" badge, optional stock status, grouped by
 * category (stock groups), with an order link per item and per category (`wa.me` / `mailto:` — plain
 * links in the exported file; the app itself makes no network call). Share it by WhatsApp / e-mail
 * or host it anywhere. Every value is HTML-escaped; photos are inlined as raster data URIs only.
 *
 * Cart (v2, `buildCatalogue` with `cart: true`): the file carries ONE small inline script that lets a
 * buyer tick items and quantities and builds a SINGLE WhatsApp order message. Why a script is safe
 * here: the file pins a Content-Security-Policy in a <meta> tag — `default-src 'none'`, images only
 * from `data:`, and the one inline <style> and the one inline <script> allowed by their SHA-256
 * hashes (no `unsafe-inline`, no network, no forms, no base URI). Nothing typed into the page can add
 * code: the item data travels as a JSON data block (not executed; `<` escaped) and the script writes
 * only `textContent`. Without JavaScript (or with the script blocked) the page still works: every
 * item and every category keeps its plain order link (script-free fallback).
 */
import type { InvoiceItem } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { escHtml as esc } from './html-esc';

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
  /** v2: item id → photo data URI (raster data URIs only; anything else is ignored). */
  images?: Map<string, string>;
  /** v2: item id → category name (stock group). Items without one go under "Other items". */
  categories?: Map<string, string>;
  /** v2: item id → offer badge text (e.g. "Buy 2 get 1"). */
  offers?: Map<string, string>;
  /**
   * PENDING 52 (8.130): prices in a foreign currency — ISO code and the typed rate (₹ per unit, no live rates). Every
   * price, MRP and the cart (message and total) show in that currency; absent / INR = rupees as before.
   */
  currency?: { code: string; rate: number };
}

export interface CataloguePolicy {
  /** `'sha256-…'` source for the inline <style>. */
  style: string;
  /** `'sha256-…'` source for the inline cart <script>. */
  script: string;
}

const inr = (n: number) => `₹${round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Money in the catalogue's currency ('' / INR = rupees; else "USD 12.50"). The inline script formats the same way. */
export const catalogueMoney = (n: number, code = ''): string => (code && code !== 'INR' ? `${code} ${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : inr(n));

/** The foreign currency in force ('' = rupees): a valid three-letter code other than INR and a rate above zero. */
export function catalogueCurrency(c: CatalogueOptions['currency']): { code: string; rate: number } {
  const code = String(c?.code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && code !== 'INR' && Number(c?.rate) > 0 ? { code, rate: Number(c!.rate) } : { code: '', rate: 1 };
}
const SAFE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const OTHER = 'Other items';

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

/** Whole-percent saving against MRP (0 when there is no MRP above the price). */
export function mrpSaving(price: number, mrp: number | undefined): number {
  const m = num(mrp);
  return m > price && price >= 0 ? Math.floor(((m - price) / m) * 100) : 0;
}

export interface CartLine {
  name: string;
  qty: number;
  price: number;
  unit?: string;
}

/**
 * The single WhatsApp order message the cart sends (the inline script builds exactly this text;
 * kept here so it is unit-tested). Quantities below 1 and non-numbers are dropped.
 */
export function cartMessage(business: string, lines: readonly CartLine[], opts: { withTax?: boolean; name?: string; currency?: string } = {}): string {
  const cur = opts.currency ?? '';
  const rows = lines.filter((l) => Number.isFinite(l.qty) && l.qty >= 1);
  const out = [`Order for ${business || 'your shop'}`, ''];
  let total = 0;
  rows.forEach((l, i) => {
    const amount = round2(l.qty * l.price);
    total += amount;
    out.push(`${i + 1}. ${l.name} × ${l.qty}${l.unit ? ` ${l.unit}` : ''} @ ${catalogueMoney(l.price, cur)} = ${catalogueMoney(amount, cur)}`);
  });
  out.push('', `Total: ${catalogueMoney(total, cur)}${opts.withTax === false ? ' + GST' : ''}`);
  if (opts.name?.trim()) out.push(`Name: ${opts.name.trim()}`);
  return out.join('\n');
}

function orderHref(wa: string, email: string | undefined, text: string): string {
  if (wa) return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
  if (email) return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(text.split('\n')[0])}&body=${encodeURIComponent(text)}`;
  return '';
}

/** JSON for a <script type="application/json"> data block: cannot close the tag or break lines. */
function jsonBlock(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/* The one stylesheet (constant, so its CSP hash is constant). */
const STYLE = `
:root { color-scheme: light dark; --fg: #1d2433; --muted: #5d6779; --bg: #f7f8fa; --card: #ffffff; --line: #dde1e8; --accent: #1f4fd1; --ok: #1d7a3e; --badge: #b4530a; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8ebf1; --muted: #a3acbc; --bg: #12151c; --card: #1b2029; --line: #2c3340; --accent: #7aa2ff; --ok: #6fd393; --badge: #f5a65b; } }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 "Chartist Sans Flex", system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); }
header, footer, nav, section { padding: 0 16px; max-width: 1100px; margin: 0 auto; }
header, footer { padding-top: 20px; padding-bottom: 20px; }
header h1 { margin: 0 0 4px; font-size: 24px; }
header p, footer p { margin: 0; color: var(--muted); }
nav { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; }
nav a { padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--fg); text-decoration: none; font-size: 13px; }
section h2 { font-size: 18px; margin: 18px 0 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.catorder { font-size: 13px; font-weight: 400; color: var(--accent); }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.item { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 6px; }
.item img { width: 100%; height: 160px; object-fit: cover; border-radius: 8px; background: var(--line); }
.item h3 { font-size: 16px; margin: 0; }
.badges { display: flex; flex-wrap: wrap; gap: 4px; }
.badge { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; color: var(--badge); border: 1px solid var(--badge); }
.desc, .meta { margin: 0; color: var(--muted); font-size: 13px; }
.price { margin: 0; font-weight: 600; font-size: 17px; }
.price s, .price span { font-weight: 400; font-size: 12px; color: var(--muted); }
.in, .out { margin: 0; font-size: 12px; }
.in { color: var(--ok); }
.out { color: var(--muted); }
.actions { margin-top: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.order, .add, .send { padding: 6px 14px; border-radius: 999px; border: 0; background: var(--accent); color: #fff; text-decoration: none; font: inherit; font-weight: 600; cursor: pointer; }
.add { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
.qty { width: 56px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--fg); font: inherit; }
#cart { position: sticky; bottom: 0; margin: 16px auto 0; max-width: 1100px; padding: 12px 16px; background: var(--card); border-top: 1px solid var(--line); box-shadow: 0 -4px 16px rgba(0,0,0,.08); }
#cart h2 { margin: 0 0 6px; font-size: 16px; }
#cart ol { margin: 0 0 6px; padding-left: 20px; max-height: 30vh; overflow: auto; }
#cart p { margin: 0 0 8px; font-weight: 600; }
#cart input { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); font: inherit; margin-right: 8px; }
[hidden] { display: none !important; }
@media print { .order, .add, .qty, #cart, nav { display: none !important; } body { background: #fff; color: #000; } }
`;

/*
 * The one script (constant, so its CSP hash is constant). It reads the JSON data block, reveals the
 * "Add" buttons, keeps a cart and builds ONE order message — the same text as cartMessage().
 * Only textContent / href are written; nothing is fetched or stored.
 */
const SCRIPT = `(function () {
  var data = JSON.parse(document.getElementById('cat-data').textContent);
  var cart = {};
  var cur = data.cur || '';
  var inr = function (n) { var s = (Math.round(n * 100) / 100).toLocaleString(cur ? 'en-US' : 'en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return cur ? cur + ' ' + s : '\\u20b9' + s; };
  var box = document.getElementById('cart');
  var list = document.getElementById('cart-lines');
  var total = document.getElementById('cart-total');
  var send = document.getElementById('cart-send');
  var who = document.getElementById('cart-name');
  function message() {
    var out = ['Order for ' + (data.business || 'your shop'), ''];
    var sum = 0, i = 0;
    Object.keys(cart).forEach(function (id) {
      var it = data.items[id], q = cart[id];
      if (!it || !(q >= 1)) return;
      var amount = Math.round(q * it.p * 100) / 100;
      sum += amount; i += 1;
      out.push(i + '. ' + it.n + ' \\u00d7 ' + q + (it.u ? ' ' + it.u : '') + ' @ ' + inr(it.p) + ' = ' + inr(amount));
    });
    out.push('', 'Total: ' + inr(sum) + (data.withTax ? '' : ' + GST'));
    if (who.value.trim()) out.push('Name: ' + who.value.trim());
    return { text: out.join('\\n'), sum: sum, count: i };
  }
  function render() {
    while (list.firstChild) list.removeChild(list.firstChild);
    Object.keys(cart).forEach(function (id) {
      var it = data.items[id];
      if (!it || !(cart[id] >= 1)) return;
      var li = document.createElement('li');
      li.textContent = it.n + ' \\u00d7 ' + cart[id] + ' = ' + inr(cart[id] * it.p);
      list.appendChild(li);
    });
    var m = message();
    total.textContent = 'Total: ' + inr(m.sum);
    box.hidden = m.count === 0;
    send.href = data.wa ? 'https://wa.me/' + data.wa + '?text=' + encodeURIComponent(m.text)
      : data.email ? 'mailto:' + encodeURIComponent(data.email) + '?subject=' + encodeURIComponent('Order') + '&body=' + encodeURIComponent(m.text) : '#';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-add]'), function (btn) {
    var id = btn.getAttribute('data-add');
    var qty = document.querySelector('[data-qty="' + id + '"]');
    btn.hidden = false;
    if (qty) qty.hidden = false;
    btn.addEventListener('click', function () {
      var q = qty ? Math.floor(Number(qty.value)) : 1;
      if (!(q >= 1)) q = 1;
      cart[id] = (cart[id] || 0) + q;
      render();
    });
  });
  document.getElementById('cart-clear').addEventListener('click', function () { cart = {}; render(); });
  who.addEventListener('input', render);
})();`;

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `'sha256-${btoa(bin)}'`;
}

/** The CSP hash sources of the inline style and script (computed, never hand-maintained). */
export async function cataloguePolicy(): Promise<CataloguePolicy> {
  const [style, script] = await Promise.all([sha256(STYLE), sha256(SCRIPT)]);
  return { style, script };
}

interface BuildFlags {
  policy?: CataloguePolicy;
  cart?: boolean;
}

function render(items: readonly InvoiceItem[], opts: CatalogueOptions, flags: BuildFlags): string {
  const withTax = opts.priceWithTax !== false;
  const showPrices = opts.showPrices !== false;
  const cart = !!flags.cart && !!flags.policy && showPrices;
  const fx = catalogueCurrency(opts.currency);
  const priceOf = (i: InvoiceItem) => round2(cataloguePrice(i, withTax) / fx.rate);
  const money = (n: number) => catalogueMoney(n, fx.code);
  const wa = waNumber(opts.phone);
  const list = items
    .filter((i) => (i.name || '').trim())
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  const grouped = !!opts.categories?.size;
  const cats = new Map<string, InvoiceItem[]>();
  for (const i of list) {
    const c = (grouped && opts.categories?.get(i.id)?.trim()) || OTHER;
    cats.set(c, [...(cats.get(c) ?? []), i]);
  }
  const catNames = [...cats.keys()].sort((a, b) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));

  const card = (i: InvoiceItem) => {
    const price = priceOf(i);
    const mrp = round2(num(i.mrp) / fx.rate);
    const off = showPrices ? mrpSaving(price, mrp) : 0;
    const stock = opts.stock?.get(i.name.trim().toLowerCase());
    const img = opts.images?.get(i.id);
    const offer = opts.offers?.get(i.id)?.trim();
    const link = orderHref(wa, opts.email, `Order: ${i.name}${i.sku ? ` (${i.sku})` : ''}`);
    const badges = [off > 0 ? `<span class="badge">${off}% off MRP</span>` : '', offer ? `<span class="badge">${esc(offer)}</span>` : ''].filter(Boolean).join('');
    return `<li class="item">
${img && SAFE_IMAGE.test(img) ? `<img src="${esc(img)}" alt="${esc(i.name)}" loading="lazy">` : ''}
<h3>${esc(i.name)}</h3>
${badges ? `<p class="badges">${badges}</p>` : ''}
${i.description ? `<p class="desc">${esc(i.description)}</p>` : ''}
<p class="meta">${[i.hsn && `HSN ${esc(i.hsn)}`, i.unit && esc(i.unit), i.sku && `SKU ${esc(i.sku)}`].filter(Boolean).join(' · ')}</p>
${showPrices ? `<p class="price">${esc(money(price))}${mrp > price ? ` <s>MRP ${esc(money(mrp))}</s>` : ''} <span>${withTax && num(i.tax_rate) ? `incl. ${esc(num(i.tax_rate))}% GST` : withTax ? '' : '+ GST'}</span></p>` : ''}
${stock === undefined ? '' : `<p class="${stock > 0 ? 'in' : 'out'}">${stock > 0 ? 'In stock' : 'Out of stock'}</p>`}
<div class="actions">${cart && stock !== 0 ? `<input class="qty" type="number" min="1" value="1" aria-label="Quantity of ${esc(i.name)}" data-qty="${esc(i.id)}" hidden><button type="button" class="add" data-add="${esc(i.id)}" hidden>Add to cart</button>` : ''}${link ? `<a class="order" href="${esc(link)}" rel="noopener">Order</a>` : ''}</div>
</li>`;
  };

  // Script-free fallback: one link per category listing its items, for the buyer to fill in quantities.
  const catLink = (name: string, rows: InvoiceItem[]) => {
    const text = [`Order (${name}) from ${opts.business || 'your shop'}:`, ...rows.map((r) => `• ${r.name}${r.unit ? ` (${r.unit})` : ''} × `)].join('\n');
    const href = orderHref(wa, opts.email, text);
    return href ? ` <a class="catorder" href="${esc(href)}" rel="noopener">Order from this category</a>` : '';
  };

  const sections = grouped
    ? catNames
        .map((name, n) => `<section id="cat-${n}"><h2>${esc(name)}${catLink(name, cats.get(name)!)}</h2>\n<ul>\n${cats.get(name)!.map(card).join('\n')}\n</ul></section>`)
        .join('\n')
    : `<section><ul>\n${list.map(card).join('\n')}\n</ul></section>`;

  const policy = flags.policy
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${flags.policy.style}; script-src ${cart ? flags.policy.script : "'none'"}; form-action 'none'; base-uri 'none'">\n`
    : '';
  const data = cart
    ? {
        business: opts.business || '',
        wa,
        email: wa ? '' : opts.email || '',
        withTax,
        ...(fx.code ? { cur: fx.code } : {}),
        items: Object.fromEntries(list.map((i) => [i.id, { n: i.name, p: priceOf(i), u: i.unit || '' }])),
      }
    : null;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${policy}<title>${esc(opts.business || 'Catalogue')}: catalogue</title>
<style>${STYLE}</style></head><body>
<header>
<h1>${esc(opts.business || 'Catalogue')}</h1>
<p>${[opts.address, opts.phone && `Phone ${opts.phone}`, opts.email, opts.gstin && `GSTIN ${opts.gstin}`].filter(Boolean).map(esc).join(' · ')}</p>
</header>
${grouped && catNames.length > 1 ? `<nav aria-label="Categories">${catNames.map((c, n) => `<a href="#cat-${n}">${esc(c)}</a>`).join('')}</nav>\n` : ''}${sections}
${
  cart
    ? `<aside id="cart" hidden aria-label="Your order"><h2>Your order</h2><ol id="cart-lines"></ol><p id="cart-total"></p><input id="cart-name" placeholder="Your name" aria-label="Your name"><a id="cart-send" class="send" href="#" rel="noopener">Send order on WhatsApp</a> <button type="button" id="cart-clear" class="add">Clear</button></aside>
<script type="application/json" id="cat-data">${jsonBlock(data)}</script>
<script>${SCRIPT}</script>`
    : ''
}
<footer><p>${list.length} items · prices ${fx.code ? `in ${esc(fx.code)} at ₹${esc(fx.rate)} per ${esc(fx.code)}, ` : ''}${withTax ? 'include GST' : 'exclude GST'} and may change · generated
 ${esc(opts.generatedAt ?? new Date().toLocaleDateString('en-IN'))}</p></footer>
</body></html>`;
}

/** Script-free catalogue (no CSP meta): the original WP-9 export, now with photos / categories / badges when given. */
export function buildCatalogueHtml(items: readonly InvoiceItem[], opts: CatalogueOptions): string {
  return render(items, opts, {});
}

/**
 * Catalogue v2 with a pinned CSP. `cart: true` adds the one-message WhatsApp cart (inline script
 * allowed only by its hash); `cart: false` gives the script-free page under `script-src 'none'`.
 */
export async function buildCatalogue(items: readonly InvoiceItem[], opts: CatalogueOptions & { cart?: boolean }): Promise<string> {
  return render(items, opts, { policy: await cataloguePolicy(), cart: opts.cart !== false });
}

/** @internal for tests: the exact inline script and style the policy hashes. */
export const CATALOGUE_INLINE = { script: SCRIPT, style: STYLE };
