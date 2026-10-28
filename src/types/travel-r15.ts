/**
 * Round 15 (travel, tour and event businesses) — persisted shapes and additive fields of R15-B … R15-D
 * (docs/prd/round-15.md §6). Existing type files are not edited: the new optional fields arrive here by declaration
 * merging. Every Round 15 snapshot on a document lives under ONE record key `tv` (`R15_RECORD_KEYS` in
 * `src/store/invoice-defaults.ts`); there is no Round 15 line key (per-line particulars sit in `tv.lines[lineId]`;
 * pass-through lines reuse the R8 line key `charge_head_id: 'rule33'`). R15-B declares the sub-field types of every
 * package in one commit; C / D fill only their own block — an interface re-declared there merges with B's.
 * Passport numbers, dates of birth and visa copies are never stored (DPDP minimisation, PRD §6).
 * Types only (0 bytes). Working papers — verify with your CA (docs/CA_REVIEW.md §15, TV1–TV31).
 */

/* ════════════════════════════════════════ R15-B ════════════════════════════════════════ */

/** The travel business picked under Services → Travel, tours and events (settings `travel_kind`). */
export type TravelKind = 'tour_operator' | 'agent' | 'inbound' | 'events' | 'other';
/** GST regime of a trip / invoice (B3): tour operator 5 % no ITC, 18 %, agent fee + pure agent, exempt outside India. */
export type TvRegime = 'to5' | 'to18' | 'agent' | 'exempt_outside';
export type TripStatus = 'enquiry' | 'confirmed' | 'travelled' | 'closed' | 'cancelled';
export type TvComponent = 'air' | 'rail' | 'bus' | 'hotel' | 'transfer' | 'sightseeing' | 'visa' | 'insurance' | 'package'
  | 'venue' | 'catering' | 'decor' | 'artist' | 'av' | 'manpower' | 'other';

/** The views a kind turns on (B1 table); a switch the user set is never turned back by a profile. */
export interface TvSwitches {
  itc_block?: boolean;
  tcs_outbound?: boolean;
  costing?: boolean;
  tickets?: boolean;
  statements?: boolean;
  commissions?: boolean;
  pure_agent?: boolean;
  foreign_currency?: boolean;
  export_chip?: boolean;
  exempt_prompt?: boolean;
  budgets?: boolean;
  event_pos?: boolean;
  vendor_tds?: boolean;
}

/** Company object `travel_settings` (owner only, audited, synced as a singleton). C / D add their sub-fields. */
export interface TravelSettings {
  regime_default?: TvRegime;
  /** The owner chose the regime default on the desk (setup checklist step `regime`). */
  regime_ok?: boolean;
  iata?: { code?: string; bsp?: boolean };
  /** Vendor ids of the consolidators the agency books through. */
  consolidators?: string[];
  fee_defaults?: { domestic?: number; international?: number };
  /** D1: TCS base (TV6). */
  tcs?: { base: 'total' | 'taxable' };
  /** C1: air-ticket value method (Rule 32(3), TV11). */
  air_value?: 'deemed' | 'actual';
  /** C2: remembered statement column maps, by preset. */
  statement_maps?: Record<string, Record<string, string>>;
  switches?: TvSwitches;
  updated_at?: string;
}

export interface TvPax { name: string; type: 'adult' | 'child' | 'infant' }

/** B2: the trip / event file — a project cost centre with `CostCentre.tv` (the R14 matter precedent). */
export interface TripInfo {
  code: string;
  kind: 'trip' | 'event';
  scope: 'domestic' | 'outbound' | 'inbound';
  destination?: string;
  start?: string;
  end?: string;
  pax: TvPax[];
  regime: TvRegime;
  /** Default INR. */
  currency?: string;
  status: TripStatus;
  /** D3: event particulars (kind `event`). */
  event?: TvEvent;
}

/** B2: one component of a trip (table `travel_bookings`, dated by `start`). */
export interface TravelBooking {
  id: string;
  trip_id: string;
  component: TvComponent;
  vendor_id?: string;
  /** PNR / confirmation no. */
  ref?: string;
  start: string;
  end?: string;
  qty?: number;
  /** Cost in `cost_currency` (default INR) at `fx` (rate at booking). */
  cost: number;
  cost_currency?: string;
  fx?: number;
  /** Sell price to the client (INR). */
  sell: number;
  /** Recovered at actual as a pure agent (Rule 33) in the agent regime. */
  pure_agent?: boolean;
  status: 'held' | 'confirmed' | 'cancelled';
  /** The supplier bill when booked. */
  bill_id?: string;
  /** Invoice + line once billed (billed state is derived from it: the line must still be on a live invoice). */
  line_ref?: { invoice_id: string; line_id: string };
  notes?: string;
  /** C4: commission due from the principal on this booking. */
  commission?: number;
  /** C3: cancellation (supplier charge, our fee, refunds). */
  cancel?: { date: string; supplier_charge: number; fee: number; refund_in: number; refund_out: number; credit_note_id?: string };
  created_at: string;
  updated_at?: string;
}

