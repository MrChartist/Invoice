/** Raw / ESC-POS printing of a saved POS bill (7U); kept out of the component file for fast refresh. */
import { escposBytes, loadPrinterPrefs, printRawReceipt, receiptLines, sendToSerial, type PrinterPrefs } from '../../lib/escpos';
import { blankProfile, localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { x7T } from '../../i18n/areas/extras-7u';

/** Print a saved bill the raw way (text window or ESC/POS); resolves when handed over. */
export async function printPosRaw(invoice: InvoiceRecord, prefs: PrinterPrefs = loadPrinterPrefs()): Promise<void> {
  // The bill's own sender snapshot first (Critical Rule 3).
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const lines = receiptLines(invoice, sender, prefs.width);
  if (prefs.mode === 'serial') {
    const cash = getTable<Payment>('transactions').some((p) => p.invoice_id === invoice.id && /cash/i.test(p.method));
    await sendToSerial(escposBytes(lines, { drawer: prefs.drawer && cash }), prefs.baud);
    return;
  }
  if (!printRawReceipt(lines, prefs.width, invoice.invoice_number)) throw new Error(x7T('popupBlocked'));
}
