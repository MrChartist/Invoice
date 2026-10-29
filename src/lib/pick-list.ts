/**
 * Pick list (8.86): the lines of one or more sales orders / delivery challans / invoices to collect from
 * the godown, merged per item + batch and sorted by bin so the picker walks the racks once. A script-free
 * HTML document printed from its own window (like label sheets). Pure.
 */

import type { InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { binForName } from './bins';
import { lineFactor } from './units';
import { escHtml as esc } from './html-esc';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

interface BinItem { name: string; aliases?: string[]; location?: string; batch_bins?: Record<string, string>; unit?: string }

export interface PickRow {
  bin: string;
  item: string;
  batch: string;
  /** Quantity in the item's base unit. */
  qty: number;
  unit: string;
  /** Document numbers the quantity comes from. */
  docs: string[];
}

/** Merge lines per item + batch, bin from the live master (a line's own snapshot when the master has none). */
export function pickRows(docs: readonly Pick<InvoiceRecord, 'invoice_number' | 'items'>[], items: readonly BinItem[]): PickRow[] {
  const map = new Map<string, PickRow>();
  for (const d of docs) {
    for (const l of d.items ?? []) {
      const q = num(l.quantity) * lineFactor(l);
      if (!l.name?.trim() || !(q > 0)) continue;
      const batch = l.batch_no?.trim() ?? '';
      const key = `${l.name.trim().toLowerCase()}|${batch.toUpperCase()}`;
      const bin = binForName(items, l.name, batch) || l.bin || '';
      const master = items.find((i) => i.name.trim().toLowerCase() === l.name.trim().toLowerCase());
      const row = map.get(key) ?? { bin, item: l.name.trim(), batch, qty: 0, unit: master?.unit || l.unit || '', docs: [] };
      row.qty = round2(row.qty + q);
      if (d.invoice_number && !row.docs.includes(d.invoice_number)) row.docs.push(d.invoice_number);
      map.set(key, row);
    }
  }
  // Rows without a bin last; bins in natural order (A2 before A10).
  return [...map.values()].sort((a, b) => (a.bin ? 0 : 1) - (b.bin ? 0 : 1) || a.bin.localeCompare(b.bin, undefined, { numeric: true }) || a.item.localeCompare(b.item));
}


export function pickListHtml(rows: readonly PickRow[], opts: { title?: string; business?: string; date?: string } = {}): string {
  const body = rows.map((r) => `<tr><td>${esc(r.bin || '—')}</td><td>${esc(r.item)}</td><td>${esc(r.batch)}</td><td class="n">${r.qty}</td><td>${esc(r.unit)}</td><td>${esc(r.docs.join(', '))}</td><td class="tick"></td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title || 'Pick list')}</title>
<style>${PRINT_FONT_FACE}body{font-family:${PRINT_FONT};color:black;background:white;margin:12mm}h1{font-size:14pt;margin:0 0 2mm}p{margin:0 0 4mm;font-size:9pt}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #999;padding:1.5mm 2mm;text-align:left}th{background:#eee}.n{text-align:right}.tick{width:12mm}</style></head><body>
<h1>${esc(opts.title || 'Pick list')}</h1><p>${esc([opts.business, opts.date].filter(Boolean).join(' · '))}</p>
<table><thead><tr><th>Bin / rack</th><th>Item</th><th>Batch</th><th class="n">Qty</th><th>Unit</th><th>Documents</th><th>✓</th></tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}
