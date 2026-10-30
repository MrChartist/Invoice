/**
 * R7-B3 check-out / interim save. Every window's invoice is saved through `localDb.invoices.save` (roles, period lock,
 * numbering in the profile's Indian-FY series, audit), advances are applied with `applyAdvance` (a payment row with
 * `advance_id` — moved no cash), the balance taken with `localDb.payments.record`, the billed folio lines stamped with
 * the invoice id (never billed twice) — all in one rollback block (the R3-A `withTablesRollback` pattern): every
 * window or none. A final check-out marks the stay's windows `invoiced` and calls `markCheckedOut` (line out, room
 * dirty). An interim invoice bills the posted lines up to the business date and leaves the folio open (D7).
 * Bill to company: no payment, the invoice stays in receivables (B4).
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { Folio, Reservation } from '../../types/hotel-r7';
import { can, requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { shiftDay } from '../dates';
import { round2 } from '../invoice-calc';
import { todayIso } from '../tax-rules';
import { applyAdvance, invoiceOpen, loadAdvances, openAdvancesFor } from '../advances';
import { hotelDb, HT } from './hotel-store';
import { pendingNights } from './room-post';
import { HotelError } from './reservations';
import { markCheckedOut } from './checkin';
import { tdsFor } from './bill-to';
import { otaTags } from './ota';
import { NIGHT_KINDS, billable, buildCheckoutInvoice, fnbRate, type CheckoutDraft } from './checkout';
import { premisesNow, stayProperty } from './premises';
import { fyOfDay } from './hotel-gst';
import { catchUpLine } from './night-audit';
import { lineLeaveDay, trimLine } from './checkin';
import { isYearEnd, nextDay } from './business-date';

export const SAVE_TABLES = ['invoices', 'transactions', 'advances', 'clients', 'items_catalog', 'series_counters', HT.folios, HT.reservations, HT.rooms];

/** The invoice party of a folio: the saved client (master-only fields dropped), else the guest (B2C, home state). */
export function payerClient(f: Folio, res: Reservation | undefined, home: string, guest?: Partial<Client>): Client {
  if (f.payer.kind === 'client' && f.payer.client_id) {
    const c = localDb.clients.getById(f.payer.client_id);
    if (c) {
      const out = { ...c };
      for (const k of ['hotel', 'custom_fields', 'credit_limit', 'credit_days', 'price_level', 'contacts', 'addresses', 'doc_defaults'] as const) delete (out as Record<string, unknown>)[k];
      return out;
    }
  }
  return { name: f.payer.name, email: res?.guest.email ?? '', phone: res?.guest.phone ?? '', address: '', city: '', zip: '', company: '', gstin: '', state_code: home, ...guest };
}

/** Context and draft for one window on `day` (preview and save share it). */
export function draftFor(f: Folio, day: string, opts: { guest?: Partial<Client>; interim?: boolean } = {}): CheckoutDraft {
  const res = f.reservation_id ? hotelDb.reservation(f.reservation_id) : undefined;
  const settings = localDb.settings.get();
  // D18 / QA9 H4: one premises for the sender profile and the specified-premises test (the booking's, else its room's).
  const property = res ? stayProperty(res, res.lines.find((l) => l.id === f.line_id), hotelDb.rooms()) : undefined;
  const sender = settings.profiles.find((p) => p.id === property) ?? localDb.settings.activeProfile();
  const home = sender?.stateCode || String(sender?.companyGstin ?? '').slice(0, 2);
  const client = payerClient(f, res, home, opts.guest);
  const master = f.payer.client_id ? localDb.clients.getById(f.payer.client_id) : undefined;
  const hs = hotelDb.settings();
  const lines = billable(f, opts.interim ? day : undefined);
  const rooms = [...new Set(lines.map((l) => l.room_no).filter(Boolean) as string[])];
  const stayLines = lines.some((l) => NIGHT_KINDS.has(l.kind));
  const extra: Partial<InvoiceRecord> = {
    ...(stayLines ? otaTags(res, sender, day) : {}),
    ...(f.payer.kind === 'client' ? { ...tdsFor(master, day), due_date: shiftDay(day, master?.credit_days ?? settings.defaultDueDays) } : {}),
  };
  return buildCheckoutInvoice(f, {
    day, settings, sender, templateId: localDb.template.get(), client, hs, res, rooms, extra,
    fnb: fnbRate(day, premisesNow(fyOfDay(day), property).specified),
  }, lines);
}

/**
 * Open advances a window may take (QA9 H8): the booking's own (`advance_ids`) and advances taken for no booking, of
 * the window's payer — never another booking's, even for a guest of the same name. `own` = pre-ticked.
 */
