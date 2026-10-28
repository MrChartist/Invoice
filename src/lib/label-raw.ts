/**
 * Raw label-printer output (8.87): TSPL (TSC and most Indian thermal label printers), EPL2 and ZPL (Zebra)
 * for the thermal roll layouts in `label-sheet.ts`, plus weighed-goods EAN-13 codes with the price (or
 * weight) embedded (the "2x" in-store prefix range scales and POS scanners use).
 *
 * The commands are plain ASCII text sent to the printer over Web Serial (`sendToSerial` in escpos.ts,
 * feature-detected — WebUSB stays off per the security headers) or saved as a file for the printer's own
 * utility. 203 dpi (8 dots / mm). Pure.
 */

import type { LabelItem, LabelLayout } from './label-sheet';
import { ean13CheckDigit, isValidEan13 } from './barcode';
import { num } from './invoice-calc';

export type RawLanguage = 'tspl' | 'epl' | 'zpl';
export const RAW_LANGUAGES: readonly RawLanguage[] = ['tspl', 'epl', 'zpl'];

const DOTS_PER_MM = 8;
const dots = (mm: number) => Math.round(mm * DOTS_PER_MM);

/** Printers take ASCII: ₹ → "Rs.", other non-ASCII → "?"; command delimiters removed. */
export function rawText(s: string, max = 40): string {
  return String(s ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '?').replace(/["\\^~]/g, "'").slice(0, max);
}

const money = (n: number) => `Rs.${num(n).toFixed(2)}`;

function priceText(it: LabelItem): string {
  const parts: string[] = [];
  if (num(it.mrp) > 0) parts.push(`MRP ${money(num(it.mrp))}`);
  if (num(it.rate) > 0) parts.push(money(num(it.rate)));
  return parts.join(' ');
}

/** Labels repeated by copies, grouped into printed rows of `cols`. */
function rows(items: readonly LabelItem[], cols: number): LabelItem[][] {
  const flat: LabelItem[] = [];
  for (const it of items) for (let i = 0; i < Math.max(0, Math.floor(num(it.copies))); i++) flat.push(it);
  const out: LabelItem[][] = [];
  for (let i = 0; i < flat.length; i += cols) out.push(flat.slice(i, i + cols));
  return out;
}

/** Commands for the labels on a roll layout. Lines end with CRLF (what the printers expect). */
export function rawLabels(items: readonly LabelItem[], layout: LabelLayout, lang: RawLanguage): string {
  const W = dots(layout.cols * layout.width + (layout.cols - 1) * layout.gapX);
  const H = dots(layout.height);
  const lw = dots(layout.width);
  const pitch = dots(layout.width + layout.gapX);
  const big = layout.height >= 40;
  const barH = dots(big ? 18 : 9);
  const out: string[] = [];
  if (lang === 'tspl') {
    out.push(`SIZE ${layout.cols * layout.width + (layout.cols - 1) * layout.gapX} mm,${layout.height} mm`, 'GAP 2 mm,0 mm', 'DIRECTION 1', 'CODEPAGE 1252');
  }
  for (const row of rows(items, layout.cols)) {
    if (lang === 'tspl') out.push('CLS');
    if (lang === 'epl') out.push('N', `q${W}`, `Q${H},16`);
    if (lang === 'zpl') out.push('^XA', `^PW${W}`, `^LL${H}`, '^CI0');
    row.forEach((it, i) => {
      const x = i * pitch + 8;
      const name = rawText(it.name, Math.floor(lw / 12));
      const sub = rawText([it.note, priceText(it)].filter(Boolean).join(' '), Math.floor(lw / 10));
      const ean = isValidEan13(it.code.trim());
      const code = rawText(it.code.trim(), 48);
      if (lang === 'tspl') {
        out.push(`TEXT ${x},8,"2",0,1,1,"${name}"`);
        if (sub) out.push(`TEXT ${x},34,"1",0,1,1,"${sub}"`);
        out.push(`BARCODE ${x},${sub ? 56 : 40},"${ean ? 'EAN13' : '128'}",${barH},1,0,2,2,"${ean ? code.slice(0, 12) : code}"`);
      } else if (lang === 'epl') {
        out.push(`A${x},8,0,2,1,1,N,"${name}"`);
        if (sub) out.push(`A${x},34,0,1,1,1,N,"${sub}"`);
        out.push(`B${x},${sub ? 56 : 40},0,${ean ? 'E30' : '1'},2,4,${barH},B,"${ean ? code.slice(0, 12) : code}"`);
      } else {
        out.push(`^FO${x},8^A0N,22,22^FD${name}^FS`);
        if (sub) out.push(`^FO${x},34^A0N,18,18^FD${sub}^FS`);
        out.push(ean ? `^FO${x},${sub ? 56 : 40}^BY2^BEN,${barH},Y,N^FD${code.slice(0, 12)}^FS` : `^FO${x},${sub ? 56 : 40}^BY2^BCN,${barH},Y,N,N^FD${code}^FS`);
      }
    });
    if (lang === 'tspl') out.push('PRINT 1,1');
    if (lang === 'epl') out.push('P1');
    if (lang === 'zpl') out.push('^PQ1', '^XZ');
  }
  return out.length ? `${out.join('\r\n')}\r\n` : '';
}

export const rawBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

/* ── Weighed goods (price / weight embedded EAN-13) ── */

export type WeighedMode = 'price' | 'weight';
/** In-store prefixes: 22 = price embedded (paise), 21 = weight embedded (grams). */
const PREFIX: Record<WeighedMode, string> = { price: '22', weight: '21' };

/**
 * EAN-13 for a weighed pack: prefix (2) + PLU (5) + value (5) + check digit. Price mode: value = paise
 * (≤ ₹999.99); weight mode: grams (≤ 99.999 kg). Throws on a PLU outside 1–99999 or a value that does not fit.
 */
export function weighedEan(plu: number, value: number, mode: WeighedMode = 'price'): string {
  const p = Math.round(num(plu));
  if (p < 1 || p > 99999) throw new Error('The item code (PLU) must be 1 to 99999.');
  const v = Math.round(num(value) * (mode === 'price' ? 100 : 1000));
  if (v < 0 || v > 99999) throw new Error(mode === 'price' ? 'A weighed-goods label holds up to ₹999.99.' : 'A weighed-goods label holds up to 99.999 kg.');
  const first12 = `${PREFIX[mode]}${String(p).padStart(5, '0')}${String(v).padStart(5, '0')}`;
  return first12 + ean13CheckDigit(first12);
}

/** Read a weighed-goods code back (null when it is not one): PLU and the rupee price or kg weight. */
export function parseWeighedEan(code: string): { plu: number; mode: WeighedMode; value: number } | null {
  const c = code.trim();
  if (!isValidEan13(c)) return null;
  const mode: WeighedMode | null = c.startsWith('22') ? 'price' : c.startsWith('21') ? 'weight' : null;
  if (!mode) return null;
  const v = Number(c.slice(7, 12));
  return { plu: Number(c.slice(2, 7)), mode, value: mode === 'price' ? v / 100 : v / 1000 };
}

/** A weighed-goods label: price = weight × rate per kg (rounded to paise). */
export function weighedLabel(input: { name: string; plu: number; weightKg: number; ratePerKg: number; copies?: number }): LabelItem {
  const price = Math.round(num(input.weightKg) * num(input.ratePerKg) * 100) / 100;
  return {
    name: input.name,
    code: weighedEan(input.plu, price, 'price'),
    rate: price,
    copies: Math.max(1, Math.floor(num(input.copies) || 1)),
    note: `${num(input.weightKg).toFixed(3)} kg @ ${money(num(input.ratePerKg))}/kg`,
  };
}
