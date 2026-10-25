/**
 * Validation of the 8G snapshots stored on a document (`normalizeRecord`): the payment schedule
 * (8.100) and a quotation's acceptance (8.101). Kept apart from `payment-schedule.ts` (which the
 * dashboard's reminders put in the first-paint bundle) so first paint stays the same size.
 */

import type { PaymentInstalment, QuoteAcceptance } from '../types/invoice';
import { num, round2 } from './invoice-calc';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_INSTALMENTS = 24;

/** Clean a stored / typed schedule: valid days, one positive basis each, at most 24 rows, sorted by date. */
export function normalizeSchedule(raw: unknown): PaymentInstalment[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentInstalment[] = [];
  for (const r of raw.slice(0, MAX_INSTALMENTS)) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const due = typeof o.due_date === 'string' ? o.due_date.slice(0, 10) : '';
    if (!DAY.test(due)) continue;
    const pct = num(o.percent);
    const amt = num(o.amount);
    const row: PaymentInstalment = { id: typeof o.id === 'string' && o.id ? o.id : `i${out.length + 1}`, due_date: due };
    if (typeof o.label === 'string' && o.label.trim()) row.label = o.label.trim().slice(0, 60);
    if (pct > 0) row.percent = Math.min(round2(pct), 100);
    else if (amt > 0) row.amount = round2(amt);
    else continue;
    out.push(row);
  }
  return out.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
}

/** PNG / JPEG data URLs only, capped (~350 kB) so a scribble can never bloat the table. */
export const SIG = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
export const MAX_SIGNATURE_CHARS = 350_000;

export function sanitizeAcceptance(raw: unknown): QuoteAcceptance | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const signer = typeof o.signer === 'string' ? o.signer.trim().slice(0, 80) : '';
  const at = typeof o.signed_at === 'string' ? o.signed_at : '';
  if (!signer || !at || Number.isNaN(Date.parse(at))) return null;
  const out: QuoteAcceptance = {
    signer,
    signed_at: at,
    method: o.method === 'remote' ? 'remote' : 'counter',
    amount: Number.isFinite(Number(o.amount)) ? Number(o.amount) : 0,
  };
  if (typeof o.signature === 'string' && o.signature.length <= MAX_SIGNATURE_CHARS && SIG.test(o.signature)) out.signature = o.signature;
  if (typeof o.note === 'string' && o.note.trim()) out.note = o.note.trim().slice(0, 200);
  return out;
}

