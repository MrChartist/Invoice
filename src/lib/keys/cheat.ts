/**
 * R20-A4: the cheat sheet's pure helpers — search (English, Hindi, Tally names, key text such as "f5" or "ctrl+f8")
 * and the "This screen" filter. Tested in tests/keys-registry.test.ts.
 */
import { keysT } from '../../i18n/areas/keys-r20a';
import { KEY_ROWS, isBuilt, normCombo, scopesOfPath, type KeyRow, type KeyScope } from './registry';

/** Does the row match the search text? Words match labels in both languages; a key matches the combo or its key. */
export function rowMatches(row: KeyRow, query: string): boolean {
  const s = query.trim().toLowerCase();
  if (!s) return true;
  const text = [row.plain, row.tally].flatMap((k) => (k ? [keysT.en[k], keysT.hi[k], keysT(k)] : [])).join(' ').toLowerCase();
  if (text.includes(s)) return true;
  const q = normCombo(s.replace(/\s*\+\s*/g, '+').replace(/ctrl|cmd|⌘/g, 'mod').replace(/⌥|option/g, 'alt'));
  return [row.combo.prime, row.combo.erp9].some((c) => !!c && (normCombo(c) === q || normCombo(c).split('+').pop() === q));
}

/** Built rows of this screen (its scopes + the given registered ones + global), or every built row. */
export function sheetRows(path: string | null, registered: readonly KeyScope[] = []): KeyRow[] {
  const scopes = path === null ? null : new Set<KeyScope>(['global', ...scopesOfPath(path), ...registered]);
  return KEY_ROWS.filter((r) => isBuilt(r) && (!scopes || scopes.has(r.scope)));
}
