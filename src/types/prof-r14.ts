/**
 * Round 14 (professional and knowledge-services firms) — persisted shapes and additive fields of the four packages
 * (docs/prd/round-14.md §6). Existing type files are not edited: the new optional fields arrive here by declaration
 * merging. Every Round 14 snapshot on a document lives under ONE record key `ps` (`R14_RECORD_KEYS` in
 * `src/store/invoice-defaults.ts`); there is no Round 14 line key (per-line particulars sit in `ps.lines[lineId]`; B1's
 * disbursement lines reuse the R8 line key `charge_head_id`). PS-A declares the sub-field types of every package in one
 * commit; PS-B … PS-D fill only their own block (`// PS-B` …) — an interface re-declared there merges with PS-A's.
 * Types only (0 bytes). Working papers — verify with your CA (docs/CA_REVIEW.md §14, PS1–PS40 and PS41+).
 */

/* ════════════════════════════════════════ PS-A ════════════════════════════════════════ */

/** The professional picked under Services → Professional (settings `prof_kind`). */
export type ProfKind = 'ca' | 'legal' | 'design' | 'consulting' | 'agency' | 'freelancer' | 'other';
/** Firm form asked once by the picker; stored as the annual pack's entity type (`notes_to_accounts.entity_type`). */
export type FirmForm = 'proprietorship' | 'partnership' | 'llp' | 'company';

/** The views a kind turns on (A1 table); a switch the user set is never turned back by a profile. */
export interface PsSwitches {
  matters?: boolean;
  engagements?: boolean;
  conflicts?: boolean;
  conflict_first?: boolean;
  prebill?: boolean;
  utilisation?: boolean;
  success_prompt?: boolean;
  fee_schedule?: boolean;
  udin_lines?: boolean;
  disb_agent?: boolean;
  rcm_by_client?: boolean;
  fee_memo?: boolean;
  client_money?: boolean;
  stages?: boolean;
  property_pos?: boolean;
  media?: boolean;
  export_check?: boolean;
  fx_cards?: boolean;
  presumptive?: boolean;
  threshold?: boolean;
  tds_194j?: boolean;
  tds_194c?: boolean;
}

/**
 * Company object `mrchartist_inv_prof_settings` (`settings.manage`, audited on save, synced as a singleton, backed up).
 * B–D add their object-valued sub-fields in their own blocks below; `cleanProfSettings` keeps every object-valued key it
 * does not know.
 */
export interface ProfSettings {
  switches?: PsSwitches;
  /** A3 / A4: write-down reasons, ageing buckets (days), the dated year-end accrual switch (off when absent). */
  wip?: { reasons?: string[]; buckets?: number[]; accrue_from?: string };
  /** A1: the advocate's enrolment and State Bar Council (B2 prints them on the fee memo). */
  legal?: { enrolment?: string; bar_council?: string };
  /** A1: membership / firm registration no. (D5 adds `company_clients`). */
  ca?: { membership?: string; frn?: string; company_clients?: { company_id: string; gstin?: string; client_id: string }[] };
  updated_at?: string;
}

/** A party of a matter (conflict checks search them). */
export interface MatterParty {
  name: string;
  role: 'client' | 'opposite' | 'related' | 'witness' | 'other';
  pan?: string;
  gstin?: string;
}

/** A2: the matter fields on a project cost centre (`CostCentre.ps`; the matter IS the cost centre). */
export interface MatterInfo {
  /** Unique per company (`<client code>/<seq>` suggested). */
  code: string;
  kind: 'matter' | 'assignment' | 'project';
  practice_area?: string;
  court?: string;
  case_no?: string;
  forum?: string;
  parties: MatterParty[];
  /** `service_staff` ids. */
  responsible_id?: string;
  originating_id?: string;
  /** Local days. */
  opened: string;
  closed?: string;
  conflict_id?: string;
  engagement_id?: string;
  /** A2: the owner skipped the conflict check (legal profile), with a reason (audited). */
  skip_reason?: string;
}

export type EngagementModel = 'hourly' | 'fixed' | 'milestone' | 'retainer' | 'capped' | 'success' | 'blended';
export type EngagementStatus = 'draft' | 'sent' | 'accepted' | 'active' | 'closed';

export interface EngagementMilestone {
  id: string;
  label: string;
  pct?: number;
  amount?: number;
  due?: string;
  event?: string;
  /** The event happened (date and reference); the milestone may then be billed. */
  done_on?: string;
  ref?: string;
}

