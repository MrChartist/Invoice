/**
 * Reading side of the audit log: filtering and CSV export (used by Settings → Activity only,
 * so it lives apart from `audit.ts` to stay out of the entry chunk).
 */

import { AUDIT_ACTION_LABELS, type AuditAction, type AuditEntity, type AuditEntry } from '../types/audit';
import { toCsv } from './csv';

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
  return entries.filter((e) => {
    if (f.entity && f.entity !== 'all' && e.entity !== f.entity) return false;
    if (f.action && f.action !== 'all' && e.action !== f.action) return false;
    const day = localDay(e.at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (q) {
      const hay = [e.summary, e.doc_number, e.entity_id, ...(e.changes ?? []).flatMap((c) => [c.field, c.from, c.to])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function auditToCsv(entries: AuditEntry[]): string {
  const header = ['When', 'Entity', 'Action', 'Document', 'Summary', 'Field', 'From', 'To'];
  const rows: unknown[][] = [header];
  for (const e of entries) {
    const base = [e.at, e.entity, AUDIT_ACTION_LABELS[e.action] ?? e.action, e.doc_number ?? ''];
    if (!e.changes?.length) rows.push([...base, e.summary, '', '', '']);
    else e.changes.forEach((c, i) => rows.push([...base, i === 0 ? e.summary : '', c.field, c.from ?? '', c.to ?? '']));
  }
  return toCsv(rows);
}

