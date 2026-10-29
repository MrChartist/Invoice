/**
 * R5-B1: consignment notes (LR / bilty). Table `consignment_notes`, numbered `LR/FY…` through the series counters (a
 * branch may use its own prefix, e.g. `LR-DEL`); numbers are never reused, a cancelled LR keeps its number.
 *
 *  - Freight = rate × basis (fixed, per kg / ton of charged weight, per package, per trip) + charges.
 *  - Person liable for GST: from the FY's GTA option and the payer's kind (`gta-option.ts`); an override needs a
 *    reason and is written to the audit trail.
 *  - Status: Booked → In transit (on a trip) → Delivered (POD) → Billed / Cancelled. "Billed" is derived from a live
 *    freight bill, so cancelling the bill frees the LR (`effectiveStatus`).
 *  - "Use for e-way Part B": copies vehicle and LR no. / date into the consignor's e-way meta row when that invoice is
 *    in this company, otherwise builds the R3-C5 Part-B update JSON for the typed EWB numbers.
 * Guards: role (`doc.create`), period lock, series counter. Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ConsignmentNote, FreightBasis, GstLiable, LrPaymentBasis, LrPod, LrStatus } from '../../types/transport-works-r5';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { cleanVehicle } from '../transport';
import { liablePerson, optionFor, recipientKind } from './gta-option';
import type { GtaRecipientKind } from '../transport-works-rules';

export const LR_TABLE = 'consignment_notes';
export const LR_PREFIX = 'LR';
export const FREIGHT_BASES: readonly FreightBasis[] = ['fixed', 'per_kg', 'per_ton', 'per_package', 'per_trip'];
export const PAYMENT_BASES: readonly LrPaymentBasis[] = ['paid', 'to_pay', 'tbb'];
export const CHARGE_KINDS = ['loading', 'unloading', 'hamali', 'detention', 'door_delivery', 'lr_charge', 'other'] as const;
/** Charges billed as their own line on the freight bill. */
export const OWN_LINE_CHARGES: ReadonlySet<string> = new Set(['detention', 'other']);

export class LrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LrError';
  }
}

export function loadLrs(): readonly ConsignmentNote[] {
  return peekTable<ConsignmentNote>(LR_TABLE).filter((r) => r && typeof r.id === 'string');
}

/** Series prefix: `LR`, or a branch prefix such as `LR-DEL` (letters, digits, hyphen). */
export function lrPrefix(p?: string): string {
  const s = String(p ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return s || LR_PREFIX;
}

export function nextLrNumber(date: string, prefix?: string, rows: readonly Pick<ConsignmentNote, 'number'>[] = loadLrs()): string {
  return nextSeriesNumberFor(lrPrefix(prefix), date, rows.map((r) => r.number));
}

/** Freight before GST: rate × basis quantity, plus charges (split so the bill can put some on their own line). */
export function freightOf(lr: Pick<ConsignmentNote, 'basis' | 'rate' | 'lines' | 'charges'>): { freight: number; charges: number; ownLine: number; total: number } {
  const lines = lr.lines ?? [];
  const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + num(f(l)), 0);
  const rate = num(lr.rate);
  const qty: Record<FreightBasis, number> = {
    fixed: 1,
    per_trip: 1,
    per_kg: sum((l) => l.charged_weight ?? l.actual_weight ?? 0),
    per_ton: sum((l) => l.charged_weight ?? l.actual_weight ?? 0) / 1000,
    per_package: sum((l) => l.packages),
  };
  const freight = round2(rate * (qty[lr.basis] ?? 1));
  let charges = 0;
  let ownLine = 0;
  for (const c of lr.charges ?? []) {
    const a = round2(num(c.amount));
    if (OWN_LINE_CHARGES.has(c.kind)) ownLine = round2(ownLine + a);
    else charges = round2(charges + a);
  }
  return { freight, charges, ownLine, total: round2(freight + charges + ownLine) };
}

/** Who pays the freight: consignor (paid), consignee (to pay) or the billing party (to be billed; consignor when unset). */
export function payerId(lr: Pick<ConsignmentNote, 'payment_basis' | 'consignor_id' | 'consignee_id' | 'billing_party_id'>): string {
  if (lr.payment_basis === 'paid') return lr.consignor_id;
  if (lr.payment_basis === 'to_pay') return lr.consignee_id;
  return lr.billing_party_id || lr.consignor_id;
}

