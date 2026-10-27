/**
 * Round 11 (construction) — persisted shapes and additive fields of the four packages (docs/prd/round-11.md §6).
 * `invoice.ts`, `purchases.ts`, `localDb.ts` and `invoice-defaults.ts` are not edited: everything a construction
 * document prints lives under keys `normalizeRecord` already keeps verbatim — the record key `boq_terms` (R5-B) gains
 * one sub-object `cn` (the construction snapshot) and new deduction kinds go into `ra_deductions`. On a BOQ (sales
 * order) `boq_terms` keeps its R5 meaning; on an RA bill / demand / works invoice `boq_terms.cn` is the snapshot.
 * One block per package, marked `// CN-A` … `// CN-D`: each package fills only its own block. Types only (0 bytes).
 * Everything here is a working paper — verify with your CA (docs/CA_REVIEW.md §11, CN1–CN28).
 */

/* ════════════════════════════════════════ CN-A ════════════════════════════════════════ */

/** The construction business picked under the `contractor` business type (settings `construction_kind`). */
export type ConstructionKind = 'civil' | 'subcontractor' | 'builder' | 'interiors' | 'mep' | 'labour' | 'other';

/** RA bill paper: ordinary item table + abstract page, the PWD cumulative item table, or the line sub-line only. */
export type RaPaperStyle = 'standard' | 'pwd' | 'summary';

/** Works views (Time → Works) a construction profile switches on (CN-B / CN-D fill the screens). */
export type CnWorksView = 'contracts' | 'advances' | 'escalation' | 'guarantees' | 'subcon' | 'labour' | 'plant' | 'reco' | 'pnl';

/** Builder views (Receivables → Realty, CN-C). */
export type CnRealtyView = 'projects' | 'units' | 'bookings' | 'plans' | 'demands' | 'rera' | 'cancellations' | 'procurement';

/** Company object `mrchartist_inv_construction_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface ConstructionSettings {
  /** RA bill paper style (default `standard`; civil + government → `pwd`). */
  ra_paper?: RaPaperStyle;
  /** Print the M-book column / sub-line. */
  mb_column?: boolean;
  /** The company works for government departments / PSUs (GST TDS deductor default, cess, measured-by boxes). */
  government?: boolean;
  /** Print the contractor's certificate (default on) and its text (default `DEFAULT_CERTIFICATE`). */
  certificate?: boolean;
  certificate_text?: string;
  /** Print the "Measured by / Checked by / Passed for payment" boxes (government default). */
  signoff_boxes?: boolean;
  /** Deviation limit, % over the BOQ quantity per item (contract term; default 25). */
  deviation_pct?: number;
  /** Works views switched on by the profile (a view turned off is only hidden; its URL still opens it). */
  views?: Partial<Record<CnWorksView, boolean>>;
  /** Interiors / MEP: show the supply + installation caution (CN3). */
  split_caution?: boolean;
  /** Interiors: photo pages on by default. */
  photo_pages?: boolean;
  /** Labour contractor: manpower-supply bill preset (SAC 998519). */
  manpower_preset?: boolean;
  updated_at?: string;
}

/** Works-contract tax class of a line (suggests a rate / SAC by document date; a typed rate always wins). */
export type CnClass = 'wc_general' | 'wc_govt' | 'wc_govt_earthwork' | 'wc_subcon_govt' | 'pure_labour_exempt' | 'supply_goods' | 'install_service' | 'manpower'
  // CN-C3 real-estate classes (filled by CN-C)
  | 'realty_affordable' | 'realty_residential' | 'realty_commercial' | 'realty_old_option';

/** Line class on an RA bill: BOQ item, extra item, substituted item, quantity beyond the deviation limit. */
export type CnLineKind = 'boq' | 'extra' | 'substituted' | 'deviation';

/** Site of the work: place of supply = its State (Sec 12(3)). */
export interface CnSite {
  address?: string;
  state_code?: string;
}

/** Contract particulars printed in the "Contract particulars" box (snapshot; empty fields are skipped). */
export interface CnHeader {
  name_of_work?: string;
  agreement_no?: string;
  agreement_date?: string;
  work_order_no?: string;
  work_order_date?: string;
  tender_ref?: string;
  /** Client office (division / circle). */
  client_office?: string;
  /** Engineer-in-charge. */
  engineer?: string;
  site?: CnSite;
  contract_value?: number;
  stipulated_start?: string;
  stipulated_completion?: string;
  extended_completion?: string;
  /** "4th RA bill (running)" / "Final bill". */
  ra_label?: string;
  period_from?: string;
  period_to?: string;
  measured_on?: string;
  mb_nos?: string[];
  /** CN-B (JV / consortium, informational): "Member of ABC–XYZ JV (40%)". */
  jv_note?: string;
}

