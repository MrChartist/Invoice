/**
 * Weighing-scale barcodes (8E, roadmap 8.140): the label printed by a shop's weighing scale is a
 * restricted-circulation EAN-13 (GS1 prefixes 20–29) that carries the item's PLU and the weight or
 * the price of the pack:
 *
 *     P P I I I I I V V V V V C        (default: 2-digit prefix, 5-digit PLU, 5-digit value, check)
 *
 * The layout differs per scale, so it is a device-local profile (`mrchartist_pos_scale`, a counter
 * preference outside the `mrchartist_inv_` prefix like the printer setting: never backed up or synced,
 * no customer data): which prefixes are scale labels, the PLU length (the value takes the digits left
 * before the check digit), whether the value is a weight (kg) or a price (₹), its decimal places and
 * whether the EAN check digit must be right.
 *
 * A scanned code is matched as an ordinary barcode FIRST (an in-store "2…" code assigned by
 * `nextInStoreEan` keeps working); only an unmatched code is read as a scale label. Pure above "Storage".
 */
import { ean13CheckDigit } from './barcode';
import { num, round2 } from './invoice-calc';

export type ScaleValue = 'weight' | 'price';

export interface ScaleProfile {
  enabled: boolean;
  /** Two-digit GS1 prefixes (20–29) printed by the scale. */
  prefixes: string[];
  /** Digits of the PLU (item number) after the prefix: 4–6. */
  pluLength: number;
  value: ScaleValue;
  /** Decimal places of the value: weight in kg (3 = grams), price in rupees (2 = paise). */
  decimals: number;
  /** Refuse a label whose EAN-13 check digit is wrong. */
  checkDigit: boolean;
  /**
   * PENDING 50: the digit after the PLU is a GS1 price / weight check digit over the 4- or 5-digit value
   * (`P P I I I I V W W W W W C`); a wrong one refuses the label.
   */
  priceCheck?: boolean;
  /** Live weight (Web Serial): the scale's baud rate. */
  baud: number;
  /** PENDING 50: how the live weight is read — Web Serial (default), WebHID (USB HID POS scale) or Web Bluetooth. */
  link?: 'serial' | 'hid' | 'ble';
}

export const SCALE_PROFILE_KEY = 'mrchartist_pos_scale';
export const DEFAULT_SCALE: ScaleProfile = { enabled: false, prefixes: ['21'], pluLength: 5, value: 'weight', decimals: 3, checkDigit: true, baud: 9600 };

export interface ScaleRead {
  prefix: string;
  /** PLU as printed (leading zeros kept). */
  plu: string;
  /** kg for a weight label, ₹ for a price label. */
  value: number;
  kind: ScaleValue;
}

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : d;
};

/** A tolerant copy of a stored / typed profile (bad values fall back to the defaults). */
export function cleanScaleProfile(raw: unknown): ScaleProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScaleProfile>;
  const prefixes = (Array.isArray(r.prefixes) ? r.prefixes : [])
    .map((p) => String(p ?? '').trim())
    .filter((p) => /^2\d$/.test(p));
  const value: ScaleValue = r.value === 'price' ? 'price' : 'weight';
  return {
    enabled: r.enabled === true,
    prefixes: prefixes.length ? [...new Set(prefixes)] : [...DEFAULT_SCALE.prefixes],
    pluLength: clampInt(r.pluLength, 4, 6, DEFAULT_SCALE.pluLength),
    value,
    decimals: clampInt(r.decimals, 0, 3, value === 'price' ? 2 : 3),
    checkDigit: r.checkDigit !== false,
    ...(r.priceCheck === true ? { priceCheck: true } : {}),
    ...(r.link === 'hid' || r.link === 'ble' ? { link: r.link } : {}),
    baud: [1200, 2400, 4800, 9600, 19200, 38400].includes(Number(r.baud)) ? Number(r.baud) : 9600,
  };
}

/** "21, 22 25" → ["21", "22", "25"]; anything outside 20–29 is dropped. */
export function parsePrefixList(text: string): string[] {
  return [...new Set(String(text ?? '').split(/[\s,;]+/).filter((p) => /^2\d$/.test(p)))];
}

/**
 * Read a scanned code with the profile: null when the profile is off, the code is not 13 digits,
 * the prefix is not a scale prefix, or (with `checkDigit`) the check digit is wrong.
 */
