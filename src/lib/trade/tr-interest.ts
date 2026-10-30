/**
 * TR-A4 party-wise interest statement and bulk interest notes (Receivables → Interest; not pack-gated).
 *
 * Per bill the maths is `interest.ts` `computeInterest` unchanged (simple, 365-day year, payments and credit notes
 * reduce the balance from their date, opening bills included). Rate: the party's own late-fee terms when they are a
 * % p.a. → the company default (`interest_settings.rate`) → none (party skipped). Basis: from the due date, or from the
 * bill date + the party's credit days; a bill sold on credit till harvest (R12 AG-D4, `ag.inputs.season_due`) always
 * starts at its season due date. A bill already charged in an earlier run is charged only after the date it
 * was charged to (the earlier amount is taken off), so no bill-period is charged twice.
 * Raise: one DRAFT invoice per ticked party (G6 / TR18: interest for delayed payment is part of the value of the
 * supply, so each line takes the principal supply's GST rate and HSN of its bill), `interest_run_id` on each, and one
 * `interest_runs` row. Working paper — verify with your CA; whether interest can be charged depends on the agreement.
 */
import './tr-registry';
import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { InterestRun, InterestSettings } from '../../types/trade-r8';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { computeInterest, interestInputFor, type InterestInput } from '../interest';
import { interestChargedTo, principalItem, principalTaxRate } from '../late-fee';
import type { DocLink } from '../documents';
import type { OpeningBillInput } from '../receivables';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, setJson, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { shiftDay } from '../dates';
import { isValidGstin } from '../gstin';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { TR_OBJECTS, TR_TABLES } from './tr-shared';

export const INTEREST_RUNS_TABLE = TR_TABLES.interestRuns;
const SETTINGS_KEY = `${DB_PREFIX}${TR_OBJECTS.interestSettings}`;

export const loadInterestSettings = (): InterestSettings => getJson<InterestSettings>(SETTINGS_KEY, {}) ?? {};
export function saveInterestSettings(s: InterestSettings): void {
  requireAccess('settings.manage');
  setJson(SETTINGS_KEY, { rate: Math.min(Math.max(num(s.rate), 0), 100), grace_days: Math.max(Math.round(num(s.grace_days)), 0), basis: s.basis === 'bill' ? 'bill' : 'due', min_amount: Math.max(num(s.min_amount), 0) });
}
export const loadInterestRuns = (): readonly InterestRun[] => peekTable<InterestRun>(INTEREST_RUNS_TABLE).filter((r) => r && typeof r.id === 'string');

export interface InterestBill {
  id: string;
  number: string;
  date: string;
  due: string;
  /** Interest runs from the day after this (absent = the bill's own start). */
  charged_to?: string;
  from: string;
  to: string;
  days: number;
  outstanding: number;
  amount: number;
  /** The original invoice (absent for an opening bill). */
  invoice?: InvoiceRecord;
}
export interface PartyInterest {
  party_id?: string;
  party: string;
  rate: number;
  bills: InterestBill[];
  total: number;
  /** Below the minimum: listed, not ticked. */
  below_min: boolean;
}

export interface InterestData {
  invoices: readonly InvoiceRecord[];
  payments: readonly Pick<Payment, 'invoice_id' | 'amount' | 'date'>[];
  links: DocLink[];
  clients: readonly Client[];
  openingBills: readonly OpeningBillInput[];
  runs: readonly InterestRun[];
}

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const key = (c: { id?: string; name?: string } | undefined) => c?.id || `n:${String(c?.name ?? '').trim().toLowerCase()}`;

