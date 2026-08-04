/**
 * GSTIN + PAN validation (offline, no API calls).
 *
 * A GSTIN is 15 characters: <2 state code><10 PAN><1 entity no><1 'Z'><1 checksum>
 * The 15th character is a mod-36 checksum over the first 14 — validating it
 * catches the typos a regex alone lets through.
 */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export type GstinProblem = 'EMPTY' | 'LENGTH' | 'SHAPE' | 'CHECKSUM';

export interface GstinCheck {
  valid: boolean;
  problem?: GstinProblem;
  message?: string;
  /** Two-digit state code, present once the shape is valid. */
  stateCode?: string;
  /** Embedded PAN, present once the shape is valid. */
  pan?: string;
}

/** Compute the 15th (checksum) character for the first 14 characters of a GSTIN. */
export function gstinChecksumChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    if (value < 0) return '';
    // Weights alternate 1, 2, 1, 2 … starting at 1 for the first character.
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function checkGstin(raw?: string): GstinCheck {
  const gstin = (raw ?? '').trim().toUpperCase();
  if (!gstin) return { valid: false, problem: 'EMPTY', message: 'GSTIN is empty' };
  if (gstin.length !== 15) {
    return { valid: false, problem: 'LENGTH', message: 'GSTIN must be exactly 15 characters' };
  }
  if (!GSTIN_SHAPE.test(gstin)) {
    return { valid: false, problem: 'SHAPE', message: 'GSTIN format looks wrong (expected 22AAAAA0000A1Z5)' };
  }
  if (gstinChecksumChar(gstin.slice(0, 14)) !== gstin[14]) {
    return { valid: false, problem: 'CHECKSUM', message: 'GSTIN checksum digit does not match' };
  }
  return { valid: true, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) };
}

export function isValidGstin(raw?: string): boolean {
  return checkGstin(raw).valid;
}

export function isValidPan(raw?: string): boolean {
  return PAN_SHAPE.test((raw ?? '').trim().toUpperCase());
}

/** Pull the PAN out of a GSTIN so a profile only has to enter one of the two. */
export function panFromGstin(raw?: string): string {
  const check = checkGstin(raw);
  return check.pan ?? '';
}
