/**
 * Printable barcode label sheets (roadmap 6.7): A4 grids of item labels with name, price and a
 * Code 128 / EAN-13 barcode drawn as inline SVG. The output is one script-free HTML document
 * (inline styles only), printed from its own window like receipts and cheques. Pure.
 */

import { barcodeSvg, pickSymbology } from './barcode';
import { formatCurrency } from './utils';
import { num } from './invoice-calc';
import { escHtml as esc } from './html-esc';

export interface LabelLayout {
  id: string;
  label: string;
  cols: number;
  rows: number;
  /** Label size and sheet geometry, in mm (A4 = 210 × 297). */
  width: number;
  height: number;
  top: number;
  left: number;
  gapX: number;
  gapY: number;
  /**
   * 8.87: a thermal ROLL (not an A4 sheet): every printed page is one row of `cols` labels, the page is
   * exactly the roll width × label height, so a label printer's driver feeds one row per page.
   */
  roll?: boolean;
}

/** Common A4 label stationery. */
export const LABEL_LAYOUTS: LabelLayout[] = [
  { id: 'a4-24', label: '24 per sheet (3 × 8, 70 × 37 mm)', cols: 3, rows: 8, width: 70, height: 37, top: 0.5, left: 0, gapX: 0, gapY: 0 },
  { id: 'a4-40', label: '40 per sheet (4 × 10, 52.5 × 29.7 mm)', cols: 4, rows: 10, width: 52.5, height: 29.7, top: 0, left: 0, gapX: 0, gapY: 0 },
  { id: 'a4-65', label: '65 per sheet (5 × 13, 38.1 × 21.2 mm)', cols: 5, rows: 13, width: 38.1, height: 21.2, top: 10.7, left: 4.65, gapX: 2.5, gapY: 0 },
  // 8.87 thermal label rolls (one row per page).
  { id: 'roll-50x25', label: 'Roll 50 × 25 mm (1 across)', cols: 1, rows: 1, width: 50, height: 25, top: 0, left: 0, gapX: 0, gapY: 0, roll: true },
  { id: 'roll-38x25-2', label: 'Roll 38 × 25 mm (2 across)', cols: 2, rows: 1, width: 38, height: 25, top: 0, left: 0, gapX: 2, gapY: 0, roll: true },
  { id: 'roll-100x50', label: 'Roll 100 × 50 mm (1 across)', cols: 1, rows: 1, width: 100, height: 50, top: 0, left: 0, gapX: 0, gapY: 0, roll: true },
  // R9 (RT-E1): jewellery tag roll (tag no. barcode, net weight, purity, HUID on the printable flap).
  { id: 'jewel-tag', label: 'Jewellery tag roll 60 × 15 mm', cols: 1, rows: 1, width: 60, height: 15, top: 0, left: 0, gapX: 0, gapY: 0, roll: true },
  // R10 (SV-B3): lab sample label roll (order no. barcode, patient, sample type).
  { id: 'lab-sample', label: 'Lab sample label roll 50 × 25 mm', cols: 1, rows: 1, width: 50, height: 25, top: 0, left: 0, gapX: 0, gapY: 0, roll: true },
  // R10 (SV-C2): member cards, credit-card size (member code as the barcode).
  { id: 'member-card', label: 'Member cards 85.6 × 54 mm (2 × 5)', cols: 2, rows: 5, width: 85.6, height: 54, top: 13.5, left: 17, gapX: 4, gapY: 0 },
];

/** Page size of a layout in mm: A4 for sheets; the roll width × label height for rolls. */
export function pageSize(l: LabelLayout): { width: number; height: number } {
  return l.roll ? { width: Math.round((l.cols * l.width + (l.cols - 1) * l.gapX + l.left) * 100) / 100, height: l.height } : { width: 210, height: 297 };
}

export const layoutById = (id: string): LabelLayout => LABEL_LAYOUTS.find((l) => l.id === id) ?? LABEL_LAYOUTS[0];

export interface LabelItem {
  name: string;
  code: string;
  /** Sale price; printed when `price` is 'sale' or 'both'. */
  rate?: number;
  mrp?: number;
  copies: number;
  /** 8.87: extra line under the name (weighed goods: "0.750 kg @ ₹120.00/kg"). */
  note?: string;
  /** R9 (RT-C2): variant attributes ("M / Blue"), printed under the name. */
  attrs?: string;
}

/** R9 (RT-C2): a variant child's attribute line ("M / Blue"), '' for other items. */
export const attrLine = (attrs: Record<string, string> | undefined): string => Object.values(attrs ?? {}).filter(Boolean).join(' / ');

