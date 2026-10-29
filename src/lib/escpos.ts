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
 *  - `bluetooth` (8.26) — the same ESC/POS bytes to a Bluetooth Low Energy 58 / 80 mm printer through
 *    Web Bluetooth (`navigator.bluetooth`, Chrome on Android / desktop; feature-detected), only after the
 *    user picks the printer in the browser's own chooser. The known printer services are tried in turn
 *    and the first writable characteristic gets the bytes in {@link BLE_CHUNK}-byte writes. The chosen
 *    printer is remembered for the tab; after a reload the browser asks once more. Classic (SPP-only)
 *    Bluetooth printers are not reachable from a browser: pair them with the OS and use `browser`.
 *
 * PENDING 46 (7.158): optional UPI QR for the amount due (`GS ( k`, QR model 2) and a logo raster (`GS v 0`, the
 * sender logo turned to black / white dots by the canvas in `pos-raw-print.ts`) in the serial / Bluetooth modes —
 * both standard Epson ESC/POS commands, off by default per device. ₹ stays "Rs.": ESC/POS code pages differ by
 * printer model and the common ones (PC437 / PC850 / PC858 …) have no rupee sign.
 *
 * Pure above "Device".
 */

import type { SenderProfile, InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export type PrinterMode = 'browser' | 'raw' | 'serial' | 'bluetooth';
export type ReceiptWidth = 58 | 80;

export interface PrinterPrefs {
  mode: PrinterMode;
  width: ReceiptWidth;
  /** Send the drawer kick on cash bills (serial / Bluetooth modes). */
  drawer: boolean;
  baud: number;
  /** PENDING 46: UPI QR for the amount due / the sender logo as a raster (serial / Bluetooth modes). */
  qr?: boolean;
  logo?: boolean;
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
  if (sender.pharmacist) for (const l of wrap(`Pharmacist: ${sender.pharmacist}`, cols)) L.push(center(l, cols)); // R9 (RT-B2)
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

/** Black / white dots of an image, row-major, 1 = black. */
export interface MonoImage {
  width: number;
  height: number;
  dots: Uint8Array;
}

/** RGBA pixels → dots: luminance below `threshold` is black; transparent pixels are paper. */
export function toMono(rgba: ArrayLike<number>, width: number, height: number, threshold = 128): MonoImage {
  const dots = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
    dots[i] = lum < threshold ? 1 : 0;
  }
  return { width, height, dots };
}

/** `GS v 0` raster bit image, centred (8 dots per byte, leftmost dot in the high bit). */
export function rasterBytes(img: MonoImage): number[] {
  const bpr = Math.ceil(img.width / 8);
  const out = [ESC, 0x61, 0x01, GS, 0x76, 0x30, 0x00, bpr & 0xff, bpr >> 8, img.height & 0xff, img.height >> 8];
  for (let y = 0; y < img.height; y++) {
    for (let b = 0; b < bpr; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit;
        if (x < img.width && img.dots[y * img.width + x]) byte |= 0x80 >> bit;
      }
      out.push(byte);
    }
  }
  out.push(0x0a, ESC, 0x61, 0x00);
  return out;
}

/** `GS ( k` QR code, model 2, error correction M, centred. ASCII data up to 700 bytes; [] otherwise. */
export function qrBytes(data: string, moduleSize = 6): number[] {
  const bytes = Array.from(String(data ?? '')).map((c) => c.charCodeAt(0));
  if (!bytes.length || bytes.length > 700 || bytes.some((b) => b < 0x20 || b > 0x7e)) return [];
  const len = bytes.length + 3;
  return [
    ESC, 0x61, 0x01,
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // fn 165: model 2
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.min(Math.max(Math.round(moduleSize), 1), 16), // fn 167: module size
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // fn 169: error correction M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes, // fn 180: store the data
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // fn 181: print
    0x0a, ESC, 0x61, 0x00,
  ];
}

