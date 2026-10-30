/**
 * e-Way bill JSON for job-work challans (7S, roadmap 7.73): a Material Out challan (`JWC/FY…`, Rule 55) moving
 * goods to a job worker, in the same bulk-upload layout as `eway.ts` (version 1.0.0621) with supply type
 * Outward, sub-type 4 "Job Work" and document type CHL (delivery challan).
 *
 * - From: the active business profile (GSTIN, address, state). To: the job worker (GSTIN, state, address from the
 *   supplier master when the challan names it).
 * - Items: each challan line — HSN (line, else stock item), quantity as typed with its UQC, taxable value =
 *   quantity × value per unit, the GST rate split IGST or CGST + SGST by the job worker's state.
 * - No tax is charged on a job-work challan, so the tax values are nil and the document value is the goods' value.
 *   An e-Way bill is needed for inter-State movement to a job worker whatever the value (Rule 138(1) proviso);
 *   intra-State the ₹50,000 rule applies. Working paper: the layout is the portal's bulk format but not validated
 *   against the portal — verify with your CA before upload.
 *
 * Pure: the caller passes the challan, items, profile and vendor.
 */
import type { MaterialOut } from '../types/job-work';
import type { Vendor } from '../types/purchases';
import type { StockItem } from './inventory';
import { num, round2 } from './invoice-calc';
import { stateByCode } from './india-states';
import { extractPin, guessLocality, portalUqc, splitAddress, toNicDate } from './einvoice';
import {
  EWAY_SUB_JOB_WORK, EWAY_THRESHOLD, EWAY_VERSION, ewayTransModeCode, normaliseVehicle,
  type EwayBill, type EwayItem, type EwayPayload, type EwayTransMode,
} from './eway';
import type { UnitMaster } from './units';

export const JOB_WORK_EWAY_CA_NOTE = 'e-Way bill JSON for a job-work challan (sub-type Job Work, document CHL): not validated against the portal; verify with your CA.';

export interface JobWorkEwaySender {
  name: string;
  gstin?: string;
  address?: string;
  stateCode?: string;
}

export interface JobWorkEwayOptions {
  sender: JobWorkEwaySender;
  vendor?: Pick<Vendor, 'gstin' | 'state_code' | 'address' | 'name'>;
  items: readonly StockItem[];
  units?: readonly UnitMaster[];
  mode?: EwayTransMode;
}

export interface JobWorkEwayBuild {
  payload: EwayPayload;
  bill: EwayBill;
  /** English notes for the screen (assumptions, missing data). */
  notes: string[];
  /** True when the portal rules make an e-Way bill needed (inter-State, or value above ₹50,000). */
  required: boolean;
}

const pinOf = (v: unknown) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 6 ? Number(d) : 0;
};
const codeNum = (code?: string) => {
  const n = parseInt(code ?? '', 10);
  return Number.isFinite(n) ? n : 0;
};

/** Build the e-Way bill for a Material Out challan. */
export function buildJobWorkEway(o: MaterialOut, opts: JobWorkEwayOptions): JobWorkEwayBuild {
  const notes: string[] = [];
  const byId = new Map(opts.items.map((i) => [i.id, i]));
  const fromGstin = (opts.sender.gstin ?? '').trim().toUpperCase();
  const fromState = stateByCode(opts.sender.stateCode)?.code ?? fromGstin.slice(0, 2);
  const toGstin = (o.party_gstin ?? opts.vendor?.gstin ?? '').trim().toUpperCase() || 'URP';
  const toState = o.party_state_code || opts.vendor?.state_code || (/^\d{2}/.test(toGstin) ? toGstin.slice(0, 2) : '') || fromState;
  const inter = !!fromState && !!toState && fromState !== toState;
  if (!fromGstin) notes.push('Your GSTIN is missing in the business profile.');
  if (toGstin === 'URP') notes.push('The job worker has no GSTIN: sent as unregistered (URP).');
  const fromAddr = splitAddress(opts.sender.address ?? '');
  const toAddr = splitAddress(opts.vendor?.address ?? '');
  if (!opts.vendor?.address) notes.push("The job worker's address is not in the supplier master: add it before uploading.");
  const fromPlace = guessLocality(opts.sender.address ?? '', stateByCode(fromState)?.name) || stateByCode(fromState)?.name || '';
  const toPlace = guessLocality(opts.vendor?.address ?? '', stateByCode(toState)?.name) || stateByCode(toState)?.name || '';

  const itemList: EwayItem[] = [];
  for (const l of o.lines ?? []) {
    const it = byId.get(l.item_id);
    const qty = num(l.qty);
    if (!it || !(qty > 0)) continue;
    const hsn = (l.hsn || it.hsn || '').replace(/\D/g, '');
    if (!hsn) notes.push(`${it.name}: no HSN code.`);
    const rate = Math.max(num(l.tax_rate ?? it.tax_rate), 0);
    const value = round2(qty * Math.max(num(l.rate), 0));
    if (!(value > 0)) notes.push(`${it.name}: no value per unit on the challan line.`);
    itemList.push({
      productName: it.name.slice(0, 100),
      productDesc: (o.process ? `${it.name}: for ${o.process}` : it.name).slice(0, 100),
      hsnCode: codeNum(hsn),
      quantity: Math.round(qty * 1000) / 1000,
      qtyUnit: portalUqc(l.unit || it.unit, opts.units),
      taxableAmount: value,
      sgstRate: inter ? 0 : rate / 2,
      cgstRate: inter ? 0 : rate / 2,
      igstRate: inter ? rate : 0,
      cessRate: 0,
    });
  }
  const total = round2(itemList.reduce((s, i) => s + i.taxableAmount, 0));
  notes.push('No tax is charged on a job-work challan: tax values are nil (rates shown for information).');
  const mode = opts.mode ?? 'ROAD';
  const vehicle = normaliseVehicle(o.vehicle_no);
  if (!vehicle && !o.transporter_id) notes.push('Add the vehicle number or the transporter ID (Part B) before the goods move.');
  const bill: EwayBill = {
    userGstin: fromGstin,
    supplyType: 'O',
    subSupplyType: EWAY_SUB_JOB_WORK,
    subSupplyDesc: '',
    docType: 'CHL',
    docNo: (o.number ?? '').trim().toUpperCase(),
    docDate: toNicDate(o.date),
    transType: 1,
    fromGstin,
    fromTrdName: opts.sender.name.trim(),
    fromAddr1: fromAddr.addr1,
    fromAddr2: fromAddr.addr2,
    fromPlace,
    fromPincode: extractPin(opts.sender.address),
    actFromStateCode: codeNum(fromState),
    fromStateCode: codeNum(fromState),
    toGstin,
    toTrdName: (o.party_name || opts.vendor?.name || '').trim(),
    toAddr1: toAddr.addr1,
    toAddr2: toAddr.addr2,
    toPlace,
    toPincode: pinOf(extractPin(opts.vendor?.address)),
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
    transMode: ewayTransModeCode(mode),
    transDistance: String(Math.max(0, Math.round(num(o.distance_km)))),
    transporterName: (o.transporter_name ?? '').trim(),
    transporterId: (o.transporter_id ?? '').trim().toUpperCase(),
    transDocNo: '',
    transDocDate: '',
    vehicleNo: vehicle,
    vehicleType: 'R',
    itemList,
  };
  return { payload: { version: EWAY_VERSION, billLists: [bill] }, bill, notes, required: inter || total > EWAY_THRESHOLD };
}
