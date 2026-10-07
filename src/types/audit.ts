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
  | 'system';

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
  | 'import';

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
};
