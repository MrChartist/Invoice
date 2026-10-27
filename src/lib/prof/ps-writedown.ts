/**
 * PS-A3 write-ups / write-downs, DERIVED (no per-entry table): for a fee note, the standard value of the time entries
 * its lines bill (`bill_refs`) against the taxable value of those lines plus its fee lines (`ps.lines[id].fee`). Each
 * entry's share of the billed amount is in proportion to its standard value, so realisation can be cut by timekeeper,
 * client, matter or work type. Only the fee note's own snapshot (`ps.wd`) is stored, so the paper stays as issued while
 * reports re-derive after an edit. A write-down is a management figure, never a journal (PS35). Pure.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { num, round2 } from '../invoice-calc';
import { entryStandard } from './ps-staff';

/** A line's taxable value (line discount applied), in the document currency — time is rated in it too (C4 converts). */
export const lineTaxable = (i: Pick<InvoiceItem, 'amount' | 'discount_percent'>): number => round2(num(i.amount) * (1 - num(i.discount_percent) / 100));

export interface EntryShare { id: string; standard: number; billed: number }
export interface DocBilling { standard: number; billed: number; entries: EntryShare[] }

/**
 * Pure: what a fee note billed for time. `entries` resolves an id to the stored entry (rows not found — mileage,
 * re-billed costs — are not time). Fee lines are spread over the entries the note bills, by standard value. `null` when
 * the note bills no time and has no fee line.
 */
export function docBilling(inv: Pick<InvoiceRecord, 'items' | 'ps'>, entries: ReadonlyMap<string, TimeEntry>, prefs: TimePrefs): DocBilling | null {
  const shares = new Map<string, EntryShare>();
  let fee = 0;
  let hasFee = false;
  for (const it of inv.items ?? []) {
    const l = inv.ps?.lines?.[it.id];
    if (l?.fee) { fee += lineTaxable(it); hasFee = true; continue; }
    const rows = (it.bill_refs ?? []).map((r) => entries.get(r)).filter((e): e is TimeEntry => !!e);
    if (!rows.length) continue;
    const std = rows.map((e) => entryStandard(e, prefs));
    const total = std.reduce((s, x) => s + x, 0);
    const billed = lineTaxable(it);
    rows.forEach((e, i) => {
      const prev = shares.get(e.id) ?? { id: e.id, standard: std[i], billed: 0 };
      prev.billed += total > 0 ? (billed * std[i]) / total : billed / rows.length;
      shares.set(e.id, prev);
    });
  }
  if (!shares.size && !hasFee) return null;
  const list = [...shares.values()];
  const stdAll = list.reduce((s, e) => s + e.standard, 0);
  if (fee) list.forEach((e) => { e.billed += stdAll > 0 ? (fee * e.standard) / stdAll : fee / list.length; });
  const total = round2(list.reduce((s, e) => s + e.billed, 0) || fee);
  for (const e of list) e.billed = round2(e.billed);
  // Rounding residue goes to the largest entry, so the shares add up to the note exactly.
  const big = list.reduce<EntryShare | undefined>((m, e) => (!m || e.standard > m.standard ? e : m), undefined);
  if (big) big.billed = round2(big.billed + total - list.reduce((s, e) => s + e.billed, 0));
  return { standard: round2(stdAll), billed: total, entries: list };
}

/** Billed − standard (positive = write-up). */
export const writeDownOf = (b: Pick<DocBilling, 'standard' | 'billed'>): number => round2(b.billed - b.standard);