/** A2: table `engagements` (ENG/FY…, dated by `start`, numbered, `doc.create`). */
export interface Engagement {
  id: string;
  number: string;
  client_id: string;
  matter_ids: string[];
  title: string;
  model: EngagementModel;
  fee?: number;
  cap?: number;
  blended_rate?: number;
  currency: string;
  milestones?: EngagementMilestone[];
  success?: { basis: string; pct?: number; amount?: number; event: string; done_on?: string; ref?: string; base_amount?: number };
  /** R3-B3 hour-block retainer covering this engagement's time. */
  retainer_id?: string;
  disb_policy: 'agent' | 'markup' | 'included';
  tds_section?: string;
  letter_quote_id?: string;
  accepted_at?: string;
  start: string;
  end?: string;
  renew_on?: string;
  status: EngagementStatus;
  notes?: string;
  /** A2.5: the owner's reason for a success / percentage-of-recovery fee in a legal or CA profile (audited). */
  ethics_reason?: string;
  created_at: string;
  updated_at?: string;
}

export interface ConflictHit {
  source: 'client' | 'vendor' | 'party' | 'engagement';
  ref_id: string;
  name: string;
  matter_code?: string;
  role?: string;
  /** 1 = exact (name / PAN / GSTIN), else the token overlap. */
  score: number;
}

/** A2: table `conflict_checks` (dated, `master.edit`). */
export interface ConflictCheck {
  id: string;
  date: string;
  by?: string;
  terms: string[];
  hits: ConflictHit[];
  result: 'clear' | 'conflict' | 'waived';
  reason?: string;
  consent_note?: string;
  matter_id?: string;
  created_at: string;
  updated_at?: string;
}

/** A4: a timekeeper's dated standard (billing) and cost rate. */
export interface PsStaffRate {
  from: string;
  standard_rate: number;
  cost_rate: number;
}

/** A4: `ServiceStaff.ps` — capacity, rates and the utilisation target. */
export interface PsStaff {
  capacity_hours_week?: number;
  rates?: PsStaffRate[];
  target_pct?: number;
  /** Local user id whose new entries default to this timekeeper (a hint only: local users are device-local). */
  user_hint?: string;
}

/** A4: a WIP write-off stamped on the entry / bill (`TimeEntry.ps.wo`, `PurchaseRecord.ps.wo`). */
export interface PsWriteOff {
  date: string;
  reason: string;
  by?: string;
}

/** A3: write-up / write-down snapshot of a fee note (billed − standard; reasons sum to it). */
export interface PsWriteDown {
  standard: number;
  billed: number;
  reasons: { reason: string; amount: number }[];
}

/** One line's professional particulars (`ps.lines[lineId]`). */
export interface PsLine {
  /** A: matter code printed under the line; the line covered at 0 by a fixed / success fee; the fee line itself. */
  matter?: string;
  covered?: boolean;
  fee?: boolean;
  /** A3: the engagement milestone this fee line bills (billed once). */
  milestone?: string;
  /** D5 */
  udin?: string;
  /** B4 */
  stage?: string;
  /** B5 */
  ro?: string;
}

/** B2: the legal-services regime of a fee memo. */
export interface PsLegalSnap {
  regime: 'rcm' | 'exempt' | 'taxable';
  entry?: string;
  enrolment?: string;
  bar_council?: string;
}

/** B4: stage computation on a design fee note. */
export interface PsStageSnap {
  no?: number;
  of?: number;
  label?: string;
  project_cost?: number;
  fee_pct?: number;
  stage_pct?: number;
  billed_before?: number;
}

/** B5: media schedule rows (release orders). */
export interface PsMediaSnap {
  rows?: { ro: string; media: string; edition?: string; date?: string; amount: number }[];
  commission_pct?: number;
}

/** C1 / C2: the export check and the EDF reference. */
export interface PsExportSnap {
  checks?: { key: string; ok: boolean }[];
  edf_no?: string;
  edf_date?: string;
}

