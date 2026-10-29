/**
 * RT-D1 IMEI-first counter.
 *  - `luhnOk` / `imeiIssue`: the IMEI check digit (Luhn) on 15-digit serials of items marked `serial_kind: 'imei'` —
 *    a warning on purchase entry, never a block (MEIDs and odd stickers exist).
 *  - Dual IMEI: a bill line pairs serials (`serial_pairs`, IMEI 1 → IMEI 2, typed "IMEI1 / IMEI2"). The stock engine
 *    tracks IMEI 1 only; the pair is a lookup (scanning IMEI 2 finds IMEI 1) and both print on the sale line.
 *  - `serialIndex` / `serialHit`: an in-stock serial → its item and godown, built once from the tracking map; the POS /
 *    editor register it as `scan.ts`'s last fallback (`serialScan.find`), so it costs nothing without serial items.
 *  - Blocked-IMEI check log (`imei_checks`): the user checks on the government portal and logs the result; resale of a
 *    used device with no "clear" check in the last 30 days warns (Telecom Cyber Security Amendment Rules 2025, RT15).
 * Working paper — verify with your CA.
 */
import './rt-registry';
import type { InvoiceItem } from '../../types/invoice';
import type { ImeiCheck } from '../../types/retail-r9';
import type { StockItem } from '../inventory';
import type { TrackingMap } from '../stock-tracking';
import { serialKey } from '../stock-tracking';
import { IMEI_CHECK_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { shiftDay } from '../dates';
import { num } from '../invoice-calc';
import { RT_TABLES } from './rt-shared';

export const IMEI_TABLE = RT_TABLES.imeiChecks;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Pure ── */

/** Luhn check over a digit string (the IMEI's 15th digit is the check digit). */
export function luhnOk(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** An IMEI item: marked `serial_kind: 'imei'`, or unmarked in HSN 8517 (phones) — the electronics default. */
export const isImeiItem = (item: Pick<StockItem, 'serial_kind' | 'hsn'> | undefined): boolean => (item?.serial_kind ?? (String(item?.hsn ?? '').startsWith('8517') ? 'imei' : '')) === 'imei';

/** 15-digit serials of an IMEI item whose check digit fails (warnings only). */
export function imeiIssues(item: Pick<StockItem, 'serial_kind' | 'hsn'> | undefined, serials: readonly string[] = []): string[] {
  if (!isImeiItem(item)) return [];
  return serials.map((s) => s.trim()).filter((s) => /^\d{15}$/.test(s) && !luhnOk(s));
}

/** "IMEI1 / IMEI2" rows → serials (IMEI 1) and pairs. Only two 14–16 digit numbers split, so other serials keep their "/". */
export function splitPairs(rows: readonly string[]): { serials: string[]; pairs: Record<string, string> } {
  const pairs: Record<string, string> = {};
  const serials = rows.map((r) => {
    const m = /^(\d{14,16})\s*\/\s*(\d{14,16})$/.exec(r.trim());
    if (!m) return r.trim();
    pairs[m[1]] = m[2];
    return m[1];
  });
  return { serials, pairs };
}

/** The other direction: serials back to "IMEI1 / IMEI2" rows (for the bill line's text box). */
export const joinPairs = (serials: readonly string[], pairs?: Record<string, string>): string[] => serials.map((s) => (pairs?.[s] ? `${s} / ${pairs[s]}` : s));

/** Every IMEI 2 → IMEI 1 known from purchase lines (`serial_pairs`). */
export function pairIndex(purchases: readonly { lines?: readonly { serial_pairs?: Record<string, string> }[] }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of purchases) for (const l of p?.lines ?? []) for (const [a, b] of Object.entries(l?.serial_pairs ?? {})) out.set(serialKey(b), a);
  return out;
}

/** The IMEI 2 of each serial (IMEI 1 → IMEI 2), from purchase lines. */
export function pairsOf(purchases: readonly { lines?: readonly { serial_pairs?: Record<string, string> }[] }[], serials: readonly string[]): Record<string, string> | undefined {
  const want = new Set(serials.map(serialKey));
  const out: Record<string, string> = {};
  for (const p of purchases) for (const l of p?.lines ?? []) for (const [a, b] of Object.entries(l?.serial_pairs ?? {})) if (want.has(serialKey(a))) out[a] = b;
  return Object.keys(out).length ? out : undefined;
}

export interface SerialHit {
  item: StockItem;
  serial: string;
  godown: string;
  /** IMEI 2 of a dual-IMEI device. */
  pair?: string;
}

/** In-stock serials → item + godown (IMEI 2 keys point at their IMEI 1). Built once per counter session. */
export function serialIndex(tracking: TrackingMap, pairs: ReadonlyMap<string, string> = new Map()): Map<string, SerialHit> {
  const out = new Map<string, SerialHit>();
  for (const t of tracking.values()) {
    if (!t.item.track_serials) continue;
    for (const s of t.serials) if (s.inStock) out.set(serialKey(s.serial), { item: t.item, serial: s.serial, godown: s.godown });
  }
  for (const [two, one] of pairs) {
    const hit = out.get(serialKey(one));
    if (!hit) continue;
    hit.pair = two;
    if (!out.has(two)) out.set(two, hit);
  }
  return out;
}

/** A scanned code → the sale line source (item with that serial picked, from its godown), or null. */
export function serialHit(index: ReadonlyMap<string, SerialHit>, code: string, catalog: readonly InvoiceItem[] = []): InvoiceItem | null {
  const hit = index.get(serialKey(code));
  if (!hit) return null;
  const s = hit.item;
  const cat = catalog.find((c) => c.name.trim().toLowerCase() === s.name.trim().toLowerCase());
  return {
    ...(cat ?? { id: s.id, name: s.name, type: 'Product', hsn: s.hsn ?? '', unit: s.unit || 'NOS', rate: num(s.sale_rate), ...(typeof s.tax_rate === 'number' ? { tax_rate: s.tax_rate } : {}), amount: 0 }),
    quantity: 1,
    serials: [hit.serial],
    ...(hit.pair ? { serial_pairs: { [hit.serial]: hit.pair } } : {}),
    ...(hit.godown && hit.godown !== 'main' ? { godown_id: hit.godown } : {}),
    ...(num(s.warranty_months) > 0 ? { warranty_months: num(s.warranty_months) } : {}),
  };
}

/** Days a "clear" check stays good for a resale (RT15, dated rule). */
export const resaleCheckDays = (date?: string): number => ruleAt(IMEI_CHECK_RULES, date).resaleCheckDays;

/** The latest check of an IMEI (either IMEI of a pair). */
export function lastCheck(checks: readonly ImeiCheck[], imei: string, pair?: string): ImeiCheck | undefined {
  const keys = new Set([serialKey(imei), ...(pair ? [serialKey(pair)] : [])]);
  return [...checks].filter((c) => keys.has(serialKey(c.imei))).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))[0];
}

