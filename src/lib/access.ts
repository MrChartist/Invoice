/**
 * Local user roles on a shared device (roadmap 6.21): owner / clerk / viewer.
 *
 * CONVENIENCE ACCESS CONTROL, NOT SECURITY. Everything runs in this browser: anyone with the
 * device and the browser's developer tools can read or change the stored data, or bypass these
 * checks. They stop a colleague from deleting an issued invoice or erasing the books by mistake;
 * vault mode (src/lib/vault.ts) and separate OS accounts are the real protection.
 *
 * This module imports nothing, so the data layer (localDb, backup, period-lock, audit) can ask
 * `can()` / `requireAccess()` without import cycles. `auth.ts` registers who is signed in through
 * `setActorProvider()`; with no provider, or with no PIN set up, every check passes (single-user
 * installs, tests, and boot code such as migrations, which run inside `asSystem`, behave exactly as
 * before). Once a PIN is set up, a tab whose signed-in user cannot be resolved (locked, or the user was
 * removed in another tab) is SIGNED OUT: it gets the least privileged role, never the owner's.
 */

export type Role = 'owner' | 'clerk' | 'viewer';

export const ROLES: readonly Role[] = ['owner', 'clerk', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  clerk: 'Clerk',
  viewer: 'Viewer',
};

export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Everything, including settings, users, backups, erase and the period lock.',
  clerk: 'Creates and edits documents, payments, purchases and expenses. Cannot delete issued documents, see payroll, change settings or restore / erase data.',
  viewer: 'Read-only: can view, print, download PDFs and export reports.',
};

/** Everything a screen or the data layer may ask about. */
export type AccessAction =
  /** Create a new invoice / quotation / credit note … (the editor's "New"). */
  | 'doc.create'
  /** Edit a saved document, change its status, convert it. */
  | 'doc.edit'
  /** Delete a draft (never issued). */
  | 'doc.deleteDraft'
  /** Delete an issued document (anything that is not a draft). */
  | 'doc.deleteIssued'
  /** Record / remove a payment against a document. */
  | 'payment.record'
  /** Clients, catalogue items, vendors, stock — the masters. */
  | 'master.edit'
  /** Purchases, expenses, vouchers, time entries, recurring schedules. */
  | 'books.edit'
  /** Business profiles, defaults, design studio, period-lock date. */
  | 'settings.manage'
  /** Users, PIN rules for others, vault mode, idle timeout. */
  | 'security.manage'
  /** Download / auto-save a FULL backup (every table). */
  | 'data.backup'
  /** Restore a backup over this device's data. */
  | 'data.restore'
  /** Erase every table on this device. */
  | 'data.erase'
  /** Unlock a period-locked document or move the lock date earlier. */
  | 'period.override'
  /** View screens, print / download a document PDF. */
  | 'view'
  /** Export reports (CSV / Excel / GST papers). */
  | 'report.export'
  /** Approve / reject a document a clerk issued while approvals are on (WP-9 maker-checker). Owner only. */
  | 'doc.approve'
  /**
   * See and run payroll (Phase 7): employees, salaries, payslips, statutory returns. Salaries are
   * confidential, so this is owner-only — clerks and viewers do not see the Payroll screen and the
   * payroll tables refuse their writes. (The ledger still shows the month's Payroll voucher totals.)
   */
  | 'payroll.view';

const CLERK: ReadonlySet<AccessAction> = new Set<AccessAction>([
  'doc.create',
  'doc.edit',
  'doc.deleteDraft',
  'payment.record',
  'master.edit',
  'books.edit',
  'view',
  'report.export',
]);

const VIEWER: ReadonlySet<AccessAction> = new Set<AccessAction>(['view', 'report.export']);

/** Pure role matrix. */
export function roleCan(role: Role | null | undefined, action: AccessAction): boolean {
  if (role === 'owner') return true;
  if (role === 'clerk') return CLERK.has(action);
  if (role === 'viewer') return VIEWER.has(action);
  return false;
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'clerk' || value === 'viewer';
}

