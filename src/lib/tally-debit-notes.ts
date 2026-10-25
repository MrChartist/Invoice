/**
 * Tally "Debit Note" vouchers for purchase returns / supplier credit notes (WP-3, P0-5). A fragment
 * for tally-xml.ts (owned by WP-7), which calls it with one line inside its purchases block; the
 * vouchers it returns are rendered by the same `voucherXml`.
 *
 *   Dr Supplier (Sundry Creditors)  — Agst Ref the bill number (New Ref the note number when on account)
 *   Cr Purchase Returns (Purchase Accounts) — taxable (+ GST when the bill's ITC was not claimed)
 *   Cr Input CGST / SGST / IGST     — ITC given back
 *   Dr GST payable on reverse charge / IGST payable on imports — self-assessed GST reversed
 *   ± Round Off
 *
 * Pure. Working papers — verify with your CA before importing into Tally.
 */

import type { PurchaseReturn } from '../types/purchases';
import { checkGstin } from './gstin';
import { num } from './invoice-calc';
import { inRange, stateNameOf, toPaise, type DateRange } from './export-shared';
import { isLiveNote, noteSelfTax } from './purchase-returns-gst';
import type { TallyEntry, TallyVoucher } from './tally-xml';

export const PURCHASE_RETURNS_LEDGER = 'Purchase Returns';

export interface DebitNoteLedgers {
  range: DateRange;
  roundOffLedger: string;
  inputCgst: string;
  inputSgst: string;
  inputIgst: string;
  rcmPayableLedger: string;
  customsIgstLedger: string;
}

type Duty = 'Central Tax' | 'State Tax' | 'Integrated Tax' | 'Cess';
type RegisterLedger = (def: { name: string; parent: string; gstin?: string; stateName?: string; billwise?: boolean; duty?: Duty }) => void;

function push(entries: TallyEntry[], ledger: string, side: 'Dr' | 'Cr', paise: number, bill?: TallyEntry['bill']) {
  if (paise <= 0) return;
  entries.push({ ledger, side, paise, ...(bill ? { bill } : {}) });
}

/** Debit Note vouchers for the notes dated in `o.range`; registers the ledgers they use. */
export function debitNoteVouchers(notes: readonly PurchaseReturn[] | undefined, o: DebitNoteLedgers, addLedger: RegisterLedger): TallyVoucher[] {
  const out: TallyVoucher[] = [];
  for (const n of notes ?? []) {
    if (!isLiveNote(n) || !inRange(n.date, o.range)) continue;
    const total = toPaise(num(n.total));
    const taxable = toPaise(num(n.taxable));
    const cgst = toPaise(num(n.cgst));
    const sgst = toPaise(num(n.sgst));
    const igst = toPaise(num(n.igst));
    const gst = cgst + sgst + igst;
    const self = noteSelfTax(n) > 0 ? gst : 0;
    const party = String(n.vendor_name ?? '').trim() || 'Unknown vendor';
    const gstin = String(n.vendor_gstin ?? '').trim().toUpperCase();
    const stateName = stateNameOf(checkGstin(gstin).stateCode ?? n.place_of_supply ?? '');
    const entries: TallyEntry[] = [];
    push(entries, party, 'Dr', total - self, n.purchase_id && n.bill_number ? { name: n.bill_number, type: 'Agst Ref' } : { name: n.note_number, type: 'New Ref' });
    push(entries, PURCHASE_RETURNS_LEDGER, 'Cr', n.itc_eligible ? taxable : taxable + gst);
    if (n.itc_eligible) {
      push(entries, o.inputCgst, 'Cr', cgst);
      push(entries, o.inputSgst, 'Cr', sgst);
      push(entries, o.inputIgst, 'Cr', igst);
    }
    const selfLedger = n.import_type === 'GOODS' ? o.customsIgstLedger : o.rcmPayableLedger;
    if (self) push(entries, selfLedger, 'Dr', self);
    const net = entries.reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0);
    if (net > 0) entries.push({ ledger: o.roundOffLedger, side: 'Dr', paise: net });
    else if (net < 0) entries.push({ ledger: o.roundOffLedger, side: 'Cr', paise: -net });

    addLedger({ name: party, parent: 'Sundry Creditors', billwise: true, gstin, stateName });
    addLedger({ name: PURCHASE_RETURNS_LEDGER, parent: 'Purchase Accounts' });
    addLedger({ name: o.roundOffLedger, parent: 'Indirect Expenses' });
    addLedger({ name: o.inputCgst, parent: 'Duties & Taxes', duty: 'Central Tax' });
    addLedger({ name: o.inputSgst, parent: 'Duties & Taxes', duty: 'State Tax' });
    addLedger({ name: o.inputIgst, parent: 'Duties & Taxes', duty: 'Integrated Tax' });
    if (self) addLedger({ name: selfLedger, parent: 'Duties & Taxes' });
    out.push({
      type: 'Debit Note',
      date: n.date,
      number: n.note_number,
      party,
      partyGstin: gstin,
      stateName,
      narration: [
        n.kind === 'SUPPLIER_CN' ? `Supplier credit note ${n.supplier_note_number ?? ''} ${n.supplier_note_date ?? ''}`.trim() : 'Purchase return / debit note',
        n.bill_number && `Original invoice ${n.bill_number}${n.bill_date ? ` dated ${n.bill_date}` : ''}`,
        n.notes,
      ].filter(Boolean).join(' | '),
      reference: n.supplier_note_number || n.bill_number || '',
      entries,
      inventory: [],
      inventoryLedger: '',
    });
  }
  return out;
}
