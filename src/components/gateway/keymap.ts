/** Gateway helpers for key buttons. R20-A: the key map itself is the registry (`src/lib/keys/registry.ts`). */

/** "mod+f8" → "Control+F8" for aria-keyshortcuts. */
export function ariaKeys(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'mod' || p === 'ctrl' ? 'Control' : p === 'alt' ? 'Alt' : p.length <= 3 ? p.toUpperCase() : p))
    .join('+');
}
