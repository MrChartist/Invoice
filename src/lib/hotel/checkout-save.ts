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
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { shiftDay } from '../dates';
import { round2 } from '../invoice-calc';
import { todayIso } from '../tax-rules';
import { applyAdvance, invoiceOpen, loadAdvances, openAdvancesFor } from '../advances';
import { hotelDb, HT } from './hotel-store';
import { HotelError } from './reservations';
import { markCheckedOut } from './checkin';
import { tdsFor } from './bill-to';
import { otaTags } from './ota';
import { NIGHT_KINDS, billable, buildCheckoutInvoice, fnbRate, fyMaxNight, isSpecified, type CheckoutDraft } from './checkout';

export const SAVE_TABLES = ['invoices', 'transactions', 'advances', 'clients', 'items_catalog', 'series_counters', HT.folios, HT.reservations, HT.rooms];

const fyStart = (day: string) => (Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1);

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
  const sender = settings.profiles.find((p) => p.id === res?.property_id) ?? localDb.settings.activeProfile();
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
    fnb: fnbRate(day, isSpecified(day, hs, fyMaxNight(hotelDb.folios(), fyStart(day) - 1))),
  }, lines);
}

/** Open advances of a window's payer (the booking's own first), with what is left on each. */
export function advancesFor(f: Folio, res: Reservation | undefined): { id: string; number: string; open: number }[] {
  const party = f.payer.kind === 'client' ? { id: f.payer.client_id, name: f.payer.name } : { name: f.payer.name };
  const mine = new Set(res?.advance_ids ?? []);
  return openAdvancesFor(party, loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll())
    .sort((a, b) => Number(mine.has(b.advance.id)) - Number(mine.has(a.advance.id)))
    .map((x) => ({ id: x.advance.id, number: x.advance.number, open: x.balance.open }));
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
    const out: InvoiceRecord[] = [];
    for (const plan of input.windows) {
      const f = hotelDb.folios().find((x) => x.id === plan.folioId);
      if (!f || f.status === 'invoiced') throw new HotelError('This folio is already billed.');
      const draft = draftFor(f, day, { guest: plan.guest, interim: input.interim });
      if (!draft.lineIds.length) continue;
      if (!(draft.record.total > 0)) throw new HotelError(`${f.name}: nothing to bill.`);
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
