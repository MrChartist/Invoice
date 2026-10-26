/**
 * Round 7 hotel pack — every persisted shape (R7-A owns this file; R7-B and R7-C append to their own marked blocks).
 * `src/types/invoice.ts` is not edited: additive record fields come by declaration merging below.
 *
 * Tables (company data, backed up and synced): `hotel_room_types`, `hotel_rooms`, `hotel_rate_plans`,
 * `hotel_reservations` (DATED `arrival`, NUMBERED `RES/FY…`), `hotel_folios` (DATED `opened_on`), `hotel_guests`,
 * `hotel_night_audits` (DATED `business_date`); object `hotel_settings`. All stay dates are local days (`YYYY-MM-DD`);
 * a night is named by its start day (the night of 24 Oct is 24 → 25 Oct). Money is rupees, rounded to paise.
 */

/* ── R7-A: additive fields on existing records ─────────────────── */

declare module './invoice' {
  interface InvoiceRecord {
    /** R7-B3: the folio (window) this check-out / interim invoice bills. */
    folio_id?: string;
    /** R7-B3: the reservation it belongs to. */
    reservation_id?: string;
    /** R7-B3: stay snapshot printed on the invoice (never re-read from the reservation). */
    stay?: StaySnapshot;
    /** R7-C1: accommodation band of the invoice's room-nights (snapshot). */
    hotel_band?: 'low' | 'high' | 'mixed';
  }
}

export interface StaySnapshot {
  arrival: string;
  departure: string;
  /** Room numbers. */
  rooms: string[];
  nights: number;
  adults: number;
  children: number;
}

/* ── R7-A: masters ─────────────────────────────────────────────── */

export type MealPlan = 'EP' | 'CP' | 'MAP' | 'AP';
export type HkStatus = 'clean' | 'dirty' | 'inspected' | 'ooo' | 'oos';

/** `hotel_room_types` (master). */
export interface RoomType {
  id: string;
  name: string;
  code: string;
  base_occupancy: number;
  max_occupancy: number;
  max_extra_beds: number;
  /** SAC (default 996311). */
  sac?: string;
  sort?: number;
  /** D2: a dormitory bed sold separately is the unit (not the room). */
  dorm?: boolean;
}

/** `hotel_rooms` (master; housekeeping fields written by `doc.create` users through `housekeeping.ts`). */
export interface Room {
  id: string;
  number: string;
  room_type_id: string;
  floor?: string;
  active: boolean;
  /** D18: branch sender profile id of the property (absent = the main profile). */
  property_id?: string;
  hk_status?: HkStatus;
  hk_at?: string;
  hk_by?: string;
  /** Out of order from … to (local days, both inclusive): no booking may use these nights. */
  ooo?: { from: string; to: string; reason: string };
}

/** Rates of one room type in a plan (tax-exclusive unless the plan says `tax_inclusive`). */
export interface RoomRate {
  room_type_id: string;
  /** Room rate for 1 adult and for 2 adults. */
  single: number;
  double: number;
  extra_adult: number;
  extra_child: number;
  extra_bed: number;
  /** Own weekend rates (else the plan's `weekend_pct` uplift). */
  weekend_single?: number;
  weekend_double?: number;
}

export interface Season {
  name: string;
  from: string;
  to: string;
  /** pct: every charge ± value %; amount: room rate + value; override: room rate = value. */
  kind: 'pct' | 'amount' | 'override';
  value: number;
}

/** B6 cancellation / no-show policy (fields declared here, used by R7-B). */
export interface CancelPolicy {
  free_until_hours: number;
  charge: 'none' | 'first_night' | 'pct' | 'full';
  pct?: number;
  no_show: 'first_night' | 'full' | 'none';
}

/** `hotel_rate_plans` (master). */
export interface RatePlan {
  id: string;
  name: string;
  code: string;
  meal_plan: MealPlan;
  rates: RoomRate[];
  /** Days of week (0 = Sunday) that are weekend nights. Default Fri, Sat. */
  weekend_days?: number[];
  weekend_pct?: number;
  /** Later rows win on overlap. */
  seasons?: Season[];
  min_stay?: number;
  tax_inclusive?: boolean;
  audience: 'public' | 'corporate' | 'agent' | 'ota';
  /** A company's or agent's own plan. */
  client_id?: string;
  /** Meal component per adult per day (CP / MAP / AP): information for the folio and annexure. */
  meal_per_adult?: number;
  /** D5: meals priced separately → `fnb` lines at the restaurant rate (else composite with the room). */
  meals_separate?: boolean;
  policy?: CancelPolicy;
  active?: boolean;
}

