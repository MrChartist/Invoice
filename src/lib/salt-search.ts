/**
 * Salt / composition search (8.84, Marg's "substitute" search for chemists). A stock item may carry a
 * `salt` ("Paracetamol 500mg"); the editor item picker and the POS search match it, so typing a salt (or
 * an item's name) lists every brand with the same composition. Pure; kept tiny (editor + POS chunks).
 */

interface SaltRow { name: string; salt?: string; aliases?: string[] }

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Item name (and aliases), lower case → salt, for items that have one. */
export function saltIndex(items: readonly SaltRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    const salt = String(it?.salt ?? '').trim();
    if (!salt) continue;
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n) && !m.has(norm(n))) m.set(norm(n), salt);
  }
  return m;
}

/** The salt of a line / catalogue name ('' when none). */
export const saltOf = (index: ReadonlyMap<string, string>, name: string): string => index.get(norm(name)) ?? '';

/**
 * Substitutes of `name`: other items with the same salt (compared case- and space-insensitively),
 * in name order. Empty when the item has no salt.
 */
export function substitutes<T extends SaltRow>(name: string, items: readonly T[]): T[] {
  const salt = norm(items.find((i) => norm(i.name) === norm(name))?.salt);
  if (!salt) return [];
  return items.filter((i) => norm(i.salt) === salt && norm(i.name) !== norm(name)).sort((a, b) => a.name.localeCompare(b.name));
}
