/**
 * Ranking for inline typeahead suggestions (client and item names in the editor).
 * Pure; reuses the command palette's fuzzy scorer so both feel the same.
 */

import { fold, fuzzyMatch } from './search';

export interface Suggestion<T> {
  row: T;
  label: string;
  sub?: string;
  score: number;
}

export interface SuggestOptions<T> {
  /** Main text shown and matched first. */
  label: (row: T) => string;
  /** Extra fields matched at a lower weight (company, GSTIN, HSN …). */
  extra?: (row: T) => (string | undefined)[];
  sub?: (row: T) => string | undefined;
  limit?: number;
}

export function suggest<T>(query: string, rows: readonly T[], opts: SuggestOptions<T>): Suggestion<T>[] {
  const q = query.trim();
  if (!q) return [];
  const out: Suggestion<T>[] = [];
  for (const row of rows) {
    const label = opts.label(row) ?? '';
    if (!label.trim()) continue;
    let score = fuzzyMatch(q, label)?.score ?? -Infinity;
    for (const f of opts.extra?.(row) ?? []) {
      if (!f) continue;
      const m = fuzzyMatch(q, f);
      if (m) score = Math.max(score, m.score * 0.6);
    }
    if (score === -Infinity) continue;
    out.push({ row, label, sub: opts.sub?.(row), score });
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, opts.limit ?? 6);
}

/** Enter may pick the top suggestion only when it starts with what was typed (never hijacks a new name). */
export function autoHighlight<T>(query: string, list: readonly Suggestion<T>[]): number {
  const q = fold(query.trim());
  return q && list[0] && fold(list[0].label).startsWith(q) ? 0 : -1;
}
