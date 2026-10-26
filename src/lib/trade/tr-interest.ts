/**
 * TR-A4 party-wise interest statement and bulk interest notes (Receivables → Interest; not pack-gated).
 *
 * Per bill the maths is `interest.ts` `computeInterest` unchanged (simple, 365-day year, payments and credit notes
 * reduce the balance from their date, opening bills included). Rate: the party's own late-fee terms when they are a
 * % p.a. → the company default (`interest_settings.rate`) → none (party skipped). Basis: from the due date, or from the
 * bill date + the party's credit days. A bill already charged in an earlier run is charged only after the date it
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
import { principalItem, principalTaxRate } from '../late-fee';
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
  const chargedTo = new Map<string, string>();
  for (const r of d.runs) for (const b of r.bills) if (!chargedTo.has(b.id) || b.to > chargedTo.get(b.id)!) chargedTo.set(b.id, b.to);
  const parties = new Map<string, PartyInterest>();
  const add = (pk: string, name: string, id: string | undefined, number: string, date: string, due: string, input: InterestInput, inv?: InvoiceRecord) => {
    const c = clients.get(pk);
    const fee = c?.late_fee?.mode === 'percent_pa' && num(c.late_fee.rate) > 0 ? c.late_fee : undefined;
    const rate = fee ? num(fee.rate) : num(s.rate);
    if (!(rate > 0)) return;
    const startDue = s.basis === 'bill' ? shiftDay(date, Math.max(num(c?.credit_days), 0)) : due;
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
  const rec: InvoiceRecord = {
    ...draft, issue_date: ctx.date, due_date: ctx.date > draft.due_date ? ctx.date : draft.due_date, status: 'Draft', client: { ...ctx.client }, items, place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }),
    notes: `Interest on overdue bills as on ${ctx.asOf} (Sec 15(2)(d) CGST Act: part of the value of the supply — verify with your CA).`,
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
    for (const p of chosen) {
      const client = localDb.clients.getById(p.party_id!);
      if (!client) throw new Error(`${p.party} is not in Clients.`);
      const latest = [...localDb.invoices.getAll()].filter((i) => i.client?.id === client.id && i.doc_type !== 'CREDIT_NOTE').sort((a, b) => b.issue_date.localeCompare(a.issue_date))[0];
      const saved = localDb.invoices.save({ ...buildInterestInvoice(p, { date, asOf, client, settings, sender: localDb.settings.activeProfile(), fallbackRate: latest ? principalTaxRate(latest.items) : 0 }), interest_run_id: id });
      ids.push(saved.id);
    }
    if (peekTable<unknown>('items_catalog').length !== catalogue.length) setTable('items_catalog', catalogue as unknown[]);
    const run: InterestRun = { id, date, as_of: asOf, bills: chosen.flatMap((p) => p.bills.map((b) => ({ id: b.id, party: p.party, from: b.from, to: b.to, amount: b.amount }))), invoice_ids: ids, total: round2(chosen.reduce((t, p) => t + p.total, 0)), created_at: new Date().toISOString() };
    setTable(INTEREST_RUNS_TABLE, [...getTable<InterestRun>(INTEREST_RUNS_TABLE), run]);
    return run;
  });
}

/** Statement text for one party (print / WhatsApp). */
export function interestText(p: PartyInterest, asOf: string, money: (n: number) => string): string {
  return [`Interest statement — ${p.party} (as on ${asOf}, ${p.rate}% p.a.)`, ...p.bills.map((b) => `${b.number} (${b.date}, due ${b.due}): ${b.from} to ${b.to}, ${b.days} days on ${money(b.outstanding)} → ${money(b.amount)}`), `Total interest: ${money(p.total)}`].join('\n');
}
