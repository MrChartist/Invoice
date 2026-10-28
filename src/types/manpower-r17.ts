/**
 * Round 17 (security, facility-management and manpower-supply agencies) — persisted shapes and additive fields of
 * R17-A … R17-D (docs/prd/round-17.md §6). Existing type files are not edited: the new optional fields arrive here by
 * declaration merging. Every Round 17 snapshot on a document lives under ONE record key `mp` (`R17_RECORD_KEYS` in
 * `src/store/invoice-defaults.ts`); there is no Round 17 line key (Sl. 66 lines reuse the R10 line key `sv.exempt`, the
 * SAC sits in `hsn`). R17-A declares the sub-field types of every package in one commit; B–D fill only their own block —
 * an interface re-declared there merges with A's. Aadhaar, bank details and police-verification documents are never
 * stored (DPDP minimisation, PRD §6). Types only (0 bytes). Working papers — verify with your CA (CA_REVIEW §17, MP1–MP32).
 */

/* ════════════════════════════════════════ R17-A ════════════════════════════════════════ */

/** The agency picked under Services → Security, housekeeping and manpower supply (settings `manpower_kind`). */
export type ManpowerKind = 'security' | 'facility' | 'staffing' | 'labour' | 'other';
/** GST regime of a manpower document (A3): forward 18 %, RCM entry 14, exempt Sl. 66(b)(iii), manual exempt. */
export type MpRegime = 'fwd' | 'rcm' | 'exempt66' | 'manual_exempt';
/** Billing basis of a post (A2; B3 bills by it). */
export type MpBasis = 'month' | 'duty' | 'hour' | 'costplus';
export type SiteStatus = 'active' | 'paused' | 'closed';

/** A2: one post at a site (≤ 30 a site). `skill` / `zone` feed C3's wage check. */
export interface MpPost {
  id: string;
  name: string;
  sac: string;
  heads: number;
  shift_hours: number;
  basis: MpBasis;
  /** ₹ per month (per head), per duty, per hour, or per duty of wages (cost-plus). */
  rate: number;
  skill?: string;
  zone?: string;
  /** B3: bill OT hours at the hour rate / bill duties above heads × days on a monthly post. */
  bill_ot?: boolean;
  bill_extra?: boolean;
}

/** A2: the site — a project cost centre with `CostCentre.mp` (the R14 matter / R15 trip precedent). */
export interface SiteInfo {
  code: string;
  address?: string;
  /** Two-digit GST state code of the site (place of supply of an unregistered client, MP3). */
  state?: string;
  contract: { from?: string; to?: string; ref?: string; escalation?: 'vda_pass_through' | 'fixed' | 'none' };
  posts: MpPost[];
  /** B3: sites with the same group and client are billed on one invoice. */
  bill_group?: string;
  status: SiteStatus;
}

/** A2: client flags (`Client.mp`) the regime engine and D2 read. */
export interface ClientMp {
  /** A Government department registered only to deduct TDS u/s 51 (outside entry 14). */
  gst_tds_only?: boolean;
  /** A composition taxpayer (outside entry 14). */
  composition?: boolean;
  /** Pre-school to higher secondary institution (Sl. 66(b)(iii)). */
  school?: boolean;
  /** B4 / D2: the client's TDS section and our deductee class. */
  tds?: { section: '194C' | '194J' | 'none'; deductee: 'company' | 'other' };
}

/** C: a typed minimum-wage revision. */
export interface WageRevision { id: string; from: string; zone?: string; skill?: string; post_name?: string; wage_day?: number; wage_month?: number; ref: string }
/** D3: a licence with a renewal date. */
export interface MpLicence { id: string; kind: 'psara' | 'osh' | 'clra' | 'trade' | 'other'; state?: string; no: string; valid_till: string }

/** Company object `manpower_settings` (owner only, audited, synced as a singleton). A writes the shape of every package. */
export interface ManpowerSettings {
  /** A: pro-rata base of a monthly post. */
  billing_days?: 'calendar' | 26 | 30;
  shift_hours?: 8 | 12;
  service_charge_pct?: number;
  /** A: invoice date of a month's bill (MP11). */
  bill_date?: 'month_end' | 'next_1';
  /** B: payroll attendance type for extra duties; typed cost-plus percentages (no defaults in rules). */
  extra_duty_type_id?: string;
  costplus?: { pf_pct?: number; esi_pct?: number; bonus_pct?: number; leave_pct?: number; relieving_pct?: number; uniform_per_head?: number };
  /** B4: print the expected client TDS line. */
  print_tds?: boolean;
  /** C: typed minimum-wage / VDA revisions. */
  wage_revisions?: WageRevision[];
  /** D: licences with renewal dates; arrears document (MP12). */
  licences?: MpLicence[];
  arrears_doc?: 'debit_note' | 'invoice';
  updated_at?: string;
}

