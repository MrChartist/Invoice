/**
 * Per-FY auditor export of the audit trail (ROADMAP 7.49): every audit row of one Indian financial year
 * (archived segments included), with the chain head and the verification result of the WHOLE chain, as
 * CSV (formula-guarded) and JSON. Companies (Accounts) Rules, 2014, rule 3(1) proviso: the edit log must
 * be preserved and produced for audit — this is a copy for the auditor, never an edit of the log.
 *
 * Pure: the caller passes `audit.fullRows()`. Each row keeps its `prev` / `hash`, so an auditor can
 * re-check every link inside the year; `fy_first_prev` ties the year to the row before it and
 * `chain_head` is the newest hash of the whole log at export time.
 */
import type { AuditEntry } from '../types/audit';
import { describeChain, verifyAuditChain } from './audit-chain';
import { toCsv } from './csv';
import { isoDay } from './dates';
import { getIndianFY } from './invoice-number';

export interface AuditorExport {
  /** "25-26" */
  fy: string;
  /** 1 April – 31 March of the FY (local days). */
  from: string;
  to: string;
  generated_at: string;
  rows: AuditEntry[];
  chain: {
    verified: boolean;
    summary: string;
    /** Newest hash of the whole log (all years). */
    chain_head: string | null;
    /** `prev` of the FY's first row (links it to the year before) and hash of its last row. */
    fy_first_prev: string | null;
    fy_last_hash: string | null;
    total_rows: number;
  };
}

/** Indian FY label of an audit row's instant, as the local day. */
export const fyOfRow = (r: Pick<AuditEntry, 'at'>): string => getIndianFY(isoDay(r.at) || undefined).label;

/** FY labels present in the log, newest first. */
export function auditFys(rows: readonly AuditEntry[]): string[] {
  return [...new Set(rows.filter((r) => isoDay(r.at)).map(fyOfRow))].sort().reverse();
}

export function auditorExport(all: readonly AuditEntry[], fy: string, now: Date = new Date()): AuditorExport {
  const rows = all.filter((r) => isoDay(r.at) && fyOfRow(r) === fy);
  const report = verifyAuditChain([...all]);
  const start = 2000 + Number(fy.slice(0, 2));
  return {
    fy,
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    generated_at: now.toISOString(),
    rows,
    chain: {
      verified: report.ok,
      summary: describeChain(report),
      chain_head: report.head,
      fy_first_prev: rows[0]?.prev ?? null,
      fy_last_hash: rows[rows.length - 1]?.hash ?? null,
      total_rows: report.total,
    },
  };
}

const CSV_HEAD = ['At (ISO)', 'Local day', 'User', 'Entity', 'Record id', 'Action', 'Document no.', 'Summary', 'Changes', 'Prev hash', 'Hash'];

/** CSV: one row per audit row, then the chain facts. Cells are formula-guarded (`toCsv`). */
export function auditorCsv(x: AuditorExport): string {
  const body = x.rows.map((r) => [
    r.at, isoDay(r.at), r.by ?? '', r.entity, r.entity_id, r.action, r.doc_number ?? '', r.summary,
    (r.changes ?? []).map((c) => `${c.field}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' | '),
    r.prev ?? '', r.hash ?? '',
  ]);
  const foot = [
    [],
    ['Financial year', `FY ${x.fy} (${x.from} to ${x.to})`],
    ['Rows in this year', x.rows.length],
    ['Chain verified', x.chain.verified ? 'yes' : 'NO'],
    ['Verification', x.chain.summary],
    ['Chain head (whole log)', x.chain.chain_head ?? ''],
    ['First row prev (link to earlier year)', x.chain.fy_first_prev ?? ''],
    ['Last row hash (this year)', x.chain.fy_last_hash ?? ''],
    ['Generated at', x.generated_at],
    ['Note', 'Copy of the audit trail for the auditor; the log itself cannot be edited or turned off.'],
  ];
  return '﻿' + toCsv([CSV_HEAD, ...body, ...foot]);
}

export function auditorJson(x: AuditorExport, company = ''): string {
  return JSON.stringify({ format: 'mrchartist-audit-trail', version: 1, company, ...x }, null, 2);
}

export const auditorFileName = (fy: string, ext: 'csv' | 'json') => `audit-trail-FY${fy}.${ext}`;
