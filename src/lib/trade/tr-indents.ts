/**
 * TR-C1 indent register: orders a buyer places with a principal (mill / manufacturer) through us, the indenting agent.
 * Table `indents`, numbered `IND/FY…`. Status: placed → dispatched (the principal's invoice no.) → paid → commission
 * billed (derived: only while the commission invoice is live) · cancelled.
 *
 * "Bill commission" makes ONE services invoice per principal for the chosen dispatched / paid indents: SAC 996111 at
 * 18%, place of supply = the principal's location (Sec 12(2) IGST Act), with the 194H TDS the principal is expected to
 * deduct preset (TR21). A principal outside India is an intermediary service, not an export (Sec 13(8)(b)) — the
 * invoice carries that warning. Working paper — verify with your CA.
 */
import './tr-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Indent, IndentStatus } from '../../types/trade-r8';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { localDb, type AppSettings } from '../localDb';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { isValidGstin } from '../gstin';
import { tdsSections } from '../tax-rules';
import { AgencyError } from './tr-arrivals';
import { TR_SERIES, TR_TABLES } from './tr-shared';

export const INDENTS_TABLE = TR_TABLES.indents;
export const COMMISSION_SAC = '996111';
export const COMMISSION_GST_RATE = 18;

export const loadIndents = (): readonly Indent[] => peekTable<Indent>(INDENTS_TABLE).filter((r) => r && typeof r.id === 'string');

/* ── Pure ─────────────────────────────────────────────────────── */

/** Commission earned on an indent: % of its value, or ₹ per unit. */
export function commissionOf(i: Pick<Indent, 'qty' | 'rate' | 'commission_basis' | 'commission_rate'>): number {
  const r = Math.max(num(i.commission_rate), 0);
  return round2(i.commission_basis === 'per_unit' ? num(i.qty) * r : (num(i.qty) * num(i.rate) * r) / 100);
}

/** The status shown: "billed" only while the commission invoice is live (cancelling the invoice frees the indent). */
export function indentStatus(i: Indent, invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[]): IndentStatus {
  if (i.status === 'cancelled') return 'cancelled';
  const inv = i.commission_invoice_id ? invoices.find((x) => x.id === i.commission_invoice_id) : undefined;
  if (inv && inv.status !== 'Cancelled') return 'billed';
  if (i.paid_on) return 'paid';
  if (i.dispatched_on) return 'dispatched';
  return 'placed';
}

/** Pending indents (placed, not yet dispatched) and the commission due (dispatched / paid, not billed). */
export function indentSummary(rows: readonly Indent[], invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[]): { pending: number; due: number } {
  let pending = 0;
  let due = 0;
  for (const i of rows) {
    const st = indentStatus(i, invoices);
    if (st === 'placed') pending++;
    if (st === 'dispatched' || st === 'paid') due = round2(due + commissionOf(i));
  }
  return { pending, due };
}

export interface IndentInput extends Omit<Indent, 'id' | 'number' | 'status' | 'created_at' | 'updated_at'> {
  id?: string;
}

export function validateIndent(i: IndentInput): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date ?? '')) return 'Choose the indent date.';
  if (!String(i.buyer_name ?? '').trim()) return 'Enter the buyer.';
  if (!i.principal_id) return 'Choose the principal (mill) from Clients.';
  if (!String(i.item ?? '').trim()) return 'Enter the item.';
  if (!(num(i.qty) > 0) || num(i.rate) < 0) return 'Enter the quantity and rate.';
  if (!(num(i.commission_rate) > 0)) return 'Enter the commission.';
  return '';
}

/**
 * Pure: the commission invoice to `principal` for `rows` (one line each, SAC 996111 at 18%). Place of supply = the
 * principal's state (its GSTIN, else its state code, else ours).
 */
