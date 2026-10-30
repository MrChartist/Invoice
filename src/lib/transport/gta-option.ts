/**
 * R5-B1: the GTA tax option per financial year (Distribution → Transport → Settings) and the "person liable to pay
 * GST" rule for a consignment note.
 *
 *  - One row per FY in `gta_options`: `rcm` (the notified recipient pays 5% under reverse charge), `fcm_5` (the GTA
 *    pays 5%, no ITC) or `fcm_18` (the GTA pays 18% with ITC; 12% before 22 Sep 2025). No row = `rcm` (the default
 *    position). Rates and the notified recipient list are date-keyed in `transport-works-rules.ts`.
 *  - Liable person: option `rcm` and a recipient in the notified list → the recipient (reverse charge); otherwise the
 *    GTA. The LR form may override it with a reason (logged on the LR and in the audit trail).
 * Working paper — verify with your CA.
 */
import type { GstLiable, GtaOption, GtaOptionRow } from '../../types/transport-works-r5';
import { getIndianFY } from '../invoice-number';
import { ruleAt } from '../tax-rules';
import { GTA_RCM_RECIPIENT_KINDS, gtaRate, type GtaRecipientKind } from '../transport-works-rules';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';

export const GTA_OPTIONS_TABLE = 'gta_options';
export const GTA_OPTIONS: readonly GtaOption[] = ['rcm', 'fcm_5', 'fcm_18'];

export const fyOf = (day: string): string => getIndianFY(day).label;

/** The FY label after `fy` ("26-27" → "27-28"). */
export function nextFy(fy: string): string {
  const a = Number(fy.slice(0, 2)) + 1;
  const p = (n: number) => String(n % 100).padStart(2, '0');
  return `${p(a)}-${p(a + 1)}`;
}

export function loadGtaOptions(): readonly GtaOptionRow[] {
  return peekTable<GtaOptionRow>(GTA_OPTIONS_TABLE).filter((r) => r && typeof r.fy === 'string');
}

/** The option in force for the FY of `day` (no row = reverse charge). */
export function optionFor(day: string, rows: readonly GtaOptionRow[] = loadGtaOptions()): GtaOption {
  const fy = fyOf(day);
  return rows.find((r) => r.fy === fy)?.option ?? 'rcm';
}

/** Save (insert or replace by FY) the option of a financial year. */
export function saveGtaOption(input: Omit<GtaOptionRow, 'id'> & { id?: string }): GtaOptionRow {
  requireAccess('settings.manage');
  if (!/^\d{2}-\d{2}$/.test(input.fy)) throw new Error('Choose the financial year.');
  if (!GTA_OPTIONS.includes(input.option)) throw new Error('Choose the option.');
  const all = getTable<GtaOptionRow>(GTA_OPTIONS_TABLE);
  const prev = all.find((r) => r.fy === input.fy);
  const row: GtaOptionRow = {
    id: prev?.id ?? input.id ?? generateId(),
    fy: input.fy,
    option: input.option,
    ...(input.filed_on ? { filed_on: input.filed_on } : {}),
    ...(input.arn?.trim() ? { arn: input.arn.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  setTable(GTA_OPTIONS_TABLE, prev ? all.map((r) => (r.id === prev.id ? row : r)) : [...all, row]);
  return row;
}

/** Recipient kind from the party: a GSTIN = a registered person; else as typed (default unregistered). */
export function recipientKind(party: { gstin?: string } | undefined, typed?: GtaRecipientKind): GtaRecipientKind {
  if (typed) return typed;
  return party?.gstin?.trim() ? 'registered' : 'unregistered';
}

/** Pure: who pays the GST on the freight. */
export function liablePerson(option: GtaOption, kind: GtaRecipientKind, day: string): GstLiable {
  if (option !== 'rcm') return 'gta';
  return ruleAt(GTA_RCM_RECIPIENT_KINDS, day).includes(kind) ? 'recipient' : 'gta';
}

/** The printed option line ("GTA option FY 26-27: reverse charge — 5% payable by the recipient"). */
export function optionLine(option: GtaOption, day: string): string {
  const r = gtaRate(option, day);
  const what = r.rcm ? `reverse charge: ${r.rate}% payable by the recipient` : `forward charge: ${r.rate}% ${r.itc ? 'with' : 'without'} ITC, paid by the GTA`;
  return `GTA option FY ${fyOf(day)}: ${what}`;
}