export interface Actor {
  id: string;
  name: string;
  role: Role;
  /**
   * Additive (7T): actions the owner granted this user on top of the role. Only `GRANTABLE_ACTIONS`
   * are honoured (a trusted clerk may be given `payroll.view`); everything else stays role-based.
   */
  grants?: readonly string[];
}

/** Actions the owner may grant to a named clerk / viewer (7T). Payroll stays owner-only by default. */
export const GRANTABLE_ACTIONS: readonly AccessAction[] = ['payroll.view'];

/** Role matrix plus the owner's per-user grants. */
export function actorCan(actor: Actor | null, role: Role, action: AccessAction): boolean {
  if (roleCan(role, action)) return true;
  return !!actor && actor.role === role && GRANTABLE_ACTIONS.includes(action) && !!actor.grants?.includes(action);
}

let provider: (() => Actor | null) | null = null;
let signInRequired: (() => boolean) | null = null;

/**
 * Called once by auth.ts. Tests may pass their own. `opts.signInRequired` answers "is a PIN set up on
 * this device?": when it is and nobody resolves as signed in, checks run as a signed-out viewer.
 */
export function setActorProvider(fn: (() => Actor | null) | null, opts: { signInRequired?: () => boolean } = {}): void {
  provider = fn;
  signInRequired = fn ? (opts.signInRequired ?? null) : null;
}

/** Who is signed in to this tab, or null (no PIN set up, locked, or no provider). */
export function currentActor(): Actor | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}

/**
 * True when a PIN is set up but nobody valid is signed in to this tab (locked, or the signed-in user
 * was removed / the credential replaced elsewhere). The app must show the PIN screen.
 */
export function isSignedOut(): boolean {
  if (!provider || currentActor()) return false;
  try {
    return signInRequired ? signInRequired() : false;
  } catch {
    return true; // cannot tell: fail closed
  }
}

/**
 * The current role. With no PIN set up (single-user install, tests) nobody signed in counts as the
 * owner; once a PIN exists, a signed-out tab is a viewer (see the module comment).
 */
export function currentRole(): Role {
  const actor = currentActor();
  if (actor) return actor.role;
  return isSignedOut() ? 'viewer' : 'owner';
}

/** May the signed-in user do `action`? */
export function can(action: AccessAction): boolean {
  return actorCan(currentActor(), currentRole(), action);
}

const DENIED_TEXT: Partial<Record<AccessAction, string>> = {
  'doc.create': 'create documents',
  'doc.edit': 'edit documents',
  'doc.deleteDraft': 'delete documents',
  'doc.deleteIssued': 'delete issued documents',
  'payment.record': 'record or remove payments',
  'master.edit': 'change clients, items or vendors',
  'books.edit': 'change purchases, expenses or the books',
  'settings.manage': 'change settings',
  'security.manage': 'manage users or security',
  'data.backup': 'download a full backup',
  'data.restore': 'restore a backup',
  'data.erase': 'erase data',
  'period.override': 'override the period lock',
  'doc.approve': 'approve or reject documents',
  'payroll.view': 'view or run payroll',
};

export function deniedMessage(action: AccessAction, role: Role = currentRole()): string {
  const what = DENIED_TEXT[action] ?? 'do that';
  return `Your role (${ROLE_LABELS[role]}) cannot ${what}. Ask the owner.`;
}

export class AccessDeniedError extends Error {
  readonly code = 'ACCESS_DENIED';
  readonly action: AccessAction;
  readonly role: Role;
  constructor(action: AccessAction, role: Role) {
    super(deniedMessage(action, role));
    this.name = 'AccessDeniedError';
    this.action = action;
    this.role = role;
  }
}

export function isAccessDeniedError(err: unknown): err is AccessDeniedError {
  return err instanceof AccessDeniedError || (err as { code?: string } | null)?.code === 'ACCESS_DENIED';
}