/** C1: ticket particulars on a line (`tv.lines[lineId].tkt`). */
export interface TvTicket {
  pax?: string;
  airline?: string;
  ticket_no?: string;
  pnr?: string;
  sector?: string;
  class?: 'economy' | 'other';
  intl?: boolean;
  basic?: number;
  taxes?: number;
  airline_gst?: number;
}

/* ════════════════════════════════════════ R15-C ════════════════════════════════════════ */

/** C1: the air-ticket value method on a document (`tv.air`): Rule 32(3) deemed value or the actual fee (TV11). */
export interface TvSnapshot {
  air?: { method: 'deemed' | 'actual'; fee: number; value: number; line_id?: string; note?: string };
}

export interface TravelBooking {
  /** C1: tickets entered on an `air` booking (copied to the invoice's `tv.lines` when billed). */
  tkt?: TvTicket[];
}

/** C2: one row of a supplier statement (BSP TKTT / RFND / ADMA / ACMA, a consolidator or bed-bank line). */
export interface StatementRow {
  doc_no: string;
  type: string;
  date?: string;
  pax?: string;
  gross: number;
  taxes: number;
  commission: number;
  net: number;
  match?: { kind: 'invoice_line' | 'booking' | 'bill'; id: string };
  status?: 'matched' | 'diff' | 'missing' | 'ours_only';
  /** Our amount less theirs when `diff`. */
  diff?: number;
  /** ADM to record / dispute; a refund not yet passed on to the client. */
  flag?: 'adm' | 'refund';
  disputed?: boolean;
}

/** C2: table `supplier_statements` (dated by `period_end`; rows inside, ≤ 2,000 a statement). */
export interface SupplierStatement {
  id: string;
  vendor_id: string;
  kind: 'bsp' | 'consolidator' | 'bedbank';
  period_start: string;
  period_end: string;
  ref: string;
  rows: StatementRow[];
  totals: { gross: number; taxes: number; commission: number; net: number };
  bill_id?: string;
  file_name?: string;
  created_at: string;
  updated_at?: string;
}

/* ════════════════════════════════════════ R15-D (declared by B) ════════════════════════════════════════ */

export interface TvEvent {
  venue?: string;
  city?: string;
  state?: string;
  date_from?: string;
  date_to?: string;
  guests?: number;
  budget?: { head: string; approved: number }[];
}

/** The invoice snapshot `tv` (B: trip, regime, decl; C: lines; D: tcs, event, pos_note). */
export interface TvSnapshot {
  trip?: { id?: string; code: string; destination?: string; start?: string; end?: string; pax?: number; lead?: string; kind?: 'trip' | 'event' };
  regime?: TvRegime;
  /** The printed regime sentence (snapshotted, never re-derived). */
  decl?: string;
  lines?: Record<string, { tkt?: TvTicket }>;
  tcs?: { rate: number; base: number; label: string; slab?: string };
  event?: { venue?: string; state?: string; date_from?: string; date_to?: string };
  pos_note?: string;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 15 record snapshot (see `TvSnapshot`). */
    tv?: TvSnapshot;
  }
  interface Client {
    /** D2: a foreign tourist / non-resident buyer (TCS and POS prompts). */
    tv?: { foreign_tourist?: boolean; non_resident?: boolean };
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** B1: travel profile under `services` / `travel`; absent = no travel desk. */
    travel_kind?: TravelKind;
  }
}

declare module '../lib/cost-centres' {
  interface CostCentre {
    /** B2: trip / event fields (the trip is this project cost centre). */
    tv?: TripInfo;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** B2 / B3: the trip (and booking) a supplier bill belongs to; `itc_reason` = why ITC is claimed on a 5 % trip. */
    tv?: { trip_id: string; booking_id?: string; regime?: TvRegime; itc_reason?: string };
  }
  interface Vendor {
    /** B / C: the kind of travel supplier. */
    tv?: { kind: 'airline' | 'consolidator' | 'bsp' | 'hotel' | 'bedbank' | 'dmc' | 'venue' | 'artist' | 'other' };
  }
}
