/**
 * R18-D3 registers and the audit tracker (pure; family `f-society`): the member rows behind the List of members (MH Form
 * J, Rule 33; elsewhere a register of members), the I register (with transfers), the share and nomination registers
 * (nominees as name / share / relation only, HS30), titled by the State row (`registers`); and each FY's audit due date
 * (`audit_due_months` after the FY end — TN 3, KA 6 — else typed, HS31) with its status. Working papers — verify with
 * your CA.
 */
import type { Client } from '../../types/invoice';
import type { HsAudit, HsNominee, SocietyUnit } from '../../types/society-r18';

export interface MemberRow { id: string; no: string; name: string; unit: string; admitted?: string; cert?: string; nominees: HsNominee[]; transfers: number }

/** One row per live unit with an owner, by unit code; the member number is the client's, else the row's place. */
export function memberRows(units: readonly SocietyUnit[], clients: readonly Client[]): MemberRow[] {
  const byId = new Map(clients.map((c) => [c.id, c]));
  return units.filter((u) => u.status === 'active' && u.owner_id && byId.has(u.owner_id)).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })).map((u, i) => {
    const c = byId.get(u.owner_id!)!;
    return { id: u.id, no: c.hs?.member_no || String(i + 1), name: c.name, unit: u.wing && !u.code.startsWith(u.wing) ? `${u.code} (Wing ${u.wing})` : u.code, ...(u.admitted_on ? { admitted: u.admitted_on } : {}), ...(u.share_cert ? { cert: u.share_cert } : {}), nominees: u.nominees ?? [], transfers: u.transfers?.length ?? 0 };
  });
}

/** `Asha:50:Wife; Ravi:50` → nominees (blank names dropped, shares clamped 0–100). */
export const parseNominees = (t: string): HsNominee[] =>
  t.split(';').map((x) => x.split(':').map((y) => y.trim())).filter(([n]) => n).map(([name, pct, relation]) => ({ name, share_pct: Math.min(100, Math.max(0, Number(pct) || 0)), ...(relation ? { relation } : {}) }));
export const nomineesText = (n: readonly HsNominee[] = []) => n.map((x) => [x.name, x.share_pct, x.relation].filter((v) => v !== undefined && v !== '').join(':')).join('; ');

/** The due date of FY `fy` (`2026-27`): typed, else the last day `months` after 31 March. */
export function auditDue(a: Pick<HsAudit, 'fy' | 'due_on'>, months: number | null): string {
  if (a.due_on) return a.due_on;
  const y = Number(a.fy.slice(0, 4)) + 1;
  if (!months || !y) return '';
  const m = 3 + months, yy = y + Math.floor((m - 1) / 12), mm = ((m - 1) % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** Status chip: rectified, reported, overdue or due in n days. */
export function auditStatus(a: HsAudit, due: string, today: string): { code: 'sFixed' | 'sDone' | 'sOver' | 'sDue' | ''; n?: number } {
  if (a.rectified_on) return { code: 'sFixed' };
  if (a.report_on) return { code: 'sDone' };
  if (!due) return { code: '' };
  const n = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  return n < 0 ? { code: 'sOver' } : { code: 'sDue', n };
}