export function buildCommissionInvoice(rows: readonly Indent[], ctx: { principal: Client; date: string; settings: AppSettings; sender: InvoiceRecord['sender']; templateId?: string }): InvoiceRecord {
  if (!rows.length) throw new AgencyError('Choose dispatched indents to bill.');
  const home = senderStateCode(ctx.sender);
  const pos = (isValidGstin(ctx.principal.gstin ?? '') ? ctx.principal.gstin!.slice(0, 2) : ctx.principal.state_code) || home;
  const items: InvoiceItem[] = rows.map((i) => {
    const amount = commissionOf(i);
    return {
      id: generateId(),
      name: `Indent commission — ${i.number}`,
      description: `${i.item}: ${i.qty}${i.unit ? ` ${i.unit}` : ''} × ₹${num(i.rate)} for ${i.buyer_name}${i.principal_invoice_no ? `, your invoice ${i.principal_invoice_no}` : ''} (${i.commission_basis === 'per_unit' ? `₹${i.commission_rate} per unit` : `${i.commission_rate}%`})`,
      type: 'Service',
      hsn: COMMISSION_SAC,
      unit: 'NOS',
      quantity: 1,
      rate: amount,
      tax_rate: COMMISSION_GST_RATE,
      discount_percent: 0,
      amount,
    };
  });
  const draft = makeDraft({ settings: ctx.settings, sender: ctx.sender, docType: isValidGstin(ctx.principal.gstin ?? '') ? 'TAX_INVOICE' : 'INVOICE', templateId: ctx.templateId });
  const h194 = tdsSections(ctx.date).find((s) => s.section === '194H');
  const foreign = pos === '96';
  const rec: InvoiceRecord = {
    ...draft,
    issue_date: ctx.date,
    due_date: ctx.date > draft.due_date ? ctx.date : draft.due_date,
    status: 'Draft',
    client: { ...ctx.principal },
    items,
    place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }),
    ...(h194 ? { tds_enabled: true, tds_section: '194H', tds_rate: h194.rate, tds_on_taxable: true } : {}),
    notes: [
      `Commission as indenting agent on ${rows.length} indent(s).`,
      ...(foreign ? ['Principal outside India: an intermediary service (Sec 13(8)(b) IGST Act), not an export — verify with your CA.'] : []),
    ].join('\n'),
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return {
    ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount,
    tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

/* ── Storage ──────────────────────────────────────────────────── */

const lockOf = (r: Pick<Indent, 'id' | 'date' | 'number'>) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

export function saveIndent(input: IndentInput): Indent {
  requireAccess('doc.create');
  const err = validateIndent(input);
  if (err) throw new AgencyError(err);
  const all = getTable<Indent>(INDENTS_TABLE);
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  if (prev && prev.status === 'cancelled') throw new AgencyError(`Indent ${prev.number} is cancelled.`);
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  const id = prev?.id ?? generateId();
  const number = prev?.number ?? nextSeriesNumberFor(TR_SERIES.indents, input.date, all.map((r) => r.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, prev ? 'edit' : 'create');
  const now = new Date().toISOString();
  const row: Indent = {
    ...prev,
    ...input,
    id,
    number,
    buyer_name: input.buyer_name.trim(),
    item: input.item.trim(),
    qty: num(input.qty),
    rate: round2(num(input.rate)),
    commission_rate: num(input.commission_rate),
    status: prev?.status ?? 'placed',
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };
  setTable(INDENTS_TABLE, prev ? all.map((r) => (r.id === id ? row : r)) : [...all, row]);
  recordSeries(number);
  return row;
}

/** Move an indent on: dispatched (with the principal's invoice no.), paid, or cancelled (with a reason). */
export function markIndent(id: string, to: 'dispatched' | 'paid' | 'cancelled', opts: { date: string; ref?: string }): Indent {
  requireAccess('doc.create');
  const all = getTable<Indent>(INDENTS_TABLE);
  const r = all.find((x) => x.id === id);
  if (!r) throw new AgencyError('Indent not found.');
  if (r.status === 'cancelled') throw new AgencyError(`Indent ${r.number} is cancelled.`);
  assertUnlocked(lockOf(r), to === 'cancelled' ? 'cancel' : 'edit');
  if (to === 'cancelled' && r.commission_invoice_id && indentStatus(r, localDb.invoices.getAll()) === 'billed') throw new AgencyError('Cancel the commission invoice first.');
  const next: Indent = {
    ...r,
    ...(to === 'dispatched' ? { dispatched_on: opts.date, principal_invoice_no: opts.ref?.trim() || r.principal_invoice_no, status: 'dispatched' as const } : {}),
    ...(to === 'paid' ? { paid_on: opts.date, dispatched_on: r.dispatched_on ?? opts.date, status: 'paid' as const } : {}),
    ...(to === 'cancelled' ? { status: 'cancelled' as const, notes: [r.notes, opts.ref?.trim()].filter(Boolean).join(' · ') } : {}),
    updated_at: new Date().toISOString(),
  };
  setTable(INDENTS_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** One draft commission invoice per principal for the chosen dispatched / paid indents (all or nothing). */
export function billCommission(ids: readonly string[], date: string): InvoiceRecord[] {
  requireAccess('doc.create');
  const invoices = localDb.invoices.getAll();
  const chosen = getTable<Indent>(INDENTS_TABLE).filter((i) => ids.includes(i.id));
  for (const i of chosen) {
    const st = indentStatus(i, invoices);
    if (st !== 'dispatched' && st !== 'paid') throw new AgencyError(`Indent ${i.number} is ${st}: only dispatched or paid indents are billed.`);
  }
  const byPrincipal = new Map<string, Indent[]>();
  for (const i of chosen) byPrincipal.set(i.principal_id, [...(byPrincipal.get(i.principal_id) ?? []), i]);
  return withTablesRollback(['invoices', INDENTS_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const out: InvoiceRecord[] = [];
    for (const [pid, rows] of byPrincipal) {
      const principal = localDb.clients.getById(pid);
      if (!principal) throw new AgencyError('The principal is not in Clients.');
      const bill = localDb.invoices.save(buildCommissionInvoice(rows, { principal, date, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: localDb.template.get() }));
      out.push(bill);
      const set = new Set(rows.map((r) => r.id));
      setTable(INDENTS_TABLE, getTable<Indent>(INDENTS_TABLE).map((i) => (set.has(i.id) ? { ...i, commission_invoice_id: bill.id, status: 'billed' as const, updated_at: new Date().toISOString() } : i)));
    }
    return out;
  });
}