export type PriceShown = 'sale' | 'mrp' | 'both' | 'none';

export interface LabelSheetOptions {
  layout: LabelLayout;
  price: PriceShown;
  /** Labels already used on the first sheet (start printing at this position). */
  skip?: number;
  business?: string;
  currency?: string;
}

/** Items that can be printed (a code the encoders accept), each repeated `copies` times. */
export function expandLabels(items: readonly LabelItem[]): { labels: LabelItem[]; skipped: string[] } {
  const labels: LabelItem[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    const copies = Math.max(0, Math.floor(num(it.copies)));
    if (copies === 0) continue;
    if (!it.code.trim() || !pickSymbology(it.code)) {
      skipped.push(it.name);
      continue;
    }
    for (let i = 0; i < copies; i++) labels.push(it);
  }
  return { labels, skipped };
}

/** Pages needed for `count` labels after skipping `skip` positions. */
export function sheetCount(layout: LabelLayout, count: number, skip = 0): number {
  const per = layout.cols * layout.rows;
  return count <= 0 ? 0 : Math.ceil((count + Math.min(Math.max(skip, 0), per - 1)) / per);
}


function priceLine(it: LabelItem, shown: PriceShown, currency: string, compact = false): string {
  const parts: string[] = [];
  if ((shown === 'mrp' || shown === 'both') && num(it.mrp) > 0) parts.push(`MRP ${formatCurrency(num(it.mrp), currency)}`);
  if ((shown === 'sale' || shown === 'both') && num(it.rate) > 0) parts.push(shown === 'both' && !compact ? `Our price ${formatCurrency(num(it.rate), currency)}` : formatCurrency(num(it.rate), currency));
  return parts.join(' · ');
}

/** The whole sheet set as a script-free HTML document. */
export function labelSheetHtml(items: readonly LabelItem[], opts: LabelSheetOptions): string {
  const { labels } = expandLabels(items);
  const L = opts.layout;
  const per = L.cols * L.rows;
  const skip = Math.min(Math.max(Math.floor(num(opts.skip)), 0), per - 1);
  const cells: (LabelItem | null)[] = [...Array<null>(skip).fill(null), ...labels];
  const pages: (LabelItem | null)[][] = [];
  for (let i = 0; i < cells.length; i += per) pages.push(cells.slice(i, i + per));
  const small = L.height < 25;
  const currency = opts.currency || 'INR';
  const barH = small ? 22 : 30;

  const label = (it: LabelItem | null) => {
    if (!it) return '<div class="cell"></div>';
    const price = priceLine(it, opts.price, currency, small);
    return `<div class="cell"><div class="name">${esc(it.name)}</div>${it.attrs ? `<div class="price">${esc(it.attrs)}</div>` : ''}${it.note ? `<div class="price">${esc(it.note)}</div>` : ''}${price ? `<div class="price">${esc(price)}</div>` : ''}<div class="bars">${barcodeSvg(it.code, { height: barH })}</div></div>`;
  };

  const page = pageSize(L);
  const css = `@page { size: ${L.roll ? `${page.width}mm ${page.height}mm` : 'A4'}; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: black; background: white; }
.sheet { width: ${page.width}mm; height: ${page.height}mm; padding: ${L.top}mm 0 0 ${L.left}mm; display: grid; grid-template-columns: repeat(${L.cols}, ${L.width}mm); grid-auto-rows: ${L.height}mm; column-gap: ${L.gapX}mm; row-gap: ${L.gapY}mm; page-break-after: always; break-after: page; overflow: hidden; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.cell { overflow: hidden; padding: ${small ? '0.8mm 1.2mm' : '1.5mm 2.5mm'}; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: ${small ? '0.2mm' : '0.6mm'}; }
.name { font-size: ${small ? 6.5 : 8.5}pt; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; width: 100%; }
.price { font-size: ${small ? 6.5 : 8}pt; font-weight: 700; }
.bars { width: 100%; flex: 1 1 auto; min-height: 0; display: flex; justify-content: center; }
.bars svg { height: 100%; max-width: 100%; }
@media screen { body { background: gainsboro; } .sheet { background: white; margin: 8mm auto; box-shadow: 0 1px 4px rgba(0,0,0,.25); } .cell { outline: 1px dashed silver; } }`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Barcode labels${opts.business ? ` · ${esc(opts.business)}` : ''}</title>
<style>${css}</style></head><body>
${pages.map((p) => `<section class="sheet">${p.map(label).join('')}</section>`).join('\n')}
</body></html>`;
}
