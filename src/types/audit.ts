/**
 * Audit trail ("edit log") types. Persisted in the `audit_log` table
 * (`mrchartist_inv_audit_log`). Additive only — never rename fields.
 */

export type AuditEntity =
  | 'invoice'
  | 'payment'
  | 'client'
  | 'profile'
  | 'settings'
  | 'purchase'
  | 'item'
  | 'system'
  /** Double-entry ledger (6.1): manual vouchers, user accounts, fixed-asset register. */
  | 'voucher'
  | 'account'
  | 'fixed_asset'
  /** Cost centres / projects (6.16) and budgets (6.17). */
  | 'cost_centre'
  | 'budget'
  /** Cheque register (6.26). */
  | 'cheque'
  /** Stock transfer voucher between godowns (6.10). */
  | 'stock_transfer'
  /** Advance receipts, refunds and adjustments (5.3). */
  | 'advance'
  /** TDS / TCS challans, manual deductions and return-filed marks (Tally parity). */
  | 'tds'
  /** Supplier advances / on-account payments and their bill-wise adjustments (Tally parity). */
  | 'vendor_payment'
  /** Integrity review: godown masters, purchase orders, manual stock adjustments, POS day-close counts. */
  | 'godown'
  | 'purchase_order'
  | 'stock_adjustment'
  | 'pos_day_close'
  /** Payroll masters: employees, groups, pay heads, salary structures, production types (Phase 7). */
  | 'employee'
  /** Payroll runs, attendance, salary / statutory payments (Phase 7). */
  | 'payroll'
  /** Phase 7 (Tally parity): Bill of Materials, Manufacturing Journal, Stock Journal, Physical Stock. */
  | 'bom'
  | 'manufacturing'
  | 'stock_journal'
  | 'physical_stock';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'reinstate'
  | 'payment_add'
  | 'payment_remove'
  | 'lock'
  | 'unlock'
  | 'override'
  | 'restore'
  | 'import'
  /** Integrity anchors (4.5): written by the app itself, never by a user action. */
  | 'chain_start'
  | 'truncate';

export interface AuditChange {
  field: string;
  /** Display string (money already formatted). null = "not set". */
  from: string | null;
  to: string | null;
}

export interface AuditEntry {
  id: string;
  /** ISO instant the change was made. */
  at: string;
  entity: AuditEntity;
  entity_id: string;
  action: AuditAction;
  /** One readable sentence, e.g. "Edited INV/FY25-26/0007: Total ₹1,000.00 → ₹1,180.00". */
  summary: string;
  changes?: AuditChange[];
  /** Document number for invoice / payment rows, so the log reads without a lookup. */
  doc_number?: string;
  /** Owning document id for rows that hang off one (payments). */
  parent_id?: string;
  /**
   * Name of the local user signed in when the change was made (6.21). Covered by `hash`.
   * Absent on older rows, on rows written before anyone signed in, and on integrity anchors.
   */
  by?: string;
  /**
   * Tamper evidence (4.5). `prev` is the previous row's `hash` (or `AUDIT_GENESIS` for the first row);
   * `hash` is SHA-256 over the canonical form of every other field of this row, `prev` included.
   * Absent on rows written before 4.5 (the legacy segment).
   */
  prev?: string;
  hash?: string;
  /** Extra facts carried by anchor rows (`chain_start`, `truncate`, `restore`). Covered by `hash`. */
  seal?: AuditSeal;
}

export interface AuditSeal {
  /** Unchained rows immediately before this anchor (chain_start) or at the start of the log (truncate). */
  legacy?: { count: number; digest: string };
  /** truncate: why older rows were removed, how many, and the `prev` of the first chained row kept. */
  reason?: 'storage' | 'cap';
  dropped?: number;
  cut?: string;
  /** restore: chain head + row count of the backup's own log, and of the log it replaced. */
  restored_head?: string | null;
  restored_rows?: number;
  replaced_head?: string | null;
  replaced_rows?: number;
}

export const AUDIT_ENTITIES: AuditEntity[] = [
  'invoice',
  'payment',
  'client',
  'profile',
  'settings',
  'purchase',
  'item',
  'system',
  'voucher',
  'account',
  'fixed_asset',
  'cost_centre',
  'budget',
  'cheque',
  'advance',
  'employee',
  'payroll',
];

export const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'cancel',
  'reinstate',
  'payment_add',
  'payment_remove',
  'lock',
  'unlock',
  'override',
  'restore',
  'import',
  'chain_start',
  'truncate',
];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Created',
  update: 'Edited',
  delete: 'Deleted',
  cancel: 'Cancelled',
  reinstate: 'Reinstated',
  payment_add: 'Payment added',
  payment_remove: 'Payment removed',
  lock: 'Books locked',
  unlock: 'Lock lifted',
  override: 'Lock overridden',
  restore: 'Restored',
  import: 'Imported',
  chain_start: 'Chain started',
  truncate: 'Older entries removed',
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  invoice: 'Documents',
  payment: 'Payments',
  client: 'Clients',
  profile: 'Business profiles',
  settings: 'Settings',
  purchase: 'Purchases',
  item: 'Catalogue',
  system: 'System',
  voucher: 'Vouchers',
  account: 'Chart of accounts',
  fixed_asset: 'Fixed assets',
  cost_centre: 'Cost centres',
  budget: 'Budgets',
  cheque: 'Cheques',
  stock_transfer: 'Stock transfers',
  advance: 'Advances',
  tds: 'TDS / TCS',
  vendor_payment: 'Supplier advances',
  godown: 'Godowns',
  purchase_order: 'Purchase orders',
  stock_adjustment: 'Stock adjustments',
  pos_day_close: 'POS day close',
  employee: 'Payroll masters',
  payroll: 'Payroll',
  bom: 'Bills of materials',
  manufacturing: 'Manufacturing journals',
  stock_journal: 'Stock journals',
  physical_stock: 'Physical stock',
};
