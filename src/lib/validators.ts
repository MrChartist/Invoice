/** Small offline format checks for payment identifiers. */

/** UPI VPA: handle@bank, e.g. name.surname@okicici. */
export function isValidUpi(value?: string): boolean {
  return /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test((value ?? '').trim());
}

/** IFSC: four letters, a zero, then six alphanumerics. */
export function isValidIfsc(value?: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((value ?? '').trim().toUpperCase());
}

/** PAN: five letters, four digits, one letter. */
export function isValidPan(value?: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((value ?? '').trim().toUpperCase());
}