/* ── R7-A: reservations ────────────────────────────────────────── */

/** One night's price snapshot (pre-GST; `gross` kept when the plan was tax-inclusive). */
export interface NightPrice {
  night: string;
  room: number;
  extra_adult: number;
  extra_child: number;
  extra_bed: number;
  /** Meal share inside `total` (information only). */
  meal: number;
  total: number;
  gross?: number;
}

export type LineStatus = 'booked' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';

export interface FormCTrack {
  /** ISO instant: check-in + the rule's hours. */
  due_at: string;
  filed_at?: string;
  ref?: string;
  /** C2: the check-out update tick. */
  checkout_updated_at?: string;
}

/** A room line of a reservation (one room, or a type-level booking before a room is assigned). */
export interface RoomLine {
  id: string;
  room_type_id: string;
  room_id?: string;
  rate_plan_id: string;
  adults: number;
  children: number;
  extra_beds: number;
  nightly: NightPrice[];
  status: LineStatus;
  /** Own dates when the line differs from the reservation (early departure, extension). */
  arrival?: string;
  departure?: string;
  /** D14: not a supply — counted as occupied, never posted or invoiced. */
  comp?: 'complimentary' | 'house';
  checked_in_at?: string;
  checked_out_at?: string;
  guest_ids?: string[];
  form_c?: FormCTrack;
}

export type ResStatus = 'tentative' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled' | 'no_show';
export type ResSource = 'walk_in' | 'phone' | 'direct' | 'company' | 'agent' | 'ota';

/** `hotel_reservations` (DATED `arrival`, NUMBERED `RES/FY…`). */
export interface Reservation {
  id: string;
  number: string;
  booked_on: string;
  source: ResSource;
  /** OTA details (R7-B5). */
  ota?: { name: string; ref?: string; gstin?: string; collect: 'ota_collect' | 'hotel_collect'; gross?: number };
  guest: { name: string; phone?: string; email?: string; nationality?: string; guest_id?: string };
  /** R7-B4: who pays (a client); absent = the guest. */
  bill_to?: { client_id: string; name: string };
  arrival: string;
  departure: string;
  lines: RoomLine[];
  status: ResStatus;
  guarantee: 'none' | 'advance' | 'company' | 'card_noted';
  notes?: string;
  /** Advance receipt vouchers (`advances`) taken for this booking. */
  advance_ids?: string[];
  /** R7-B1 routing rules: kinds → window. */
  routing?: { kinds: FolioLineKind[]; window: number }[];
  /** R7-B6 (fields only). */
  cancellation?: { on: string; charge: number; waived?: boolean; reason?: string; invoice_id?: string; refund_id?: string };
  property_id?: string;
  created_at?: string;
  updated_at?: string;
}

/* ── R7-A: guests ──────────────────────────────────────────────── */

export type IdType = 'aadhaar' | 'passport' | 'driving_licence' | 'voter_id' | 'other';

/** Form C fields of a foreign guest (as understood — verify). */
export interface ForeignDetails {
  passport_no?: string;
  passport_place?: string;
  passport_issued?: string;
  passport_expiry?: string;
  visa_no?: string;
  visa_type?: string;
  visa_place?: string;
  visa_issued?: string;
  visa_expiry?: string;
  arrived_india_on?: string;
  arrived_from?: string;
  next_destination?: string;
  purpose?: string;
  address_in_india?: string;
}

/** `hotel_guests` (personal data: kept on the device, vault mode advised; ID fields hidden from the edit log). */
export interface Guest {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** ISO country code; 'IN' (or empty) = Indian. */
  nationality?: string;
  dob?: string;
  id_doc?: { type: IdType; number: string; masked?: boolean };
  /** Optional ID image (`assets` id); off by default. */
  id_image?: string;
  foreign?: ForeignDetails;
  created_at?: string;
  updated_at?: string;
}

/* ── R7-A / R7-B: folios (shape fixed here so the night audit can post) ── */

export type FolioLineKind =
  | 'room' | 'extra_bed' | 'extra_person' | 'meal_plan' | 'fnb' | 'laundry' | 'minibar' | 'transport' | 'misc'
  | 'cancellation' | 'no_show' | 'allowance';

