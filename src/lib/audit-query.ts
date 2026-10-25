/**
 * Reading side of the audit log: filtering and CSV export (used by Settings → Activity only,
 * so it lives apart from `audit.ts` to stay out of the entry chunk).
 */

import { AUDIT_ACTION_LABELS, type AuditAction, type AuditEntity, type AuditEntry } from '../types/audit';
import { can } from './access';
import { toCsv } from './csv';

/* ── Payroll privacy (review H1) ───────────────────────────────── */

/**
 * Entities whose rows describe salaries, loans, leave or settlements of named employees. Payroll is
 * confidential (`payroll.view`, owner-only by default), so a clerk / viewer never sees these rows in
 * the activity log, its CSV or a record's edit log.
 */
export const PAYROLL_AUDIT_ENTITIES: ReadonlySet<AuditEntity> = new Set<AuditEntity>(['payroll', 'employee']);

export const isPayrollAudit = (e: Pick<AuditEntry, 'entity'>): boolean => PAYROLL_AUDIT_ENTITIES.has(e.entity);

/** The rows the signed-in user may see: payroll rows only with `payroll.view`. */
export function visibleAudit(entries: AuditEntry[], payroll: boolean = can('payroll.view')): AuditEntry[] {
  return payroll ? entries : entries.filter((e) => !isPayrollAudit(e));
}

/* ── Query / export (pure) ─────────────────────────────────────── */

export interface AuditFilter {
  entity?: AuditEntity | 'all';
  action?: AuditAction | 'all';
  /** Inclusive local day, YYYY-MM-DD. */
  from?: string;
  to?: string;
  q?: string;
}

function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function filterAudit(entries: AuditEntry[], f: AuditFilter): AuditEntry[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const payroll = can('payroll.view');
  return entries.filter((e) => {
    if (!payroll && isPayrollAudit(e)) return false;
    if (f.entity && f.entity !== 'all' && e.entity !== f.entity) return false;
    if (f.action && f.action !== 'all' && e.action !== f.action) return false;
    const day = localDay(e.at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q) {
      const hay = [e.summary, e.doc_number, e.entity_id, e.by, ...(e.changes ?? []).flatMap((c) => [c.field, c.from, c.to])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function auditToCsv(entries: AuditEntry[]): string {
  // 'By' (6.21) is appended last so existing column positions do not move.
  const header = ['When', 'Entity', 'Action', 'Document', 'Summary', 'Field', 'From', 'To', 'By'];
  const rows: unknown[][] = [header];
  for (const e of visibleAudit(entries)) {
    const base = [e.at, e.entity, AUDIT_ACTION_LABELS[e.action] ?? e.action, e.doc_number ?? ''];
    const by = e.by ?? '';
    if (!e.changes?.length) rows.push([...base, e.summary, '', '', '', by]);
    else e.changes.forEach((c, i) => rows.push([...base, i === 0 ? e.summary : '', c.field, c.from ?? '', c.to ?? '', by]));
  }
  return toCsv(rows);
}

