/**
 * Column mapping for marketplace report files (R5-A3 / A4 / A6). Marketplaces rename columns often, so a preset is
 * only a SYNONYM table per field, scored with the importer's `scoreHeader`; the user confirms or fixes the guess and
 * the result is saved on the channel by header text (`SavedMapping`).
 *
 * Imported files are untrusted: rows are read by column index only and field names are our own constants, so no
 * header or cell text ever becomes an object key (no prototype pollution). Pure — no storage, no DOM.
 */
import { scoreHeader } from '../import-mapping';
import { parseDate, parseNumber } from '../importers';
import type { SavedMapping } from '../../types/marketplace-r5';

export type SynonymTable = Readonly<Record<string, readonly string[]>>;

/** field → column index (absent = not in the file). Built only from the preset's own field names. */
export type ColumnMap = Map<string, number>;

export interface FileTable {
  headers: string[];
  rows: string[][];
}

const MIN_SCORE = 0.55;

/**
 * Best column per field: a saved mapping (by exact header text) wins, then the highest `scoreHeader` ≥ 0.55; each
 * column is used once, the strongest pairs first.
 */
export function guessColumns(headers: readonly string[], table: SynonymTable, saved?: SavedMapping): ColumnMap {
  const out: ColumnMap = new Map();
  const used = new Set<number>();
  const norm = (h: string) => h.trim().toLowerCase();
  for (const { field, header } of saved?.columns ?? []) {
    if (!Object.hasOwn(table, field)) continue;
    const idx = headers.findIndex((h) => norm(h) === norm(header));
    if (idx >= 0 && !used.has(idx)) {
      out.set(field, idx);
      used.add(idx);
    }
  }
  const pairs: { field: string; idx: number; score: number }[] = [];
  for (const field of Object.keys(table)) {
    if (out.has(field)) continue;
    headers.forEach((h, idx) => {
      const score = scoreHeader(h, [...table[field]]);
      if (score >= MIN_SCORE) pairs.push({ field, idx, score });
    });
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const p of pairs) {
    if (out.has(p.field) || used.has(p.idx)) continue;
    out.set(p.field, p.idx);
    used.add(p.idx);
  }
  return out;
}

/** The mapping to save on the channel (field → header text). */
export function toSavedMapping(preset: string, headers: readonly string[], cols: ColumnMap): SavedMapping {
  return { preset, columns: [...cols].filter(([, i]) => headers[i] !== undefined).map(([field, i]) => ({ field, header: headers[i] })) };
}

export const cellOf = (row: readonly string[], cols: ColumnMap, field: string): string => {
  const i = cols.get(field);
  return i === undefined ? '' : String(row[i] ?? '').trim();
};

/** A money / number cell, or null when empty or unreadable. */
export const numOf = (row: readonly string[], cols: ColumnMap, field: string): number | null => {
  const p = parseNumber(cellOf(row, cols, field));
  return p.ok ? p.value : null;
};

export const dayOf = (row: readonly string[], cols: ColumnMap, field: string): string => parseDate(cellOf(row, cols, field)) ?? '';

/** Required fields missing from a mapping. */
export const missingFields = (cols: ColumnMap, required: readonly string[]): string[] => required.filter((f) => !cols.has(f));
