/**
 * Ranking for inline typeahead suggestions (client and item names in the editor).
 * Pure; reuses the command palette's fuzzy scorer so both feel the same.
 */

import { fold, fuzzyFolded } from './search';
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
  return makeSuggester(rows, opts)(query);
}

interface Prepared<T> {
  row: T;
  label: string;
  /** Folded label and extra fields (blank extras dropped). */
  labelF: string;
  extrasF: string[];
  /** Which a–z / 0–9 occur in any of them: a query char outside it cannot match (no typo pass here). */
  lo: number;
  hi: number;
}

function addMask(text: string, m: [number, number]): void {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const b = c >= 97 && c <= 122 ? c - 97 : c >= 48 && c <= 57 ? c - 22 : -1;
    if (b < 0) continue;
    if (b < 32) m[0] |= 1 << b;
    else m[1] |= 1 << (b - 32);
  }
}

let labelCollator: Intl.Collator | null = null;
/** Same order as `a.label.localeCompare(b.label)` (default locale collator), built once. */
const byLabel = (a: string, b: string) => (labelCollator ??= new Intl.Collator()).compare(a, b);

/**
 * PERF-2: `suggest` with the rows folded once. Build it when the directory / catalogue changes
 * (`useMemo` on the rows) and call it per keystroke; results equal `suggest(query, rows, opts)`.
 */
export function makeSuggester<T>(rows: readonly T[], opts: SuggestOptions<T>): (query: string) => Suggestion<T>[] {
  let prepared: Prepared<T>[] | null = null;
  const prepare = (): Prepared<T>[] => {
    const out: Prepared<T>[] = [];
    for (const row of rows) {
      const label = opts.label(row) ?? '';
      if (!label.trim()) continue;
      const labelF = fold(label);
      const extrasF: string[] = [];
      for (const f of opts.extra?.(row) ?? []) if (f) extrasF.push(fold(f));
      const m: [number, number] = [0, 0];
      addMask(labelF, m);
      for (const f of extrasF) addMask(f, m);
      out.push({ row, label, labelF, extrasF, lo: m[0], hi: m[1] });
    }
    return out;
  };
  return (query: string) => {
    const q = query.trim();
    if (!q) return [];
    prepared ??= prepare();
    const qf = fold(q).replace(/\s+/g, '');
    const qm: [number, number] = [0, 0];
    addMask(qf, qm);
    const [qlo, qhi] = qm;
    const out: Suggestion<T>[] = [];
    for (const p of prepared) {
      if ((qlo & ~p.lo) | (qhi & ~p.hi)) continue;
      let score = fuzzyFolded(qf, p.labelF)?.score ?? -Infinity;
      for (const f of p.extrasF) {
        const m = fuzzyFolded(qf, f);
        if (m) score = Math.max(score, m.score * 0.6);
      }
      if (score === -Infinity) continue;
      out.push({ row: p.row, label: p.label, sub: opts.sub?.(p.row), score });
    }
    return out.sort((a, b) => b.score - a.score || byLabel(a.label, b.label)).slice(0, opts.limit ?? 6);
  };
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
