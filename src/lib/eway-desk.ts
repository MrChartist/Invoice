/**
 * R3-C5 e-Way desk: active e-Way Bills with validity, filters, and the bulk Part-B (vehicle) and
 * transporter update files for the portal's bulk tools — WORKING PAPER, LAYOUT UNVERIFIED (verify with
 * your CA). Rows are built from `einvoice_meta` (rows with an `eway_no`) and the invoices they belong to.
 * The JSON field names follow the e-Way Bill API's Part-B / transporter update as understood
 * (`ewbNo`, `vehicleNo`, `fromPlace`, `fromState`, `reasonCode`, `reasonRem`, `transDocNo`,
 * `transDocDate`, `transMode`, `vehicleType`; `transporterId`); the portal's bulk tool layout is not
 * published in a form we could verify. Nothing is uploaded.
 */

import type { EInvoiceMeta } from './einvoice';
import type { InvoiceRecord } from '../types/invoice';
import type { TransporterChange, VehicleChange } from '../types/docs-r3';
import { EWAY_VERSION, VEHICLE_REGEX, normaliseVehicle } from './eway';
import { effectiveValidity, hoursLeft, inExtensionWindow, localDay } from './eway-validity';
import { requireAccess } from './access';
import { audit } from './audit';
import { getTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';

const META_TABLE = 'einvoice_meta';

export type EwayStatus = 'active' | 'expiring' | 'expired' | 'unknown';
export type EwayFilter = 'all' | 'expiring24' | 'expired' | 'noPartB';
/** "Expiring" = less than this many hours left. */
export const EXPIRING_HOURS = 24;
/** Expired bills stay on the desk for this many days. */
export const EXPIRED_KEEP_DAYS = 7;

export interface EwayRow {
  invoiceId: string;
  number: string;
  party: string;
  ewayNo: string;
  vehicle: string;
  distance: number;
  status: EwayStatus;
  expiresAt: Date | null;
  hoursLeft: number | null;
  source: 'typed' | 'computed' | 'none';
  typedDay?: string;
  computedDay?: string;
  differs: boolean;
  /** Inside the portal's extension window (date-keyed hours around expiry). */
  extension: boolean;
  noPartB: boolean;
}

/** Desk rows: EWBs not cancelled on a live document; expired ones only for `EXPIRED_KEEP_DAYS`. */
export function buildEwayRows(meta: readonly EInvoiceMeta[], invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number' | 'client' | 'status'>[], now: Date): EwayRow[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const out: EwayRow[] = [];
  for (const m of meta) {
    const no = String(m?.eway_no ?? '').trim();
    if (!no || m.ewb_cancel?.status === 'done') continue;
    const inv = byId.get(m.invoice_id);
    if (inv?.status === 'Cancelled') continue;
    const v = effectiveValidity(m);
    const h = v.expiresAt ? hoursLeft(v.expiresAt, now) : null;
    if (v.expiresAt && now.getTime() - v.expiresAt.getTime() > EXPIRED_KEEP_DAYS * 86_400_000) continue;
    const status: EwayStatus = !v.expiresAt ? 'unknown' : v.expiresAt.getTime() < now.getTime() ? 'expired' : (h ?? 0) < EXPIRING_HOURS ? 'expiring' : 'active';
    out.push({
      invoiceId: m.invoice_id,
      number: inv?.invoice_number ?? '',
      party: inv?.client?.name ?? '',
      ewayNo: no,
      vehicle: normaliseVehicle(m.vehicle),
      distance: Number(m.eway_distance_km ?? m.distance) || 0,
      status,
      expiresAt: v.expiresAt,
      hoursLeft: h,
      source: v.source,
      ...(v.typedDay ? { typedDay: v.typedDay } : {}),
      ...(v.computedDay ? { computedDay: v.computedDay } : {}),
      differs: v.differs,
      extension: !!v.expiresAt && inExtensionWindow(v.expiresAt, now),
      noPartB: !normaliseVehicle(m.vehicle),
    });
  }
  return out.sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
}

export function filterRows(rows: readonly EwayRow[], f: EwayFilter): EwayRow[] {
  if (f === 'expiring24') return rows.filter((r) => r.status === 'expiring');
  if (f === 'expired') return rows.filter((r) => r.status === 'expired');
  if (f === 'noPartB') return rows.filter((r) => r.noPartB);
  return [...rows];
}

/* ── Bulk vehicle (Part-B) / transporter update ──────────────── */

export type VehicleReason = VehicleChange['reason'];
/** Portal reason codes as understood: 1 break-down, 2 trans-shipment, 3 others (remark required). */
export const REASON_CODE: Record<VehicleReason, string> = { breakdown: '1', transhipment: '2', others: '3' };
const MODE_CODE = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' } as const;

export interface VehicleUpdateInput {
  vehicle: string;
  place: string;
  stateCode: string;
  reason: VehicleReason;
  remark?: string;
  docNo?: string;
  /** YYYY-MM-DD */
  docDate?: string;
  mode?: keyof typeof MODE_CODE;
}

export type VehicleIssue = 'vehicle' | 'place' | 'state' | 'remark' | 'none';

export function vehicleIssues(input: VehicleUpdateInput, selected: number): VehicleIssue[] {
  const out: VehicleIssue[] = [];
  if (!selected) out.push('none');
  if (!VEHICLE_REGEX.test(normaliseVehicle(input.vehicle))) out.push('vehicle');
  if (!input.place.trim()) out.push('place');
  const sc = Number(input.stateCode);
  if (!/^\d{1,2}$/.test(input.stateCode.trim()) || sc < 1 || sc > 99) out.push('state');
  if (input.reason === 'others' && !input.remark?.trim()) out.push('remark');
  return out;
}

const dmy = (day?: string) => (day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : '');
const REASON_TEXT: Record<VehicleReason, string> = { breakdown: 'Due to break down', transhipment: 'Due to transhipment', others: 'Others' };

/** JSON for the portal's bulk Part-B update (layout unverified — working paper). */
export function vehicleUpdateJson(ewbNos: readonly string[], input: VehicleUpdateInput): Record<string, unknown> {
  return {
    version: EWAY_VERSION,
    vehicleUpdtList: ewbNos.map((n) => ({
      ewbNo: Number(n),
      vehicleNo: normaliseVehicle(input.vehicle),
      fromPlace: input.place.trim().slice(0, 50),
      fromState: Number(input.stateCode),
      reasonCode: REASON_CODE[input.reason],
      reasonRem: (input.reason === 'others' ? input.remark ?? '' : input.remark || REASON_TEXT[input.reason]).trim().slice(0, 50),
      transDocNo: (input.docNo ?? '').trim().slice(0, 15),
      transDocDate: dmy(input.docDate),
      transMode: MODE_CODE[input.mode ?? 'ROAD'],
      vehicleType: 'R',
    })),
  };
}

/** Transporter ID: a GSTIN or a 15-character TRANSIN. */
export const TRANSPORTER_ID = /^[0-9]{2}[0-9A-Z]{13}$/;

/** JSON for the portal's bulk transporter update (layout unverified — working paper). */
export function transporterUpdateJson(ewbNos: readonly string[], transporterId: string): Record<string, unknown> {
  return { version: EWAY_VERSION, transporterUpdtList: ewbNos.map((n) => ({ ewbNo: Number(n), transporterId: transporterId.trim().toUpperCase() })) };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV beside the JSON (same rows), for the dispatcher's records. */
export function vehicleUpdateCsv(ewbNos: readonly string[], input: VehicleUpdateInput): string {
  const rows = (vehicleUpdateJson(ewbNos, input).vehicleUpdtList as Record<string, unknown>[]);
  const head = ['ewbNo', 'vehicleNo', 'fromPlace', 'fromState', 'reasonCode', 'reasonRem', 'transDocNo', 'transDocDate', 'transMode'];
  return [head.join(','), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n';
}

export function transporterUpdateCsv(ewbNos: readonly string[], transporterId: string): string {
  return ['ewbNo,transporterId', ...ewbNos.map((n) => `${csvCell(n)},${csvCell(transporterId.trim().toUpperCase())}`)].join('\n') + '\n';
}

/** Pure: record the new vehicle (with history) on the selected bills' meta rows. */
export function applyVehicleUpdate(meta: readonly EInvoiceMeta[], invoiceIds: ReadonlySet<string>, input: VehicleUpdateInput, now: Date): EInvoiceMeta[] {
  const at = now.toISOString();
  const change: VehicleChange = {
    at,
    vehicle: normaliseVehicle(input.vehicle),
    reason: input.reason,
    place: input.place.trim(),
    state_code: String(Number(input.stateCode)).padStart(2, '0'),
    ...(input.remark?.trim() ? { remark: input.remark.trim() } : {}),
    ...(input.docNo?.trim() ? { doc_no: input.docNo.trim() } : {}),
    ...(input.docDate ? { doc_date: input.docDate } : {}),
  };
  return meta.map((m) => (invoiceIds.has(m.invoice_id) && m.eway_no
    ? { ...m, vehicle: change.vehicle, vehicle_history: [...(m.vehicle_history ?? []), change], updated_at: at }
    : m));
}

export function applyTransporterUpdate(meta: readonly EInvoiceMeta[], invoiceIds: ReadonlySet<string>, transporterId: string, now: Date, name?: string): EInvoiceMeta[] {
  const at = now.toISOString();
  const id = transporterId.trim().toUpperCase();
  const change: TransporterChange = { at, transporter_id: id, ...(name?.trim() ? { transporter_name: name.trim() } : {}) };
  return meta.map((m) => (invoiceIds.has(m.invoice_id) && m.eway_no
    ? { ...m, transporter_id: id, ...(change.transporter_name ? { transporter_name: change.transporter_name } : {}), transporter_history: [...(m.transporter_history ?? []), change], updated_at: at }
    : m));
}

/** Write a prepared bulk update to `einvoice_meta` (one write, all-or-nothing) and audit it. */
export function recordBulkUpdate(kind: 'vehicle' | 'transporter', next: EInvoiceMeta[], count: number, detail: string): void {
  requireAccess('books.edit');
  withTablesRollback([META_TABLE], () => setTable(META_TABLE, next));
  audit.record({ entity: 'invoice', entity_id: `eway-bulk-${localDay(new Date())}`, action: 'update', summary: `e-Way desk: ${kind === 'vehicle' ? 'Part-B vehicle' : 'transporter'} update prepared for ${count} e-Way Bill(s) — ${detail} (working paper)` });
}

export const loadMeta = (): EInvoiceMeta[] => getTable<EInvoiceMeta>(META_TABLE);
