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
  }
  interface PurchaseRecord {
    broker_id?: string;
  }
  interface Vendor {
    broker_id?: string;
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