export function advancesFor(f: Folio, res: Reservation | undefined): { id: string; number: string; open: number; own: boolean }[] {
  const party = f.payer.kind === 'client' ? { id: f.payer.client_id, name: f.payer.name } : { name: f.payer.name };
  const mine = new Set(res?.advance_ids ?? []);
  const booked = new Set(hotelDb.reservations().flatMap((r) => r.advance_ids ?? []));
  return openAdvancesFor(party, loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll())
    .filter((x) => mine.has(x.advance.id) || !booked.has(x.advance.id))
    .sort((a, b) => Number(mine.has(b.advance.id)) - Number(mine.has(a.advance.id)))
    .map((x) => ({ id: x.advance.id, number: x.advance.number, open: x.balance.open, own: mine.has(x.advance.id) }));
}

/**
 * QA9 H11: a folio line stamped with an invoice that was deleted (recycle bin) or cancelled is free again (the id is
 * kept in `was_invoice_id`) and its folio reopens; a restored invoice gets its lines back while they are still free
 * (the recycle bin refuses the restore once they were billed again). Pure.
 */
export function reconcilePure(folios: readonly Folio[], live: (id: string) => boolean, closed: (f: Folio) => boolean = () => false): Folio[] {
  const out: Folio[] = [];
  for (const f of folios) {
    let touched = false;
    const lines = f.lines.map((l) => {
      const inv = l.src?.invoice_id;
      const was = l.src?.was_invoice_id;
      if (inv && !live(inv)) {
        touched = true;
        const src = { ...l.src, was_invoice_id: inv };
        delete src.invoice_id;
        return { ...l, src };
      }
      if (!inv && was && live(was)) {
        touched = true;
        const src = { ...l.src, invoice_id: was };
        delete src.was_invoice_id;
        return { ...l, src };
      }
      return l;
    });
    if (!touched) continue;
    const ids = new Set(lines.map((l) => l.src?.invoice_id).filter(Boolean) as string[]);
    const free = lines.some((l) => !l.void && !l.src?.invoice_id);
    const status = free ? 'open' as const : f.status === 'open' && closed(f) ? 'invoiced' as const : f.status;
    out.push({ ...f, lines, status, invoice_ids: [...new Set([...(f.invoice_ids ?? []).filter((id) => live(id)), ...ids])] });
  }
  return out;
}

/** Apply `reconcilePure` to the store (skipped for a role that cannot write folios). Returns the folios changed. */
export function reconcileFolios(): Folio[] {
  if (!can('doc.create')) return [];
  const live = (id: string) => {
    const inv = localDb.invoices.getById(id);
    return !!inv && inv.status !== 'Cancelled';
  };
  // A checked-out stay's folio closes again once every line is billed (restored invoice).
  const closed = (f: Folio) => !!f.reservation_id && hotelDb.reservation(f.reservation_id)?.lines.find((l) => l.id === f.line_id)?.status === 'checked_out';
  const out = reconcilePure(hotelDb.folios(), live, closed);
  if (out.length) hotelDb.putFolios(...out);
  return out;
}

export interface WindowPlan {
  folioId: string;
  /** Guest invoice: company name / GSTIN typed at the desk (B2B). */
  guest?: Partial<Client>;
  /** Advances to apply (default: none — the dialog pre-ticks the open ones). */
  advances?: { id: string; amount: number }[];
  pay?: { method: string; amount: number; bankAccountId?: string; reference?: string };
}

/** Save an invoice and settle it (advances, then the payment). Inside the caller's rollback block. */
export function saveAndSettle(rec: InvoiceRecord, plan: Pick<WindowPlan, 'advances' | 'pay'>, today = todayIso()): InvoiceRecord {
  const saved = localDb.invoices.save({ ...rec, status: 'Sent' });
  for (const a of plan.advances ?? []) {
    const open = invoiceOpen(localDb.invoices.getById(saved.id) ?? saved);
    const amount = round2(Math.min(a.amount, open));
    if (amount > 0) applyAdvance({ advanceId: a.id, invoiceId: saved.id, amount }, { today: today > saved.issue_date ? today : saved.issue_date });
  }
  const p = plan.pay;
  if (p && p.amount > 0) localDb.payments.record({ invoiceId: saved.id, amount: round2(p.amount), method: p.method, reference: p.reference, date: saved.issue_date, bankAccountId: p.bankAccountId, note: 'Check-out' });
  return localDb.invoices.getById(saved.id) ?? saved;
}

export interface CheckoutInput {
  windows: WindowPlan[];
  /** Interim: bill the posted lines up to the business date, folio stays open. */
  interim?: boolean;
  /** Final check-out of this room line (`markCheckedOut` after billing). */
  checkout?: { resId: string; lineId: string };
  day?: string;
  at?: Date;
}