/** Throws `AccessDeniedError` unless the signed-in user may do `action`. Used by the data layer. */
export function requireAccess(action: AccessAction): void {
  const role = currentRole();
  if (!actorCan(currentActor(), role, action)) throw new AccessDeniedError(action, role);
}

/* ── Table-level guard (defence in depth) ─────────────────────────
 * The data APIs check `requireAccess` themselves; this map also stops a clerk / viewer from
 * changing these tables through any path that does not (stock adjustments, catalogue edits,
 * godowns, transfers, budgets, …). `storage.setTable` asks before every write. Tables the app
 * writes as a side effect of viewing (audit, notifications, export / design preferences,
 * compliance marks, reminder log) and the ones whose APIs already guard each operation with finer
 * rules (invoices, payments) are deliberately not listed.
 */
/** Payroll tables (review L1): a write is a books change AND needs payroll access, like the payroll APIs. */
const PAYROLL_WRITE: readonly AccessAction[] = ['books.edit', 'payroll.view'];

const TABLE_ACTIONS: Readonly<Record<string, AccessAction | readonly AccessAction[]>> = {
  // masters
  items_catalog: 'master.edit',
  clients: 'master.edit',
  vendors: 'master.edit',
  stock_items: 'master.edit',
  godowns: 'master.edit',
  cost_centres: 'master.edit',
  bank_accounts: 'master.edit',
  price_levels: 'master.edit',
  schemes: 'master.edit',
  custom_fields: 'master.edit',
  // Accounts Info (WP-1): groups / sub-groups and ledgers are masters
  groups: 'master.edit',
  accounts: 'master.edit',
  boms: 'master.edit',
  // Inventory masters (WP-8)
  stock_groups: 'master.edit',
  stock_categories: 'master.edit',
  units: 'master.edit',
  // books
  stock_moves: 'books.edit',
  stock_transfers: 'books.edit',
  purchases: 'books.edit',
  purchase_payments: 'books.edit',
  purchase_orders: 'books.edit',
  recurring: 'books.edit',
  time_entries: 'books.edit',
  mileage: 'books.edit',
  vouchers: 'books.edit',
  fixed_assets: 'books.edit',
  budgets: 'books.edit',
  cheques: 'books.edit',
  advances: 'books.edit',
  bank_statements: 'books.edit',
  book_opening: 'books.edit',
  // Openings (WP-1): ledger opening balances, books-beginning date, bill-wise opening outstandings
  ledger_openings: 'books.edit',
  books_begin: 'books.edit',
  opening_bills: 'books.edit',
  tds_certificates: 'books.edit',
  gstr2b_actions: 'books.edit',
  gstr4_manual: 'books.edit',
  einvoice_meta: 'books.edit',
  pos_day_close: 'books.edit',
  // Tally parity: TDS on payables, bill-wise supplier advances
  tds_challans: 'books.edit',
  tds_deductions: 'books.edit',
  tds_returns: 'books.edit',
  vendor_payments: 'books.edit',
  // Number high-water marks: written alongside a payment / transfer / PO / advance save (integrity review).
  series_counters: 'books.edit',
  // WP-3: purchase returns / supplier notes, receipt notes (GRN) and rejections out
  purchase_returns: 'books.edit',
  receipt_notes: 'books.edit',
  // Banking (WP-5)
  deposit_slips: 'books.edit',
  cash_tally: 'books.edit',
  // 7U banking: forex bank moves (revaluation / conversion journals), e-payment batches
  fx_bank_moves: 'books.edit',
  epay_batches: 'books.edit',
  // GST set-off & payment (WP-6): set-off journals, PMT-06 challans, HSN master
  gst_setoffs: 'books.edit',
  gst_challans: 'books.edit',
  // 8D GST guards
  gst_followups: 'books.edit',
  gstr2b_itc: 'books.edit',
  gstr1_snapshots: 'books.edit',
  hsn_master: 'master.edit',
  // 7O: RCM self-invoices (Rule 46(f)) and payment vouchers (Rule 52)
  rcm_documents: 'books.edit',
  // 7R: PMT-09 transfers, GST refund claims, ISD documents, TRACES justification imports
  gst_pmt09: 'books.edit',
  gst_refunds: 'books.edit',
  isd_documents: 'books.edit',
  tds_justifications: 'books.edit',
  // business extras (WP-9)
  pos_returns: 'doc.create',
  // 8E: cashier shifts — a clerk opens / closes their own shift at the counter
  pos_shifts: 'doc.create',
  branches: 'master.edit',
  amc_contracts: 'master.edit',
  loyalty_adjustments: 'master.edit',
  // 7U: sales agents (master) and the commission payable journals posted for them
  sales_agents: 'master.edit',
  commission_postings: 'books.edit',
  // 8C: documents inbox, draft bills (out of the books), recurring bills, bank rules, payment requests
  doc_inbox: 'books.edit',
  purchase_drafts: 'books.edit',
  recurring_bills: 'books.edit',
  bank_rules: 'books.edit',
  payment_requests: 'books.edit',
  // 8F: distribution masters, van settlements, order pad, breakage / expiry claims and receipts
  dist_areas: 'master.edit',
  dist_routes: 'master.edit',
  dist_beats: 'master.edit',
  van_settlements: 'books.edit',
  order_pad_outbox: 'doc.create',
  order_pad_imports: 'doc.create',
  expiry_claims: 'books.edit',
  expiry_receipts: 'books.edit',
  // approvals decision log: only the owner's decision writes it (approvals.ts `decide`); a clerk's
  // request lives on the document itself, so a clerk can never forge a decision row (review L5)
  approvals: 'doc.approve',
  // payroll (Phase 7): owner-only, salaries are confidential
  employees: PAYROLL_WRITE,
  employee_groups: PAYROLL_WRITE,
  pay_heads: PAYROLL_WRITE,
  salary_structures: PAYROLL_WRITE,
  attendance_types: PAYROLL_WRITE,
  attendance: PAYROLL_WRITE,
  payroll_runs: PAYROLL_WRITE,
  payroll_payments: PAYROLL_WRITE,
  // payroll depth (7P)
  payroll_arrears: PAYROLL_WRITE,
  employee_loans: PAYROLL_WRITE,
  leave_types: PAYROLL_WRITE,
  leave_entries: PAYROLL_WRITE,
  payroll_adjustments: PAYROLL_WRITE,
  perquisites: PAYROLL_WRITE,
  fnf_settlements: PAYROLL_WRITE,
  // payroll follow-ups (7T): Form 10E workings, actuarial valuations
  payroll_relief89: PAYROLL_WRITE,
  actuarial_valuations: PAYROLL_WRITE,
  // Phase 7 (Tally parity): manufacturing and stock vouchers
  manufacturing_vouchers: 'books.edit',
  stock_journals: 'books.edit',
  physical_stock: 'books.edit',
  // Phase 7M: job work (orders, Material Out / In, principal's material) and Rejections In
  job_work_orders: 'books.edit',
  job_work_out: 'books.edit',
  job_work_in: 'books.edit',
  job_work_principal: 'books.edit',
  rejections_in: 'books.edit',
  // 7S: production plans (MRP)
  production_plans: 'books.edit',
  // WP-7: year-end checklist marks (locking the year itself needs settings.manage, in year-end-store.ts)
  year_end: 'books.edit',
};

let systemDepth = 0;

/**
 * Run `fn` as the app rather than the signed-in user: for writes no person asked for directly
 * (folder-sync merges of another device's changes, migrations). Synchronous by design, so a
 * bypass can never stay open across an `await`.
 */
export function asSystem<T>(fn: () => T): T {
  systemDepth++;
  try {
    return fn();
  } finally {
    systemDepth--;
  }
}

/** Throws `AccessDeniedError` when the signed-in user may not write table `name`. */
export function requireTableWrite(name: string): void {
  if (systemDepth > 0) return;
  const action = TABLE_ACTIONS[name];
  if (typeof action === 'string') requireAccess(action);
  else if (action) for (const a of action) requireAccess(a);
}