/** A4: one post summary row printed on the paper (B fills `duties` and `line_id`). */
export interface MpPostRow { post: string; sac: string; heads: number; duties?: number; rate: number; amount?: number; basis?: MpBasis; line_id?: string; site?: string }

/** The invoice snapshot `mp` (A: site, month, basis, regime, decl, posts; B: muster_id, annex, tds; C: comp; D: arrear). */
export interface MpSnapshot {
  site?: { id: string; code: string; name: string };
  /** Service month `YYYY-MM`. */
  month?: string;
  basis?: MpBasis;
  regime?: MpRegime;
  /** The user's override reason (audited); the manual-exemption reason. */
  regime_note?: string;
  /** The printed regime sentence (snapshotted, never re-derived). */
  decl?: string;
  posts?: MpPostRow[];
  /** B1 / B3: the muster billed (billed state is derived from it). */
  muster_id?: string;
  /** B3: per-employee duty annexure (name and code only). */
  annex?: { name: string; code: string; duties: number; ot?: number; post?: string }[];
  /** B4: expected client TDS. */
  tds?: { section: string; rate: number; expected: number; label?: string };
  /** C1: the site's compliance proof referenced on the bill. */
  comp?: { trrn?: string; challan?: string; status?: 'pending' | 'proved' | 'waived' };
  /** D1: arrears debit note of an original invoice. */
  arrear?: { rev_id: string; from: string; to: string; of: string };
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Round 17 record snapshot (see `MpSnapshot`). */
    mp?: MpSnapshot;
  }
  interface Client {
    /** A2: the client's GST-regime and TDS flags. */
    mp?: ClientMp;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** A1: manpower profile under `services` / `manpower`; absent = no Deploy desk. */
    manpower_kind?: ManpowerKind;
  }
}

declare module '../lib/cost-centres' {
  interface CostCentre {
    /** A2: site fields (the site is this project cost centre). */
    mp?: SiteInfo;
  }
}

declare module './purchases' {
  interface PurchaseRecord {
    /** C2: the site a purchase bill (uniforms, consumables, equipment hire) is charged to. */
    mp?: { site_id: string };
  }
}

declare module './payroll' {
  interface Employee {
    /** A2: the post an employee is deployed on; D3: the guard's own licence. */
    mp?: { post_id?: string; guard_licence?: { no: string; valid_till: string } };
  }
}

/* ════════════════════════════════════════ R17-B ════════════════════════════════════════ */

/** B1: one person's month at a site (duties in 0.5 steps; OT in hours; a reliever covers others' offs). */
export interface MusterRow { employee_id: string; post_id: string; duties: number; ot_hours?: number; relief?: boolean; note?: string }

/** B1: table `site_musters` — one row per site × month (≤ 300 rows inside), dated by the month's last day (`date`). */
export interface SiteMuster {
  id: string;
  site_id: string;
  /** `YYYY-MM`. */
  month: string;
  /** The month's last day (`YYYY-MM-DD`): the sync / period-lock date. */
  date: string;
  rows: MusterRow[];
  status: 'draft' | 'locked';
  locked_at?: string;
  updated_at: string;
}

/** B3 / B4 sub-fields of the `mp` snapshot (interface merging with A's declaration above). */
export interface MpSnapshot {
  /** B3: every muster on a grouped (per client + bill group) bill; `muster_id` is the first. */
  muster_ids?: string[];
  /** B4: print the expected-TDS footer (the "Print expected TDS" setting when the bill was made). */
  tds_print?: boolean;
}

/* ════════════════════════════════════════ R17-C ════════════════════════════════════════ */

/** C1: table `site_compliance` — one row per site × month, dated by the month's last day (`date`). */
export interface SiteCompliance {
  id: string;
  site_id: string;
  /** `YYYY-MM`. */
  month: string;
  /** The month's last day (`YYYY-MM-DD`): the sync / period-lock date. */
  date: string;
  pf: { trrn?: string; paid_on?: string; amount?: number };
  esi: { challan?: string; paid_on?: string; amount?: number };
  attachments?: string[];
  /** `proved` needs the PF TRRN and, when ESI is due, the ESI challan (MP18). */
  status: 'pending' | 'proved' | 'waived';
  /** The client's hold on the month's bills (typed % or amount): nothing posts, the receivable stays open (MP27). */
  hold?: { pct?: number; amount?: number; invoice_id?: string };
  updated_at: string;
}

/* ════════════════════════════════════════ R17-D ════════════════════════════════════════ */

/** D1: a late-notified revision may carry the increase per duty itself, an end date and the sites ticked by hand. */
export interface WageRevision {
  /** ₹ more a duty from `from` (else `wage_day` less the previous matching revision's). */
  delta_day?: number;
  to?: string;
  /** Sites that pass it through although their escalation is not `vda_pass_through`. */
  site_ids?: string[];
}

/** D1: the arrears note's rows (post, service month, duties × increase) for its annexure. */
export interface MpSnapshot {
  arrear_rows?: { post: string; month: string; duties: number; delta: number; amount: number }[];
}