/** Status as the screens see it: "billed" only while the freight bill is live (cancelling the bill frees the LR). */
export function effectiveStatus(lr: ConsignmentNote, invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[]): LrStatus {
  if (lr.status === 'cancelled') return 'cancelled';
  const bill = lr.bill_id ? invoices.find((i) => i.id === lr.bill_id) : undefined;
  if (bill && bill.status !== 'Cancelled') return 'billed';
  if (lr.pod?.delivered_on) return 'delivered';
  if (lr.trip_id) return 'in_transit';
  return 'booked';
}

const NEXT: Record<LrStatus, readonly LrStatus[]> = {
  booked: ['in_transit', 'delivered', 'billed', 'cancelled'],
  in_transit: ['delivered', 'billed', 'cancelled'],
  delivered: ['billed', 'cancelled'],
  billed: [],
  cancelled: [],
};
export const canMove = (from: LrStatus, to: LrStatus): boolean => NEXT[from].includes(to);

export interface LrInput extends Omit<ConsignmentNote, 'id' | 'number' | 'status' | 'liable' | 'created_at' | 'updated_at'> {
  id?: string;
  /** Kind of the payer when it has no GSTIN (factory, society …); a GSTIN reads as a registered person. */
  recipient_kind?: GtaRecipientKind;
  /** Override of the derived liable person (needs `liable_override_reason`). */
  liable_override?: GstLiable;
}

/** Pure: the derived liable person for an LR (option of its FY × payer kind × date). */
export function derivedLiable(lr: Pick<ConsignmentNote, 'date' | 'payment_basis' | 'consignor_id' | 'consignee_id' | 'billing_party_id'>, parties: readonly { id?: string; gstin?: string }[], kind?: GtaRecipientKind, options?: Parameters<typeof optionFor>[1]): GstLiable {
  const payer = parties.find((p) => p.id === payerId(lr));
  return liablePerson(optionFor(lr.date, options), recipientKind(payer, kind), lr.date);
}

const lockOf = (r: Pick<ConsignmentNote, 'id' | 'date' | 'number'>) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

function validate(input: LrInput): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '')) return 'Choose the LR date.';
  if (!input.consignor_id || !input.consignee_id) return 'Choose the consignor and the consignee.';
  if (!String(input.from?.place ?? '').trim() || !String(input.to?.place ?? '').trim()) return 'Enter the from and to places.';
  if (!(input.lines ?? []).some((l) => String(l.description ?? '').trim() && num(l.packages) > 0)) return 'Add the goods: description and packages.';
  if (!FREIGHT_BASES.includes(input.basis)) return 'Choose the freight basis.';
  if (!PAYMENT_BASES.includes(input.payment_basis)) return 'Choose who pays (paid / to pay / to be billed).';
  if (input.liable_override && !String(input.liable_override_reason ?? '').trim()) return 'Give a reason for changing the person liable for GST.';
  return '';
}

/** Create or edit an LR (not once billed or cancelled). Role, period lock, series counter, audit. */
export function saveLr(input: LrInput, parties: readonly { id?: string; gstin?: string }[]): ConsignmentNote {
  requireAccess('doc.create');
  const err = validate(input);
  if (err) throw new LrError(err);
  const all = getTable<ConsignmentNote>(LR_TABLE);
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  if (prev && (prev.status === 'cancelled' || prev.bill_id)) throw new LrError(`LR ${prev.number} is ${prev.status === 'cancelled' ? 'cancelled' : 'billed'} and cannot be changed.`);
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  const prefix = lrPrefix(input.prefix);
  const number = prev?.number ?? nextLrNumber(input.date, prefix, all);
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, prev ? 'edit' : 'create');
  const derived = derivedLiable(input, parties, input.recipient_kind);
  const liable = input.liable_override ?? derived;
  const overridden = liable !== derived;
  const now = new Date().toISOString();
  const { recipient_kind: _k, liable_override: _o, ...rest } = input;
  void _k;
  void _o;
  const row: ConsignmentNote = {
    ...prev,
    ...rest,
    id,
    number,
    prefix,
    vehicle_no: cleanVehicle(input.vehicle_no) || undefined,
    lines: (input.lines ?? []).filter((l) => String(l.description ?? '').trim() && num(l.packages) > 0),
    charges: (input.charges ?? []).filter((c) => num(c.amount) > 0),
    rate: round2(num(input.rate)),
    liable,
    ...(overridden ? { liable_override_reason: String(input.liable_override_reason).trim() } : { liable_override_reason: undefined }),
    status: prev?.status ?? 'booked',
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };
  setTable(LR_TABLE, prev ? all.map((r) => (r.id === id ? row : r)) : [...all, row]);
  recordSeries(number);
  if (overridden && (!prev || prev.liable !== liable)) {
    audit.record({ entity: 'invoice', entity_id: id, action: 'override', doc_number: number, summary: `LR ${number}: person liable for GST set to ${liable === 'gta' ? 'the GTA' : 'the recipient (reverse charge)'} instead of ${derived === 'gta' ? 'the GTA' : 'the recipient'}, ${row.liable_override_reason}` });
  }
  return row;
}

