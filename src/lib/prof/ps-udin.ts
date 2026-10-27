/**
 * PS-D5 UDIN register (table `udin_register`, dated, `doc.create`, audited): UDIN, date, client, kind, description,
 * member no., FY / PAN, revocation. Format check from `UDIN_FORMAT_RULES` (18 characters: year, membership no., 10
 * letters / digits — marked verify, PS29); "UDINs not yet billed" from the invoice lines' `bill_refs` (`udin:<id>`, a
 * cancelled invoice frees them). The UDIN prints on the billed line (PS-A5 `ps.lines[lineId].udin`). No ICAI / ICSI /
 * ICMAI portal call: the UDIN is generated there and typed here.
 */
import './ps-registry';
import type { UdinRow } from '../../types/prof-r14';
import type { InvoiceRecord } from '../../types/invoice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { PS_TABLES } from './ps-shared';
import { UDIN_FORMAT_RULES, psRuleAt } from '../prof-rules';

const T = PS_TABLES.udin;
export const UDIN_KINDS: readonly UdinRow['kind'][] = ['certificate', 'tax_audit', 'gst_audit', 'stat_audit', 'other'];
export const udinRef = (id: string) => `udin:${id}`;

export const loadUdins = (): UdinRow[] => getTable<UdinRow>(T).filter((r) => !!r && typeof r.id === 'string' && typeof r.udin === 'string');

/** Problems with a UDIN for a member no. and date ([] = the format matches). The rule is unverified (PS29). */
export function udinProblems(udin: string, memberNo: string, date: string): string[] {
  const f = psRuleAt(UDIN_FORMAT_RULES, date).value;
  const u = udin.trim().toUpperCase();
  const out: string[] = [];
  if (u.length !== f.length || !/^[A-Z0-9]+$/.test(u)) out.push(`A UDIN has ${f.length} letters / digits.`);
  const yy = u.slice(0, f.yearDigits);
  if (!/^\d+$/.test(yy) || (date && yy !== date.slice(2, 4))) out.push(`It should start with the year of generation (${date.slice(2, 4)}).`);
  const m = memberNo.replace(/\D/g, '');
  if (m && u.slice(f.yearDigits, f.yearDigits + f.memberDigits) !== m.padStart(f.memberDigits, '0').slice(-f.memberDigits)) out.push('The membership no. inside the UDIN does not match.');
  return out;
}

/** Save a UDIN (unique across the register; the format is checked as a warning by the screen, not here). */
export function saveUdin(input: Omit<UdinRow, 'id' | 'created_at'> & { id?: string }): UdinRow {
  requireAccess('doc.create');
  const all = loadUdins();
  const udin = input.udin.trim().toUpperCase();
  if (!udin) throw new Error('Enter the UDIN.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Enter the UDIN date.');
  if (!input.client_id) throw new Error('Choose the client.');
  if (all.some((r) => r.id !== input.id && r.udin === udin)) throw new Error(`UDIN ${udin} is already in the register.`);
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const row: UdinRow = { ...input, id: prev?.id ?? generateId(), udin, description: input.description.trim(), member_no: input.member_no.trim(), created_at: prev?.created_at ?? new Date().toISOString() };
  setTable(T, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}

/** Mark a UDIN revoked on the portal (date and reason kept; it stays in the register). */
export function revokeUdin(id: string, date: string, reason: string): UdinRow {
  requireAccess('doc.create');
  const r = loadUdins().find((x) => x.id === id);
  if (!r) throw new Error('UDIN not found.');
  if (!reason.trim()) throw new Error('Enter why it was revoked.');
  return saveUdin({ ...r, revoked: { date, reason: reason.trim() } });
}

/** Delete a UDIN row (recycle bin); refused while a live invoice bills it. */
export function deleteUdin(id: string, invoices: readonly InvoiceRecord[] = []): void {
  requireAccess('doc.create');
  if (billedUdins(invoices).has(id)) throw new Error('This UDIN is billed on a live invoice. Cancel the invoice first.');
  setTable(T, loadUdins().filter((r) => r.id !== id));
}

/** Ids of UDIN rows billed by a live (not cancelled) invoice line. */
export function billedUdins(invoices: readonly Pick<InvoiceRecord, 'status' | 'items'>[]): Set<string> {
  const out = new Set<string>();
  for (const inv of invoices) {
    if (inv.status === 'Cancelled') continue;
    for (const it of inv.items ?? []) for (const ref of it.bill_refs ?? []) if (ref.startsWith('udin:')) out.add(ref.slice(5));
  }
  return out;
}

/** UDINs not yet billed (and not revoked), oldest first. */
export const unbilledUdins = (rows: readonly UdinRow[], invoices: readonly Pick<InvoiceRecord, 'status' | 'items'>[]): UdinRow[] => {
  const billed = billedUdins(invoices);
  return rows.filter((r) => !r.revoked && !billed.has(r.id)).sort((a, b) => a.date.localeCompare(b.date));
};
