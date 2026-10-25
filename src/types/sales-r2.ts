/**
 * R2-B sales documents: additive document / line fields for progress billing (B2) and quotation
 * revisions, optional lines and proposal sections (B3). Declared by declaration merging so the shared
 * `invoice.ts` stays with its owner (docs/prd/round-2.md §6). Contacts / attention live in `contacts.ts`.
 */
import './contacts';

/** A milestone of the billing plan on a quotation / sales order (B2). */
export interface Milestone {
  id: string;
  name: string;
  /** Percent of the whole quotation billed at this milestone. */
  percent: number;
  /** Local day (YYYY-MM-DD) the milestone is expected. */
  expected_date?: string;
  /** Stage invoice that billed it (ticked). */
  invoice_id?: string;
}

export type ProgressBasis = 'percent' | 'amount' | 'lines';

/** On a stage invoice: what it bills of which quotation / sales order (B2). */
export interface ProgressOf {
  source_id: string;
  basis: ProgressBasis;
  /** Percent (basis percent), rupees before GST (basis amount) or the weighted percent (basis lines). */
  value: number;
  /** Stage number (1, 2, 3 …). */
  stage?: number;
  /** The "remaining balance" invoice that closed the source. */
  final?: boolean;
  milestone_id?: string;
  /** Billing beyond 100% was allowed for this reason. */
  over_reason?: string;
}

export type SectionPlace = 'cover' | 'before' | 'after';

/** A proposal block on a quotation (B3): cover page, before or after the items. */
export interface ProposalSection {
  id: string;
  place: SectionPlace;
  title: string;
  /** Plain text (line breaks kept). */
  body: string;
  /** Optional image: an attachment of the same document (`attachments`). */
  attachment_id?: string;
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R2-B2): milestone plan on a quotation / sales order. */
    milestones?: Milestone[];
    /** Additive (R2-B2): set on a stage invoice raised by progress billing. */
    progress_of?: ProgressOf;
    /** Additive (R2-B3): id of the quotation this one revises. */
    revision_of?: string;
    /** Additive (R2-B3): revision number (the original is 1, the first revision 2 → "-R2"). */
    revision_no?: number;
    /** Additive (R2-B3): proposal sections printed on the quotation. */
    proposal_sections?: ProposalSection[];
  }
  interface InvoiceItem {
    /** Additive (R2-B3), quotations: an optional add-on, outside the total unless `selected`. */
    optional?: boolean;
    /** Additive (R2-B3): the client picked this optional / alternative line. */
    selected?: boolean;
    /** Additive (R2-B3): lines sharing a group are alternatives ("Option A / Option B"); one is selected. */
    alt_group?: string;
    /** Additive (R2-B2), stage invoices: id of the quotation / sales-order line this line bills a share of. */
    progress_line_of?: string;
  }
}

export {};
