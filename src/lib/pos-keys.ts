/**
 * POS keyboard speed pack (8E, roadmap 8.141): the BUSY / Marg / Logic ERP / Gofrugal counter habits.
 *
 *  - Quantity prefix: "3*8901030865275", "3 * SOAP", "3 8901030865275" (a space works only before a
 *    single code / short code) or "3*" alone (the quantity waits for the next scan).
 *  - Short codes: an item's `short_code` ("SB" for soap bar) matches exactly in the POS and the editor.
 *  - Gross amount: "=500" sets the last line's AMOUNT; the rate is worked back from it
 *    (`rateFromGross`, discount % respected).
 *  - Custom function keys: a device-local keymap (`mrchartist_pos_keys`, a counter preference outside
 *    the `mrchartist_inv_` prefix: never backed up or synced, key names only) overrides POS_SHORTCUTS.
 *
 * Pure above "Storage".
 */
import { num, round2 } from './invoice-calc';
import { POS_SHORTCUTS, type PosAction } from './pos';

/* ── Counter entry ───────────────────────────────────────────── */

export type CounterEntry =
  | { kind: 'empty' }
  /** "=500": amount of the last line. */
  | { kind: 'gross'; amount: number }
  /**
   * An item to add. `qty` is set for a prefix; `loose` = the prefix was a space ("3 SB"), so it only
   * applies when `term` matches a code / short code exactly (else the whole `raw` text is a search).
   */
  | { kind: 'item'; term: string; raw: string; qty?: number; loose?: boolean };

const QTY = '(\\d{1,5}(?:\\.\\d{1,3})?)';
const STAR = new RegExp(`^${QTY}\\s*[*×]\\s*(.*)$`);
const SPACE = new RegExp(`^${QTY}\\s+(\\S+)$`);

/** Read what was typed / scanned into the POS scan box before Enter. */
export function parseCounterEntry(text: string): CounterEntry {
  const raw = String(text ?? '').trim();
  if (!raw) return { kind: 'empty' };
  const gross = raw.match(/^=\s*(\d+(?:\.\d{1,2})?)$/);
  if (gross) {
    const amount = round2(Number(gross[1]));
    return amount > 0 ? { kind: 'gross', amount } : { kind: 'empty' };
  }
  const star = raw.match(STAR);
  if (star) {
    const qty = Number(star[1]);
    if (qty > 0) return { kind: 'item', term: star[2].trim(), raw, qty };
  }
  const space = raw.match(SPACE);
  if (space) {
    const qty = Number(space[1]);
    if (qty > 0) return { kind: 'item', term: space[2], raw, qty, loose: true };
  }
  return { kind: 'item', term: raw, raw };
}

/** The text to search item names with (the quantity prefix left out). */
export function searchTermOf(text: string): string {
  const e = parseCounterEntry(text);
  if (e.kind !== 'item') return '';
  return e.loose ? e.raw : e.term;
}

/** True for text that looks like a scanned code rather than a name: one token, mostly digits, 6+ chars. */
export function looksLikeCode(text: string): boolean {
  const t = String(text ?? '').trim();
  return /^\S{6,}$/.test(t) && (t.match(/\d/g)?.length ?? 0) >= Math.ceil(t.length * 0.6);
}

export { findByShortCode } from './scan';

/**
 * Rate that makes a line's amount (quantity × rate less discount %) equal `gross`. Two decimals when
 * they reproduce the amount, else four (₹100 for 3 → 33.3333, amount 100.00). 0 for a zero quantity.
 */
export function rateFromGross(gross: number, qty: number, discountPercent = 0): number {
  const q = num(qty);
  const d = Math.min(Math.max(num(discountPercent), 0), 99.99);
  const g = round2(num(gross));
  if (!(q > 0) || !(g > 0)) return 0;
  const exact = g / (q * (1 - d / 100));
  const two = round2(exact);
  if (round2(q * two * (1 - d / 100)) === g) return two;
  return Math.round(exact * 10000) / 10000;
}

/* ── Keymap overrides ────────────────────────────────────────── */

export const POS_KEYMAP_KEY = 'mrchartist_pos_keys';
export type PosKeymap = Partial<Record<PosAction, string>>;

/**
 * Can `combo` be a counter key? Function keys (with any modifier), PageUp / PageDown / Home / End,
 * and Alt + a letter or digit. Plain letters, digits, Enter, Tab, Esc and Ctrl + letter are refused:
 * they would break typing in the scan box or fight the browser.
 */
export function isAssignableCombo(combo: string): boolean {
  const parts = String(combo ?? '').split('+');
  const key = parts.pop() ?? '';
  const mods = new Set(parts);
  if ([...mods].some((m) => !['Ctrl', 'Alt', 'Shift'].includes(m))) return false;
  // Ctrl+F4 / Alt+F4 close the tab / window; bare F11 / F12 are full screen / developer tools.
  if (/^F([1-9]|1[0-2])$/.test(key)) return !(key === 'F4' && (mods.has('Ctrl') || mods.has('Alt'))) && !(['F11', 'F12'].includes(key) && !mods.size);
  if (['PageUp', 'PageDown', 'Home', 'End'].includes(key)) return !mods.has('Ctrl');
  if (/^[A-Z0-9]$/.test(key)) return mods.has('Alt') && !mods.has('Ctrl');
  return false;
}

/** Combo for each action: the override when it is valid, else the default. */
export function effectiveKeys(map: PosKeymap = {}): Record<PosAction, string> {
  const out = {} as Record<PosAction, string>;
  for (const s of POS_SHORTCUTS) {
    const o = map[s.action];
    out[s.action] = o && isAssignableCombo(o) ? o : s.keys;
  }
  return out;
}

/** Combos used by more than one action (after overrides) → the actions sharing each. */
export function keymapConflicts(map: PosKeymap = {}): Map<string, PosAction[]> {
  const by = new Map<string, PosAction[]>();
  for (const [action, combo] of Object.entries(effectiveKeys(map)) as [PosAction, string][]) by.set(combo, [...(by.get(combo) ?? []), action]);
  for (const [k, v] of [...by]) if (v.length < 2) by.delete(k);
  return by;
}

/** A clean stored keymap: known actions, assignable combos, and only those differing from the default. */
export function cleanKeymap(raw: unknown): PosKeymap {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: PosKeymap = {};
  for (const s of POS_SHORTCUTS) {
    const v = r[s.action];
    if (typeof v === 'string' && v !== s.keys && isAssignableCombo(v)) out[s.action] = v;
  }
  return out;
}

/** Assign `combo` to `action`; the action that had it swaps to `action`'s old key (no key is ever lost). */
export function assignKey(map: PosKeymap, action: PosAction, combo: string): PosKeymap {
  if (!isAssignableCombo(combo)) return map;
  const keys = effectiveKeys(map);
  const old = keys[action];
  const next: Record<string, string> = { ...keys, [action]: combo };
  for (const [a, k] of Object.entries(keys)) if (a !== action && k === combo) next[a] = old;
  return cleanKeymap(next);
}

/* ── Storage (device-local preference) ───────────────────────── */

export function loadKeymap(): PosKeymap {
  try {
    return cleanKeymap(JSON.parse(localStorage.getItem(POS_KEYMAP_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

export function saveKeymap(map: PosKeymap): void {
  try {
    const clean = cleanKeymap(map);
    if (Object.keys(clean).length) localStorage.setItem(POS_KEYMAP_KEY, JSON.stringify(clean));
    else localStorage.removeItem(POS_KEYMAP_KEY);
  } catch {
    /* private window: not remembered */
  }
}
