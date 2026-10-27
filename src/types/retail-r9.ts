/**
 * Round 9 (retail shops) — persisted shapes and additive fields of the five packages.
 * `src/types/invoice.ts`, `purchases.ts`, `localDb.ts` and `inventory.ts` are not edited: the new optional fields arrive
 * here by declaration merging (additive, snake_case). One block per package (§6 of docs/prd/round-9.md), marked
 * `// RT-A` … `// RT-E`: each package edits only its own block. Record keys are listed in `R9_RECORD_KEYS` and line
 * keys in `R9_LINE_KEYS` (`src/store/invoice-defaults.ts`, owned by RT-A), so the editor and `normalizeRecord` keep
 * them. Everything here is a working paper — verify with your CA.
 */
import type { PriceBandKind } from '../lib/retail-rules';

/* ════════════════════════════════════════ RT-A ════════════════════════════════════════ */

/** The shop picked under the `kirana` business type (settings `retail_kind`; absent = not chosen). */
export type RetailKind = 'grocery' | 'pharmacy' | 'apparel' | 'electronics' | 'jewellery' | 'general';

export type GuardMode = 'off' | 'warn' | 'block';

/** Company object `mrchartist_inv_retail_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface RetailSettings {
  /** RT-A2: no sale above MRP (Legal Metrology Rule 18(2)). Absent = off (existing companies). */
  mrp_guard?: GuardMode;
  /** RT-A3: home-delivery orders and riders (the "Delivery" switch on the POS / editor). */
  delivery?: { enabled?: boolean };
  /** RT-A4: the short book offered at the counter when an item is not found / out of stock. */
  short_book?: { enabled?: boolean };
  /** RT-A4: Free and Disc % cells on supplier bill lines. */
  free_qty?: boolean;
  /** RT-E3 (generic): cash receipts of ₹2 lakh or more (Sec 269ST) — warn / block. */
  cash_guard?: GuardMode;
  /** RT-E3: a sale above the PAN limit needs PAN or a Form 60 / 97 declaration (block when on). */
  require_pan?: boolean;
  updated_at?: string;
}

/** RT-A2: "this MRP was printed for GST at `rate` %" (stock items received up to `until`, local day; absent = all). */
export interface MrpTaxBasis {
  rate: number;
  until?: string;
}

/** RT-A3 delivery status flow: new → packed → out → delivered, or returned / cancelled. */
export type DeliveryStatus = 'new' | 'packed' | 'out' | 'delivered' | 'returned' | 'cancelled';

/** RT-A3: home-delivery details on a sale record (snapshot; the bill itself is a normal invoice). */
export interface DeliveryInfo {
  address: string;
  phone?: string;
  /** Free text slot ("6–8 pm"). */
  slot?: string;
  rider_id?: string;
  status: DeliveryStatus;
  /** Delivery charge put on the bill as a normal service line (G5 / RT6). */
  charge?: number;
  /** Cash on delivery: the rider collects; receipts are tagged `rider_id`. */
  cod?: boolean;
  note?: string;
  /** Local day the order was delivered / returned. */
  done_on?: string;
  /** The credit note made for a returned order. */
  credit_note_id?: string;
}

/** RT-A3 riders master (table `delivery_riders`, `master.edit`). */
export interface DeliveryRider {
  id: string;
  name: string;
  phone?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** RT-A3 rider cash settlement (table `rider_settlements`, `payment.record`, dated `date`). */
export interface RiderSettlement {
  id: string;
  date: string;
  rider_id: string;
  rider_name: string;
  /** COD receipts (`transactions` ids) this settlement clears. */
  payment_ids: string[];
  expected: number;
  counted: number;
  /** counted − expected (negative = shortage). */
  difference: number;
  /** Ledger a shortage / excess goes to (chosen by the user; never silent). */
  difference_account_id?: string;
  /** Orders that came back (invoice ids). */
  returned_ids?: string[];
  voucher_id?: string;
  voucher_number?: string;
  note?: string;
  created_at: string;
}

/** RT-A4 short book (table `short_book`, `doc.create`, dated `date`). */
export interface ShortBookEntry {
  id: string;
  date: string;
  /** Stock item id when known; free text otherwise. */
  item_id?: string;
  name: string;
  qty: number;
  unit?: string;
  customer?: string;
  phone?: string;
  note?: string;
  status: 'open' | 'ordered' | 'closed';
  /** The draft purchase order made from it. */
  po_id?: string;
  closed_on?: string;
  closed_how?: 'arrived' | 'manual';
  created_at: string;
  updated_at?: string;
}

/** RT-E3 (declared here because the record key list is RT-A's): PAN / Form 60 / 97 on a big sale. */
export interface SaleKyc {
  pan?: string;
  form?: '60' | '97';
  ref?: string;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** RT-A3: home delivery (POS / editor "Delivery" switch). */
    delivery?: DeliveryInfo;
    /** RT-E3: PAN or Form 60 / 97 taken on a sale above the PAN limit (masked in lists). */
    kyc?: SaleKyc;
  }
  interface InvoiceItem {
    /** RT-A2, catalogue rows: the MRP was printed for an older GST rate (effective MRP after a cut). */
    mrp_tax_basis?: MrpTaxBasis;
    /** RT-A2, catalogue rows: when a shelf label was last printed, and the rate / MRP it showed (relabel queue). */
    label_printed_at?: string;
    label_price?: { rate: number; mrp: number };
  }
  interface Payment {
    /** RT-A3: cash collected by a delivery rider (held in "Cash with riders" until settled). */
    rider_id?: string;
    /** RT-D3 / RT-E3: settled by the customer's old goods (a URD purchase voucher) — no cash moved (`movedNoCash`). */
    exchange_purchase_id?: string;
  }
}
declare module './purchases' {
  interface PurchaseLine {
    /** RT-A4: free units received with the line ("10 + 1"); no value and no GST; stock = paid + free. */
    free_qty?: number;
    /** RT-A4: line discount % (already read by `readPurchaseLines`; now typed in the bill line editor). */
    discount_percent?: number;
  }
}
declare module '../lib/localDb' {
  interface AppSettings {
    /** RT-A1: shop profile under the `kirana` business type; absent = not chosen (existing companies unchanged). */
    retail_kind?: RetailKind;
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    /** RT-A2: the MRP of stock received up to `until` was printed for GST at `rate` %. */
    mrp_tax_basis?: MrpTaxBasis;
    /** RT-A2: last label print and what it showed (relabel queue). */
    label_printed_at?: string;
    label_price?: { rate: number; mrp: number };
  }
}

