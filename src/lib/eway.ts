/**
 * e-Way Bill bulk-upload JSON generator (version 1.0.0621), offline.
 *
 * The file produced here is uploaded on the e-Way Bill portal under
 * "Generate (Bulk)" — the app never calls the portal itself.
 */

import type { InvoiceRecord, SenderProfile } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, pctOf, round2 } from './invoice-calc';
import { stateByCode, stateByName } from './india-states';
import {
  extractPin,
  guessLocality,
  isServiceHsn,
  issue,
  mapUnitToUqc,
  splitAddress,
  toNicDate,
  type PreflightIssue,
} from './einvoice';

export const EWAY_VERSION = '1.0.0621';
/** Consignment value above which an e-Way Bill is mandatory for goods. */
export const EWAY_THRESHOLD = 50000;

export type EwayTransMode = 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
const TRANS_MODE_CODE: Record<EwayTransMode, number> = { ROAD: 1, RAIL: 2, AIR: 3, SHIP: 4 };

/** Registration-plate formats the portal accepts: standard state series and BH series. */
export const VEHICLE_REGEX = /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;

export interface EwayItem {
  productName: string;
  productDesc: string;
  hsnCode: number;
  quantity: number;
  qtyUnit: string;
  taxableAmount: number;
  sgstRate: number;
  cgstRate: number;
  igstRate: number;
  cessRate: number;
  /** Additive: fixed (non-ad-valorem) cess amount on the line. */
  cessNonadvol?: number;
}

export interface EwayBill {
  userGstin: string;
  supplyType: 'O' | 'I';
  subSupplyType: number;
  subSupplyDesc: string;
  docType: 'INV' | 'BIL' | 'BOE' | 'CHL' | 'CNT' | 'OTH';
  docNo: string;
  docDate: string;
  transType: 1 | 2 | 3 | 4;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2: string;
  fromPlace: string;
  fromPincode: number;
  actFromStateCode: number;
  fromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2: string;
  toPlace: string;
  toPincode: number;
  actToStateCode: number;
  toStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  TotNonAdvolVal: number;
  OthValue: number;
  totInvValue: number;
  transMode?: number;
  transDistance: string;
  transporterName: string;
  transporterId: string;
  transDocNo: string;
  transDocDate: string;
  vehicleNo: string;
  vehicleType: 'R' | 'O';
  itemList: EwayItem[];
}

export interface EwayPayload {
  version: typeof EWAY_VERSION;
  billLists: EwayBill[];
}

export interface EwayTransport {
  mode?: EwayTransMode;
  /** Vehicle registration number; spaces and hyphens are stripped. */
  vehicle?: string;
  vehicleType?: 'R' | 'O';
  /** Approximate km; 0 asks the portal to compute it. */
  distance?: number;
  transporterId?: string;
  transporterName?: string;
  docNo?: string;
  /** yyyy-mm-dd */
  docDate?: string;
}

export interface EwayOptions {
  transport?: EwayTransport;
  fallbackSender?: SenderProfile | null;
  /** Dispatch-from / ship-to when they differ from the seller / buyer. */
  shipFrom?: { addr1?: string; place?: string; pin?: string | number; stateCode?: string };
  shipTo?: { addr1?: string; place?: string; pin?: string | number; stateCode?: string };
}

export interface EwayBuild {
  payload: EwayPayload;
  bill: EwayBill;
  assumptions: PreflightIssue[];
  /** Goods lines left out because they are services (SAC 99xxxx). */
  skippedServiceLines: number;
}