/** Bill the windows (all or none). Returns the saved invoices. */
export function saveCheckout(input: CheckoutInput): InvoiceRecord[] {
  requireAccess('doc.create');
  const day = input.day ?? hotelDb.settings().business_date;
  return withTablesRollback(SAVE_TABLES, () => {
    reconcileFolios();
    const out: InvoiceRecord[] = [];
    const windows = [...input.windows];
    const stay = stayToPost(input, day);
    if (stay) {
      // QA9 H1: every stayed night is posted before billing (a missed audit never drops a night), and an early
      // check-out ends the line on the day the guest leaves (H9); windows the catch-up opened are billed too.
      catchUpLine(stay.resId, stay.lineId, stay.end);
      const res = hotelDb.reservation(stay.resId)!;
      if (input.checkout) hotelDb.putReservations(trimLine(res, stay.lineId, stay.end));
      for (const f of hotelDb.folios()) if (f.reservation_id === stay.resId && f.line_id === stay.lineId && f.status === 'open' && !windows.some((w) => w.folioId === f.id)) windows.push({ folioId: f.id });
    }
    for (const plan of windows) {
      const f = hotelDb.folios().find((x) => x.id === plan.folioId);
      if (!f || f.status === 'invoiced') throw new HotelError('This folio is already billed.');
      const draft = draftFor(f, day, { guest: plan.guest, interim: input.interim });
      if (!draft.lineIds.length) continue;
      if (!(draft.record.total > 0)) throw new HotelError(`${f.name}: nothing to bill${f.lines.some((l) => l.kind === 'allowance' && !l.void) ? ': move the allowance to the window it discounts' : ''}.`);
      const saved = saveAndSettle(draft.record, plan, todayIso(input.at));
      const ids = new Set(draft.lineIds);
      hotelDb.putFolios({ ...f, lines: f.lines.map((l) => (ids.has(l.id) ? { ...l, src: { ...l.src, invoice_id: saved.id } } : l)), invoice_ids: [...(f.invoice_ids ?? []), saved.id] });
      out.push(saved);
    }
    if (input.checkout) {
      const { resId, lineId } = input.checkout;
      const left = hotelDb.folios().filter((f) => f.reservation_id === resId && f.line_id === lineId && f.status !== 'invoiced');
      if (left.some((f) => billable(f).length)) throw new HotelError('Bill every window before check-out.');
      if (left.length) hotelDb.putFolios(...left.map((f) => ({ ...f, status: 'invoiced' as const })));
      if (hotelDb.reservation(resId)?.lines.find((l) => l.id === lineId)?.status === 'checked_in') markCheckedOut(resId, lineId, input.at);
    }
    return out;
  });
}

/**
 * The in-house line whose stayed nights must be posted before this save, and up to which night: a final check-out
 * up to the day the guest leaves; an interim on 31 March up to and including that night (D7, QA9 H10: the March
 * nights land on a 31 March invoice in the old FY); another interim up to the business date. Null otherwise.
 */
export function stayToPost(input: Pick<CheckoutInput, 'windows' | 'interim' | 'checkout' | 'at'>, day: string): { resId: string; lineId: string; end: string } | null {
  let ref = input.checkout;
  if (!ref) {
    const f = hotelDb.folios().find((x) => x.id === input.windows[0]?.folioId);
    if (!f?.reservation_id || !f.line_id) return null;
    ref = { resId: f.reservation_id, lineId: f.line_id };
  }
  const res = hotelDb.reservation(ref.resId);
  const line = res?.lines.find((l) => l.id === ref.lineId);
  if (!res || !line || line.status !== 'checked_in') return null;
  const end = input.interim ? (isYearEnd(day) ? nextDay(day) : day) : lineLeaveDay(res, line, input.at);
  return { ...ref, end };
}

/** Nights a check-out / interim of this folio would post first (the dialog shows them with a one-tap post). */
export function nightsToPost(f: Folio, interim: boolean, day: string): string[] {
  const s = stayToPost({ windows: [{ folioId: f.id }], interim }, day);
  const res = s && hotelDb.reservation(s.resId);
  const line = res?.lines.find((l) => l.id === s!.lineId);
  return res && line ? pendingNights(res, line, hotelDb.folios(), s!.end) : [];
}

/** QA9 H10: on 31 March (before the audit rolls the date), an interim invoice for every in-house stay, dated 31 March. */
export function yearEndInterims(day: string = hotelDb.settings().business_date, at?: Date): InvoiceRecord[] {
  if (!isYearEnd(day)) throw new HotelError('Year-end interim invoices are taken on 31 March, before the night audit.');
  return withTablesRollback(SAVE_TABLES, () => {
    const out: InvoiceRecord[] = [];
    for (const r of hotelDb.reservations()) for (const l of r.lines) {
      if (l.status !== 'checked_in') continue;
      const wins = hotelDb.folios().filter((f) => f.reservation_id === r.id && f.line_id === l.id && f.status === 'open');
      if (wins.length) out.push(...saveCheckout({ windows: wins.map((f) => ({ folioId: f.id })), interim: true, day, at }));
    }
    return out;
  });
}
