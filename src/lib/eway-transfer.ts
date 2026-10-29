/**
 * e-Way bill JSON for a stock transfer between two places of business under the SAME GSTIN (R4-B4): a dispatch STR of
 * a transfer request, in the bulk-upload layout of `eway.ts` (version 1.0.0621), supply type Outward, sub-type 5
 * "For own use", document type CHL (delivery challan), from and to GSTIN both the business's own.
 *
 * - Values: quantity (base unit) × the item's cost per unit (the caller's `costOf`, normally the stock engine's average
 *   cost). No tax is charged on a same-GSTIN movement, so the tax values are nil; rates are shown for information.
 * - Whether an e-Way bill is needed for an intra-State movement below ₹50,000 depends on the State's notification.
 *   The layout is the portal's bulk format but NOT validated against the portal — verify with your CA before upload.
 *
 * Pure: the caller passes the transfer, items, the business profile and both addresses.
 */
import type { StockTransfer } from '../types/stock';
import type { StockItem } from './inventory';
import { num, round2 } from './invoice-calc';
import { lineFactor, type UnitMaster } from './units';
import { stateByCode } from './india-states';
import { extractPin, guessLocality, portalUqc, splitAddress, toNicDate } from './einvoice';
import { EWAY_THRESHOLD, EWAY_VERSION, ewayTransModeCode, normaliseVehicle, type EwayBill, type EwayItem, type EwayPayload, type EwayTransMode } from './eway';

/** Portal sub-supply type 5 = "For Own Use". */
export const EWAY_SUB_OWN_USE = 5;
export const TRANSFER_EWAY_CA_NOTE = 'e-Way bill JSON for a branch transfer under the same GSTIN (sub-type For own use, document CHL, value at cost): not validated against the portal; verify with your CA.';

export interface TransferEwayOptions {
  sender: { name: string; gstin?: string; stateCode?: string };
  /** Addresses of the dispatching and receiving premises (godown / branch address, else the business address). */
  fromAddress?: string;
  toAddress?: string;
  /** Receiving premises' state (default: the sender's). */
  toStateCode?: string;
  items: readonly StockItem[];
  costOf: (itemId: string) => number;
  units?: readonly UnitMaster[];
  mode?: EwayTransMode;
  vehicle?: string;
  transporterId?: string;
  transporterName?: string;
  distanceKm?: number;
  /** Challan number printed (default the STR number). */
  docNo?: string;
}

export interface TransferEwayBuild {
  payload: EwayPayload;
  bill: EwayBill;
  notes: string[];
  /** Above ₹50,000 (or inter-State): an e-Way bill is normally needed. */
  required: boolean;
}

const codeNum = (code?: string) => {
  const n = parseInt(code ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};
const pinOf = (v: unknown) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 6 ? Number(d) : 0;
};

export function buildEwayTransfer(t: Pick<StockTransfer, 'transfer_number' | 'date' | 'lines'>, opts: TransferEwayOptions): TransferEwayBuild {
  const notes: string[] = [];
  const byId = new Map(opts.items.map((i) => [i.id, i]));
  const gstin = (opts.sender.gstin ?? '').trim().toUpperCase();
  const fromState = stateByCode(opts.sender.stateCode)?.code ?? gstin.slice(0, 2);
  const toState = opts.toStateCode || fromState;
  if (!gstin) notes.push('Your GSTIN is missing in the business profile.');
  if (toState !== fromState) notes.push('The two premises are in different States: a branch in another State has its own GSTIN, raise a tax invoice (Sec 25(4)) instead.');
  const fromAddr = splitAddress(opts.fromAddress ?? '');
  const toAddr = splitAddress(opts.toAddress ?? '');
  if (!opts.toAddress) notes.push('Add the receiving godown / branch address before uploading.');
  const itemList: EwayItem[] = [];
  for (const l of t.lines ?? []) {
    const it = byId.get(l.item_id);
    const qty = num(l.qty) * lineFactor(l);
    if (!it || !(qty > 0)) continue;
    const hsn = (it.hsn ?? '').replace(/\D/g, '');
    if (!hsn) notes.push(`${it.name}: no HSN code.`);
    const value = round2(qty * Math.max(num(opts.costOf(it.id)), 0));
    if (!(value > 0)) notes.push(`${it.name}: no cost value in stock, the line goes at ₹0.`);
    const rate = Math.max(num(it.tax_rate), 0);
    itemList.push({
      productName: it.name.slice(0, 100),
      productDesc: `${it.name}${l.batch_no ? ` batch ${l.batch_no}` : ''}`.slice(0, 100),
      hsnCode: codeNum(hsn),
      quantity: Math.round(qty * 1000) / 1000,
      qtyUnit: portalUqc(it.unit, opts.units),
      taxableAmount: value,
      sgstRate: rate / 2,
      cgstRate: rate / 2,
      igstRate: 0,
      cessRate: 0,
    });
  }
  const total = round2(itemList.reduce((s, i) => s + i.taxableAmount, 0));
  notes.push('No tax is charged on a same-GSTIN transfer: tax values are nil (rates shown for information).');
  const vehicle = normaliseVehicle(opts.vehicle);
  if (!vehicle && !opts.transporterId) notes.push('Add the vehicle number or the transporter ID (Part B) before the goods move.');
  const bill: EwayBill = {
    userGstin: gstin,
    supplyType: 'O',
    subSupplyType: EWAY_SUB_OWN_USE,
    subSupplyDesc: '',
    docType: 'CHL',
    docNo: (opts.docNo ?? t.transfer_number ?? '').trim().toUpperCase().slice(0, 16),
    docDate: toNicDate(t.date),
    transType: 1,
    fromGstin: gstin,
    fromTrdName: opts.sender.name.trim(),
    fromAddr1: fromAddr.addr1,
    fromAddr2: fromAddr.addr2,
    fromPlace: guessLocality(opts.fromAddress ?? '', stateByCode(fromState)?.name) || stateByCode(fromState)?.name || '',
    fromPincode: extractPin(opts.fromAddress),
    actFromStateCode: codeNum(fromState),
    fromStateCode: codeNum(fromState),
    toGstin: gstin,
    toTrdName: opts.sender.name.trim(),
    toAddr1: toAddr.addr1,
    toAddr2: toAddr.addr2,
    toPlace: guessLocality(opts.toAddress ?? '', stateByCode(toState)?.name) || stateByCode(toState)?.name || '',
    toPincode: pinOf(extractPin(opts.toAddress)),
    actToStateCode: codeNum(toState),
    toStateCode: codeNum(toState),
    totalValue: total,
    cgstValue: 0,
    sgstValue: 0,
    igstValue: 0,
    cessValue: 0,
    TotNonAdvolVal: 0,
    OthValue: 0,
    totInvValue: total,
    transMode: ewayTransModeCode(opts.mode ?? 'ROAD'),
    transDistance: String(Math.max(0, Math.round(num(opts.distanceKm)))),
    transporterName: (opts.transporterName ?? '').trim(),
    transporterId: (opts.transporterId ?? '').trim().toUpperCase(),
    transDocNo: '',
    transDocDate: '',
    vehicleNo: vehicle,
    vehicleType: 'R',
    itemList,
  };
  return { payload: { version: EWAY_VERSION, billLists: [bill] }, bill, notes, required: toState !== fromState || total > EWAY_THRESHOLD };
}