/** Warning for reselling a used device: no clear check within the window, or the last check said blocked. */
export function resaleCheckIssue(checks: readonly ImeiCheck[], imei: string, day: string, pair?: string): string {
  const c = lastCheck(checks, imei, pair);
  if (c?.result === 'blocked') return `IMEI ${imei} was logged as BLOCKED on ${c.date}: do not resell it. Verify with your CA.`;
  const days = resaleCheckDays(day);
  if (!c || c.date < shiftDay(day, -days)) return `IMEI ${imei}: no "clear" blocked-IMEI check in the last ${days} days, check it on the government portal and log it (Telecom Cyber Security Amendment Rules 2025, verify with your CA).`;
  return '';
}

/* ── Storage ── */

export const loadImeiChecks = (): ImeiCheck[] => getTable<ImeiCheck>(IMEI_TABLE).filter((r) => r && typeof r.id === 'string');

/** Log a check done on the government portal (`doc.create`). */
export function logImeiCheck(input: { date: string; imei: string; result: 'clear' | 'blocked'; portal_ref?: string; attachment?: string; by?: string; note?: string }): ImeiCheck {
  requireAccess('doc.create');
  const imei = input.imei.replace(/\s+/g, '');
  if (!DAY.test(input.date)) throw new Error('Choose the date of the check.');
  if (!imei) throw new Error('Type the IMEI you checked.');
  if (input.result !== 'clear' && input.result !== 'blocked') throw new Error('Pick the result.');
  const row: ImeiCheck = {
    id: generateId(), date: input.date, imei, result: input.result, created_at: new Date().toISOString(),
    ...(input.portal_ref?.trim() ? { portal_ref: input.portal_ref.trim() } : {}),
    ...(input.attachment ? { attachment: input.attachment } : {}),
    ...(input.by?.trim() ? { by: input.by.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  setTable(IMEI_TABLE, [...loadImeiChecks(), row]);
  return row;
}

/** Delete a logged check (to the recycle bin through the watched table). */
export function deleteImeiCheck(id: string): void {
  requireAccess('doc.create');
  setTable(IMEI_TABLE, loadImeiChecks().filter((c) => c.id !== id));
}
