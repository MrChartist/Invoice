/**
 * Round 4 package C (trade desk & trust) — persisted shapes and additive fields. `invoice.ts` and `purchases.ts`
 * are not edited: the exporter profile, the export document fields and the Bill of Entry duty snapshot arrive here
 * by declaration merging (additive, optional, snake_case). Tables: `lut_register`, `export_irms`,
 * `export_incentives`, `export_writeoffs`, `recycle_bin`.
 */

declare module './invoice' {
  interface SenderProfile {
    /** Additive (R4-C1): Importer-Exporter Code (10 characters, today the PAN). */
    iec?: string;
    /** Additive (R4-C1): Authorised Dealer code registered on ICEGATE (14 digits). */
    ad_code?: string;
    /** Additive (R4-C1): label of the AD bank (e.g. "HDFC Bank, Fort branch"). */
    ad_bank?: string;
  }
  interface InvoiceRecord {
    /** Additive (R4-C1): Incoterms 2020 rule (EXW … DDP). */
    incoterm?: string;
    port_of_loading?: string;
    port_of_discharge?: string;
    /** ISO 3166 alpha-2 code (default IN when printed). */
    country_of_origin?: string;
    /** ISO 3166 alpha-2 code; pre-fills the e-Invoice `CntCode`. */
    country_of_destination?: string;
    pre_carriage?: string;
    vessel_flight?: string;
    marks_numbers?: string;
    /** Free text, e.g. "DA 60 days". */
    export_payment_terms?: string;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** Additive (R4-C3): the Bill of Entry duty sheet as applied to this import bill (snapshot). */
    boe_duty?: BoeDuty;
  }
}

/* ── LUT register (R4-C1) ─────────────────────────────────────── */

export interface LutRow {
  id: string;
  /** `FY26-27`. */
  fy: string;
  /** GSTIN the LUT was furnished for ('' = every GSTIN of the company). */
  gstin: string;
  /** ARN of the RFD-11 acknowledgement. */
  arn: string;
  /** Local day the LUT was filed. */
  filed_on: string;
  valid_from: string;
  valid_to: string;
  created_at?: string;
  updated_at?: string;
}

/* ── Export realisation (R4-C2) ───────────────────────────────── */

export type EbrcStatus = 'self_certified' | 'pending';

export interface IrmAllocation {
  invoice_id: string;
  fcy: number;
}

/** A bank inward remittance message (IRM) / FIRC, typed or CSV-imported. */
export interface ExportIrm {
  id: string;
  irm_no: string;
  /** Local day of the remittance. */
  date: string;
  bank?: string;
  currency: string;
  fcy: number;
  purpose?: string;
  /** Remitter as the bank reports it (matching hint only). */
  remitter?: string;
  allocations: IrmAllocation[];
  ebrc_no?: string;
  ebrc_date?: string;
  ebrc_status?: EbrcStatus;
  created_at?: string;
  updated_at?: string;
}

export type IncentiveKind = 'rodtep' | 'drawback' | 'igst_refund';

export interface IncentiveUse {
  /** The import bill (Bill of Entry) the scrip paid duty on. */
  boe_id: string;
  amount: number;
  date: string;
  voucher_id?: string;
}

export interface ExportIncentive {
  id: string;
  invoice_id: string;
  kind: IncentiveKind;
  /** Local day of the claim (the shipping bill / claim date). */
  date: string;
  /** Amount claimed (₹). */
  claimed: number;
  /** RoDTEP rate % / drawback AIR rate %. */
  rate?: number;
  scrip_no?: string;
  scrip_date?: string;
  /** Amount credited (₹): scrip value (RoDTEP), drawback / refund received in the bank. */
  credited?: number;
  credited_on?: string;
  /** RoDTEP: scrip used against customs duty. */
  utilised?: IncentiveUse[];
  /** RoDTEP: scrip sold: face `amount` transferred for `value`. */
  transferred?: { date: string; value: number; amount: number; voucher_id?: string };
  /** IGST refund (shipping-bill route): portal status as typed. */
  refund_status?: string;
  /** MF-D4 (MF18): RoDTEP schedule — Appendix 4R (DTA) or 4RE (exports under AA / EOU / SEZ). Absent = 4R. */
  appendix?: '4R' | '4RE';
  /** Journals posted for this row (claim, credit, utilisation, transfer). */
  voucher_ids: string[];
  /** The claim journal, once posted. */
  claim_voucher_id?: string;
  /** The credit journal (drawback / IGST refund), once posted. */
  credit_voucher_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExportWriteOff {
  id: string;
  invoice_id: string;
  date: string;
  reason: string;
  fcy: number;
  created_at?: string;
}

/* ── Bill of Entry duty (R4-C3) ───────────────────────────────── */

export interface BoeDutyLine {
  /** `PurchaseLine.id`. */
  line_id: string;
  /** Customs tariff heading typed on the sheet (defaults to the line HSN). */
  cth?: string;
  /** Assessable value (₹) — allocated by value unless typed. */
  av: number;
  /** True when the user typed the AV (not allocated). */
  av_typed?: boolean;
  bcd_pct: number;
  sws_pct: number;
  igst_pct: number;
  cess_pct?: number;
  /** Anti-dumping / safeguard duty (₹). */
  other?: number;
}

export interface BoeDutyTotals {
  av: number;
  bcd: number;
  sws: number;
  other: number;
  igst: number;
  cess: number;
  /** BCD + SWS + other: the duty loaded into stock cost. */
  duty: number;
  /** Duty + IGST + cess: paid at customs. */
  total: number;
}

export interface BoeDuty {
  /** Customs exchange rate (₹ per unit of `currency`). */
  rate: number;
  currency?: string;
  fob?: number;
  freight?: number;
  insurance?: number;
  /** CIF in foreign currency. */
  cif: number;
  lines: BoeDutyLine[];
  totals: BoeDutyTotals;
  /** "Post duty" journal (Dr Customs duty on imports | Cr Customs duty payable). */
  voucher_id?: string;
  /** Rule date the sheet was computed under (the BOE date, else the bill date). */
  rule_date?: string;
}

/* ── Recycle bin (R4-C4) ──────────────────────────────────────── */

export interface BinEntry {
  id: string;
  /** Table the row was deleted from. */
  table: string;
  row_id: string;
  /** ISO time of the delete. */
  deleted_at: string;
  deleted_by?: string;
  /** The whole deleted row, as it was stored. */
  row: unknown;
  /** Copied from the row so its attachment files are kept while the entry exists. */
  attachments?: unknown;
  /** Derived for display when absent (label / number / document day). */
  label?: string;
  number?: string;
  period_day?: string;
}