/** Pure: interest per party as of `asOf`. */
export function partyInterest(asOf: string, s: InterestSettings, d: InterestData): PartyInterest[] {
  const clients = new Map(d.clients.map((c) => [key(c), c]));
  // QA8 T5: only live runs count (their interest invoice still live); T4: a live late-fee invoice charged its bill up
  // to its own date, so the run starts after that.
  const chargedTo = interestChargedTo(d.runs, d.invoices);
  for (const inv of d.invoices) {
    const of = inv?.late_fee_for;
    if (!of || inv.status === 'Cancelled') continue;
    const day = String(inv.issue_date).slice(0, 10);
    if (!chargedTo.has(of) || day > chargedTo.get(of)!) chargedTo.set(of, day);
  }
  const parties = new Map<string, PartyInterest>();
  const add = (pk: string, name: string, id: string | undefined, number: string, date: string, due: string, input: InterestInput, inv?: InvoiceRecord) => {
    const c = clients.get(pk);
    const fee = c?.late_fee?.mode === 'percent_pa' && num(c.late_fee.rate) > 0 ? c.late_fee : undefined;
    const rate = fee ? num(fee.rate) : num(s.rate);
    if (!(rate > 0)) return;
    const startDue = inv?.ag?.inputs?.season_due || (s.basis === 'bill' ? shiftDay(date, Math.max(num(c?.credit_days), 0)) : due); // R12 (AG-D4): credit till harvest runs from the season due date
    const cfg = { enabled: true, mode: 'annual' as const, rate, grace_days: fee ? num(fee.graceDays) : num(s.grace_days) };
    const at = (day: string) => computeInterest({ ...input, due_date: startDue }, cfg, day);
    const now = at(asOf);
    const prevTo = chargedTo.get(id ?? number);
    const before = prevTo ? at(prevTo) : undefined;
    const amount = round2(now.amount - (before?.amount ?? 0));
    if (!now.eligible || !(amount > 0)) return;
    const p = parties.get(pk) ?? { party_id: c?.id, party: name, rate, bills: [], total: 0, below_min: false };
    p.bills.push({ id: id ?? number, number, date, due: startDue, ...(prevTo ? { charged_to: prevTo } : {}), from: shiftDay(prevTo ?? now.accrues_from ?? startDue, 1), to: now.accrued_to ?? asOf, days: now.chargeable_days - (before?.chargeable_days ?? 0), outstanding: now.outstanding, amount, ...(inv ? { invoice: inv } : {}) });
    p.total = round2(p.total + amount);
    parties.set(pk, p);
  };
  for (const inv of d.invoices) {
    if (!SALES.has(inv.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled' || inv.issue_date > asOf || inv.late_fee_for || inv.interest_run_id) continue;
    add(key(inv.client), inv.client?.name ?? '', inv.id, inv.invoice_number, inv.issue_date, inv.due_date, interestInputFor(inv, d.payments as Payment[], d.links, d.invoices as InvoiceRecord[]), inv);
  }
  for (const b of d.openingBills) {
    if (b.dr_cr !== 'Dr' || b.on_account || b.date > asOf) continue;
    const input: InterestInput = { doc_type: 'INVOICE', status: 'Sent', due_date: b.due_date, total: b.amount, payments: d.payments.filter((p) => p.invoice_id === b.id).map((p) => ({ date: p.date, amount: p.amount })) };
    add(b.party_id || key({ name: b.party_name }), b.party_name, b.id, b.ref_no, b.date, b.due_date, input);
  }
  const min = num(s.min_amount);
  return [...parties.values()].map((p) => ({ ...p, below_min: min > 0 && p.total < min })).sort((a, b) => b.total - a.total);
}

/** Bills of `parties` also charged in an earlier run (the warning list). */
export const overlaps = (parties: readonly PartyInterest[]) => parties.flatMap((p) => p.bills.filter((b) => b.charged_to).map((b) => `${b.number} (charged to ${b.charged_to})`));

/** Export / SEZ supply types: their interest keeps the bill's supply type (one draft each). */
const isSpecialSupply = (t: InvoiceRecord['supply_type']) => !!t && t !== 'B2B' && t !== 'B2C';
const supplyGroup = (b: InterestBill) => (isSpecialSupply(b.invoice?.supply_type) ? b.invoice!.supply_type! : '');

/** Pure: a party's bills split by supply type (export / SEZ bills apart from the rest), totals re-worked. */
export function splitBySupply(p: PartyInterest): PartyInterest[] {
  const groups = new Map<string, InterestBill[]>();
  for (const b of p.bills) groups.set(supplyGroup(b), [...(groups.get(supplyGroup(b)) ?? []), b]);
  return [...groups.values()].map((bills) => ({ ...p, bills, total: round2(bills.reduce((t, b) => t + b.amount, 0)) }));
}

/** Pure: the draft interest invoice to one party. */
export function buildInterestInvoice(p: PartyInterest, ctx: { date: string; asOf: string; client: Client; settings: ReturnType<typeof localDb.settings.get>; sender: InvoiceRecord['sender']; fallbackRate: number }): InvoiceRecord {
  const items: InvoiceItem[] = p.bills.map((b) => {
    const pi = b.invoice ? principalItem(b.invoice.items) : undefined;
    return {
      id: generateId(),
      name: `Interest on ${b.number}`,
      description: `Interest at ${p.rate}% p.a. on the overdue balance of ${b.number} dated ${b.date} for ${b.from} to ${b.to} (${b.days} day${b.days === 1 ? '' : 's'}), as per agreed terms.`,
      type: pi?.type || 'service',
      ...(pi?.hsn?.trim() ? { hsn: pi.hsn.trim() } : {}),
      unit: 'NOS',
      quantity: 1,
      rate: b.amount,
      tax_rate: b.invoice ? principalTaxRate(b.invoice.items) : ctx.fallbackRate,
      discount_percent: 0,
      amount: b.amount,
    };
  });
  const home = senderStateCode(ctx.sender);
  const pos = (isValidGstin(ctx.client.gstin ?? '') ? ctx.client.gstin!.slice(0, 2) : ctx.client.state_code) || home;
  const draft = makeDraft({ settings: ctx.settings, sender: ctx.sender, docType: isValidGstin(ctx.client.gstin ?? '') ? 'TAX_INVOICE' : 'INVOICE' });
  // QA8 T6: interest follows the principal supply — on an export / SEZ bill it is zero-rated (or IGST with payment)
  // under the same supply type, LUT and place of supply. `raiseInterest` gives each supply type its own draft.
  const src = p.bills.map((b) => b.invoice).find((i) => i && isSpecialSupply(i.supply_type));
  const rec: InvoiceRecord = {
    ...draft, issue_date: ctx.date, due_date: ctx.date > draft.due_date ? ctx.date : draft.due_date, status: 'Draft', client: { ...ctx.client }, items, place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }),
    ...(src ? { supply_type: src.supply_type, place_of_supply: src.place_of_supply || pos, gst_mode: src.gst_mode, ...(src.lut_number ? { lut_number: src.lut_number } : {}), ...(src.lut_date ? { lut_date: src.lut_date } : {}) } : {}),
    notes: `Interest on overdue bills as on ${ctx.asOf} (Sec 15(2)(d) CGST Act: part of the value of the supply, verify with your CA).`,
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount };
}

