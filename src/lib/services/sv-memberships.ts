/**
 * SV-C1 memberships (table `memberships`, `doc.create`, audited "Membership", dated `start`, numbered `MEM/FY…`):
 * sell, freeze / unfreeze, upgrade, transfer, cancel with refund, renew / auto-renew, wallet top-up. Every document goes
 * through the ordinary invoice save (numbering, period lock, snapshot, audit):
 *  - sale: ONE issued invoice for the whole price, taxed at sale (SV14; part-payment = the normal balance); record
 *    `sv.membership` (commission "membership sale");
 *  - freeze fee / transfer fee: a small separate invoice;
 *  - upgrade: the old plan's unused value (pro rata by days or sessions, at the old price) is credited on ONE invoice
 *    for the difference (a note on the line) — or, with `credit_note` mode, a credit note on the old bill + a full bill;
 *  - cancel: a GST credit note for the refund within the Sec 34(2) date; past it the app refuses (refund without a GST
 *    adjustment is a CA question, SV14);
 *  - wallet top-up: an advance receipt (GST on receipt for services, G3) with a bonus value (a discount on later use).
 * Expiry forfeits unused sessions with no GST event (SV15). Working papers — verify with your CA.
 */
import './sv-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { MemberPlan, Membership, MembershipEvent } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb, resettleCreditedInvoices } from '../localDb';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { shiftDay } from '../dates';
import { getIndianFY } from '../invoice-number';
import { nextFyCutoff } from '../gst-penalties';
import { saveAdvance } from '../advances';
import { blankClient, blankItem, makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { serviceClassAt } from '../service-rules';
import { SV_SERIES, SV_TABLES } from './sv-shared';
import { baseEnd, endOf, freezeError, loadCheckins, loadMemberPlans, loadMemberships, sessionsUsed, unusedValue } from './sv-members';
import { readServiceSettings } from './sv-settings';

export const MEM = SV_SERIES.memberships;
const now = () => new Date().toISOString();
const fmt = (d: string) => d.split('-').reverse().join('/');
const write = (all: Membership[]) => setTable(SV_TABLES.memberships, all);
const find = (id: string) => {
  const m = loadMemberships().find((x) => x.id === id);
  if (!m) throw new Error('Membership not found.');
  return m;
};
const put = (m: Membership) => write(loadMemberships().map((x) => (x.id === m.id ? { ...m, end: endOf(m), updated_at: now() } : x)));
/** QA12 S2: a cancelled / upgraded membership takes no further action (a second cancel would refund twice). */
const open = (id: string) => {
  const m = find(id);
  if (m.closed) throw new Error(`${m.number} is ${m.closed}.`);
  return m;
};
const event = (m: Membership, e: MembershipEvent): MembershipEvent[] => [...(m.history ?? []), e];

/** Sec 34(2): last day a GST credit note may be issued for a bill of `billDate`. */
export const sec34Limit = (billDate: string) => nextFyCutoff(getIndianFY(billDate).startYear);

/** A plan's sale line (rate by the plan, else its class on the date). */
export function planLine(plan: Omit<MemberPlan, 'created_at'>, date: string, rate = num(plan.price), note = ''): InvoiceItem {
  const cls = plan.cls ? serviceClassAt(plan.cls, date) : undefined;
  const tax = plan.tax_rate ?? cls?.rate ?? num(localDb.settings.get().defaultTaxRate);
  // QA12 S5: a 0% exempt class (education, charitable yoga, health care) reports in the Table 8 exempt column, not nil.
  return { ...blankItem(), name: plan.name, description: note, rate: round2(rate), amount: round2(rate), tax_rate: tax, hsn: plan.sac ?? cls?.sac ?? '', ...(plan.cls ? { sv: { cls: plan.cls, ...(!num(tax) && cls?.exempt ? { exempt: cls.exempt } : {}) } } : {}) };
}

const clientOf = (m: Pick<Membership, 'client_id' | 'client_name' | 'phone'>): Client => (m.client_id ? localDb.clients.getById(m.client_id) : undefined) ?? { ...blankClient(), name: m.client_name, phone: m.phone ?? '' };

/** Save one invoice (issued unless `draft`) for `client` with `items`; `sv` goes on the record. */
function bill(client: Client, items: InvoiceItem[], date: string, notes: string, sv?: InvoiceRecord['sv'], draft = false): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = { ...makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() }), id: generateId(), issue_date: date, due_date: date };
  const rec = buildBillDraft(base, client, items, sender);
  return localDb.invoices.save({ ...rec, status: draft ? 'Draft' : 'Sent', notes, ...(sv ? { sv: { ...rec.sv, ...sv } } : {}), invoice_number: localDb.invoices.nextNumber(date, rec.doc_type, sender?.invoicePrefix || undefined) });
}

