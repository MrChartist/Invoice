/**
 * RT-B2 retention of Schedule H1 / X bills (`PHARMA_RETENTION_RULES`: H1 register 3 years, X prescriptions 2 years, cash
 * memos 3 years — RT7, unverified). Small on purpose: the recycle bin's "Delete permanently" and the year-end checklist
 * read it without loading the pharmacy desk. Warns, never blocks — the owner decides. Verify with your drug inspector / CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { plusDays, readPharmaSettings } from '../pharma-gate';
import { liveScheduleIndex } from '../pharma';
import { ruleAt } from '../tax-rules';
import { PHARMA_RETENTION_RULES, type PharmaRetention } from '../retail-rules';

type Schedule = 'H' | 'H1' | 'X';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ── Retention ── */

export const retentionAt = (day: string): PharmaRetention => ruleAt(PHARMA_RETENTION_RULES, day);

/** Local day until which a bill of `day` with lines of `schedules` is kept (H1: register years; X: prescription years). */
export function keepUntil(day: string, schedules: readonly Schedule[]): string {
  const r = retentionAt(day);
  const years = Math.max(schedules.includes('H1') ? r.h1Years : 0, schedules.includes('X') ? r.xPrescriptionYears : 0);
  if (!years) return '';
  return plusDays(`${+day.slice(0, 4) + years}${day.slice(4)}`, 0);
}

/** Bills with H1 / X lines still inside their retention window on `today`. */
export function retainedBills(invoices: readonly InvoiceRecord[], index: ReadonlyMap<string, Schedule>, today: string): { id: string; number: string; until: string }[] {
  const out: { id: string; number: string; until: string }[] = [];
  for (const inv of invoices) {
    if (!inv?.issue_date) continue;
    const sch = [...new Set((inv.items ?? []).map((l) => index.get(norm(l.name))).filter((s): s is Schedule => s === 'H1' || s === 'X'))];
    if (!sch.length) continue;
    const until = keepUntil(inv.issue_date, sch);
    if (until && until > today) out.push({ id: inv.id, number: inv.invoice_number, until });
  }
  return out;
}

/* ── Storage (read only): retention warnings for the recycle bin and the year-end checklist ── */

/** Invoice rows (live or deleted) with H1 / X lines still inside retention on `today` ([] with the pharma features off). */
export function retainedAmong(rows: readonly unknown[], today: string): { id: string; number: string; until: string }[] {
  if (!readPharmaSettings().enabled) return [];
  const invoices = rows.filter((r): r is InvoiceRecord => !!r && typeof r === 'object' && Array.isArray((r as InvoiceRecord).items));
  return invoices.length ? retainedBills(invoices, liveScheduleIndex(), today) : [];
}

/** Year-end: bills of the year (`from` … `to`) with H1 / X lines to keep, and the latest keep-until day. */
export function rxRetainedInYear(invoices: readonly InvoiceRecord[], from: string, to: string, today: string): { count: number; until: string } | undefined {
  const rows = retainedAmong(invoices.filter((i) => i?.issue_date >= from && i.issue_date <= to), today);
  return rows.length ? { count: rows.length, until: rows.reduce((m, r) => (r.until > m ? r.until : m), '') } : undefined;
}
