/**
 * Raw thermal receipts and the cash drawer (7U, roadmap 7.43 — ESC/POS).
 *
 * Three ways to print a POS bill, chosen per device (`mrchartist_pos_printer` in localStorage — a
 * device-local preference like the report options, never backed up or synced). Default: `browser`.
 *  - `browser` — the existing 80 mm receipt layout through the browser print dialog. A cash drawer
 *    wired to the printer opens only if the printer DRIVER is set to "open drawer" on print — the
 *    browser cannot send the kick itself.
 *  - `raw` — a plain-text receipt at 32 columns (58 mm) or 48 columns (80 mm), monospaced, printed
 *    from its own script-free window (`rawReceiptHtml`); the same lines feed ESC/POS.
 *  - `serial` — ESC/POS bytes sent to a USB / serial receipt printer through the Web Serial API, only
 *    after the user picks the port in the browser's own chooser (`navigator.serial`, Chrome / Edge on
 *    desktop; feature-detected). With "kick the drawer" on, a cash bill sends `ESC p 0 25 250`.
 *    No network, no driver, nothing leaves the device.
 *
 * Pure above "Device".
 */

import type { SenderProfile, InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export type PrinterMode = 'browser' | 'raw' | 'serial';
export type ReceiptWidth = 58 | 80;

export interface PrinterPrefs {
  mode: PrinterMode;
  width: ReceiptWidth;
  /** Send the drawer kick on cash bills (serial mode only). */
  drawer: boolean;
  baud: number;
}

export const POS_PRINTER_KEY = 'mrchartist_pos_printer';
export const DEFAULT_PRINTER: PrinterPrefs = { mode: 'browser', width: 80, drawer: false, baud: 9600 };

export const columnsFor = (width: ReceiptWidth): number => (width === 58 ? 32 : 48);

/** Thermal printers print ASCII: ₹ → "Rs.", other non-ASCII → "?". */
export function asciiOnly(s: string): string {
  return String(s ?? '').replace(/₹/g, 'Rs.').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E]/g, '?');
}

const amt = (n: number) => round2(num(n)).toFixed(2);

/** Text left, value right, in `cols` columns (the left side is cut to fit). */
export function lr(left: string, right: string, cols: number): string {
  const r = asciiOnly(right);
  const l = asciiOnly(left).slice(0, Math.max(cols - r.length - 1, 1));
  return l + ' '.repeat(Math.max(cols - l.length - r.length, 1)) + r;
}

export function center(text: string, cols: number): string {
  const t = asciiOnly(text).slice(0, cols);
  return ' '.repeat(Math.floor((cols - t.length) / 2)) + t;
}

/** Word-wrap to `cols`. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of asciiOnly(text).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > cols) {
        out.push(line.slice(0, cols));
        line = line.slice(cols);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

const TITLES: Record<string, string> = { INVOICE: 'INVOICE', TAX_INVOICE: 'TAX INVOICE', BILL_OF_SUPPLY: 'BILL OF SUPPLY', CREDIT_NOTE: 'CREDIT NOTE' };

/** The receipt as text lines (bill's own sender snapshot first — Critical Rule 3). */
export function receiptLines(rec: InvoiceRecord, sender: Partial<SenderProfile>, width: ReceiptWidth): string[] {
  const cols = columnsFor(width);
  const rule = '-'.repeat(cols);
  const L: string[] = [];
  for (const l of wrap(sender.companyName || 'Your business', cols)) L.push(center(l, cols));
  for (const l of wrap(sender.companyAddress ?? '', cols)) L.push(center(l, cols));
  if (sender.companyPhone) L.push(center(`Ph: ${sender.companyPhone}`, cols));
  if (sender.companyGstin) L.push(center(`GSTIN: ${sender.companyGstin}`, cols));
  if (sender.drug_licence) for (const l of wrap(`DL No.: ${sender.drug_licence}`, cols)) L.push(center(l, cols));
  L.push(rule);
  L.push(center(TITLES[rec.doc_type] ?? 'BILL', cols));
  L.push(lr(`No: ${rec.invoice_number || 'DRAFT'}`, rec.issue_date.split('-').reverse().join('-'), cols));
  const party = rec.client?.name?.trim();
  if (party && party.toLowerCase() !== 'walk-in customer') L.push(...wrap(`To: ${party}`, cols));
  if (rec.rx?.patient) L.push(...wrap(`Patient: ${rec.rx.patient}`, cols));
  if (rec.rx?.prescriber) L.push(...wrap(`Dr.: ${rec.rx.prescriber}${rec.rx.prescriber_reg ? ` (${rec.rx.prescriber_reg})` : ''}`, cols));
  L.push(rule);
  for (const it of rec.items) {
    if (!it.name.trim()) continue;
    L.push(...wrap(it.name, cols));
    const qty = `${num(it.quantity)}${it.unit ? ` ${it.unit}` : ''} x ${amt(it.rate)}${num(it.discount_percent) > 0 ? ` -${num(it.discount_percent)}%` : ''}`;
    const value = round2(num(it.quantity) * num(it.rate) * (1 - num(it.discount_percent) / 100));
    L.push(lr(`  ${qty}`, num(it.rate) === 0 && it.free_of ? 'FREE' : amt(value), cols));
    if (it.batch_no) L.push(`  Batch ${asciiOnly(it.batch_no)}${it.batch_expiry ? ` Exp ${it.batch_expiry.slice(0, 7)}` : ''}`.slice(0, cols));
  }
  L.push(rule);
  L.push(lr('Subtotal', amt(rec.subtotal), cols));
  if (rec.offer && num(rec.offer.value) > 0) L.push(lr(rec.offer.label, `-${amt(rec.offer.value)}`, cols));
  const otherDisc = round2(num(rec.discount_amount) - num(rec.offer?.value));
  if (otherDisc > 0.004) L.push(lr('Discount', `-${amt(otherDisc)}`, cols));
  if (num(rec.cgst_amount) > 0) L.push(lr('CGST', amt(rec.cgst_amount), cols));
  if (num(rec.sgst_amount) > 0) L.push(lr('SGST', amt(rec.sgst_amount), cols));
  if (num(rec.igst_amount) > 0) L.push(lr('IGST', amt(rec.igst_amount), cols));
  if (num(rec.cess_amount) > 0) L.push(lr('Cess', amt(rec.cess_amount ?? 0), cols));
  if (num(rec.round_off) !== 0) L.push(lr('Round off', amt(rec.round_off), cols));
  L.push(lr('TOTAL', `Rs.${amt(rec.total)}`, cols));
  L.push(rule);
  L.push(center('Thank you!', cols));
  return L;
}