export function normaliseVehicle(raw?: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

function pinOf(v: unknown): number {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 6 ? Number(d) : 0;
}

function codeNum(code?: string): number {
  const n = parseInt(code ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

export function ewayDocType(doc: InvoiceRecord['doc_type']): EwayBill['docType'] {
  if (doc === 'DELIVERY_CHALLAN') return 'CHL';
  if (doc === 'CREDIT_NOTE') return 'CNT';
  return 'INV';
}

export function buildEway(record: InvoiceRecord, options: EwayOptions = {}): EwayBuild {
  const assumptions: PreflightIssue[] = [];
  const sender = record.sender ?? options.fallbackSender ?? null;
  const client = record.client ?? ({} as InvoiceRecord['client']);
  const t = options.transport ?? {};

  const calc = calculateInvoice(calcInputFromRecord(record));

  const sellerGstin = (sender?.companyGstin ?? '').trim().toUpperCase();
  const gstinStateFrom = sellerGstin.slice(0, 2);
  const fromState = stateByCode(sender?.stateCode)?.code ?? gstinStateFrom;
  const fromAddr = splitAddress(options.shipFrom?.addr1 ?? sender?.companyAddress ?? '');
  const fromStateName = stateByCode(fromState)?.name;
  let fromPlace = options.shipFrom?.place ?? guessLocality(sender?.companyAddress ?? '', fromStateName);
  if (fromPlace.length < 3) {
    fromPlace = fromStateName ?? '';
    assumptions.push(issue('warning', 'FROM_PLACE_GUESS', 'Dispatch from', `Dispatch place guessed as "${fromPlace}"; put the city in the sender address.`));
  }

  const isExport = ['99', '96'].includes((record.place_of_supply ?? '').trim());
  const buyerGstin = isExport ? 'URP' : (client.gstin ?? '').trim().toUpperCase() || 'URP';
  const toGstinState = /^\d{2}/.test(buyerGstin) ? buyerGstin.slice(0, 2) : '';
  const clientState = stateByCode(client.state_code)?.code ?? stateByName(client.state)?.code ?? '';
  const toState = isExport ? '99' : toGstinState || clientState || (record.place_of_supply ?? '');
  const toAddr = splitAddress(options.shipTo?.addr1 ?? client.address ?? '');
  const actTo = options.shipTo?.stateCode ?? (isExport ? '99' : clientState || toState);
  const shipDiffers = !!(options.shipTo || options.shipFrom);

  // Goods only — e-Way Bills do not apply to services.
  const goods = calc.lines.filter((l) => !isServiceHsn(l.hsn));
  const skippedServiceLines = calc.lines.length - goods.length;
  const allGoods = skippedServiceLines === 0;
  const sum = (pick: (l: (typeof goods)[number]) => number) => round2(goods.reduce((s, l) => s + pick(l), 0));
  const noTax = record.gst_mode === 'NONE';
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  // Cess: ad valorem part by rate, the rest is the fixed per-unit part. TCS has no
  // field of its own on the portal, so it rides in "other value" with freight.
  const advolOf = (l: (typeof goods)[number]) => pctOf(l.taxable, l.cess_rate);
  const cessAdvol = sum(advolOf);
  const cessFixed = sum((l) => round2(l.cess - advolOf(l)));
  const other = allGoods ? round2(calc.shipping + calc.other_charges + calc.tcs_amount) : 0;
  const totInv = allGoods
    ? calc.total
    : round2(taxable + cgst + sgst + igst + cessAdvol + cessFixed);

  const itemList: EwayItem[] = goods.map((l) => {
    const rate = noTax ? 0 : l.tax_rate;
    const intraSplit = l.cgst > 0 || l.sgst > 0;
    return {
      productName: (l.name || 'Item').slice(0, 100),
      productDesc: (l.name || 'Item').slice(0, 100),
      hsnCode: codeNum(l.hsn),
      quantity: Math.round(l.quantity * 1000) / 1000,
      qtyUnit: mapUnitToUqc(l.unit),
      taxableAmount: l.taxable,
      sgstRate: intraSplit ? rate / 2 : 0,
      cgstRate: intraSplit ? rate / 2 : 0,
      igstRate: intraSplit ? 0 : rate,
      cessRate: l.cess_rate,
      ...(round2(l.cess - advolOf(l)) > 0 ? { cessNonadvol: round2(l.cess - advolOf(l)) } : {}),
    };
  });

  const mode = t.mode ?? 'ROAD';
  const bill: EwayBill = {
    userGstin: sellerGstin,
    supplyType: 'O',
    subSupplyType: record.doc_type === 'CREDIT_NOTE' ? 8 : isExport ? 3 : 1,
    subSupplyDesc: record.doc_type === 'CREDIT_NOTE' ? 'Credit note' : '',
    docType: ewayDocType(record.doc_type),
    docNo: (record.invoice_number ?? '').trim().toUpperCase(),
    docDate: toNicDate(record.issue_date),
    transType: shipDiffers ? 4 : 1,
    fromGstin: sellerGstin,
    fromTrdName: (sender?.companyName ?? '').trim(),
    fromAddr1: fromAddr.addr1,
    fromAddr2: fromAddr.addr2,
    fromPlace,
    fromPincode: pinOf(options.shipFrom?.pin) || extractPin(sender?.companyAddress),
    actFromStateCode: codeNum(options.shipFrom?.stateCode ?? fromState),
    fromStateCode: codeNum(gstinStateFrom || fromState),
    toGstin: buyerGstin,
    toTrdName: (client.company || client.name || '').trim(),
    toAddr1: toAddr.addr1,
    toAddr2: toAddr.addr2,
    toPlace: (options.shipTo?.place ?? client.city ?? '').trim(),
    toPincode: isExport ? 999999 : pinOf(options.shipTo?.pin) || pinOf(client.zip) || extractPin(client.address),
    actToStateCode: codeNum(actTo),
    toStateCode: codeNum(toState),
    totalValue: taxable,
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igst,
    cessValue: cessAdvol,
    TotNonAdvolVal: cessFixed,
    OthValue: other,
    totInvValue: totInv,
    transMode: TRANS_MODE_CODE[mode],
    transDistance: String(Math.max(0, Math.round(num(t.distance)))),
    transporterName: (t.transporterName ?? '').trim(),
    transporterId: (t.transporterId ?? '').trim().toUpperCase(),
    transDocNo: (t.docNo ?? '').trim(),
    transDocDate: toNicDate(t.docDate),
    vehicleNo: normaliseVehicle(t.vehicle),
    vehicleType: t.vehicleType ?? 'R',
    itemList,
  };

  return { payload: { version: EWAY_VERSION, billLists: [bill] }, bill, assumptions, skippedServiceLines };
}

/** Merge several bills into one bulk file (the portal takes up to 25 per upload at a time). */
export function buildEwayBulk(bills: EwayBill[]): EwayPayload {
  return { version: EWAY_VERSION, billLists: bills.slice() };
}

export function stringifyEway(payload: EwayPayload): string {
  return JSON.stringify(payload, null, 2);
}
