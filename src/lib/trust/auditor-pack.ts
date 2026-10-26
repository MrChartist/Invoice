/**
 * R4-C5 auditor trail pack per financial year (Companies (Accounts) Rules, Rule 3(1) proviso; Rule 11(g) of the
 * Companies (Audit and Auditors) Rules: the edit-log feature existed, operated all year for every transaction, was
 * not tampered with and was preserved; Sec 128(5): kept 8 years). Roadmap 7.49.
 *
 * Pure builders: the dialog collects the inputs (full chain incl. archive segments, documents, users) and zips the
 * files with `zip.ts`. Privacy redaction is the activity log's (contact / bank values never copied; payroll rows
 * only with `payroll.view`). CSV cells pass the formula guard (`toCsv`). Working paper — verify with your CA.
 */
import type { AuditEntry } from '../../types/audit';
import { verifyAuditChain, describeChain } from '../audit-chain';
import { auditToCsv, visibleAudit } from '../audit-query';
import { toCsv } from '../csv';
import { localDayOf, parseDay } from '../dates';
import { sha256 } from '../sha256';
import { requireAccess } from '../access';
import { getTable, setTable } from '../storage';

/**
 * Year-end checklist (WP-7) step "Auditor pack generated" for the FY starting `fyStart` — the same row shape as
 * `saveYearEndMark` (table `year_end`, id `FY26-27`), written here so the dialog does not load the ledger.
 */
export function markAuditorPack(fyStart: number, at: string = new Date().toISOString()): void {
  requireAccess('books.edit');
  const id = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
  const rows = getTable<{ id: string; marks?: Record<string, string>; created_at?: string }>('year_end');
  const prev = rows.find((r) => r?.id === id);
  const next = { ...(prev ?? { id, created_at: at }), marks: { ...(prev?.marks ?? {}), auditor_pack: at }, updated_at: at };
  setTable('year_end', [...rows.filter((r) => r?.id !== id), next]);
}

