/**
 * Consolidated e-Way Bill (EWB-02, Rule 138(9)) — 7R (7.126). A transporter (or the consignor) carrying several
 * consignments in one conveyance generates one consolidated e-Way Bill from the e-Way Bill numbers of the
 * individual consignments. This builds the JSON for the portal's consolidated / trip-sheet upload offline; the
 * app never calls the portal.
 *
 * UNVERIFIED layout: the keys follow the NIC e-Way Bill API "GENCEWB" request as we understand it
 * (`fromPlace`, `fromState`, `vehicleNo`, `transMode`, `transDocNo`, `transDocDate`, `tripSheetEwbBills[].ewbNo`),
 * wrapped in a bulk file `{ version, tripSheets: [...] }` with the generator's GSTIN (`userGstin`). Check against
 * the current portal before upload — `CEWB_LAYOUT` holds the version string. Working paper; verify with your CA /
 * transporter. Pure (node:test).
 */

import { stateByCode } from './india-states';
import type { EwayTransMode } from './eway';
import { checkGstin } from './gstin';
import { isoDay } from './dates';

export const CEWB_LAYOUT = { version: '1.0.0621', wrapper: 'tripSheets' } as const;
export const CEWB_NOTE = 'Consolidated e-Way Bill (EWB-02) JSON prepared offline: layout not verified against the portal. Every e-Way Bill included must be valid for the trip; verify before upload.';
/** e-Way Bill numbers are 12 digits. */
export const EWB_NO = /^\d{12}$/;
/** Upper bound kept for an untrusted pasted list. */
export const MAX_CEWB_BILLS = 500;

/** Same plate formats / normalising as eway.ts (copied so this chunk does not load the e-Invoice builders). */
const VEHICLE_REGEX = /^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/;
const normaliseVehicle = (raw?: string) => (raw ?? '').toUpperCase().replace(/[\s-]+/g, '');

const TRANS_MODE_CODE: Record<EwayTransMode, string> = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' };

export interface ConsolidatedInput {
  /** GSTIN (or transporter id) of the person generating the consolidated bill. */
  userGstin: string;
  /** Place the conveyance starts from (town / city) and its State code. */
  fromPlace: string;
  fromStateCode: string;
  transMode: EwayTransMode;
  /** Road: vehicle number (required). */
  vehicleNo?: string;
  /** Rail / air / ship: transport document (RR / airway bill / bill of lading) number and date. */
  transDocNo?: string;
  transDocDate?: string;
  /** The individual e-Way Bill numbers (typed or from saved invoices). */
  ewbNos: readonly string[];
  /** Validity (local day) per EWB, when known — an expired bill is flagged. */
  validUpto?: Readonly<Record<string, string | undefined>>;
  today?: string;
}

export interface ConsolidatedResult {
  payload: Record<string, unknown> | null;
  bills: string[];
  errors: string[];
  warnings: string[];
}

/** Split a pasted list ("1234…, 1234…\n…") into distinct 12-digit numbers; anything else is reported. */
export function parseEwbList(text: string): { numbers: string[]; rejected: string[] } {
  const parts = String(text ?? '').slice(0, 20000).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const numbers: string[] = [];
  const rejected: string[] = [];
  for (const p of parts.slice(0, MAX_CEWB_BILLS * 2)) {
    const n = p.replace(/[^0-9]/g, '');
    if (EWB_NO.test(n)) {
      if (!numbers.includes(n)) numbers.push(n);
    } else rejected.push(p.slice(0, 30));
  }
  return { numbers: numbers.slice(0, MAX_CEWB_BILLS), rejected };
}

const nicDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Build (and check) the consolidated e-Way Bill JSON. `payload` is null when there is a blocking error. */
export function buildConsolidatedEway(i: ConsolidatedInput): ConsolidatedResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bills: string[] = [];
  for (const raw of i.ewbNos) {
    const n = String(raw ?? '').replace(/\s+/g, '');
    if (!EWB_NO.test(n)) errors.push(`"${n.slice(0, 20)}" is not a 12-digit e-Way Bill number.`);
    else if (bills.includes(n)) warnings.push(`e-Way Bill ${n} is listed twice: included once.`);
    else bills.push(n);
  }
  if (!bills.length) errors.push('Add at least one e-Way Bill number.');
  else if (bills.length === 1) warnings.push('Only one e-Way Bill: a consolidated bill is normally for several consignments in one vehicle.');
  if (bills.length > MAX_CEWB_BILLS) errors.push(`At most ${MAX_CEWB_BILLS} e-Way Bills in one file.`);
  const gstin = String(i.userGstin ?? '').trim().toUpperCase();
  if (!checkGstin(gstin).valid && !/^[0-9A-Z]{15}$/.test(gstin)) errors.push('Enter the GSTIN / transporter id generating the consolidated bill.');
  const place = String(i.fromPlace ?? '').trim();
  if (!place) errors.push('Enter the place the vehicle starts from.');
  if (place.length > 50) errors.push('The place may have at most 50 characters.');
  const state = stateByCode(String(i.fromStateCode ?? '').padStart(2, '0'));
  if (!state) errors.push('Choose the State the vehicle starts from.');
  const vehicle = normaliseVehicle(i.vehicleNo);
  if (i.transMode === 'ROAD') {
    if (!vehicle) errors.push('Enter the vehicle number (road).');
    else if (!VEHICLE_REGEX.test(vehicle)) errors.push(`Vehicle number ${vehicle} does not look valid (e.g. KA01AB1234).`);
  } else {
    if (!String(i.transDocNo ?? '').trim()) errors.push('Enter the transport document number (RR / airway bill / bill of lading).');
    if (!isoDay(i.transDocDate)) errors.push('Enter the transport document date.');
  }
  const today = isoDay(i.today);
  if (today && i.validUpto) {
    for (const b of bills) {
      const v = isoDay(i.validUpto[b]);
      if (v && v < today) warnings.push(`e-Way Bill ${b} expired on ${v}: extend it before consolidating.`);
    }
  }
  if (errors.length) return { payload: null, bills, errors, warnings };
  const sheet: Record<string, unknown> = {
    userGstin: gstin,
    fromPlace: place.slice(0, 50),
    fromState: Number(state!.code),
    transMode: TRANS_MODE_CODE[i.transMode],
    vehicleNo: i.transMode === 'ROAD' ? vehicle : vehicle || '',
    transDocNo: String(i.transDocNo ?? '').trim().slice(0, 15),
    transDocDate: isoDay(i.transDocDate) ? nicDate(isoDay(i.transDocDate)) : '',
    tripSheetEwbBills: bills.map((n) => ({ ewbNo: Number(n) })),
  };
  return { payload: { version: CEWB_LAYOUT.version, [CEWB_LAYOUT.wrapper]: [sheet] }, bills, errors, warnings };
}

/** Saved invoices that carry an e-Way Bill number (`einvoice_meta`), for picking. */
export function ewbCandidates(meta: readonly { invoice_id: string; eway_no?: string; eway_date?: string; eway_valid_upto?: string; vehicle?: string }[], invoices: readonly { id: string; invoice_number?: string; issue_date?: string; client?: { name?: string } }[]): { invoiceId: string; number: string; date: string; party: string; ewb: string; validUpto: string; vehicle: string }[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  return meta
    .filter((m) => EWB_NO.test(String(m.eway_no ?? '').replace(/\s+/g, '')))
    .map((m) => {
      const inv = byId.get(m.invoice_id);
      return { invoiceId: m.invoice_id, number: String(inv?.invoice_number ?? ''), date: String(inv?.issue_date ?? m.eway_date ?? ''), party: String(inv?.client?.name ?? ''), ewb: String(m.eway_no).replace(/\s+/g, ''), validUpto: isoDay(m.eway_valid_upto), vehicle: String(m.vehicle ?? '') };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
