/**
 * Round 14 PS-D (the firm's statutory desk) — persisted shapes of the D tables (`partners`, `partner_runs`,
 * `udin_register`) and the D sub-objects read from PS-A's additive fields (`Client.ps.tds` / `fees`, catalogue
 * `ps.fee_event`, `prof_settings.ca`). Types only (0 bytes). Kept beside `prof-r14.ts` (PS-A's scaffold, one
 * `declare module` block per package) so this package never edits A's block; the D block there may re-export these.
 * Everything here is a working paper — verify with your CA (docs/CA_REVIEW.md §14, PS18–PS25, PS29, PS33–PS36, PS70+).
 */

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

/** `prof_settings.ca` (PS-A1 asks member / firm no.; PS-D5 adds the company links). */
export interface ProfCaSettings {
  member_no?: string;
  firm_reg_no?: string;
  body?: 'icai' | 'icsi' | 'icmai';
  company_clients?: { company_id: string; gstin?: string; client_id: string }[];
}
