/**
 * Customer-facing display (8E, roadmap 8.143): a second window (`/pos-display`, opened with
 * `window.open` on the counter, dragged to a second monitor or a pole display) that shows the bill's
 * lines, the total and the UPI QR, updated live over a same-origin BroadcastChannel
 * (`openBroadcast` in cross-tab.ts). No network, nothing stored: the display only paints the last
 * message; reloading it asks the counter to send the bill again (`hello`).
 *
 * Pure: message builders and a validating reader (the display trusts nothing it receives).
 */
import type { InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';

export const DISPLAY_CHANNEL = 'mrchartist-pos-display';
export const DISPLAY_PATH = '/pos-display';
/** The display shows the newest lines when a bill is longer than this. */
export const DISPLAY_MAX_LINES = 40;

export interface DisplayLine {
  name: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

export type DisplayMessage =
  | { v: 1; type: 'bill'; business: string; lines: DisplayLine[]; more: number; count: number; total: number; saved: number; upi?: { link: string; amount: number } }
  | { v: 1; type: 'thanks'; business: string; total: number; change: number }
  | { v: 1; type: 'idle'; business: string }
  | { v: 1; type: 'hello' };

const text = (s: unknown, max = 80) => [...String(s ?? '')].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('').trim().slice(0, max);
const money = (n: unknown) => round2(Math.max(num(n), 0));

type BillLike = Pick<InvoiceRecord, 'items' | 'total'> & { discount_amount?: number; sender?: { companyName?: string } | null };

/** The bill on the counter as a display message (`upi.link` is the validated UPI link, when a UPI tender is open). */
export function billMessage(rec: BillLike, upi?: { link: string | null; amount: number }): DisplayMessage {
  const all = (rec.items ?? []).filter((i) => i.name?.trim() && num(i.quantity) > 0);
  const lines = all.slice(-DISPLAY_MAX_LINES).map((i) => ({
    name: text(i.name),
    qty: num(i.quantity),
    unit: text(i.unit, 8),
    rate: money(i.rate),
    amount: round2(num(i.quantity) * num(i.rate) * (1 - num(i.discount_percent) / 100)),
  }));
  return {
    v: 1,
    type: 'bill',
    business: text(rec.sender?.companyName),
    lines,
    more: all.length - lines.length,
    count: all.length,
    total: money(rec.total),
    saved: money(rec.discount_amount),
    ...(upi?.link && upi.amount > 0 ? { upi: { link: upi.link, amount: money(upi.amount) } } : {}),
  };
}

export const thanksMessage = (business: string, total: number, change: number): DisplayMessage => ({ v: 1, type: 'thanks', business: text(business), total: money(total), change: money(change) });
export const idleMessage = (business: string): DisplayMessage => ({ v: 1, type: 'idle', business: text(business) });

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate a received message (anything malformed → null). UPI links must be `upi://pay?…`. */
export function readDisplayMessage(raw: unknown): DisplayMessage | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  if (raw.type === 'hello') return { v: 1, type: 'hello' };
  const business = text(raw.business);
  if (raw.type === 'idle') return { v: 1, type: 'idle', business };
  if (raw.type === 'thanks') return { v: 1, type: 'thanks', business, total: money(raw.total), change: money(raw.change) };
  if (raw.type !== 'bill' || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines.filter(isObj).slice(-DISPLAY_MAX_LINES).map((l) => ({ name: text(l.name), qty: num(l.qty), unit: text(l.unit, 8), rate: money(l.rate), amount: round2(num(l.amount)) }));
  const upi = isObj(raw.upi) && typeof raw.upi.link === 'string' && /^upi:\/\/pay\?/.test(raw.upi.link) && raw.upi.link.length < 600 ? { link: raw.upi.link, amount: money(raw.upi.amount) } : undefined;
  return {
    v: 1, type: 'bill', business, lines,
    more: Math.max(Math.round(num(raw.more)), 0),
    count: Math.max(Math.round(num(raw.count)), 0),
    total: money(raw.total),
    saved: money(raw.saved),
    ...(upi ? { upi } : {}),
  };
}
