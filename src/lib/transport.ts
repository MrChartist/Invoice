/**
 * Transport / dispatch details on a document (P1-24): normalising what is stored, the rows the
 * paper prints, and a prefill from the e-Way data saved in `einvoice_meta`.
 *
 * Pure; no React, no storage. Stored records are snapshots: the paper prints `invoice.transport`
 * only, so editing the e-Way data later never changes an issued document.
 */

import type { TransportDetails, TransportMode } from '../types/invoice';

export const TRANSPORT_MODES: readonly TransportMode[] = ['ROAD', 'RAIL', 'AIR', 'SHIP'];

export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  ROAD: 'Road',
  RAIL: 'Rail',
  AIR: 'Air',
  SHIP: 'Ship',
};

/** The consignment-note name for a mode: LR (road), RR (rail), AWB (air), B/L (ship). */
export function transportDocLabel(mode?: TransportMode): string {
  switch (mode) {
    case 'ROAD': return 'LR no.';
    case 'RAIL': return 'RR no.';
    case 'AIR': return 'AWB no.';
    case 'SHIP': return 'B/L no.';
    default: return 'LR / RR no.';
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, max = 60): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Vehicle numbers print without spaces / hyphens in capitals ("MH12AB1234"), like the e-Way bill. */
export function cleanVehicle(v: unknown): string {
  return str(v, 20).replace(/[\s-]+/g, '').toUpperCase();
}

/** Tolerant read of a stored value; undefined when nothing meaningful is set (keeps legacy rows clean). */
export function normalizeTransport(raw: unknown): TransportDetails | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: TransportDetails = {};
  if (TRANSPORT_MODES.includes(r.mode as TransportMode)) out.mode = r.mode as TransportMode;
  const vehicle = cleanVehicle(r.vehicle_no);
  if (vehicle) out.vehicle_no = vehicle;
  const name = str(r.transporter_name, 100);
  if (name) out.transporter_name = name;
  const id = str(r.transporter_id, 15).toUpperCase();
  if (id) out.transporter_id = id;
  const lr = str(r.lr_no, 30);
  if (lr) out.lr_no = lr;
  const lrDate = str(r.lr_date, 10);
  if (DAY.test(lrDate)) out.lr_date = lrDate;
  const ewb = str(r.eway_bill_no, 20).replace(/\s+/g, '');
  if (ewb) out.eway_bill_no = ewb;
  const km = Number(r.distance_km);
  if (Number.isFinite(km) && km > 0) out.distance_km = Math.min(Math.round(km), 4000);
  return hasTransport(out) ? out : undefined;
}

/** True when any printable transport field is set (a bare mode alone does not print a block). */
export function hasTransport(t: TransportDetails | undefined | null): boolean {
  if (!t) return false;
  return Boolean(t.vehicle_no || t.transporter_name || t.transporter_id || t.lr_no || t.eway_bill_no || t.distance_km);
}

export interface TransportRow {
  key: 'mode' | 'vehicle' | 'transporter' | 'lr' | 'eway' | 'distance';
  label: string;
  value: string;
}

/**
 * The label / value pairs the paper prints, in Tally's "Dispatch details" order. `date` formats
 * a local day the way the design asks. `skipEway` drops the e-Way number when the IRN block
 * already prints the same one.
 */
export function transportRows(
  t: TransportDetails | undefined | null,
  date: (day: string) => string,
  opts: { skipEway?: string } = {},
): TransportRow[] {
  if (!hasTransport(t) || !t) return [];
  const rows: TransportRow[] = [];
  if (t.mode) rows.push({ key: 'mode', label: 'Mode of transport', value: TRANSPORT_MODE_LABELS[t.mode] });
  if (t.transporter_name || t.transporter_id) {
    const value = [t.transporter_name, t.transporter_id && `ID ${t.transporter_id}`].filter(Boolean).join(' · ');
    rows.push({ key: 'transporter', label: 'Dispatched through', value });
  }
  if (t.vehicle_no) rows.push({ key: 'vehicle', label: 'Vehicle no.', value: t.vehicle_no });
  if (t.lr_no) {
    rows.push({ key: 'lr', label: `${transportDocLabel(t.mode)} & date`, value: [t.lr_no, t.lr_date ? date(t.lr_date) : ''].filter(Boolean).join(' dt. ') });
  }
  if (t.eway_bill_no && t.eway_bill_no !== opts.skipEway) rows.push({ key: 'eway', label: 'e-Way bill no.', value: t.eway_bill_no });
  if (t.distance_km) rows.push({ key: 'distance', label: 'Distance', value: `${t.distance_km} km` });
  return rows;
}

/** The e-Way fields saved by the e-Invoice module (`EInvoiceMeta`), as far as transport goes. */
export interface EwayMetaLike {
  transport?: string;
  vehicle?: string;
  transporter_id?: string;
  transporter_name?: string;
  transport_doc_no?: string;
  transport_doc_date?: string;
  distance?: number;
  eway_no?: string;
}

/**
 * Prefill from saved e-Way data: fields already typed on the document win; empty ones are
 * filled. Returns undefined when the meta has nothing to offer.
 */
export function transportFromEway(meta: EwayMetaLike | undefined | null, current?: TransportDetails): TransportDetails | undefined {
  if (!meta) return current;
  const fromMeta = normalizeTransport({
    mode: meta.transport,
    vehicle_no: meta.vehicle,
    transporter_id: meta.transporter_id,
    transporter_name: meta.transporter_name,
    lr_no: meta.transport_doc_no,
    lr_date: meta.transport_doc_date,
    distance_km: meta.distance,
    eway_bill_no: meta.eway_no,
  });
  if (!fromMeta) return current;
  const merged: Record<string, unknown> = { ...fromMeta };
  for (const [k, v] of Object.entries(current ?? {})) if (v !== undefined && v !== '') merged[k] = v;
  return normalizeTransport(merged);
}

/** True when the meta holds a transport field the document does not have yet. */
export function ewayPrefillAvailable(meta: EwayMetaLike | undefined | null, current?: TransportDetails): boolean {
  const next = transportFromEway(meta, current);
  return JSON.stringify(next ?? {}) !== JSON.stringify(normalizeTransport(current) ?? {});
}