export function parseScaleBarcode(raw: string, profile: ScaleProfile): ScaleRead | null {
  if (!profile.enabled) return null;
  const code = String(raw ?? '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(code)) return null;
  const prefix = code.slice(0, 2);
  if (!profile.prefixes.includes(prefix)) return null;
  if (profile.checkDigit && ean13CheckDigit(code.slice(0, 12)) !== Number(code[12])) return null;
  const plu = code.slice(2, 2 + profile.pluLength);
  const at = 2 + profile.pluLength + (profile.priceCheck ? 1 : 0);
  const digits = code.slice(at, 12);
  if (!digits) return null;
  if (profile.priceCheck && String(priceCheckDigit(digits)) !== code[at - 1]) return null;
  const value = Number(digits) / 10 ** profile.decimals;
  if (!(value > 0)) return null;
  return { prefix, plu, value: profile.value === 'price' ? round2(value) : Math.round(value * 1000) / 1000, kind: profile.value };
}

/** Build a scale label for tests and for the settings preview ("what does my scale print?"). */
export function makeScaleBarcode(profile: Pick<ScaleProfile, 'pluLength' | 'decimals' | 'priceCheck'>, prefix: string, plu: string | number, value: number): string {
  const valueLen = 10 - profile.pluLength - (profile.priceCheck ? 1 : 0);
  const v = String(Math.round(value * 10 ** profile.decimals)).padStart(valueLen, '0').slice(-valueLen);
  const body = prefix + String(plu).padStart(profile.pluLength, '0').slice(-profile.pluLength) + (profile.priceCheck ? String(priceCheckDigit(v)) : '') + v;
  return body + ean13CheckDigit(body);
}

// GS1 General Specifications, "check digit calculation for price / weight fields": weighting factors 2-, 3, 5+, 5-.
const W2M = [0, 2, 4, 6, 8, 9, 1, 3, 5, 7];
const W3 = [0, 3, 6, 9, 2, 5, 8, 1, 4, 7];
const W5P = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
const W5M = [0, 5, 9, 4, 8, 3, 7, 2, 6, 1];

/** GS1 check digit of a 4- or 5-digit price / weight field (-1 for any other length). */
export function priceCheckDigit(value: string): number {
  const d = [...value].map(Number);
  if (d.length === 4) return ((W2M[d[0]] + W2M[d[1]] + W3[d[2]] + W5M[d[3]]) * 3) % 10;
  if (d.length !== 5) return -1;
  const sum = (W5P[d[0]] + W2M[d[1]] + W5M[d[2]] + W5P[d[3]] + W2M[d[4]]) % 10;
  return W5M.indexOf((10 - sum) % 10);
}

const pluKey = (p: unknown) => String(p ?? '').trim().replace(/^0+(?=\d)/, '');

/** The catalogue item carrying this PLU (leading zeros ignored). */
export function findByPlu<T extends { plu?: string }>(items: readonly T[], plu: string): T | undefined {
  const k = pluKey(plu);
  return k ? items.find((i) => i.plu && pluKey(i.plu) === k) : undefined;
}

export interface ScaleLine {
  quantity: number;
  rate: number;
  /** quantity × rate as the line will show it. */
  amount: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Quantity and rate for a scale label on an item sold at `rate` per kg (or per unit):
 *  - weight label: quantity = the weight, rate = the item rate;
 *  - price label: the amount must be the printed price exactly, so the quantity is derived
 *    (3 decimals, the closer of the two roundings) and, when quantity × rate still misses the price
 *    by a paisa, the rate is nudged (4 decimals) so the line amount is the label price.
 */
export function scaleLine(read: Pick<ScaleRead, 'value' | 'kind'>, itemRate: number): ScaleLine {
  const rate = round2(num(itemRate));
  if (read.kind === 'weight' || !(rate > 0)) {
    const quantity = read.kind === 'weight' ? round3(read.value) : 1;
    const r = read.kind === 'weight' ? rate : round2(read.value);
    return { quantity, rate: r, amount: round2(quantity * r) };
  }
  const price = round2(read.value);
  const exact = price / rate;
  const lo = Math.max(Math.floor(exact * 1000) / 1000, 0.001);
  const hi = Math.ceil(exact * 1000) / 1000;
  const quantity = Math.abs(round2(lo * rate) - price) <= Math.abs(round2(hi * rate) - price) ? lo : hi;
  if (round2(quantity * rate) === price) return { quantity, rate, amount: price };
  const nudged = round4(price / quantity);
  return { quantity, rate: nudged, amount: round2(quantity * nudged) };
}

/* ── Live weight over Web Serial: frame parsing (pure) ─────────────
 * RS-232 / USB-serial retail scales stream ASCII frames such as
 *   "ST,GS,+  1.234kg"   (A&D / many Chinese units: ST stable, US unstable, OL overload)
 *   "S   1.234 kg" / "U   1.230 kg"   (stability letter first)
 *   "+001.234"  "  1234 g"  "1.234KG ?"   (a "?" or "M" flags motion)
 */
export interface ScaleFrame {
  /** kg */
  weight: number;
  stable: boolean;
}

export function parseScaleFrame(text: string): ScaleFrame | null {
  const s = [...String(text ?? '')].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim();
  if (!s || /\bOL\b|overload/i.test(s)) return null;
  const m = s.match(/([-+]?)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb)?/i);
  if (!m) return null;
  let weight = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(weight)) return null;
  const unit = (m[3] ?? 'kg').toLowerCase();
  if (unit === 'g') weight /= 1000;
  else if (unit === 'lb') weight *= 0.45359237;
  if (m[1] === '-') weight = -weight;
  const head = s.slice(0, m.index);
  const tail = s.slice(m.index! + m[0].length);
  let stable: boolean;
  if (/^(US|U|M)(?![A-Z])/i.test(head)) stable = false;
  else if (/^(ST|S)(?![A-Z])/i.test(head)) stable = true;
  else stable = !/\?|(?:^|\s)M(?:\s|$)|motion/i.test(tail);
  return { weight: round3(weight), stable };
}

/** Split a serial byte stream into frames (CR / LF / ETX delimited); returns the frames and the unfinished tail. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const ETX = String.fromCharCode(3);
  const STX = String.fromCharCode(2);
  const parts = buffer.split(ETX).join('\n').split(/[\r\n]+/);
  const rest = parts.pop() ?? '';
  return { frames: parts.map((p) => (p.startsWith(STX) ? p.slice(1) : p).trim()).filter(Boolean), rest };
}

/* ── Storage (device-local preference) ───────────────────────────── */

export function loadScaleProfile(): ScaleProfile {
  try {
    return cleanScaleProfile(JSON.parse(localStorage.getItem(SCALE_PROFILE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SCALE };
  }
}

export function saveScaleProfile(p: ScaleProfile): void {
  try {
    localStorage.setItem(SCALE_PROFILE_KEY, JSON.stringify(cleanScaleProfile(p)));
  } catch {
    /* private window: not remembered */
  }
}
