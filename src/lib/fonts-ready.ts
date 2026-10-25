/**
 * html-to-image paints whatever fonts are loaded at capture time. Noto Sans Devanagari downloads
 * lazily (unicode-range), so a PDF exported right after Hindi first appears could fall back to a
 * device font. Wait for both weights first so every device exports the same glyphs (5.4).
 */
const DEVANAGARI = /[ऀ-ॿ]/;

export function hasDevanagari(text: string | null | undefined): boolean {
  return !!text && DEVANAGARI.test(text);
}

export async function ensureDevanagariFont(text: string | null | undefined): Promise<void> {
  if (!hasDevanagari(text) || typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 16px "Noto Sans Devanagari"`, 'क')));
    await document.fonts.ready;
  } catch {
    /* capture anyway with whatever is available */
  }
}