/** Raise one draft per party (all or nothing) and record the run. */
export function raiseInterest(parties: readonly PartyInterest[], asOf: string, date: string): InterestRun {
  requireAccess('doc.create');
  requireAccess('books.edit');
  const chosen = parties.filter((p) => p.total > 0 && p.party_id);
  if (!chosen.length) throw new Error('Tick at least one party from Clients with interest due.');
  const id = generateId();
  assertUnlocked({ id, issue_date: date, invoice_number: '' }, 'create');
  return withTablesRollback(['invoices', INTEREST_RUNS_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const settings = localDb.settings.get();
    const catalogue = peekTable<unknown>('items_catalog');
    const ids: string[] = [];
    const bills: InterestRun['bills'] = [];
    for (const party of chosen) {
      const client = localDb.clients.getById(party.party_id!);
      if (!client) throw new Error(`${party.party} is not in Clients.`);
      const latest = [...localDb.invoices.getAll()].filter((i) => i.client?.id === client.id && i.doc_type !== 'CREDIT_NOTE').sort((a, b) => b.issue_date.localeCompare(a.issue_date))[0];
      for (const p of splitBySupply(party)) {
        const saved = localDb.invoices.save({ ...buildInterestInvoice(p, { date, asOf, client, settings, sender: localDb.settings.activeProfile(), fallbackRate: latest ? principalTaxRate(latest.items) : 0 }), interest_run_id: id });
        ids.push(saved.id);
        for (const b of p.bills) bills.push({ id: b.id, party: p.party, from: b.from, to: b.to, amount: b.amount, invoice_id: saved.id });
      }
    }
    if (peekTable<unknown>('items_catalog').length !== catalogue.length) setTable('items_catalog', catalogue as unknown[]);
    const run: InterestRun = { id, date, as_of: asOf, bills, invoice_ids: ids, total: round2(chosen.reduce((t, p) => t + p.total, 0)), created_at: new Date().toISOString() };
    setTable(INTEREST_RUNS_TABLE, [...getTable<InterestRun>(INTEREST_RUNS_TABLE), run]);
    return run;
  });
}

/**
 * QA8 T5: undo an interest run. Its draft invoices are deleted (recycle bin); an issued one must be cancelled first.
 * The run stays (audited) marked undone, so its bills can be charged again.
 */
export function undoInterestRun(runId: string): InterestRun {
  requireAccess('books.edit');
  const all = getTable<InterestRun>(INTEREST_RUNS_TABLE);
  const run = all.find((r) => r.id === runId);
  if (!run) throw new Error('Interest run not found.');
  if (run.status === 'undone') return run;
  const docs = run.invoice_ids.map((i) => localDb.invoices.getById(i)).filter((i): i is InvoiceRecord => !!i && i.status !== 'Cancelled');
  const issued = docs.find((i) => i.status !== 'Draft');
  if (issued) throw new Error(`Interest invoice ${issued.invoice_number} is issued: cancel it first, then undo the run.`);
  assertUnlocked({ id: run.id, issue_date: run.date, invoice_number: '' }, 'delete');
  return withTablesRollback(['invoices', INTEREST_RUNS_TABLE, 'series_counters'], () => {
    for (const d of docs) localDb.invoices.remove(d.id);
    const next: InterestRun = { ...run, status: 'undone', undone_at: new Date().toISOString() };
    setTable(INTEREST_RUNS_TABLE, getTable<InterestRun>(INTEREST_RUNS_TABLE).map((r) => (r.id === runId ? next : r)));
    return next;
  });
}

/** Statement text for one party (print / WhatsApp). */
export function interestText(p: PartyInterest, asOf: string, money: (n: number) => string): string {
  return [`Interest statement: ${p.party} (as on ${asOf}, ${p.rate}% p.a.)`, ...p.bills.map((b) => `${b.number} (${b.date}, due ${b.due}): ${b.from} to ${b.to}, ${b.days} days on ${money(b.outstanding)} → ${money(b.amount)}`), `Total interest: ${money(p.total)}`].join('\n');
}
