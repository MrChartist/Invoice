/**
 * 8D (8.64) — one cancel flow for a document with an IRN and / or an e-Way Bill (TallyPrime 7.0 pattern).
 *
 * Cancelling such a document in the books also needs the IRN and the e-Way Bill cancelled on the portals, each within
 * 24 hours of generation. This module prepares the two cancel requests as JSON (NIC API field names — the app never
 * calls a portal), works out the deadlines and records the status on the document's `einvoice_meta` row (additive
 * fields `irn_cancel` / `ewb_cancel`).
 *
 * Statutory / portal facts used (verify with your CA):
 *  - IRN: cancellable only within 24 hours of the Ack date; not partially; the number cannot be reused. After 24 hours
 *    the IRN stays valid — issue a credit note (and report it) instead. Rule 48(4) / e-invoice FAQ.
 *  - e-Way Bill: cancellable within 24 hours of generation (Rule 138(9)); after that the recipient may only reject it
 *    within 72 hours. An active e-Way Bill generated with the IRN has to be cancelled before the IRN.
 *  - Reason codes: IRN `1` duplicate, `2` data entry mistake, `3` order cancelled, `4` others; e-Way `1` duplicate,
 *    `2` order cancelled, `3` data entry mistake, `4` others.
 */

import { localDayOf } from './dates';
import { saveEInvoiceMeta, type EInvoiceMeta, type PortalCancel } from './einvoice';

export type CancelReason = PortalCancel['reason'];
export type { PortalCancel };

export const IRN_CANCEL_CODES: Record<CancelReason, string> = { duplicate: '1', data_entry: '2', order_cancelled: '3', other: '4' };
export const EWB_CANCEL_CODES: Record<CancelReason, number> = { duplicate: 1, order_cancelled: 2, data_entry: 3, other: 4 };
/** Hours after generation within which the IRP / e-Way portal accept a cancellation. */
export const CANCEL_WINDOW_HOURS = 24;
/** Hours within which the recipient may reject an e-Way Bill once it can no longer be cancelled. */
export const EWB_REJECT_HOURS = 72;

export type CancelStatus = PortalCancel['status'];

/** Local `YYYY-MM-DD[ hh:mm[:ss]]` → epoch ms (local time). Missing time = start of the day. */
export function parseLocalStamp(s: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s ?? '').trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
}

export interface CancelDeadline {
  /** Epoch ms of the deadline, null when the generation time is unknown. */
  until: number | null;
  /** Minutes left (negative once passed). */
  minutesLeft: number | null;
  open: boolean;
  /** The generation time had no clock time: the deadline assumes 00:00 (conservative). */
  approximate: boolean;
}

function deadline(stamp: string | undefined, now: Date): CancelDeadline {
  const t = parseLocalStamp(stamp);
  if (t === null) return { until: null, minutesLeft: null, open: false, approximate: false };
  const until = t + CANCEL_WINDOW_HOURS * 3600000;
  const minutesLeft = Math.floor((until - now.getTime()) / 60000);
  return { until, minutesLeft, open: minutesLeft >= 0, approximate: !/\d{2}:\d{2}/.test(String(stamp)) };
}

export interface CancelPlan {
  hasIrn: boolean;
  hasEwb: boolean;
  irn: CancelDeadline;
  ewb: CancelDeadline;
  /** Cancel the e-Way Bill first when both exist. */
  ewbFirst: boolean;
  /** Both windows (that apply) have passed: the remedy is a credit note. */
  creditNoteOnly: boolean;
}

export function cancelPlan(meta: Pick<EInvoiceMeta, 'irn' | 'ack_date' | 'eway_no' | 'eway_date'> | null | undefined, now = new Date()): CancelPlan {
  const hasIrn = !!meta?.irn;
  const hasEwb = !!meta?.eway_no;
  const irn = deadline(hasIrn ? meta?.ack_date : undefined, now);
  const ewb = deadline(hasEwb ? meta?.eway_date || meta?.ack_date : undefined, now);
  const irnClosed = hasIrn && irn.until !== null && !irn.open;
  return { hasIrn, hasEwb, irn, ewb, ewbFirst: hasIrn && hasEwb, creditNoteOnly: hasIrn ? irnClosed : hasEwb && ewb.until !== null && !ewb.open };
}

/** IRN cancel request (IRP API `CancelIRN` body). */
export function irnCancelJson(irn: string, reason: CancelReason, remark: string): string {
  return JSON.stringify({ Irn: irn.trim(), CnlRsn: IRN_CANCEL_CODES[reason], CnlRem: remark.trim().slice(0, 100) || 'Cancelled' }, null, 2);
}

/** e-Way Bill cancel request (e-Way API `CANEWB` body). */
export function ewbCancelJson(ewbNo: string, reason: CancelReason, remark: string): string {
  return JSON.stringify({ ewbNo: Number(String(ewbNo).replace(/\D/g, '')), cancelRsnCode: EWB_CANCEL_CODES[reason], cancelRmrk: remark.trim().slice(0, 50) || 'Cancelled' }, null, 2);
}

/** Pure: the meta row with a cancel step recorded. */
export function withCancel(meta: EInvoiceMeta, which: 'irn' | 'ewb', patch: Partial<PortalCancel> & Pick<PortalCancel, 'status'>, now = new Date()): EInvoiceMeta {
  const key = which === 'irn' ? 'irn_cancel' : 'ewb_cancel';
  const prev = meta[key];
  const next: PortalCancel = {
    reason: patch.reason ?? prev?.reason ?? 'order_cancelled',
    remark: patch.remark ?? prev?.remark ?? '',
    prepared_at: prev?.prepared_at ?? now.toISOString(),
    status: patch.status,
    ...(patch.status === 'done' ? { done_on: patch.done_on ?? prev?.done_on ?? localDayOf(now) } : {}), // QA14: the local day (UTC was the day before until 05:30 IST)
  };
  return { ...meta, [key]: next, updated_at: now.toISOString() };
}

export function recordCancel(meta: EInvoiceMeta, which: 'irn' | 'ewb', patch: Partial<PortalCancel> & Pick<PortalCancel, 'status'>): EInvoiceMeta {
  return saveEInvoiceMeta(withCancel(meta, which, patch));
}

/** Short status for pills: what is still open on the portals. */
export function cancelState(meta: EInvoiceMeta | null | undefined): 'none' | 'pending' | 'done' {
  if (!meta || (!meta.irn_cancel && !meta.ewb_cancel)) return 'none';
  const need = [meta.irn ? meta.irn_cancel : null, meta.eway_no ? meta.ewb_cancel : null].filter((x) => x !== null);
  return need.every((c) => c?.status === 'done') ? 'done' : 'pending';
}
