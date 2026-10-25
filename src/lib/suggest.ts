/**
 * Ranking for inline typeahead suggestions (client and item names in the editor).
 * Pure; reuses the command palette's fuzzy scorer so both feel the same.
 */

import { fold, fuzzyMatch } from './search';
import { contactSearchFields } from './contacts';
import type { Client } from '../types/invoice';

export interface Suggestion<T> {
  row: T;
  label: string;
  sub?: string;
  score: number;
  /** 8E: an exact short-code hit; Enter picks it even though the label does not start with the query. */
  exact?: boolean;
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
  if (list[0]?.exact) return 0;
  const q = fold(query.trim());
  return q && list[0] && fold(list[0].label).startsWith(q) ? 0 : -1;
}

/**
 * R2-B4: what the client typeahead matches besides the name — company, GSTIN, city, and every contact
 * person's name / phone / e-mail (so typing "Iyer" or "98200" finds the party).
 */
export function clientExtras(c: Pick<Client, 'company' | 'gstin' | 'city' | 'phone' | 'contacts'>): (string | undefined)[] {
  return [c.company, c.gstin, c.city, c.phone, ...contactSearchFields(c)];
}