/** ESC/POS bytes: initialise, optional logo, the lines, optional QR, feed, partial cut, optional drawer kick. */
export function escposBytes(lines: readonly string[], opts: { drawer?: boolean; cut?: boolean; logo?: MonoImage | null; qr?: string | null } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40];
  if (opts.logo && opts.logo.width > 0 && opts.logo.height > 0) out.push(...rasterBytes(opts.logo));
  for (const line of lines) {
    for (const ch of asciiOnly(line)) out.push(ch.charCodeAt(0));
    out.push(0x0a);
  }
  if (opts.qr) out.push(...qrBytes(opts.qr));
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
<style>@page{size:${width}mm auto;margin:2mm}html,body{margin:0;background:#fff;color:#000}pre{font:${fontPx}px/1.25 monospace;margin:0;white-space:pre}</style></head>
<body><pre>${esc(lines.join('\n'))}</pre></body></html>`;
}

/* ── Device (browser only) ─────────────────────────────────────── */

export function loadPrinterPrefs(): PrinterPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_PRINTER_KEY) ?? 'null') as Partial<PrinterPrefs> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PRINTER };
    return {
      mode: raw.mode === 'raw' || raw.mode === 'serial' || raw.mode === 'bluetooth' ? raw.mode : 'browser',
      width: raw.width === 58 ? 58 : 80,
      drawer: raw.drawer === true,
      baud: [9600, 19200, 38400, 57600, 115200].includes(Number(raw.baud)) ? Number(raw.baud) : 9600,
      ...(raw.qr === true ? { qr: true } : {}),
      ...(raw.logo === true ? { logo: true } : {}),
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

/* ── Web Bluetooth (8.26) ───────────────────────────────────────── */

/**
 * GATT services of common BLE receipt printers (and their usual write characteristic): the 0x18F0
 * "printer" service (0x2AF1), ISSC transparent UART (49535343-…, 49535343-8841-…), 0xFF00 (0xFF02),
 * 0xFFE0 (0xFFE1) and the e7810a71-… service used by many 58 mm units (bef8d6c9-…).
 */
export const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
] as const;

/** Bytes per GATT write: under the 185-byte MTU most printers negotiate, and far under Chrome's 512 cap. */
export const BLE_CHUNK = 180;

/** Split bytes into writes of at most `size`. */
export function chunkBytes(bytes: Uint8Array, size = BLE_CHUNK): Uint8Array[] {
  const step = Math.max(1, Math.floor(size));
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += step) out.push(bytes.subarray(i, i + step));
  return out;
}

interface BleCharacteristic {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValueWithResponse?(v: BufferSource): Promise<void>;
  writeValueWithoutResponse?(v: BufferSource): Promise<void>;
  writeValue?(v: BufferSource): Promise<void>;
}
interface BleService { getCharacteristics(): Promise<BleCharacteristic[]> }
interface BleServer { connected: boolean; getPrimaryService(uuid: string): Promise<BleService>; disconnect(): void }
interface BleDevice { name?: string; gatt?: { connected: boolean; connect(): Promise<BleServer>; disconnect(): void } }
interface BluetoothLike {
  requestDevice(o: { acceptAllDevices: true; optionalServices: string[] }): Promise<BleDevice>;
  getAvailability?(): Promise<boolean>;
}

const bluetoothApi = (): BluetoothLike | null => {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { bluetooth?: BluetoothLike }) | undefined;
  return nav?.bluetooth && typeof nav.bluetooth.requestDevice === 'function' ? nav.bluetooth : null;
};

/** True when the browser offers Web Bluetooth (Chrome / Edge on Android, ChromeOS, desktop; secure page). */
export const bluetoothSupported = (): boolean => !!bluetoothApi();

let blePrinter: BleDevice | null = null;

/** Ask the user to pick the BLE printer (must run from a click). Returns its name, or null. */
export async function chooseBluetoothPrinter(): Promise<string | null> {
  const api = bluetoothApi();
  if (!api) return null;
  blePrinter = await api.requestDevice({ acceptAllDevices: true, optionalServices: [...BLE_PRINTER_SERVICES] });
  return blePrinter.name || 'Bluetooth printer';
}

/** First writable characteristic among the known printer services. */
async function writableCharacteristic(server: BleServer): Promise<BleCharacteristic> {
  for (const uuid of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(uuid);
      const ch = (await service.getCharacteristics()).find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (ch) return ch;
    } catch {
      /* this printer does not offer that service */
    }
  }
  throw new Error('This Bluetooth device is not a supported receipt printer.');
}

/** Send bytes to the chosen BLE printer (asks for one when none was chosen in this tab). */
export async function sendToBluetooth(bytes: Uint8Array): Promise<void> {
  const api = bluetoothApi();
  if (!api) throw new Error('This browser has no Web Bluetooth: use the browser print mode.');
  if (!blePrinter?.gatt) blePrinter = await api.requestDevice({ acceptAllDevices: true, optionalServices: [...BLE_PRINTER_SERVICES] });
  const gatt = blePrinter.gatt;
  if (!gatt) throw new Error('This Bluetooth device cannot be connected.');
  const server = await gatt.connect();
  try {
    const ch = await writableCharacteristic(server);
    for (const part of chunkBytes(bytes)) {
      const copy = part.slice(); // a fresh ArrayBuffer per write
      if (ch.properties.write && ch.writeValueWithResponse) await ch.writeValueWithResponse(copy);
      else if (ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(copy);
      else if (ch.writeValue) await ch.writeValue(copy);
      else throw new Error('The printer refused the data.');
    }
  } finally {
    gatt.disconnect();
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

/* ── R3-A: kitchen tickets ─────────────────────────────────────── */

/** ESC/POS bytes for a short ticket (KOT): every line cut to the roll's columns, then fed and cut. */
export function ticketBytes(lines: readonly string[], width: ReceiptWidth): Uint8Array {
  const cols = columnsFor(width);
  return escposBytes(lines.flatMap((l) => (l.length > cols ? wrap(l, cols) : [l])));
}