/** A GST credit note of `taxable` on `inv` (split over its lines by value; tax reversed at each line's rate). */
export function valueNote(inv: InvoiceRecord, taxable: number, date: string, reason: string, only?: (l: InvoiceItem) => boolean): InvoiceRecord {
  const calc = calculateInvoice(calcInputFromRecord(inv));
  const lines = calc.lines.filter((c) => num(c.taxable) > 0 && (!only || only(inv.items.find((l) => l.id === c.id)!)));
  const base = lines.reduce((s, c) => s + num(c.taxable), 0);
  if (!(taxable > 0) || !(base > 0)) throw new Error('Nothing to credit.');
  if (date > sec34Limit(inv.issue_date)) throw new Error(`Past the Sec 34(2) date (${sec34Limit(inv.issue_date)}) for ${inv.invoice_number}: no GST credit note — ask your CA.`);
  let left = round2(Math.min(taxable, base));
  const items = lines.map((c, i) => {
    const v = i === lines.length - 1 ? left : round2((Math.min(taxable, base) * num(c.taxable)) / base);
    left = round2(left - v);
    const l = inv.items.find((x) => x.id === c.id)!;
    return { ...l, id: generateId(), quantity: 1, rate: v, amount: v, discount_percent: 0, description: reason };
  }).filter((l) => l.rate > 0);
  // The save upserts the client from the snapshot: an old snapshot must not reset the enrolments (batch, refund).
  const { enrolments: _enr, ...client } = inv.client;
  void _enr;
  const rec: InvoiceRecord = {
    ...inv, client, id: generateId(), invoice_number: '', doc_type: 'CREDIT_NOTE', issue_date: date, due_date: date, status: 'Sent', items, attachments: undefined,
    discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0, amount_paid: 0, po_number: inv.invoice_number, goods_returned: false, price_includes_tax: false,
    notes: `Credit note against ${inv.invoice_number} dated ${inv.issue_date}. Reason: ${reason}.`,
    created_at: undefined, updated_at: undefined, approval: undefined, party_balance_snapshot: undefined, pos: undefined, transport: undefined, late_fee_for: undefined, recurring_id: undefined, fee_plan_id: undefined, fee_instalment: undefined,
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  const saved = localDb.invoices.save({ ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, cess_amount: t.cess_amount, round_off: t.round_off, total: t.total, balance_due: 0 });
  setTable('doc_links', [...getTable<object>('doc_links'), { id: generateId(), from_id: inv.id, to_id: saved.id, relation: 'credit_note', reason, created_at: now() }]);
  resettleCreditedInvoices(saved.id);
  return saved;
}

export interface SellInput {
  plan_id: string;
  client_id?: string;
  client_name: string;
  phone?: string;
  start: string;
  date?: string;
  trainer_id?: string;
  auto_renew?: boolean;
  /** Wallet: the first top-up. */
  topup?: { amount: number; method: string };
}

const TABLES = [SV_TABLES.memberships, 'invoices', 'series_counters', 'doc_links', 'advances'];

/** Sell a plan: the membership row (MEM/FY…) and its sale bill (or, for a wallet, the first top-up). */
export function sellPlan(i: SellInput, extra: { credit?: { value: number; note: string }; from?: Membership; draft?: boolean } = {}): Membership {
  requireAccess('doc.create');
  const plan = loadMemberPlans().find((p) => p.id === i.plan_id);
  if (!plan) throw new Error('Choose a plan.');
  if (!i.client_name.trim()) throw new Error('Choose the member.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.start)) throw new Error('Choose the start date.');
  const date = i.date ?? i.start;
  const all = loadMemberships();
  const number = nextSeriesNumberFor(MEM, i.start, all.map((m) => m.number));
  const { created_at: _c, updated_at: _u, ...snap } = plan;
  void _c; void _u;
  const m: Membership = {
    id: generateId(), number, client_id: i.client_id, client_name: i.client_name.trim(), ...(i.phone ? { phone: i.phone } : {}), plan: snap, start: i.start, end: baseEnd(plan, i.start),
    invoice_ids: [], ...(i.trainer_id || plan.trainer_id ? { trainer_id: i.trainer_id || plan.trainer_id } : {}), ...(i.auto_renew ? { auto_renew: true } : {}), created_at: now(),
  };
  return withTablesRollback(TABLES, () => {
    recordSeries(number);
    if (plan.kind !== 'wallet') {
      const credit = Math.min(num(extra.credit?.value), num(plan.price));
      const span = m.end ? ` · ${fmt(m.start)} – ${fmt(m.end)}` : '';
      const line = planLine(plan, date, num(plan.price) - credit, `${number}${span}${credit ? ` · ${extra.credit!.note}` : ''}`);
      const inv = bill(clientOf(m), [line], date, `${plan.name} ${number}`, { membership: { id: m.id, number, start: m.start, ...(m.end ? { end: m.end } : {}) } }, extra.draft);
      m.invoice_ids.push(inv.id);
    }
    write([...loadMemberships(), m]);
    if (plan.kind === 'wallet' && i.topup) topUp(m.id, i.topup.amount, i.topup.method, date);
    return loadMemberships().find((x) => x.id === m.id)!;
  });
}

/** Freeze between `from` and `to` (the end moves by the frozen days); a plan fee is a separate small bill. */
export function freeze(id: string, from: string, to: string, reason = '', date = from): Membership {
  requireAccess('doc.create');
  const m = open(id);
  const err = freezeError(m, from, to);
  if (err) throw new Error(err);
  return withTablesRollback(TABLES, () => {
    const fee = num(m.plan.freeze?.fee);
    const inv = fee > 0 ? bill(clientOf(m), [planLine({ ...m.plan, name: `Freeze fee — ${m.number}` }, date, fee, `${fmt(from)} – ${fmt(to)}`)], date, `Freeze of ${m.number}`) : undefined;
    put({ ...m, freezes: [...(m.freezes ?? []), { from, to, ...(reason ? { reason } : {}), ...(inv ? { invoice_id: inv.id } : {}) }] });
    return find(id);
  });
}

/** End a freeze early on `day` (the member is back that day): the end is recomputed. */
export function unfreeze(id: string, day: string): Membership {
  requireAccess('doc.create');
  const m = find(id);
  const freezes = (m.freezes ?? []).flatMap((f) => (f.from <= day && day <= f.to ? (day > f.from ? [{ ...f, to: shiftDay(day, -1) }] : []) : [f]));
  put({ ...m, freezes });
  return find(id);
}

/**
 * Upgrade to `planId` from `date`: the old membership closes ("upgraded") and a new one starts. The old plan's unused
 * value is credited on the new bill (one invoice for the difference) or, in `credit_note` mode, by a credit note on
 * the old bill and a full new bill.
 */
export function upgrade(id: string, planId: string, date: string, mode = readServiceSettings().upgrade_mode ?? 'difference'): Membership {
  requireAccess('doc.create');
  const m = open(id);
  const u = unusedValue(m, shiftDay(date, -1), sessionsUsed(m, localDb.invoices.getAll(), loadCheckins()));
  const note = `₹${u.value} credited for ${u.left} unused ${u.by} of ${m.number}`;
  return withTablesRollback(TABLES, () => {
    let creditNote: InvoiceRecord | undefined;
    const old = localDb.invoices.getById(m.invoice_ids[0] ?? '');
    if (mode === 'credit_note' && u.value > 0 && old) creditNote = valueNote(old, u.value, date, `Upgrade of ${m.number}`);
    const next = sellPlan({ plan_id: planId, client_id: m.client_id, client_name: m.client_name, phone: m.phone, start: date, trainer_id: m.trainer_id, auto_renew: m.auto_renew }, mode === 'credit_note' ? {} : { credit: { value: u.value, note } });
    put({ ...find(id), closed: 'upgraded', next_id: next.id, history: event(m, { date, kind: 'upgrade', note: `${note} → ${next.number}`, invoice_id: next.invoice_ids[0], ...(creditNote ? { credit_note_id: creditNote.id } : {}) }) });
    return next;
  });
}

/** Transfer to another member from `date` (history kept on the same row; the plan's fee is billed to the old member). */
export function transfer(id: string, to: { client_id?: string; client_name: string; phone?: string }, date: string): Membership {
  requireAccess('doc.create');
  const m = open(id);
  if (!m.plan.transferable) throw new Error(`${m.plan.name} is not transferable.`);
  if (!to.client_name.trim()) throw new Error('Choose the new member.');
  return withTablesRollback(TABLES, () => {
    const fee = num(m.plan.transfer_fee);
    const inv = fee > 0 ? bill(clientOf(m), [planLine({ ...m.plan, name: `Transfer fee — ${m.number}` }, date, fee, `To ${to.client_name}`)], date, `Transfer of ${m.number}`) : undefined;
    put({ ...m, client_id: to.client_id, client_name: to.client_name.trim(), phone: to.phone, history: event(m, { date, kind: 'transfer', note: `${m.client_name} → ${to.client_name}`, ...(inv ? { invoice_id: inv.id } : {}) }) });
    return find(id);
  });
}

/** What a cancellation on `date` refunds (taxable): none, pro rata of the unused value, or `custom`. */
export function refundFor(m: Membership, date: string, custom?: number): number {
  if (custom !== undefined) return round2(Math.max(0, Math.min(custom, num(m.plan.price))));
  return m.plan.refund === 'pro_rata' ? unusedValue(m, date, sessionsUsed(m, localDb.invoices.getAll(), loadCheckins())).value : 0;
}

/** Cancel with refund: a GST credit note on the sale bill for the refund (within Sec 34(2)); the row closes. */
export function cancelMembership(id: string, date: string, reason: string, custom?: number): Membership {
  requireAccess('doc.create');
  const m = open(id);
  if (!reason.trim()) throw new Error('Give the reason.');
  const refund = refundFor(m, date, custom);
  const sale = localDb.invoices.getById(m.invoice_ids[0] ?? '');
  return withTablesRollback(TABLES, () => {
    const note = refund > 0 && sale ? valueNote(sale, refund, date, `Cancellation of ${m.number}: ${reason.trim()}`) : undefined;
    put({ ...m, closed: 'cancelled', history: event(m, { date, kind: 'cancel', note: `${reason.trim()}; refund ₹${refund}`, ...(note ? { credit_note_id: note.id } : {}) }) });
    return find(id);
  });
}

/** Renew: the same plan from the day after the end (or `date` when later); `draft` = an unissued bill (auto-renew). */
export function renew(id: string, date: string, draft = false): Membership {
  requireAccess('doc.create');
  const m = open(id);
  if (m.next_id) throw new Error(`${m.number} is already renewed.`);
  const start = m.end && shiftDay(m.end, 1) > date ? shiftDay(m.end, 1) : date;
  const plan = loadMemberPlans().find((p) => p.id === m.plan.id);
  if (!plan) throw new Error(`The plan ${m.plan.name} was deleted.`);
  return withTablesRollback(TABLES, () => {
    // QA12 S9: an auto-renewal bill is saved as a draft at once (it was issued first, then turned back into a draft).
    const next = sellPlan({ plan_id: plan.id, client_id: m.client_id, client_name: m.client_name, phone: m.phone, start, date, trainer_id: m.trainer_id, auto_renew: m.auto_renew }, { draft });
    put({ ...find(id), next_id: next.id, history: event(m, { date, kind: 'renew', note: `→ ${next.number}${draft ? ' (draft bill)' : ''}`, invoice_id: next.invoice_ids[0] }) });
    return next;
  });
}

/** Auto-renew: every auto-renewing membership past its end gets its successor with a DRAFT bill (issue it to tax it). */
export function autoRenewDue(today: string): Membership[] {
  // QA12 S9: one membership that cannot renew (its plan deleted) no longer stops every other renewal.
  return loadMemberships().filter((m) => m.auto_renew && !m.closed && !m.next_id && m.end && m.end < today).flatMap((m) => {
    try {
      return [renew(m.id, shiftDay(m.end, 1), true)]; // no gap: from the day after the end
    } catch {
      return [];
    }
  });
}

/** Wallet top-up: an advance receipt (GST on receipt for services) plus the plan's bonus value (never cash). */
export function topUp(id: string, amount: number, method: string, date: string): Membership {
  requireAccess('doc.create');
  const m = open(id);
  if (m.plan.kind !== 'wallet') throw new Error(`${m.number} is not a wallet.`);
  const c = clientOf(m);
  // QA12 S3: the top-up's GST rate is the plan's rate as on a sale (its tax class, else the default rate) — the plan
  // form has no rate field, so `plan.tax_rate` alone left every wallet top-up at 0%.
  const adv = saveAdvance({ date, client: { id: c.id, name: c.name, gstin: c.gstin, state_code: c.state_code }, place_of_supply: c.state_code || senderStateCode(localDb.settings.activeProfile() ?? null), supply: 'services', tax_rate: num(planLine(m.plan, date).tax_rate), amount, method, description: `Wallet ${m.number}` });
  const bonus = round2((num(amount) * num(m.plan.bonus_pct)) / 100);
  put({ ...m, wallet: { ...m.wallet, topups: [...(m.wallet?.topups ?? []), { advance_id: adv.id, date, amount: adv.amount, bonus }] } });
  return find(id);
}

/** Bonus value left on a wallet (given as a discount on a later bill). */
export const bonusLeft = (m: Membership) => round2((m.wallet?.topups ?? []).reduce((s, t) => s + num(t.bonus), 0) - num(m.wallet?.bonus_used));

/** Record bonus value given as a discount on a bill. */
export function useBonus(id: string, amount: number): Membership {
  requireAccess('doc.create');
  const m = find(id);
  if (!(amount > 0) || amount > bonusLeft(m) + 0.001) throw new Error(`Bonus left: ₹${bonusLeft(m)}.`);
  put({ ...m, wallet: { topups: m.wallet?.topups ?? [], bonus_used: round2(num(m.wallet?.bonus_used) + amount) } });
  return find(id);
}

/** Data-layer delete (recycle bin): only while no live bill belongs to it; the MEM number stays used. */
export function deleteMembership(id: string): void {
  requireAccess('doc.create');
  const m = find(id);
  const live = m.invoice_ids.map((x) => localDb.invoices.getById(x)).find((i) => i && i.status !== 'Cancelled');
  if (live) throw new Error(`Cancel ${live.invoice_number} first (or cancel the membership).`);
  write(loadMemberships().filter((x) => x.id !== id));
}
