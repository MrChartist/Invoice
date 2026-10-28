/**
 * R3-B service billing & party speed: additive fields on invoices, clients and time entries, declared by
 * declaration merging so the shared `invoice.ts` / `time.ts` stay with their owners (docs/prd/round-3.md §6).
 * Persisted names are snake_case and additive-only. See docs/features/service-billing-r3.md.
 */

/** One time row printed on the timesheet annexure (B4), copied from the billed entry at save time. */
export interface AnnexureRow {
  /** Local day YYYY-MM-DD. */
  date: string;
  who?: string;
  project?: string;
  task?: string;
  description: string;
  /** Raw minutes worked. */
  minutes: number;
  /** Minutes billed (after the billing step / retainer coverage). */
  billed_minutes: number;
  rate: number;
  amount: number;
  /** `time_entries` row id (ties the row to the invoice line's `bill_refs`). */
  ref?: string;
}

/** One re-billed cost printed on the annexure (B4). */
export interface AnnexureExpense {
  date: string;
  vendor: string;
  description: string;
  /** What the invoice line charges for it (cost + markup, or the actual cost for a pure agent). */
  amount: number;
  markup_pct: number;
  pure_agent: boolean;
  /** `purchases` row id. */
  ref?: string;
}

/** Snapshot of the timesheet behind a bill (B4). Never rebuilt automatically (Critical Rule 3). */
export interface InvoiceAnnexure {
  kind: 'timesheet';
  rows: AnnexureRow[];
  expenses?: AnnexureExpense[];
  /** ISO time the snapshot was taken (refreshes update it). */
  taken_at?: string;
}

/** Per-party document defaults (B5): applied once when the party is picked on a NEW document. */
export interface DocDefaults {
  template_id?: string;
  currency?: string;
  /** Default line discount % for new lines. */
  discount_percent?: number;
  notes?: string;
  terms?: string;
  /** Client hourly rate (rate cards, B1). */
  hourly_rate?: number;
  /** Tick "Attach timesheet annexure" by default when billing this client (B4). */
  annexure?: boolean;
  /** Print language for the Bilingual template: 'hi' picks the Bilingual (Hindi) template when no template is set. */
  print_lang?: 'en' | 'hi';
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R3-B4): timesheet / expense annexure snapshot, printed as a following page. */
    annexure?: InvoiceAnnexure;
  }
  interface Client {
    /** Additive (R3-B5): document defaults for this party. */
    doc_defaults?: DocDefaults;
  }
}

declare module './time' {
  interface TimeEntry {
    /** Additive (R3-B1): `work_types` row id. Its SAC overrides the preference SAC on the bill line. */
    work_type_id?: string;
    /** Additive (R3-B2): `project_tasks` row id. */
    task_id?: string;
    /** Additive (R3-B3): retainer that covered this entry when its period was closed. */
    retainer_id?: string;
    /** Additive (R3-B3): that retainer period (first local day of the period, YYYY-MM-DD). */
    retainer_period?: string;
  }
}

declare module '../lib/timer' {
  interface TimerState {
    /** R3-B: the running timer's task / work type / project, copied onto the entry when it stops. */
    task_id?: string;
    work_type_id?: string;
    cost_centre_id?: string;
  }
}

export {};