const ESC = 0x1b;
const GS = 0x1d;
/** ESC p m t1 t2 — pulse drawer pin 2 for 25×2 ms on, 250×2 ms off. */
export const DRAWER_KICK = [ESC, 0x70, 0x00, 0x19, 0xfa] as const;

/** ESC/POS bytes: initialise, the lines, feed, partial cut, optional drawer kick. */
export function escposBytes(lines: readonly string[], opts: { drawer?: boolean; cut?: boolean } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const line of lines) {
    for (const ch of asciiOnly(line)) out.push(ch.charCodeAt(0));
    out.push(0x0a);
  }
  out.push(ESC, 0x64, 0x04); // feed 4 lines
  if (opts.cut !== false) out.push(GS, 0x56, 0x42, 0x00); // partial cut with feed
  if (opts.drawer) out.push(...DRAWER_KICK);
  return Uint8Array.from(out);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Script-free printable page for the text receipt at the roll width. */
export function rawReceiptHtml(lines: readonly string[], width: ReceiptWidth, title = 'Receipt'): string {
  const fontPx = width === 58 ? 11 : 12;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>@page{size:${width}mm auto;margin:2mm}html,body{margin:0;background:#fff;color:#000}pre{font:${fontPx}px/1.25 ui-monospace,"Courier New",monospace;margin:0;white-space:pre}</style></head>
<body><pre>${esc(lines.join('\n'))}</pre></body></html>`;
}

/* ── Device (browser only) ─────────────────────────────────────── */

export function loadPrinterPrefs(): PrinterPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_PRINTER_KEY) ?? 'null') as Partial<PrinterPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PRINTER };
    return {
      mode: raw.mode === 'raw' || raw.mode === 'serial' ? raw.mode : 'browser',
      width: raw.width === 58 ? 58 : 80,
      drawer: raw.drawer === true,
      baud: [9600, 19200, 38400, 57600, 115200].includes(Number(raw.baud)) ? Number(raw.baud) : 9600,
    };
  } catch {
    return { ...DEFAULT_PRINTER };
  }
}

export function savePrinterPrefs(p: PrinterPrefs): void {
  try {
    localStorage.setItem(POS_PRINTER_KEY, JSON.stringify(p));
  } catch {
    /* private window: the preference is just not remembered */
  }
}

interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}

const serialApi = (): SerialLike | null => {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { serial?: SerialLike }) | undefined;
  return nav?.serial ?? null;
};

/** True when the browser offers Web Serial (Chrome / Edge desktop over HTTPS or localhost). */
export const serialSupported = (): boolean => !!serialApi();

/** Ask the user to pick the printer's port (must run from a click). */
export async function choosePort(): Promise<boolean> {
  const api = serialApi();
  if (!api) return false;
  await api.requestPort();
  return true;
}

/** Send bytes to the first port the user already granted (asks once when none). */
export async function sendToSerial(bytes: Uint8Array, baud: number): Promise<void> {
  const api = serialApi();
  if (!api) throw new Error('This browser has no Web Serial: use the browser print mode.');
  const port = (await api.getPorts())[0] ?? (await api.requestPort());
  await port.open({ baudRate: baud });
  try {
    const writer = port.writable?.getWriter();
    if (!writer) throw new Error('The printer port is not writable.');
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    await port.close();
  }
}

/** Open the text receipt in its own window and print it (false when pop-ups are blocked). */
export function printRawReceipt(lines: readonly string[], width: ReceiptWidth, title?: string): boolean {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(rawReceiptHtml(lines, width, title));
  w.document.close();
  w.focus();
  w.print();
  return true;
}
