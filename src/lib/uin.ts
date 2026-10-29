/**
 * 8.66: shape of a UIN (Unique Identity Number of a UN body / embassy, Rule 17) as seen on certificates, e.g.
 * 0717UNO00157UNO. A shape check only — not verified against the portal; a valid GSTIN never matches it.
 * Its own module so the first-paint `gstin.ts` does not grow.
 */
export const isUinShaped = (raw?: string): boolean => /^[0-9]{4}[A-Z]{3}[0-9]{5}[A-Z0-9]{3}$/.test((raw ?? '').trim().toUpperCase());