export interface FolioLine {
  id: string;
  /** Idempotency key (`stay:<line id>:<night>[:part]` for the nightly post). */
  key?: string;
  /** Business date. */
  date: string;
  kind: FolioLineKind;
  desc: string;
  qty: number;
  rate: number;
  amount: number;
  sac?: string;
  room_no?: string;
  /** Meal share inside a composite room line (information). */
  meal?: number;
  src?: { table_order_id?: string; invoice_id?: string; night?: string; line_id?: string };
  void?: { by: string; at: string; reason: string };
  moved_from?: string;
}

/** `hotel_folios` (DATED `opened_on`). Not a tax document: no GST, no tax-series number. */
export interface Folio {
  id: string;
  /** `RES/FY26-27/0001 · W1` (or `House · <name>`). */
  name: string;
  reservation_id?: string;
  line_id?: string;
  /** D10: a non-staying house account. */
  house?: boolean;
  window: number;
  payer: { kind: 'guest' | 'client'; client_id?: string; name: string };
  opened_on: string;
  lines: FolioLine[];
  /** Advances / receipts applied (R7-B). */
  applied?: { kind: 'advance' | 'payment'; id: string; amount: number; date: string }[];
  status: 'open' | 'settled' | 'invoiced';
  invoice_ids?: string[];
}

/* ── R7-A: night audit ─────────────────────────────────────────── */

export interface AuditStats {
  available: number;
  occupied: number;
  complimentary: number;
  house: number;
  ooo: number;
  room_revenue: number;
  adr: number;
  revpar: number;
  /** Per cent, 2 decimals. */
  occupancy: number;
}

/** `hotel_night_audits` (DATED `business_date`). */
export interface NightAudit {
  id: string;
  business_date: string;
  at: string;
  by: string;
  posted_keys: string[];
  no_shows: string[];
  late_arrivals: string[];
  due_outs: string[];
  stats: AuditStats;
  revenue_by_kind: Partial<Record<FolioLineKind, number>>;
  payments_by_mode: Record<string, number>;
  guest_ledger: number;
  advances_held: number;
}

/* ── R7-A: settings ────────────────────────────────────────────── */

/** C1 specified-premises declaration (Annexure VII / VIII / IX), per premises (profile). */
export interface PremisesDecl {
  fy: string;
  kind: 'opt_in' | 'new_reg_opt_in' | 'opt_out';
  filed_on: string;
  ref?: string;
  property_id?: string;
}

/** Object `mrchartist_inv_hotel_settings`. */
export interface HotelSettings {
  /** Moves only through the night audit. */
  business_date: string;
  checkin_time: string;
  checkout_time: string;
  clerk_void_cap: { lines: number; amount: number };
  interim_days: number;
  /** D7: offer interim invoices for in-house guests on 31 Mar. */
  interim_year_end: boolean;
  premises: PremisesDecl[];
  tax_inclusive_default: boolean;
  sac_room: string;
  sac_fnb: string;
  /** Night audit marks occupied rooms dirty. */
  hk_dirty_on_audit: boolean;
  /** Registration-card terms. */
  terms?: string;
  /** C1: typed highest unit-night value of a year before the app, per FY. */
  prev_fy_max_value?: Record<string, number>;
}

/* ── R7-B block (append below) ─────────────────────────────────── */

declare module './restaurant' {
  interface TableOrder {
    /** R7-B2: settled by "charge to room" onto this folio (no POS bill; the check-out invoice charges it). */
    folio_id?: string;
  }
}

declare module './invoice' {
  interface Client {
    /** R7-B4: hotel billing defaults of a company / travel agent (master only). */
    hotel?: ClientHotel;
  }
}

/** R7-B4 (D11): TDS the company deducts (`none` default, chosen by the user — the app never guesses). */
export interface ClientHotel {
  tds_default?: 'none' | '194I-B' | '194C';
  /** Travel agent's commission % on the room value (194H on payment). */
  commission_pct?: number;
  rate_plan_id?: string;
}

/** R7-B additive fields on folio lines (same-file interface merging). */
export interface FolioLine {
  /** GST % of a laundry / minibar / misc line (from its catalogue item or the default). */
  tax_rate?: number;
  /** B6 (D13): value of the unit-night a cancellation / no-show charge replaces — decides its band. */
  band_value?: number;
}

/** R7-B additive fields on reservations. */
export interface Reservation {
  /** B4: who the bill goes to (company / agent need `bill_to`). Absent = guest, or company when `bill_to` is set. */
  bill_kind?: 'guest' | 'company' | 'agent';
  /** B4: the agent's commission bill draft (`purchase_drafts`). */
  commission?: { draft_id: string; amount: number; date: string };
}

/* ── R7-C block (append below) ─────────────────────────────────── */
