/**
 * R16-A3: the ONE HTML escape for print windows and saved HTML documents (user text — names, addresses, notes — is
 * written into markup there). Escapes all five of `& < > " '`, so a value is safe in element text and in quoted
 * attributes either way; `null` / `undefined` print as ''. A lazy module: never import it from a first-paint module
 * (scripts/check-bundle-size.mjs fails the build if it reaches the initial chunk).
 */
const MAP: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escHtml = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
