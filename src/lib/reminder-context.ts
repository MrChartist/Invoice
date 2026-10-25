/**
 * Round 2 (R2-A4 / A5): the reminder options every "who to nudge" list passes to `pendingReminders` —
 * the company schedule, each party's reminder mode, open promises-to-pay (hold) and broken promises (firm).
 * Reads storage inside the call only (safe for the Dashboard chunk). Payment grades (R2-A7) are added by the
 * screens that already load `payment-score.ts`.
 */
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { KEYS, getTable } from './storage';
import { loadReminderSchedule } from './reminder-settings';
import type { PendingOptions } from './reminders';
import { brokenPromiseParties, idByNameOf, isHeldByPromise, loadCollectionNotes, openPromises, partyKeyFor, receiptsByParty } from './collections';
import { localDayOf } from './dates';

export function reminderOptions(invoices: readonly InvoiceRecord[], today: Date = new Date()): Pick<PendingOptions, 'schedule' | 'modeOf' | 'isHeld' | 'isFirm'> {
  const clients = getTable<Client>(KEYS.clients);
  const idByName = idByNameOf(clients);
  const byId = new Map(clients.filter((c) => c.id).map((c) => [c.id as string, c]));
  const keyOf = (inv: InvoiceRecord) => partyKeyFor(inv.client, idByName);
  const out: Pick<PendingOptions, 'schedule' | 'modeOf' | 'isHeld' | 'isFirm'> = {
    schedule: loadReminderSchedule(),
    modeOf: (inv) => byId.get(keyOf(inv))?.reminder_mode,
  };
  const notes = loadCollectionNotes();
  if (notes.some((n) => n.promise)) {
    const day = localDayOf(today);
    const receipts = receiptsByParty(invoices, getTable<Payment>(KEYS.transactions), clients);
    const holds = openPromises(notes, receipts, day);
    const firm = brokenPromiseParties(notes, receipts, day);
    out.isHeld = (inv) => isHeldByPromise(holds, inv.id, keyOf(inv));
    out.isFirm = (inv) => firm.has(keyOf(inv));
  }
  return out;
}