/** `FY26-27` → its local-day range. */
export function fyBoundsOf(fy: string): { from: string; to: string } {
  const m = /^FY(\d{2})-(\d{2})$/.exec(fy);
  if (!m) throw new Error('Choose a financial year.');
  const y = 2000 + Number(m[1]);
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

/** Local day of an ISO timestamp. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 10) : localDayOf(d);
};

/** Rows whose `at` falls in the FY (archive segments included when the caller passed the full chain). */
export function sliceFy(rows: readonly AuditEntry[], fy: string): AuditEntry[] {
  const { from, to } = fyBoundsOf(fy);
  return rows.filter((r) => {
    const d = dayOf(r.at);
    return d >= from && d <= to;
  });
}

/** Delete rows with what was deleted (the before values). */
export function deletionsCsv(rows: readonly AuditEntry[]): string {
  const out: unknown[][] = [['When', 'By', 'Area', 'Record', 'Document', 'Summary', 'Field', 'Value before delete']];
  for (const e of rows) {
    if (e.action !== 'delete') continue;
    const base = [e.at, e.by ?? '', e.entity, e.entity_id, e.doc_number ?? ''];
    if (!e.changes?.length) out.push([...base, e.summary, '', '']);
    else e.changes.forEach((c, i) => out.push([...base, i === 0 ? e.summary : '', c.field, c.from ?? c.to ?? '']));
  }
  return toCsv(out);
}

export interface DatedDoc {
  kind: string;
  number: string;
  /** Document date (local day). */
  date: string;
  /** ISO time it was first saved. */
  created_at?: string;
  party?: string;
}

export interface BackdatedRow extends DatedDoc {
  createdDay: string;
  daysBefore: number;
}

/** Documents / vouchers created in the FY whose date is more than `days` days before the day they were created. */
export function backdatedRows(docs: readonly DatedDoc[], fy: string, days = 7): BackdatedRow[] {
  const { from, to } = fyBoundsOf(fy);
  const out: BackdatedRow[] = [];
  for (const d of docs) {
    if (!d?.created_at || !/^\d{4}-\d{2}-\d{2}$/.test(d.date ?? '')) continue;
    const createdDay = dayOf(d.created_at);
    if (createdDay < from || createdDay > to) continue;
    const gap = Math.round((parseDay(createdDay).getTime() - parseDay(d.date).getTime()) / 86400000);
    if (gap > days) out.push({ ...d, createdDay, daysBefore: gap });
  }
  return out.sort((a, b) => a.createdDay.localeCompare(b.createdDay) || a.number.localeCompare(b.number));
}

export function backdatedCsv(rows: readonly BackdatedRow[], days: number): string {
  return toCsv([
    ['Type', 'Number', 'Party', 'Document date', 'Created on', `Days before creation (over ${days})`],
    ...rows.map((r) => [r.kind, r.number, r.party ?? '', r.date, r.createdDay, r.daysBefore]),
  ]);
}

/** Period-lock overrides and maker-checker approvals / rejections. */
export const isOverrideRow = (e: AuditEntry) => e.action === 'override' || /^(Approved|Rejected)\b/.test(e.summary ?? '');

export function overridesCsv(rows: readonly AuditEntry[]): string {
  return toCsv([
    ['When', 'By', 'Kind', 'Area', 'Document', 'Summary'],
    ...rows.filter(isOverrideRow).map((e) => [e.at, e.by ?? '', e.action === 'override' ? 'Period-lock override' : 'Approval decision', e.entity, e.doc_number ?? '', e.summary]),
  ]);
}

export interface PackUser {
  name: string;
  role: string;
  createdAt?: string;
}
export const usersCsv = (users: readonly PackUser[]) => toCsv([['Name', 'Role', 'Added on'], ...users.map((u) => [u.name, u.role, u.createdAt ?? ''])]);

export interface IntegrityInput {
  fy: string;
  /** The whole chain, archive segments first (oldest → newest). */
  chain: AuditEntry[];
  segments: readonly { name: string; rows: number }[];
  company: string;
  generatedAt: string;
}

/** Hash of the newest chain row stamped on or before `day`. */
export function headAt(chain: readonly AuditEntry[], day: string): string | null {
  let head: string | null = null;
  for (const r of chain) if (r.hash && dayOf(r.at) <= day) head = r.hash;
  return head;
}

/** `integrity.txt` body and its SHA-256 (the hash is appended as the last line and shown on screen). */
export function integrityText(i: IntegrityInput): { text: string; sha256: string } {
  const report = verifyAuditChain(i.chain);
  const { from, to } = fyBoundsOf(i.fy);
  const inFy = sliceFy(i.chain, i.fy);
  const restores = inFy.filter((e) => e.action === 'restore' && e.entity === 'system');
  const lines = [
    `Edit log integrity — ${i.company || 'this company'} — ${i.fy} (${from} to ${to})`,
    `Generated: ${i.generatedAt}`,
    '',
    `Chain check: ${report.ok ? 'INTACT' : 'BROKEN'} — ${describeChain(report)}`,
    ...(report.broken ? [`Break: entry ${report.broken.index + 1} of ${report.total} (${report.broken.reason})`] : []),
    `Entries in the whole chain: ${report.total} (sealed ${report.chained}, sealed as a block ${report.legacy})`,
    `Entries dated in ${i.fy}: ${inFy.length}`,
    `Chain head at the end of ${i.fy} (${to}): ${headAt(i.chain, to) ?? '(none)'}`,
    `Current chain head: ${report.head ?? '(none)'}`,
    '',
    `Archive segments (${i.segments.length}):`,
    ...(i.segments.length ? i.segments.map((s) => `  ${s.name}: ${s.rows} entries`) : ['  (none)']),
    '',
    `Backup restores recorded in ${i.fy}: ${restores.length}`,
    ...restores.map((e) => `  ${e.at} ${e.summary}`),
    '',
    'The edit log cannot be disabled in this app: every change to documents, payments, masters and books tables is',
    'recorded with the user, the time and the field-level before / after, hash-chained so an edit or removal of an',
    'entry is detected. Contact and bank details are recorded as "changed", never copied.',
    'This file is a working paper for Rule 11(g) reporting — verify with your CA.',
  ];
  const body = lines.join('\n');
  const hash = sha256(body);
  return { text: `${body}\n\nSHA-256 of the text above: ${hash}\n`, sha256: hash };
}

export const PACK_README = (fy: string, days: number) => [
  `Auditor pack — ${fy}`,
  '',
  `audit-log-${fy}.csv     Every edit-log entry dated in the year (archive segments included): when, user, area, action,`,
  '                        document, summary and the field-level before / after.',
  `deletions-${fy}.csv     Every delete with the values the record had before it was deleted.`,
  `backdated-${fy}.csv     Documents and vouchers created in the year with a date more than ${days} days before the day they were created.`,
  `overrides-${fy}.csv     Period-lock overrides (PIN) and maker-checker approval decisions.`,
  'integrity.txt           Result of the hash-chain check over the whole log, the chain head at the year end, the current',
  '                        head, archive segments, backup restores in the year, and its own SHA-256 (last line).',
  'users.csv               Local users and their roles (no PIN data).',
  '',
  'Note the SHA-256 shown on screen when the pack was made: a later copy of integrity.txt with the same hash is unchanged.',
  'Working papers — verify with your CA.',
].join('\n');

export interface PackInput extends IntegrityInput {
  docs: readonly DatedDoc[];
  users: readonly PackUser[];
  /** Payroll rows only with `payroll.view`. */
  payroll: boolean;
  backdatedDays?: number;
}

/** Every file of the pack (name → text). */
export function buildAuditorPack(p: PackInput): { files: { name: string; text: string }[]; sha256: string; counts: { entries: number; deletions: number; backdated: number; overrides: number } } {
  const days = p.backdatedDays ?? 7;
  const fyRows = visibleAudit(sliceFy(p.chain, p.fy), p.payroll);
  const back = backdatedRows(p.docs, p.fy, days);
  const integrity = integrityText(p);
  const bom = '﻿';
  return {
    files: [
      { name: `audit-log-${p.fy}.csv`, text: bom + auditToCsv(fyRows) },
      { name: `deletions-${p.fy}.csv`, text: bom + deletionsCsv(fyRows) },
      { name: `backdated-${p.fy}.csv`, text: bom + backdatedCsv(back, days) },
      { name: `overrides-${p.fy}.csv`, text: bom + overridesCsv(fyRows) },
      { name: 'integrity.txt', text: integrity.text },
      { name: 'users.csv', text: bom + usersCsv(p.users) },
      { name: 'README.txt', text: PACK_README(p.fy, days) },
    ],
    sha256: integrity.sha256,
    counts: { entries: fyRows.length, deletions: fyRows.filter((e) => e.action === 'delete').length, backdated: back.length, overrides: fyRows.filter(isOverrideRow).length },
  };
}