function patch(id: string, action: 'edit' | 'cancel', fn: (r: ConsignmentNote) => ConsignmentNote): ConsignmentNote {
  requireAccess('doc.create');
  const all = getTable<ConsignmentNote>(LR_TABLE);
  const r = all.find((x) => x.id === id);
  if (!r) throw new LrError('LR not found.');
  assertUnlocked(lockOf(r), action);
  const next = { ...fn(r), updated_at: new Date().toISOString() };
  setTable(LR_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Proof of delivery (Delivered). */
export function recordPod(id: string, pod: LrPod): ConsignmentNote {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pod.delivered_on ?? '')) throw new LrError('Choose the delivery date.');
  return patch(id, 'edit', (r) => {
    if (r.status === 'cancelled') throw new LrError(`LR ${r.number} is cancelled.`);
    if (pod.delivered_on < r.date) throw new LrError('Delivery cannot be before the LR date.');
    return { ...r, pod: { ...pod, ...(pod.received_by?.trim() ? { received_by: pod.received_by.trim() } : {}) }, status: r.bill_id ? r.status : 'delivered' };
  });
}

/** Cancel with a reason; the number stays used. Refused while a live freight bill carries the LR. */
export function cancelLr(id: string, reason: string, invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[]): ConsignmentNote {
  if (!reason.trim()) throw new LrError('Give the reason for cancelling.');
  return patch(id, 'cancel', (r) => {
    const st = effectiveStatus(r, invoices);
    if (!canMove(st, 'cancelled')) throw new LrError(`LR ${r.number} is ${st} and cannot be cancelled${st === 'billed' ? ': cancel its freight bill first' : ''}.`);
    return { ...r, status: 'cancelled', cancelled_reason: reason.trim() };
  });
}

/** Set / clear the trip of LRs (In transit). Internal to trips.ts. */
export function setLrTrip(ids: readonly string[], tripId: string | undefined): void {
  const want = new Set(ids);
  if (!want.size) return;
  setTable(LR_TABLE, getTable<ConsignmentNote>(LR_TABLE).map((r) => (want.has(r.id) ? { ...r, trip_id: tripId, status: r.status === 'booked' || r.status === 'in_transit' ? (tripId ? 'in_transit' : 'booked') : r.status } : r)));
}

/* ── e-Way Part B ─────────────────────────────────────────────── */

type MetaRow = { invoice_id: string; eway_no?: string; vehicle?: string; transport?: string; transport_doc_no?: string; transport_doc_date?: string };

const splitNos = (s: string | undefined) => String(s ?? '').split(/[\s,;/]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Part B from an LR: when the consignor's invoices are in this company, their e-way meta rows get the vehicle and the
 * LR no. / date (returns how many); otherwise the Part-B update JSON for the typed EWB numbers is returned instead.
 */
export async function ewayPartB(lr: ConsignmentNote, invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number' | 'status'>[]): Promise<{ updated: number; json?: string }> {
  const vehicle = cleanVehicle(lr.vehicle_no);
  if (!vehicle) throw new LrError('Enter the vehicle number on the LR first.');
  const nos = new Set(splitNos(lr.invoice_nos).map((n) => n.toUpperCase()));
  const own = invoices.filter((i) => i.status !== 'Cancelled' && nos.has(String(i.invoice_number).toUpperCase())).map((i) => i.id);
  const meta = getTable<MetaRow>('einvoice_meta');
  const hit = new Set(meta.filter((m) => own.includes(m.invoice_id) && m.eway_no).map((m) => m.invoice_id));
  if (hit.size) {
    requireAccess('doc.edit');
    setTable('einvoice_meta', meta.map((m) => (hit.has(m.invoice_id) ? { ...m, vehicle, transport: 'ROAD', transport_doc_no: lr.number, transport_doc_date: lr.date } : m)));
    return { updated: hit.size };
  }
  const ewbs = splitNos(lr.eway_nos);
  if (!ewbs.length) throw new LrError('Neither the consignor’s invoice nor an e-way bill number is on this LR.');
  const { vehicleUpdateJson } = await import('../eway-desk');
  const json = JSON.stringify(vehicleUpdateJson(ewbs, { vehicle, place: lr.from.place, stateCode: lr.from.state, reason: 'others', remark: 'LR booked', docNo: lr.number, docDate: lr.date, mode: 'ROAD' }), null, 2);
  return { updated: 0, json };
}
