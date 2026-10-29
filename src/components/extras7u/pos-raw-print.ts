/** Raw / ESC-POS printing of a saved POS bill (7U); kept out of the component file for fast refresh. */
import { escposBytes, loadPrinterPrefs, printRawReceipt, receiptLines, sendToBluetooth, sendToSerial, toMono, type MonoImage, type PrinterPrefs } from '../../lib/escpos';
import { blankProfile, localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { invoiceUpiLink } from '../../lib/share';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { x7T } from '../../i18n/areas/extras-7u';

/** PENDING 46: the logo as printer dots (≤ 256 dots wide on 58 mm, 384 on 80 mm; ≤ 160 high). Null when it cannot be drawn. */
async function logoDots(src: string | undefined, width: 58 | 80): Promise<MonoImage | null> {
  if (!src || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(src) || typeof document === 'undefined') return null;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, (width === 58 ? 256 : 384) / img.naturalWidth, 160 / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return toMono(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return null;
  }
}

/** Print a saved bill the raw way (text window or ESC/POS); resolves when handed over. */
export async function printPosRaw(invoice: InvoiceRecord, prefs: PrinterPrefs = loadPrinterPrefs()): Promise<void> {
  // The bill's own sender snapshot first (Critical Rule 3).
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const lines = receiptLines(invoice, sender, prefs.width);
  if (prefs.mode === 'serial' || prefs.mode === 'bluetooth') {
    const pays = getTable<Payment>('transactions').filter((p) => p.invoice_id === invoice.id);
    const cash = pays.some((p) => /cash/i.test(p.method));
    const due = Math.round((Number(invoice.total) - pays.reduce((s, p) => s + (Number(p.amount) || 0), 0)) * 100) / 100;
    const qr = prefs.qr && due > 0 ? invoiceUpiLink({ ...invoice, sender } as InvoiceRecord, due) : null;
    const logo = prefs.logo ? await logoDots(sender.logo, prefs.width) : null;
    const bytes = escposBytes(lines, { drawer: prefs.drawer && cash, qr, logo });
    if (prefs.mode === 'bluetooth') await sendToBluetooth(bytes); // 8.26
    else await sendToSerial(bytes, prefs.baud);
    return;
  }
  if (!printRawReceipt(lines, prefs.width, invoice.invoice_number)) throw new Error(x7T('popupBlocked'));
}