/** The professional snapshot on a document (record key `ps`). */
export interface PsSnapshot {
  kind?: 'fee' | 'memo' | 'stage' | 'media' | 'export';
  matter?: { id: string; code: string; name: string; court?: string; case_no?: string };
  engagement?: { id: string; number: string; model: EngagementModel };
  /** "Fixed fee — stage 2 of 3", "Capped at ₹2,00,000 (₹1,62,000 used)" … */
  basis?: string;
  wd?: PsWriteDown;
  purpose_code?: string;
  legal?: PsLegalSnap;
  stage?: PsStageSnap;
  media?: PsMediaSnap;
  export?: PsExportSnap;
  udin?: string[];
  /** C5: "not registered under GST" sentence. */
  unregistered?: boolean;
  lines?: Record<string, PsLine>;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 14 record snapshot (see `PsSnapshot`). */
    ps?: PsSnapshot;
  }
  interface SenderProfile {
    /** A5: bank details printed on export documents only (snapshotted with the sender). */
    swift?: string;
    iban?: string;
    intermediary_bank?: string;
  }
  interface Client {
    /** A2 `code`; B2 `entity` / `small_business` / `advocate`; C1 `country` / `fixed_estab_in_india` / `relation`;
     *  D3 `tds` (section, rate); D5 `fees` (fee schedule overrides). */
    ps?: {
      code?: string;
      entity?: 'business' | 'individual' | 'government' | 'advocate';
      small_business?: boolean;
      advocate?: boolean;
      country?: string;
      fixed_estab_in_india?: boolean;
      relation?: 'unrelated' | 'distinct_person' | 'group';
      tds?: { section?: string; rate?: number };
      fees?: Record<string, number>;
    };
  }
  interface InvoiceItem {
    /** D5: on CATALOGUE rows (`items_catalog`) only — the compliance event a fee item bills. Never a line key
     *  (`normalizeItem` does not keep it on documents). */
    ps?: { fee_event?: string };
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** PS-A1: professional profile under `services` / `professional`; absent = today's professional preset. */
    prof_kind?: ProfKind;
    /** The sub-choice of the kind (`ca_body`, `legal_side`, `design_kind`, `exports`, `media_buying`). */
    prof_sub?: string;
  }
}

declare module '../lib/cost-centres' {
  interface CostCentre {
    /** A2: matter fields (the matter is this project cost centre). */
    ps?: MatterInfo;
  }
}

declare module './services-r10' {
  interface ServiceStaff {
    /** A4: capacity, dated standard / cost rates, target. */
    ps?: PsStaff;
  }
}

declare module './time' {
  interface TimeEntry {
    /** A4: WIP write-off stamp. */
    ps?: { wo?: PsWriteOff };
  }
}

declare module './service-r3' {
  interface AnnexureRow {
    /** A3: value at the captured rate and the amount billed (pre-billed annexures only; internal pre-bill print). */
    standard?: number;
    billed?: number;
  }
}

declare module '../lib/timer' {
  interface TimerState {
    /** A4: the timekeeper of the running timer (copied onto the entry). */
    staff_id?: string;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** A4 `wo`; B1 `disb` (kind) / `on_behalf`; B5 `media`. */
    ps?: { wo?: PsWriteOff; disb?: string; on_behalf?: boolean; media?: { ro?: string; client_id?: string } };
  }
  interface Vendor {
    /** B2: an advocate supplier (inward RCM prompt). */
    ps?: { advocate?: boolean };
  }
}

declare module '../lib/rate-cards' {
  interface WorkType {
    /** B: billing unit; C4: rate-card currency. */
    ps?: { unit?: string; currency?: string };
  }
}

declare module '../lib/bank-accounts' {
  interface BankAccount {
    /** B3: a client-money (trust) account — not the firm's cash (`isClientMoneyAccount`). */
    client_money?: boolean;
  }
}

declare module './trade-r4' {
  interface ExportIrm {
    /** C3: FIRA / e-FIRC number. */
    ps?: { fira_no?: string };
  }
}

/* ════════════════════════════════════════ PS-B ════════════════════════════════════════ */
// B4: the stage plan of a design engagement (fee % of project cost, revisions, stages, the property — PS6, PS30).
export interface PsStagePlan {
  fee_pct: number;
  cost_basis: 'estimate' | 'tender' | 'actual';
  revisions: { date: string; cost: number; note?: string }[];
  stages: { id: string; label: string; cum_pct: number }[];
  /** Documentation / site-visit charges, % of the fee. */
  extra_pct?: number;
  property: { state?: string; city?: string; country?: string };
}
export interface Engagement {
  /** B4: stage fees on project cost (model `milestone`). */
  stage?: PsStagePlan;
}
// B3: client-money vouchers live in `prof/ps-client-money.ts` (`ClientMoneyVoucher`); B1 / B5 purchase fields are read
// through `ps-disb.ts` / `ps-media.ts` (the PS-A declaration above carries the keys).

