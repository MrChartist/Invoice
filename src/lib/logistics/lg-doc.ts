/**
 * R19-D document helpers (pure; family `f-logistics`) shared by the courier, storage and agent billers: a period and its
 * month end, a party's place of supply (Sec 12(8) / 12(2): a registered recipient's State, else its State on record, else
 * ours — where the goods are handed over), one service line and a document built on the editor's draft base (the
 * sender snapshot, template, terms) with its totals. Nothing is written here. Working papers — verify with your CA.
 */
import { calcInputFromRecord, calculateInvoice, deriveGstMode, round2 } from '../invoice-calc';
import { generateId } from '../storage';
import type { Client, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';

/** `YYYY-MM` of a day. */
export const periodOf = (day: string): string => day.slice(0, 7);
export const isPeriod = (p: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
/** The last day of a `YYYY-MM` period. */
export function monthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
/** The period before `period`. */
export const prevPeriod = (period: string): string => { const [y, m] = period.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

const gstinOk = (g?: string) => /^\d{2}[0-9A-Z]{13}$/.test((g ?? '').trim().toUpperCase());
/** Place of supply of a party: a registered recipient's State, else its State on record, else `home`. */
export const partyPos = (c: Pick<Client, 'gstin' | 'state_code'>, home: string): string => (gstinOk(c.gstin) ? c.gstin!.trim().slice(0, 2) : c.state_code || home);

/** One service line (quantity 1 unless given). */
export const svcLine = (name: string, description: string, amount: number, hsn: string | undefined, tax_rate: number, extra: Partial<InvoiceItem> = {}): InvoiceItem =>
  ({ id: generateId(), name, description, type: 'Service', hsn, unit: 'NOS', quantity: 1, rate: round2(amount), tax_rate, discount_percent: 0, amount: round2(amount), ...extra });

/** The sender's State (its GSTIN's, else the one on record). */
export const homeOf = (s: SenderProfile | null | undefined): string => (gstinOk(s?.companyGstin) ? s!.companyGstin!.trim().slice(0, 2) : s?.stateCode ?? '');

/** The editor's draft (`makeDraft`), the sender's State and registration, and the document date. */
export interface DocCtx { base: InvoiceRecord; home: string; registered: boolean; date: string }

/** A document on the draft base: tax invoice when we are registered (else invoice), `Sent`, GST mode from the POS, totals. */
export function lgDoc(ctx: DocCtx, client: Client, items: InvoiceItem[], pos: string, extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const doc_type = extra.doc_type ?? (ctx.registered ? 'TAX_INVOICE' : 'INVOICE');
  const rec: InvoiceRecord = {
    ...ctx.base, doc_type, issue_date: ctx.date, due_date: ctx.date > ctx.base.due_date ? ctx.date : ctx.base.due_date, status: 'Sent', client: { ...client }, items, place_of_supply: pos,
    gst_mode: doc_type === 'BILL_OF_SUPPLY' ? 'NONE' : deriveGstMode({ senderStateCode: ctx.home, placeOfSupply: pos, senderHasGstin: ctx.registered, taxEnabled: true }), reverse_charge: false, ...extra,
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount };
}

/** Live bills (not cancelled, not a note) — billed state is derived from them, never stored. */
export const liveBills = (invoices: readonly InvoiceRecord[]): InvoiceRecord[] => invoices.filter((i) => i.lg && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE' && i.doc_type !== 'DEBIT_NOTE');
