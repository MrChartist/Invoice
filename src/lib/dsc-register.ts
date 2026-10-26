/**
 * R3-C6 DSC register (per company, company data: backed up and synced): digital signature certificates
 * of the people who sign this company's returns — holder, role, class, token / issuer, validity. The
 * bell warns 30 / 7 days before expiry in the open company (`dsc-alerts.ts`); the practice board shows
 * every company's nearest expiry. Dates are local days.
 */

import { daysBetween } from './compliance';
import { requireAccess } from './access';
import { getTable, generateId, setTable } from './storage';
import { withTablesRollback } from './table-txn';

export const DSC_TABLE = 'dsc_register';
export type DscRole = 'director' | 'partner' | 'proprietor' | 'signatory';
export const DSC_ROLES: readonly DscRole[] = ['director', 'partner', 'proprietor', 'signatory'];
/** Warn this many days before expiry (first, then urgent). */
export const DSC_WARN_DAYS = [30, 7] as const;

export interface DscRow {
  id: string;
  holder: string;
  role: DscRole;
  /** e.g. "Class 3". */
  dsc_class?: string;
  /** Token make / issuing CA. */
  token?: string;
  issuer?: string;
  /** Local days YYYY-MM-DD. */
  valid_from?: string;
  valid_to: string;
  notes?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Clean a typed / stored row; null when the holder or the expiry date is missing. */
export function sanitizeDsc(raw: unknown): DscRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const holder = txt(o.holder, 80);
  const valid_to = txt(o.valid_to, 10);
  if (!holder || !DAY.test(valid_to)) return null;
  const valid_from = txt(o.valid_from, 10);
  const row: DscRow = {
    id: txt(o.id, 64) || generateId(),
    holder,
    role: DSC_ROLES.includes(o.role as DscRole) ? (o.role as DscRole) : 'signatory',
    valid_to,
  };
  for (const k of ['dsc_class', 'token', 'issuer', 'notes'] as const) {
    const v = txt(o[k], k === 'notes' ? 200 : 60);
    if (v) row[k] = v;
  }
  if (DAY.test(valid_from)) row.valid_from = valid_from;
  return row;
}

export type DscStatus = 'expired' | 'urgent' | 'soon' | 'ok';

export const daysToExpiry = (row: Pick<DscRow, 'valid_to'>, today: string): number => daysBetween(today, row.valid_to);

/** expired (past the valid-to day), urgent (≤ 7 days), soon (≤ 30 days) or ok. */
export function dscStatus(row: Pick<DscRow, 'valid_to'>, today: string): DscStatus {
  const d = daysToExpiry(row, today);
  if (d < 0) return 'expired';
  if (d <= DSC_WARN_DAYS[1]) return 'urgent';
  if (d <= DSC_WARN_DAYS[0]) return 'soon';
  return 'ok';
}

/** The certificate that expires next (expired ones first), or undefined. */
export function nearestExpiry<T extends Pick<DscRow, 'valid_to'>>(rows: readonly T[]): T | undefined {
  return [...rows].filter((r) => r && DAY.test(r.valid_to)).sort((a, b) => a.valid_to.localeCompare(b.valid_to))[0];
}

export const dscDb = {
  all: (): DscRow[] => getTable<DscRow>(DSC_TABLE).map(sanitizeDsc).filter((r): r is DscRow => !!r),
  save(input: Partial<DscRow>): DscRow {
    requireAccess('books.edit');
    const row = sanitizeDsc(input);
    if (!row) throw new Error('Enter the holder and the valid-to date.');
    withTablesRollback([DSC_TABLE], () => setTable(DSC_TABLE, [...getTable<DscRow>(DSC_TABLE).filter((r) => r?.id !== row.id), row]));
    return row;
  },
  remove(id: string): void {
    requireAccess('books.edit');
    setTable(DSC_TABLE, getTable<DscRow>(DSC_TABLE).filter((r) => r?.id !== id));
  },
};