/* ════════════════════════════════════════ RT-B ════════════════════════════════════════
 * Doctors, refills, registers, licences, ceiling prices. Note: `InvoiceRecord.rx` is an inline object type in
 * invoice.ts, which declaration merging cannot widen — RT-B widens it there (one edit) or keeps the additions
 * (`doctor_id`, `age`, `gender`, `rx_no`, `rx_date`, `retained`) in its own shape. */
declare module '../lib/inventory' {
  interface StockItem {
    /** RT-B3: NPPA ceiling price per unit, ex-GST, dated (append-only). */
    ceiling_prices?: { from: string; price_per_unit: number; unit?: string }[];
    /** RT-B2: narcotic / psychotropic item (own register). */
    narcotic?: boolean;
  }
}

/* ════════════════════════════════════════ RT-C ════════════════════════════════════════ */
declare module './invoice' {
  interface InvoiceItem {
    /** RT-C1, catalogue rows: GST by sale value per piece. */
    gst_band?: PriceBandKind;
    /** RT-C1, lines: the band that set `tax_rate` and the value per piece it was decided on (snapshot). */
    band_rate?: { kind: PriceBandKind; value_per_piece: number };
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    gst_band?: PriceBandKind;
  }
}

/* ════════════════════════════════════════ RT-D ════════════════════════════════════════ */
/** RT-D3: what a buy-back voucher (URD purchase) received. */
export interface UsedGoods {
  serial?: string;
  model?: string;
  condition?: string;
  accessories?: string;
  id_type?: string;
  id_last4?: string;
  photo_ref?: string;
  imei_check_id?: string;
}
declare module './invoice' {
  interface InvoiceItem {
    /** RT-D1: IMEI 1 → IMEI 2 pairs of the serials on the line (snapshot). */
    serial_pairs?: Record<string, string>;
    /** RT-D3: margin-scheme resale (Rule 32(5)): the buy-back it was bought on and its value. */
    margin?: { purchase_id: string; purchase_value: number };
  }
  interface Client {
    /** RT-D2: a consumer-finance company (Bajaj Finserv, HDFC …). */
    financier?: boolean;
  }
}
declare module './purchases' {
  interface PurchaseLine {
    serial_pairs?: Record<string, string>;
  }
  interface PurchaseRecord {
    used_goods?: UsedGoods;
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    serial_kind?: 'imei' | 'serial';
    second_hand?: boolean;
  }
}

/* ════════════════════════════════════════ RT-E ════════════════════════════════════════ */
/** RT-E2: jewellery line breakdown (snapshot); `rate` = amount ÷ quantity so calc readers are unchanged. */
export interface JewelLine {
  tag?: string;
  metal: string;
  purity: string;
  gross_wt: number;
  stone_wt: number;
  net_wt: number;
  rate: number;
  wastage_pct: number;
  making: { basis: 'per_gram' | 'percent' | 'fixed'; value: number };
  stone_value: number;
  hallmark_charge: number;
  huid?: string;
  rate_locked?: boolean;
}
/** RT-E3: old metal bought / taken in exchange (URD purchase voucher). */
export interface OldMetal {
  metal: string;
  gross_wt: number;
  stone_wt: number;
  net_wt: number;
  purity_pct: number;
  melt_loss_pct: number;
  fine_wt: number;
  rate_24k: number;
  value: number;
  test_method?: string;
}
declare module './invoice' {
  interface InvoiceItem {
    jw?: JewelLine;
  }
}
declare module './purchases' {
  interface PurchaseRecord {
    old_metal?: OldMetal;
  }
  interface Vendor {
    /** RT-E4: a karigar (goldsmith job worker): fine-weight metal account. */
    karigar?: boolean;
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    /** RT-E2: lines of this item carry the jewellery breakdown. */
    jewel?: boolean;
  }
}
