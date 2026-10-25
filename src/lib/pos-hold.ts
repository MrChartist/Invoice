/**
 * POS "Hold & new bill" (roadmap 8.21): park up to {@link MAX_HELD} carts and recall them later, the
 * counter workflow of Vyapar / myBillBook when a customer steps away to fetch one more item.
 *
 * Storage: `mrchartist_inv_pos_held` in the open company's data store (`DEVICE_DRAFT_KEYS`), so a
 * reload keeps the carts, vault mode seals them like any other value, and they are never in a backup,
 * never synced and never announced to other tabs; a restore or erase removes them. A held cart is not
 * a document: no number is taken, no stock moves, nothing is audited until it is recalled and saved.
 *
 * Pure above "Storage".
 */

import type { Client, InvoiceItem } from '../types/invoice';
import { DB_PREFIX, readRaw, removeRaw, writeRaw } from './storage';

export const POS_HELD_KEY = `${DB_PREFIX}pos_held`;
export const MAX_HELD = 9;

export type HeldTender = { Cash: number; UPI: number; Card: number };

export interface HeldCart {
  id: string;
  /** ISO time the cart was parked. */
  held_at: string;
  items: InvoiceItem[];
  /** Saved customer (snapshot; the live row is used on recall when it still exists). */
  client?: Client | null;
  /** Walk-in name / phone typed at the counter. */
  name?: string;
  phone?: string;
  dispatch?: boolean;
  tender?: HeldTender;
  upi_ref?: string;
  /** Bill total when parked (shown in the recall list). */
  total: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Tolerant reader: drops anything that is not a cart with lines, keeps the newest {@link MAX_HELD}. */
export function parseHeld(raw: string | null | undefined): HeldCart[] {
  if (!raw) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const out: HeldCart[] = [];
  for (const r of rows) {
    if (!isObj(r) || typeof r.id !== 'string' || !Array.isArray(r.items) || !r.items.length) continue;
    const items = r.items.filter((i): i is InvoiceItem => isObj(i) && typeof i.id === 'string' && typeof i.name === 'string');
    if (!items.length) continue;
    const t = isObj(r.tender) ? r.tender : null;
    out.push({
      id: r.id,
      held_at: typeof r.held_at === 'string' ? r.held_at : new Date(0).toISOString(),
      items,
      ...(isObj(r.client) && typeof r.client.name === 'string' ? { client: r.client as unknown as Client } : {}),
      ...(typeof r.name === 'string' && r.name ? { name: r.name } : {}),
      ...(typeof r.phone === 'string' && r.phone ? { phone: r.phone } : {}),
      ...(r.dispatch === true ? { dispatch: true } : {}),
      ...(t ? { tender: { Cash: n(t.Cash), UPI: n(t.UPI), Card: n(t.Card) } } : {}),
      ...(typeof r.upi_ref === 'string' && r.upi_ref ? { upi_ref: r.upi_ref } : {}),
      total: n(r.total),
    });
  }
  return out.slice(-MAX_HELD);
}

export type HoldResult = { ok: true; list: HeldCart[] } | { ok: false; reason: 'empty' | 'full' };

/** Park `cart` at the end of `list` (oldest first). Refuses an empty cart and a tenth one. */
export function holdCart(list: readonly HeldCart[], cart: HeldCart): HoldResult {
  if (!cart.items.length) return { ok: false, reason: 'empty' };
  const rest = list.filter((c) => c.id !== cart.id);
  if (rest.length >= MAX_HELD) return { ok: false, reason: 'full' };
  return { ok: true, list: [...rest, cart] };
}

/** Take a held cart out of the list (null when it is gone, e.g. recalled in another tab). */
export function recallCart(list: readonly HeldCart[], id: string): { cart: HeldCart | null; list: HeldCart[] } {
  const cart = list.find((c) => c.id === id) ?? null;
  return { cart, list: list.filter((c) => c.id !== id) };
}

/** Lines the customer picked (free scheme lines left out), for the recall list. */
export const heldLineCount = (c: HeldCart): number => c.items.filter((i) => !i.free_of).length;

/* ── Storage ──────────────────────────────────────────────────── */

export function loadHeld(): HeldCart[] {
  return parseHeld(readRaw(POS_HELD_KEY));
}

/** Throws StorageWriteError when the store refuses (quota / vault conflict); the caller keeps the cart. */
export function saveHeld(list: readonly HeldCart[]): void {
  if (!list.length) removeRaw(POS_HELD_KEY);
  else writeRaw(POS_HELD_KEY, JSON.stringify(list.slice(-MAX_HELD)));
}