/* ════════════════════════════════════════ PS-C ════════════════════════════════════════ */
// PS-C: EDF register rows, platform receipts (fill here).

/* ════════════════════════════════════════ PS-D ════════════════════════════════════════ */
// PS-D: partners, partner runs, UDIN register; the D sub-objects of Client.ps / catalogue ps / prof_settings.ca.

/** How a partner's remuneration is fixed by the deed (one term row per date range). */
export interface PartnerRemuneration {
  mode: 'fixed' | 'pct_book_profit' | 'max_allowable';
  /** Fixed amount for the FY (₹), mode `fixed`. */
  amount?: number;
  /** % of book profit, mode `pct_book_profit`. */
  pct?: number;
}

export interface PartnerTerm {
  /** First day (inclusive) this term applies, `YYYY-MM-DD`. */
  from: string;
  share_pct: number;
  remuneration: PartnerRemuneration;
  /** Interest on capital, % a year (capped by `PARTNER_INTEREST_CAP_RULES`). */
  interest_pct: number;
  interest_on_drawings_pct?: number;
  deed_ref?: string;
}

/** Table `partners` (`settings.manage`, audited). */
export interface Partner {
  id: string;
  name: string;
  pan?: string;
  kind: 'working' | 'non_working';
  /** LLP designated partner. */
  designated?: boolean;
  joined: string;
  left?: string;
  capital_account_id: string;
  current_account_id: string;
  terms: PartnerTerm[];
  /** Vendor master row used as the payee of the 194T deduction (created on first need). */
  vendor_id?: string;
  created_at?: string;
}

/** One partner's line in a year-end run (₹). */
export interface PartnerRunLine {
  partner_id: string;
  name: string;
  share_pct: number;
  interest: number;
  remuneration: number;
  /** Interest charged on drawings (the firm's income). */
  drawings_interest: number;
  /** Residual profit share credited. */
  share: number;
  tds?: number;
  tds_row_id?: string;
}

/**
 * Table `partner_runs` (dated by `date`, `books.edit`, audited). `kind: 'year_end'` = the FY appropriation (one live row
 * per FY); `kind: 'credit'` = a monthly salary / remuneration / commission / bonus / interest credit to a partner (the
 * 194T aggregate reads both).
 */
export interface PartnerRun {
  id: string;
  kind: 'year_end' | 'credit';
  date: string;
  /** FY start year. */
  fy: number;
  // year_end
  book_profit?: number;
  net_profit?: number;
  adjustments?: { label: string; amount: number }[];
  allowable?: number;
  remuneration_total?: number;
  disallowed?: number;
  interest_total?: number;
  residual?: number;
  lines?: PartnerRunLine[];
  // credit
  partner_id?: string;
  credit_kind?: PartnerCreditKind;
  amount?: number;
  tds?: number;
  tds_row_id?: string;
  voucher_ids: string[];
  notes?: string;
  created_at?: string;
}

/** Kinds of credit to a partner that 194T covers (drawings and the share of profit never). */
export type PartnerCreditKind = 'salary' | 'remuneration' | 'commission' | 'bonus' | 'interest';

/** Table `udin_register` (dated by `date`, `doc.create`, audited). */
export interface UdinRow {
  id: string;
  udin: string;
  date: string;
  client_id: string;
  client_name?: string;
  kind: 'certificate' | 'tax_audit' | 'gst_audit' | 'stat_audit' | 'other';
  description: string;
  member_no: string;
  fy?: string;
  pan?: string;
  revoked?: { date: string; reason: string };
  created_at?: string;
}

/** Client default TDS on our fee notes (`Client.ps.tds`, PS-D3). */
export interface ClientTdsDefault {
  section: '194J' | '194J-T' | '194C' | '194H' | 'none';
  rate?: number;
}

/** Fee events a CA / CS / CMA firm bills (catalogue `ps.fee_event`, rates per client in `Client.ps.fees`). */
export type CaFeeEvent = 'gstr1' | 'gstr3b' | 'gstr9' | 'tds_return' | 'itr' | 'tax_audit' | 'stat_audit' | 'roc_annual' | 'certificate' | 'dsc_renewal' | 'checklist' | 'retainer';

/** `prof_settings.ca` (PS-A1 ids; PS-D5 company links). */
export type ProfCaSettings = NonNullable<ProfSettings['ca']>;

export {};
