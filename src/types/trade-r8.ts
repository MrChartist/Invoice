/**
 * Round 8 (trading businesses) — persisted shapes and additive fields of the three packages.
 * `src/types/invoice.ts`, `purchases.ts` and `localDb.ts` are not edited: the new optional fields arrive here by
 * declaration merging (additive, snake_case). One `declare module` block per package (§6 of docs/prd/round-8.md):
 * each package edits only its own block. Record keys are listed in `R8_RECORD_KEYS` and line keys in `R8_LINE_KEYS`
 * (`src/store/invoice-defaults.ts`), so the editor and `normalizeRecord` keep them.
 * Everything here is a working paper — verify with your CA.
 */

/* ── TR-A: pricing, claims, collections (shapes owned by TR-A) ── */

/** Cash-discount term printed on a bill ("2% if paid within 7 days"). */
export interface CashDiscountTerm {
  percent: number;
  days: number;
}

/** Party-item special rate (table `party_rates`, TR-A1): one client or vendor × one item, dated. */
export interface PartyRate {
  id: string;
  side: 'sale' | 'purchase';
  /** `clients` row (sale) or `vendors` row (purchase). */
  party_id: string;
  party_name: string;
  /** Catalogue / stock item id when known; matched by name otherwise. */
  item_id?: string;
  item_name: string;
  rate?: number;
  disc_chain?: number[];
  disc_per_unit?: number;
  valid_from: string;
  valid_to?: string;
  updated_at?: string;
}

/** Scheme scope v2 (additive on `schemes` rows, TR-A2). Absent = the scheme's single item, as before. */
export interface SchemeScope {
  group_ids?: string[];
  item_ids?: string[];
  /** Matched against the stock item's category name, else a word of its name. */
  brand?: string;
  client_ids?: string[];
  level_ids?: string[];
}
export type ClaimBasis = 'free_goods_at_cost' | 'free_goods_at_rate' | 'discount_given' | 'fixed_per_unit';

