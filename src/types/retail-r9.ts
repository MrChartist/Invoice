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
 * (`doctor_id`, `age`, `gender`, `rx_no`, `rx_date`, `retained`) in its own shape. RT-B widened it in invoice.ts. */

/**
 * RT-B1 doctors master (table `doctors`, `master.edit`, audited "Doctor"). Round 10 SV-B adds clinic fields
 * (`in_house`, `speciality`, `consult_fee`, `follow_up_fee`, `follow_up_days`, `staff_id`) by declaration merging
 * on this interface — keep it an interface. No referral / commission field (RT9).
 */
export interface Doctor {
  id: string;
  name: string;
  qualification?: string;
  /** Registration number with the medical council (printed on the H1 / X registers as "reg. no."). */
  reg_no?: string;
  council?: string;
  clinic?: string;
  phone?: string;
  address?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/** RT-B1 refill schedule (table `rx_refills`, `doc.create`, dated `next_due`). */
export interface RxRefill {
  id: string;
  /** Saved client (patient) when known; else the name / phone typed. */
  client_id?: string;
  name: string;
  phone?: string;
  items: { name: string; quantity: number; unit?: string }[];
  every_days: number;
  /** Local day the next purchase is due. */
  next_due: string;
  /** Local day of the last bill that refilled it (absent = only the bill it was made from). */
  last_billed?: string;
  /** Bill it was made from. */
  invoice_id?: string;
  doctor_id?: string;
  active: boolean;
  created_at: string;
  updated_at?: string;
}

/** RT-B2 drug licence forms (Drugs Rules 1945): 20 / 21 retail, 20B / 21B wholesale, 20F / 21G Schedule X, 21C restricted. */
export type DrugLicenceForm = '20' | '21' | '20B' | '21B' | '20F' | '21G' | '21C' | 'other';
export interface DrugLicence {
  form: DrugLicenceForm;
  number: string;
  valid_from?: string;
  valid_to?: string;
  premises?: string;
}
export interface Pharmacist {
  name: string;
  reg_no: string;
  council?: string;
}

/** RT-B1: the POS prescription strip's state (merged into the bill; `errors` stop the save). */
export interface PosRx {
  rx?: NonNullable<import('./invoice').InvoiceRecord['rx']>;
  /** The Rx photo(s) stored as attachments of the bill. */
  att?: import('./attachments').AttachmentRef[];
  errors: string[];
}

declare module '../lib/pharma-gate' {
  interface PharmaSettings {
    /** RT-B2: drug licences on file (printed licence line; expiry alerts; Schedule X needs 20F / 21G). */
    licences?: DrugLicence[];
    /** RT-B2: registered pharmacist printed on the bill. */
    pharmacist?: Pharmacist;
    /** RT-B1: H1 / X without patient + prescriber is an error (pharmacy profile) instead of a warning. */
    require_rx?: boolean;
  }
}
declare module '../lib/inventory' {
  interface StockItem {
    /** RT-B3: NPPA ceiling price per unit, ex-GST, dated (append-only). */
    ceiling_prices?: { from: string; price_per_unit: number; unit?: string }[];
    /** RT-B2: narcotic / psychotropic item (own register). */
    narcotic?: boolean;
    /** RT-B3: price to stockist, typed (margin view only). */
    pts?: number;
  }
}
declare module './invoice' {
  interface SenderProfile {
    /** RT-B2: "name (reg. no.)" of the registered pharmacist, written from the pharmacy desk (snapshotted with the profile). */
    pharmacist?: string;
  }
}

/* ════════════════════════════════════════ RT-C ════════════════════════════════════════ */
/** RT-C1 line snapshot: the band that set `tax_rate`, the value per piece it was decided on and the rate it gave. */
export interface BandRate {
  kind: PriceBandKind;
  value_per_piece: number;
  /** The rate the band gave (absent = not decided yet). A line `tax_rate` that differs = typed by hand. */
  rate?: number;
  /** The user typed the GST rate: the band no longer sets it (the exceptions view still compares it). */
  manual?: true;
}

export type AlterationStatus = 'received' | 'with_tailor' | 'ready' | 'delivered' | 'cancelled';

/** RT-C3 alteration slip (table `alteration_jobs`, `doc.create`, dated `date`, numbered `ALT/FY…`). */
export interface AlterationJob {
  id: string;
  number: string;
  date: string;
  customer: string;
  phone?: string;
  invoice_id?: string;
  invoice_number?: string;
  garment: string;
  /** Alteration notes and measurements (free text). */
  notes?: string;
  /** Tailor (a `vendors` row) and the name snapshot. */
  tailor_id?: string;
  tailor_name?: string;
  due: string;
  /** Charge to the customer (₹, incl. nothing else; 0 = free alteration). */
  charge: number;
  /** What the tailor is paid for this job (₹). */
  tailor_rate: number;
  status: AlterationStatus;
  /** Local days the status changed. */
  ready_on?: string;
  delivered_on?: string;
  /** The bill that charged the alteration (its own draft or a sale bill line). */
  charge_invoice_id?: string;
  /** The tailor bill draft (purchase_drafts) that paid the tailor. */
  tailor_bill_id?: string;
  created_at: string;
  updated_at?: string;
}

declare module './invoice' {
  interface InvoiceItem {
    /** RT-C1, catalogue rows: GST by sale value per piece. */
    gst_band?: PriceBandKind;
    /** RT-C1, lines: the band that set `tax_rate` and the value per piece it was decided on (snapshot). */
    band_rate?: BandRate;
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