/** Per invoice line (keyed by the invoice line id): BOQ no., M-book, class and the certified quantities. */
export interface CnLine {
  /** BOQ item no. (copied from `boq_ref`). */
  ref?: string;
  /** M-book ref "112/45–47". */
  mb?: string;
  cls?: CnClass;
  kind?: CnLineKind;
  /** Extra / substituted item approval ref. */
  approval?: string;
  /** Substituted item: the BOQ item no. it replaces. */
  substitutes?: string;
  boq_qty?: number;
  prev_qty?: number;
  cum_qty?: number;
  prev_amount?: number;
  cum_amount?: number;
}

/** One row of the abstract of cost, snapshotted at save so later bills never change it. */
export interface CnAbstractRow {
  /** BOQ line id (or the invoice line id of an extra / substituted / deviation line). */
  id: string;
  kind: CnLineKind;
  ref: string;
  description: string;
  unit: string;
  boq_qty: number;
  rate: number;
  prev_qty: number;
  prev_amount: number;
  this_qty: number;
  this_amount: number;
  cum_qty: number;
  cum_amount: number;
  /** % of the BOQ quantity (0 without one). */
  pct: number;
  mb?: string;
  approval?: string;
}

/** Contractor's certificate and sign-off boxes printed under the bill (snapshot). */
export interface CnCertificate {
  text?: string;
  boxes?: boolean;
}

/** CN-B3: price-variation statement snapshot on a supplementary bill (filled by CN-B). */
export interface CnPvSnapshot {
  statement_id?: string;
  number?: string;
  [key: string]: unknown;
}

/** CN-C3: stage demand snapshot on a demand invoice (filled by CN-C). */
export interface CnDemandSnapshot {
  booking_id?: string;
  unit?: string;
  stage?: string;
  [key: string]: unknown;
}

/** CN-B (JV / consortium share, informational). */
export interface CnJvSnapshot {
  name?: string;
  share_pct?: number;
}

/** `boq_terms.cn` — the Round 11 snapshot on a document (each package owns its sub-fields). */
export interface CnSnapshot {
  v?: 1;
  /** A works-contract bill (prints the construction paper even without an RA number). */
  works?: boolean;
  header?: CnHeader;
  lines?: Record<string, CnLine>;
  /** Abstract of cost (A4): printed as the following page. */
  abstract?: CnAbstractRow[];
  /** Paper style at save time. */
  paper?: RaPaperStyle;
  certificate?: CnCertificate;
  /** Deviation limit used (%). */
  deviation_pct?: number;
  // CN-B
  pv?: CnPvSnapshot;
  jv?: CnJvSnapshot;
  // CN-C
  demand?: CnDemandSnapshot;
}

declare module './transport-works-r5' {
  interface BoqTerms {
    /** Round 11 construction snapshot (on an RA bill / demand / works invoice; never read from a BOQ by bills). */
    cn?: CnSnapshot;
    /** CN-A2 / B1: the site of the BOQ (place of supply). */
    site?: CnSite;
    /** CN-A3: contract particulars typed on the BOQ when there is no contract (B1). */
    header?: CnHeader;
    /** CN-A4: deviation limit % for this BOQ (default 25). */
    deviation_pct?: number;
  }
  interface MeasurementLine {
    /** CN-A4: line class (absent = BOQ item; `extra` keeps working through the R5 reason). */
    kind?: 'substituted' | 'extra';
    approval?: string;
    /** Substituted item: the BOQ item no. it replaces. */
    substitutes?: string;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** CN-A1: construction profile under the `contractor` business type; absent = not chosen (unchanged company). */
    construction_kind?: ConstructionKind;
  }
}

declare module './invoice' {
  interface InvoiceItem {
    /** CN-A2, catalogue rows: works-contract tax class (on an RA bill the class lives in `boq_terms.cn.lines`). */
    cn_class?: CnClass;
  }
}

/* ════════════════════════════════════════ CN-B ════════════════════════════════════════
 * Contract register, advances, price variation, recoveries, guarantees, closure. B adds `SecurityDeposit.contract_id`
 * here (declaration merging on the R5-C type). */

/* ════════════════════════════════════════ CN-C ════════════════════════════════════════
 * Builders: projects, units, bookings, payment plans, demands, RERA account. C adds `AdvanceRecord.booking_id` and
 * `BankAccount.rera_project_id` here. */

/* ════════════════════════════════════════ CN-D ════════════════════════════════════════
 * Site operations: sub-contract work orders, labour, muster, plant, reconciliation, site P&L. D adds
 * `PurchaseRecord.cn_sub` and `FixedAsset.cn_equipment` here. */