/** One row of a claim statement (invoice line under a principal's scheme, or a price-drop unit). */
export interface ClaimRow {
  invoice_id?: string;
  line_id?: string;
  invoice_number: string;
  date: string;
  party: string;
  item: string;
  qty: number;
  free_qty: number;
  value: number;
}
export type ClaimStatus = 'draft' | 'sent' | 'settled' | 'short' | 'rejected';
/** Claim to a principal (table `trade_claims`, numbered TCL/FY…). */
export interface TradeClaim {
  id: string;
  number: string;
  date: string;
  kind: 'scheme' | 'price_drop';
  principal_id: string;
  principal_name: string;
  from: string;
  to: string;
  rows: ClaimRow[];
  amount: number;
  status: ClaimStatus;
  price_drop_id?: string;
  settlement?: { mode: 'financial' | 'gst'; note_no: string; date: string; amount: number; voucher_id?: string; return_id?: string };
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** Price-drop run (table `price_drops`, numbered PDR/FY…, TR-A3). */
export interface PriceDropRun {
  id: string;
  number: string;
  date: string;
  /** The drop per unit by item (name, folded match). */
  items: { name: string; drop: number }[];
  from: string;
  to: string;
  client_ids?: string[];
  mode: 'financial' | 'gst';
  /** Agreed before supply (only then may GST notes be issued). */
  agreed?: boolean;
  rows: { client_id?: string; client_name: string; invoice_id: string; invoice_number: string; item: string; qty: number; value: number }[];
  own_stock: { item: string; qty: number }[];
  note_ids: string[];
  total: number;
  status: 'issued' | 'undone';
  principal_id?: string;
  claim_id?: string;
  created_at?: string;
  updated_at?: string;
}

/** Interest settings (object `interest_settings`, TR-A4). */
export interface InterestSettings {
  rate?: number;
  grace_days?: number;
  basis?: 'due' | 'bill';
  min_amount?: number;
}
/** One interest run (table `interest_runs`, dated). */
export interface InterestRun {
  id: string;
  date: string;
  as_of: string;
  /** Bills charged and the period each was charged for. */
  bills: { id: string; party: string; from: string; to: string; amount: number }[];
  invoice_ids: string[];
  total: number;
  created_at?: string;
}

/** Returnable packaging master (table `packaging_types`, TR-A5). */
export interface PackagingType {
  id: string;
  name: string;
  unit?: string;
  deposit?: number;
  charge_rate?: number;
  hsn?: string;
  tax_rate?: number;
  returnable?: boolean;
}
/** Crates / bags given (out) or taken back (in) — table `packaging_moves`, dated. */
export interface PackagingMove {
  id: string;
  date: string;
  party_kind: 'client' | 'vendor';
  party_id?: string;
  party_name: string;
  type_id: string;
  out: number;
  in: number;
  doc_id?: string;
  doc_no?: string;
  /** Deposit received (+) or refunded (−) with this move, and its voucher. */
  deposit?: number;
  voucher_id?: string;
  /** Closed by a charge for unreturned units (the draft invoice). */
  charge_invoice_id?: string;
  note?: string;
  created_at?: string;
}

/* ── TR-B: weight and bag billing (shape owned by TR-B) ── */

export type WeightUnit = 'KG' | 'QTL' | 'MT';
export interface LineWeight {
  packages: number;
  /** BAG / KATTA / BORI / CRATE / BALE / custom. */
  kind: string;
  gross: number;
  tare_per_package: number;
  deduction: { basis: 'per_package' | 'per_qtl' | 'percent'; value: number };
  gross_unit: WeightUnit;
}

/** TR-B2 bill-charge head (table `trade_charge_heads`). Rates are blank by default: State / mandi specific (TR6). */
export interface ChargeHead {
  id: string;
  name: string;
  side: 'sale' | 'purchase' | 'both';
  basis: 'percent' | 'per_package' | 'per_qtl' | 'per_unit' | 'fixed';
  rate: number;
  /** `in_value` (default): part of the goods' value at their rate and HSN (Sec 15(2)); `own_rate`: own SAC / rate;
   *  `outside`: pure-agent reimbursement (Rule 33), outside the value — TR7. */
  gst: 'in_value' | 'own_rate' | 'outside';
  sac?: string;
  gst_rate?: number;
  /** Collected for / owed to the mandi (counts in "payable to mandi"). */
  payable?: boolean;
  auto?: boolean;
  order?: number;
  created_at?: string;
  updated_at?: string;
}

/** TR-B3 brokerage payable posted for a broker and period (table `brokerage_postings`, dated `to`). */
export interface BrokeragePosting {
  id: string;
  broker_id: string;
  broker_name: string;
  from: string;
  to: string;
  date: string;
  amount: number;
  tds: number;
  tds_rate: number;
  voucher_id: string;
  voucher_number: string;
  /** The 194H row in the TDS register (`tds_deductions`). */
  tds_row_id?: string;
  created_at: string;
}

/* ── TR-C: agents, statutory rules, bank statements, setup ── */

/** Trade profile chosen under the `wholesale` business type (TR-C5). */
export type TradeKind = 'distributor' | 'wholesaler' | 'commodity' | 'agent';

/** Who the principal of an arrival is (drives the RCM-goods prompt and the commission GST hint). */
export type PrincipalKind = 'agriculturist' | 'registered' | 'unregistered';

/**
 * Arrival of a principal's goods at the commission agent (TR-C1). Table `arrivals`, numbered `ARR/FY…`.
 * The goods are the principal's: they sit in a godown of kind `consignment` and never enter our own stock valuation
 * (the stock engine skips agency lines); the lot balance is `qty` less the agency lines that name this arrival.
 */
export interface Arrival {
  id: string;
  number: string;
  /** Local day `YYYY-MM-DD`. */
  date: string;
  /** `vendors` row of the farmer / trader whose goods these are. */
  principal_id: string;
  principal_name: string;
  principal_kind?: PrincipalKind;
  lot_no: string;
  item_name: string;
  hsn?: string;
  /** Billing unit of the lot (QTL, KG, BAG …); agency lines sell in this unit. */
  unit: string;
  packages: number;
  package_kind?: string;
  gross_weight?: number;
  /** Net quantity in `unit` (after tare / dhalta when weighed). */
  qty: number;
  /** Godown of kind `consignment`. */
  godown_id: string;
  vehicle_no?: string;
  lr_no?: string;
  /** Advance paid to the principal on arrival (₹), with the cash / bank ledger it was paid from. */
  advance?: number;
  advance_account_id?: string;
  advance_voucher_id?: string;
  /** Agricultural produce (aadat exempt, N 12/2017-CT(R) entry 54 — TR9) or other goods (18% SAC 996111). */
  produce?: 'agricultural' | 'other';
  status?: 'open' | 'cancelled';
  cancel_reason?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** One deduction on a bikri patti (aadat, market fee, hamali, tulai, freight …). */
export interface PattiDeduction {
  label: string;
  /** `trade_charge_heads` row (TR-B) when picked from a head. */
  head_id?: string;
  basis: 'percent' | 'per_package' | 'per_qty' | 'fixed';
  rate: number;
  amount: number;
  /** Ledger credited by the patti journal (absent = Other income; aadat = the commission ledger). */
  account_id?: string;
  aadat?: boolean;
}

/** One agency sale line settled on a patti (snapshot). */
export interface PattiSale {
  invoice_id: string;
  invoice_number: string;
  date: string;
  arrival_id: string;
  qty: number;
  amount: number;
}

/** Bikri patti — settlement of a principal's lots (TR-C1). Table `sale_pattis`, numbered `PAT/FY…`. */
export interface SalePatti {
  id: string;
  number: string;
  date: string;
  principal_id: string;
  principal_name: string;
  arrival_ids: string[];
  sales: PattiSale[];
  gross: number;
  deductions: PattiDeduction[];
  total_deductions: number;
  /** Advances paid on the lots (recovered: they already sit on the principal's ledger). */
  advance: number;
  net_payable: number;
  /** Aadat exempt (agricultural produce) or taxable (a separate commission invoice to the principal). */
  commission_gst: 'exempt' | 'taxable';
  status: 'draft' | 'posted' | 'cancelled';
  voucher_id?: string;
  voucher_number?: string;
  cancel_reason?: string;
  created_at?: string;
  updated_at?: string;
}

export type IndentStatus = 'placed' | 'dispatched' | 'paid' | 'billed' | 'cancelled';

/** Indent placed by a buyer with a principal (mill) through us (TR-C1). Table `indents`, numbered `IND/FY…`. */
export interface Indent {
  id: string;
  number: string;
  date: string;
  buyer_name: string;
  /** `clients` row of the principal (mill / manufacturer) we bill commission to. */
  principal_id: string;
  principal_name: string;
  item: string;
  qty: number;
  unit?: string;
  rate: number;
  commission_basis: 'percent' | 'per_unit';
  commission_rate: number;
  delivery_date?: string;
  status: IndentStatus;
  principal_invoice_no?: string;
  dispatched_on?: string;
  paid_on?: string;
  commission_invoice_id?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** Bank stock & book-debts statement settings per bank account (object `bank_statement_settings`, TR-C4). */
export interface BankStatementTerms {
  /** Stock margin % (default 25) and debtors margin % (default 40) — the sanction letter decides. */
  stock_margin: number;
  debtor_margin: number;
  /** Debtors older than this many days (by bill date) are not eligible (default 90). */
  age_days: number;
  /** Sanctioned limit (₹). */
  limit?: number;
}
export interface BankStatementSettings {
  by_account?: Record<string, BankStatementTerms>;
}

/** Additive TDS settings (object `tds_settings`, TR-C2): our business turnover per preceding FY (`2025-26` → ₹). */
export interface TdsSettings {
  turnover_by_fy?: Record<string, number>;
}

/* ── Declaration merging: TR-A ── */
declare module './invoice' {
  interface InvoiceItem {
    /** TR-A1: compound discount steps (≤ 3, each 0–100) and ₹ per unit; `discount_percent` holds the effective %. */
    disc_chain?: number[];
    disc_per_unit?: number;
  }
  interface InvoiceRecord {
    /** TR-A1: cash-discount term printed on the bill. */
    cash_discount?: CashDiscountTerm;
    /** TR-A3: the price-drop run this note belongs to. */
    price_drop_id?: string;
    /** TR-A4: the interest run that raised this draft. */
    interest_run_id?: string;
  }
  interface Client {
    /** TR-A1: the party's default cash-discount term. */
    cash_discount?: CashDiscountTerm;
  }
}
declare module '../lib/localDb' {
  interface AppSettings {
    /** TR-A1: company default minimum margin % (stock groups may set their own). */
    trade_min_margin?: number;
  }
}
declare module '../lib/stock-groups' {
  interface StockTreeNode {
    /** TR-A1: minimum margin % for items of this group (and its sub-groups). */
    min_margin_percent?: number;
  }
}
declare module '../lib/pricing' {
  interface Scheme {
    /** TR-A2: scope v2, free slabs, the principal who pays and how the claim is valued. */
    scope?: SchemeScope;
    free_slabs?: { min_qty: number; free_qty: number }[];
    principal_vendor_id?: string;
    claim_basis?: ClaimBasis;
    claim_rate?: number;
  }
}

/* ── Declaration merging: TR-B ── */
declare module './invoice' {
  interface InvoiceItem {
    /** TR-B1: weight / bag sub-row snapshot (net becomes `quantity`). */
    wt?: LineWeight;
    /** TR-B2: the bill-charge head that made this line. */
    charge_head_id?: string;
  }
  interface InvoiceRecord {
    /** TR-B3: broker on the sale. */
    broker_id?: string;
  }
  interface Client {
    broker_id?: string;
  }
}
declare module './purchases' {
  interface PurchaseLine {
    wt?: LineWeight;
    /** TR-B2: the bill-charge head that made this line (market fee paid on a farmer's purchase …). */
    charge_head_id?: string;
  }
  interface PurchaseRecord {
    broker_id?: string;
  }
  interface Vendor {
    broker_id?: string;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** TR-B1: lines of this item show the bags / weight sub-row. */
    sold_by_weight_bags?: boolean;
  }
}

/* ── Declaration merging: TR-C ── */
declare module './invoice' {
  interface InvoiceItem {
    /** TR-C1: the arrival (lot) an agency line sells; the line is the principal's goods, not our stock. */
    arrival_id?: string;
  }
  interface InvoiceRecord {
    /** TR-C1: a sale on behalf of principals (kachi aadat), issued in our name (Schedule I para 3 — TR10). */
    agency?: boolean;
  }
  interface Client {
    /** TR-C2: the buyer's Form 27C / Form 127 declaration (goods for manufacturing): no 206C(1) TCS. Date given. */
    tcs_declaration?: { on: string; ref?: string };
    /** TR-C2: the customer deducts 194Q on our sales above ₹50 lakh in the FY. */
    deducts_194q?: boolean;
  }
}
declare module './purchases' {
  interface Vendor {
    /** TR-C1 / C2: farmer (agriculturist), registered or unregistered person. */
    principal_kind?: PrincipalKind;
  }
}
declare module '../lib/localDb' {
  interface AppSettings {
    /** TR-C5: trade profile under the `wholesale` business type; absent = not chosen (existing companies). */
    trade_kind?: TradeKind;
    /** TR-A1 / TR-C5: compound and per-unit discount cells. */
    trade_discounts?: boolean;
    /** TR-A5 / TR-C5: returnable packaging (crates, bardana). */
    returnable_packaging?: boolean;
  }
}
