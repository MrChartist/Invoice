/**
 * HSN master default rate on invoice / bill lines (WP-6 wiring), applied from OUTSIDE the line editors
 * (ItemsTable / LineItemsEditor are untouched): compare the lines before and after an edit, and when a
 * line's HSN changed while its GST rate is still the default (unset, the document default, or what the
 * previous HSN gave), take the rate in force on the document date from the HSN master
 * (`resolveGstRate`). A rate the user typed, or one a catalogue / stock item brought, always wins.
 * Pure; loaded lazily (only when the HSN master has rows). Working paper — verify rates with your CA.
 */
import { loadHsnMaster, resolveGstRate, type HsnMasterRow } from './hsn-master';

export interface HsnLine {
  id: string;
  hsn?: string;
  tax_rate?: number;
}

export interface HsnPatch {
  id: string;
  tax_rate: number;
  cess_rate?: number;
}

export function hsnDefaultPatches(
  prev: readonly HsnLine[],
  next: readonly HsnLine[],
  master: readonly HsnMasterRow[],
  date: string,
  defaultRate?: number,
): HsnPatch[] {
  if (!master.length) return [];
  const before = new Map(prev.map((l) => [l.id, l]));
  const out: HsnPatch[] = [];
  for (const line of next) {
    const old = before.get(line.id);
    const hsn = (line.hsn ?? '').trim();
    if (!hsn || (old && (old.hsn ?? '').trim() === hsn)) continue;
    const oldAuto = old?.hsn ? resolveGstRate(master, { hsn: old.hsn, date }) : undefined;
    const untouched =
      line.tax_rate === undefined ||
      line.tax_rate === defaultRate ||
      (oldAuto?.source === 'hsn' && line.tax_rate === oldAuto.rate);
    if (!untouched) continue;
    const r = resolveGstRate(master, { hsn, date });
    if (r.source !== 'hsn' || r.rate === line.tax_rate) continue;
    out.push({ id: line.id, tax_rate: r.rate, ...(r.cess_rate ? { cess_rate: r.cess_rate } : {}) });
  }
  return out;
}

/** Apply patches to a line array (only `tax_rate`, plus `cess_rate` when the line type has one). */
export function withHsnDefaults<L extends HsnLine>(lines: readonly L[], patches: readonly HsnPatch[], keepCess = true): L[] {
  if (!patches.length) return lines as L[];
  const byId = new Map(patches.map((p) => [p.id, p]));
  return lines.map((l) => {
    const p = byId.get(l.id);
    if (!p) return l;
    return { ...l, tax_rate: p.tax_rate, ...(keepCess && p.cess_rate !== undefined ? { cess_rate: p.cess_rate } : {}) };
  });
}

export { loadHsnMaster };
