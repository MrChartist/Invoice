/**
 * Round 3 package A (restaurant & counter) — persisted shapes and additive fields.
 * `src/types/invoice.ts` is not edited: the invoice / line / catalogue fields are added here by
 * declaration merging (additive, optional, snake_case). See docs/features/restaurant.md.
 */

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R3-A1): the running table order this POS bill settled. */
    table_order_id?: string;
    /** Additive (R3-A3): part of a split bill ("Part 2 of 3"). */
    split_of?: SplitRef;
  }
  interface InvoiceItem {
    /** Additive (R3-A4), order / invoice lines: the parent line id of a priced modifier (child line). */
    modifier_of?: string;
    /** Additive (R3-A4), order / invoice lines: free modifiers and the captain's note, printed on the KOT. */
    note?: string;
    /** Additive (R3-A3), order lines: seat number for a seat-wise split. */
    seat?: number;
    /** Additive (R3-A4), catalogue rows: "not available today" — the local day it was switched off. */
    unavailable_on?: string;
  }
}

export interface SplitRef {
  order_id: string;
  /** 1-based part number. */
  part: number;
  parts: number;
}

export type OrderChannel = 'dine_in' | 'takeaway' | 'delivery' | 'aggregator';
export type OrderStatus = 'open' | 'printed' | 'settled' | 'void';

/** Settings → Tables → areas (`dining_areas`). */
export interface DiningArea {
  id: string;
  name: string;
  /** A `price_levels` row applied to every line ordered in this area. */
  price_level_id?: string;
  /** Optional service charge %, off (absent / 0) by default. Verify with your CA / legal adviser. */
  service_charge_pct?: number;
  sort?: number;
  created_at?: string;
}

/** Settings → Tables → tables (`dining_tables`). */
export interface DiningTable {
  id: string;
  name: string;
  seats: number;
  area_id: string;
  sort?: number;
  created_at?: string;
}

/** One line of a running order: an invoice line plus who added it and when. */
export interface OrderLine {
  id: string;
  name: string;
  type: string;
  hsn?: string;
  unit?: string;
  quantity: number;
  rate: number;
  tax_rate?: number;
  cess_rate?: number;
  cess_per_unit?: number;
  discount_percent?: number;
  amount: number;
  unit_factor?: number;
  sold_by_weight?: boolean;
  /** Catalogue id the line came from (station + 86 lookups). */
  item_id?: string;
  /** Stock group of the item (station routing). */
  group_id?: string;
  modifier_of?: string;
  /** Modifier option id when this is a priced child line. */
  option_id?: string;
  note?: string;
  seat?: number;
  /** A rate typed by the cashier: never re-priced by the area price level. */
  typed_rate?: boolean;
  price_basis?: string;
  /**
   * Quantity already sent to the kitchen on another order (a transfer moves it here; negative on the
   * source line). Sent quantity = Σ this line's KOT quantities + this offset.
   */
  sent_offset?: number;
  added_by?: string;
  added_at?: string;
}

export interface KotLine {
  line_id: string;
  name: string;
  qty: number;
  unit?: string;
  note?: string;
  seat?: number;
}

/** A kitchen order ticket. Not a tax document; `number` restarts each local day. */
export interface Kot {
  id: string;
  /** "K12". */
  number: string;
  /** Local day (YYYY-MM-DD) of the daily counter. */
  day: string;
  at: string;
  by: string;
  station: string;
  kind: 'new' | 'cancel';
  lines: KotLine[];
  reason?: CancelReason;
  /** Times it was reprinted (each copy is marked DUPLICATE). */
  reprints?: number;
  /** Kept from a merged order. */
  from_order?: string;
}

export type CancelReason = 'wrong_order' | 'customer_cancelled' | 'out_of_stock' | 'other';

export type OrderEventKind =
  | 'open' | 'add' | 'move' | 'merge' | 'transfer' | 'cancel' | 'kot' | 'reprint'
  | 'print' | 'reopen' | 'settle' | 'part_paid' | 'void' | 'service_charge';

export interface OrderEvent {
  at: string;
  by: string;
  kind: OrderEventKind;
  from?: string;
  to?: string;
  line?: string;
  qty?: number;
  /** Value of a cancellation (qty × rate) for the leakage view. */
  value?: number;
  reason?: CancelReason | string;
  note?: string;
}

/** Equal / custom split: one invoice, several payers settled one by one. */
export interface PayerRow {
  name?: string;
  amount: number;
  paid?: boolean;
  method?: string;
  payment_id?: string;
}

export interface OrderClient {
  id?: string;
  name: string;
  phone?: string;
  gstin?: string;
}

/** A running order (`table_orders`). Not an invoice: no GST number, never in reports. */
export interface TableOrder {
  id: string;
  /** Local day it was opened (sync DATED key, token counter). */
  day: string;
  area_id: string;
  table_id?: string;
  channel: OrderChannel;
  /** Takeaway / delivery / aggregator token, counted per local day. */
  token?: number;
  covers: number;
  captain_id?: string;
  captain_name?: string;
  client?: OrderClient;
  /** Aggregator orders: the e-commerce operator's GSTIN (Sec 9(5)). */
  eco_gstin?: string;
  eco_name?: string;
  /** The aggregator's own order id, typed in. */
  ref?: string;
  lines: OrderLine[];
  kots: Kot[];
  log: OrderEvent[];
  status: OrderStatus;
  opened_at: string;
  printed_at?: string;
  settled_at?: string;
  invoice_ids?: string[];
  /** Service charge % for this order (copied from the area); the cashier can remove it. */
  service_charge_pct?: number;
  /** The cashier removed the service charge for this bill. */
  service_charge_off?: boolean;
  /** Equal / custom split in progress. */
  payers?: PayerRow[];
}

/** Station map and small company settings (`restaurant_settings`, one object). */
export interface RestaurantSettings {
  /** Default service charge % for new areas (0 = off). */
  service_charge_default?: number;
  token_reset: 'daily';
  /** Stock group id → station name. Unmapped items go to "Kitchen". */
  stations?: Record<string, string>;
  /** Station names offered in the map. */
  station_names?: string[];
  /** A clerk's cancellations above this per order ask for the owner's PIN. */
  cancel_cap?: { lines: number; amount: number };
  /** "Auto-86 at zero stock" for tracked items (off by default). */
  auto86?: boolean;
}

/** Settings → Tables → Modifiers (`modifier_groups`). */
export interface ModifierOption {
  id: string;
  name: string;
  /** ₹ ≥ 0. A priced option becomes a child line; a free one is a note. */
  price: number;
  /** Optional catalogue item for stock and its own HSN / GST. */
  item_id?: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: ModifierOption[];
  /** Catalogue item ids it applies to. */
  item_ids?: string[];
  /** Stock group ids it applies to. */
  group_ids?: string[];
  created_at?: string;
}
